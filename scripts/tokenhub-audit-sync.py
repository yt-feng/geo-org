#!/usr/bin/env python3
"""Export TokenHub audit evidence or import independently analyzed case results.

Only explicit non-secret D1 columns are read. Remote access uses Wrangler's
existing authentication. No model requests, credentials or network settings
are handled here. An import is pinned to the current campaign and both saved
request/response hashes; stale or incomplete results are never written.
"""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DATABASE = "eco-geo-api"
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_CASE_BYTES = 64 * 1024
HASH = re.compile(r"^[0-9a-f]{64}$")
CHAT_MODELS = (
    "glm-5-3-flash-260828", "glm-5-2-260617",
    "deepseek-v4-pro-ga-260813", "deepseek-v4-flash-ga-260731",
)
CHAT_RESERVATIONS = dict(zip(CHAT_MODELS, (10_000, 50_000, 40_000, 10_000)))
PLAN_VERSION = "tokenhub-audit-v3"
# One short/long pair per model and campaign day, alternating anchor/fresh.
CHAT_SLOTS = frozenset((0, 3, 4, 7, 8, 11, 12))
VIDEO_ROTATION = {
    2: ("seedance-fast-video", "dreamina-seedance-2-0-fast-260128"),
    6: ("seedance-mini-video", "dreamina-seedance-2-0-mini-260615"),
    10: ("seedance-2-5-video", "dreamina-seedance-2-5-260628"),
}
# Never SELECT * here, including in the campaign subquery.
CAMPAIGN_COLUMNS = (
    "id,state,started_at,ends_at,budget_micros,key_hint,catalog_json,"
    "catalog_hash,plan_version,pause_reason,created_at,updated_at"
)
CASE_COLUMNS = (
    "campaign_id,slot,case_id,kind,model,state,reserved_micros,request_json,"
    "request_hash,expected_json,price_json,price_hash,response_json,response_hash,"
    "creation_json,headers_json,http_status,latency_ms,usage_json,returned_model,"
    "derived_cost_micros,grading_json,flags_json,independent_analysis_json,"
    "billing_actual_micros,billing_evidence_json,task_id,poll_count,next_poll_at,"
    "submitted_at,updated_at"
)
CATALOG_COLUMNS = (
    "campaign_id,day,state,attempt_count,next_attempt_at,models_json,models_hash,"
    "pricing_json,pricing_hash,catalog_json,error_json,fetched_at,updated_at"
)
LATEST_ID_SQL = "SELECT id FROM tokenhub_audit_campaigns ORDER BY created_at DESC,id DESC LIMIT 1"
FORBIDDEN_FIELDS = {"encrypted_key", "encryptedkey", "apikey", "api_key", "authorization", "access_token", "admin_session_secret"}


class SyncError(Exception):
    """Safe diagnostic: callers must not include raw records or CLI output."""


def sql_quote(value):
    if not isinstance(value, str) or "\x00" in value:
        raise SyncError("Invalid SQL text value")
    return "'" + value.replace("'", "''") + "'"


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def parse_json(value, default=None):
    if value is None:
        return default
    if not isinstance(value, str):
        raise SyncError("Unexpected stored JSON type")
    try:
        return json.loads(value, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, TypeError):
        raise SyncError("Stored evidence contains invalid JSON") from None


def sanitize(value):
    if isinstance(value, dict):
        return {key: "[REDACTED]" if key.lower() in FORBIDDEN_FIELDS else sanitize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    return value


def has_forbidden_field(value):
    if isinstance(value, dict):
        return any(key.lower() in FORBIDDEN_FIELDS or has_forbidden_field(item) for key, item in value.items())
    if isinstance(value, list):
        return any(has_forbidden_field(item) for item in value)
    return False


def wrangler_rows(payload):
    """Accept CLI [{results:...}] and API {result:[{results:...}]} envelopes."""
    rows = []

    def visit(node):
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict) or node.get("success") is False:
            raise SyncError("Wrangler returned an unsuccessful or invalid result")
        if "result" in node:
            visit(node["result"])
        elif "results" in node and isinstance(node["results"], list):
            if not all(isinstance(row, dict) for row in node["results"]):
                raise SyncError("Wrangler returned invalid rows")
            rows.extend(node["results"])
        else:
            raise SyncError("Wrangler result envelope was not recognized")

    visit(payload)
    return rows


def parse_wrangler_output(stdout):
    """Wrangler bulk uploads can print progress lines before their JSON result.

    Only attempt a complete JSON suffix beginning at a line boundary. Never
    strip arbitrary text from inside JSON or accept trailing unparsed output.
    """
    lines = stdout.splitlines()
    for index, line in enumerate(lines):
        if not line.lstrip().startswith(("[", "{")):
            continue
        try:
            payload = json.loads("\n".join(lines[index:]))
        except ValueError:
            continue
        return wrangler_rows(payload)
    raise SyncError("Wrangler did not return a complete JSON result; no raw output logged")


def run_wrangler(*, command=None, sql_file=None):
    if (command is None) == (sql_file is None):
        raise SyncError("Exactly one SQL input is required")
    argv = ["npx", "wrangler", "d1", "execute", DATABASE, "--remote", "--json"]
    argv += ["--command", command] if command is not None else ["--file", str(sql_file)]
    try:
        completed = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True,
                                   check=False, timeout=180, shell=False)
    except subprocess.TimeoutExpired:
        raise SyncError("Wrangler timed out; export fresh evidence before retrying an import") from None
    except OSError:
        raise SyncError("Wrangler could not be started") from None
    if completed.returncode != 0:
        # CLI output may include arbitrary SQL/data. Do not print it or command arguments.
        raise SyncError(f"Wrangler command failed (exit {completed.returncode}); no raw output logged")
    return parse_wrangler_output(completed.stdout)


def current_snapshot(query=run_wrangler):
    campaigns = query(command=f"SELECT {CAMPAIGN_COLUMNS} FROM tokenhub_audit_campaigns ORDER BY created_at DESC,id DESC LIMIT 1")
    if not campaigns:
        return None, []
    if len(campaigns) != 1 or not isinstance(campaigns[0].get("id"), str):
        raise SyncError("Current campaign is ambiguous")
    campaign = campaigns[0]
    rows = query(command=f"SELECT {CASE_COLUMNS} FROM tokenhub_audit_cases WHERE campaign_id={sql_quote(campaign['id'])} ORDER BY slot,case_id")
    if any(row.get("campaign_id") != campaign["id"] for row in rows):
        raise SyncError("Case belongs to a different campaign")
    return campaign, rows


def catalog_snapshot(campaign, query=run_wrangler):
    if campaign is None:
        return []
    rows = query(command=f"SELECT {CATALOG_COLUMNS} FROM tokenhub_audit_catalog_snapshots WHERE campaign_id={sql_quote(campaign['id'])} ORDER BY day")
    if any(row.get("campaign_id") != campaign["id"] for row in rows):
        raise SyncError("Catalog snapshot belongs to a different campaign")
    days = [row.get("day") for row in rows]
    if any(isinstance(day, bool) or not isinstance(day, int) or not 0 <= day < 7 for day in days) or len(set(days)) != len(days):
        raise SyncError("Catalog snapshot has an invalid or duplicate day")
    return rows


def stored_case(row):
    analysis = parse_json(row.get("independent_analysis_json"))
    billing = parse_json(row.get("billing_evidence_json"))
    request = parse_json(row.get("request_json"))
    expected = parse_json(row.get("expected_json"))
    plan_version = expected.get("protocolVersion") if isinstance(expected, dict) else None
    max_output_tokens = request.get("max_tokens") if isinstance(request, dict) else None
    return {
        "slot": row["slot"], "caseId": row["case_id"], "kind": row["kind"], "requestedModel": row["model"],
        "planVersion": plan_version if isinstance(plan_version, str) else "tokenhub-audit-v1",
        "maxOutputTokens": max_output_tokens if isinstance(max_output_tokens, int) and not isinstance(max_output_tokens, bool) else None,
        "state": row["state"], "reservedMicros": row["reserved_micros"],
        "submittedAt": None if row["state"] in ("price_blocked", "reserved", "window_expired") else row.get("submitted_at"),
        "updatedAt": row.get("updated_at"), "usage": parse_json(row.get("usage_json")),
        "returnedModel": row.get("returned_model"), "derivedExpectedCostMicros": row.get("derived_cost_micros"),
        "grading": parse_json(row.get("grading_json")), "flags": parse_json(row.get("flags_json"), []),
        "taskId": row.get("task_id"), "httpStatus": row.get("http_status"), "latencyMs": row.get("latency_ms"),
        "requestHash": row.get("request_hash"), "responseHash": row.get("response_hash"),
        "independentAnalysis": analysis, "billingActualMicros": row.get("billing_actual_micros"), "billingEvidence": billing,
        "tokenVerification": analysis.get("tokenVerification", "provisional") if isinstance(analysis, dict) else "pending_official_tokenizer",
        "billingVerification": "recorded" if row.get("billing_actual_micros") is not None and billing else "pending",
        "request": request, "response": parse_json(row.get("response_json")),
        "expected": expected, "priceSnapshot": parse_json(row.get("price_json")),
        "priceHash": row.get("price_hash"), "creationResponse": parse_json(row.get("creation_json")),
        "headers": parse_json(row.get("headers_json")), "pollCount": row.get("poll_count", 0),
    }


def parse_time(value):
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result
    except (ValueError, TypeError, AttributeError):
        raise SyncError("Campaign timestamp is invalid") from None


def planned_cases(slot):
    plan = []
    if slot in CHAT_SLOTS:
        plan += [(f"{model}:{variant}", "chat", model, CHAT_RESERVATIONS[model]) for model in CHAT_MODELS for variant in ("short", "long")]
    if slot in (0, 13):
        plan += [("seedream-image", "image", "dola-seedream-5-0-pro-260628", 120_000), ("seedance-video", "video", "dreamina-seedance-2-0-260128", 600_000)]
    if slot in VIDEO_ROTATION:
        case_id, model = VIDEO_ROTATION[slot]
        plan.append((case_id, "video", model, 600_000))
    return plan


def catalog_observations(rows):
    observations = []
    for row in rows:
        models = parse_json(row.get("catalog_json"), [])
        if not isinstance(models, list) or not all(isinstance(model, dict) and isinstance(model.get("model"), str) for model in models):
            raise SyncError("Stored normalized catalog is invalid")
        observations.append({
            "day": row["day"] + 1, "observedAt": row.get("fetched_at"), "status": row["state"],
            "attemptCount": row.get("attempt_count"), "nextAttemptAt": row.get("next_attempt_at"), "updatedAt": row.get("updated_at"),
            "modelsHash": row.get("models_hash"), "pricingHash": row.get("pricing_hash"),
            "modelCount": len(models), "models": models, "errors": parse_json(row.get("error_json"), []),
            "modelsResponse": parse_json(row.get("models_json")), "pricingResponse": parse_json(row.get("pricing_json")),
        })
    return observations


def known_models():
    models = [(model, "chat") for model in CHAT_MODELS]
    models += [("dola-seedream-5-0-pro-260628", "image"), ("dreamina-seedance-2-0-260128", "video")]
    models += [(model, "video") for _, model in VIDEO_ROTATION.values()]
    return [{"model": model, "kind": kind, "label": model, "sources": [], "enabled": None} for model, kind in models]


def normalize_initial_catalog(value):
    """Match the server's model-source normalizer for the campaign baseline."""
    known = {model["model"]: model for model in known_models()}
    models = {}
    for raw in value.get("data", []) if isinstance(value, dict) and isinstance(value.get("data"), list) else []:
        if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) or not 0 < len(raw["id"]) <= 200:
            continue
        model_id = raw["id"]
        type_names = []
        for field in ("modelType", "capabilities", "type"):
            field_value = raw.get(field)
            type_names += [item for item in (field_value if isinstance(field_value, list) else [field_value]) if isinstance(item, str)]
        types = " ".join(type_names).lower()
        deployments = [item for item in raw.get("deployments", []) if isinstance(item, dict)] if isinstance(raw.get("deployments"), list) else []
        prices = [item["pricing"] for item in deployments if isinstance(item.get("pricing"), dict)]
        prior = models.get(model_id, {})
        if model_id in known:
            kind = known[model_id]["kind"]
        elif any(isinstance(price.get("video"), dict) for price in prices) or "video" in types:
            kind = "video"
        elif any(isinstance(price.get("fixed"), dict) and price["fixed"].get("priceUnit") == "image" for price in prices) or "image" in types:
            kind = "image"
        elif any(name in types for name in ("chat", "text", "completion")):
            kind = "chat"
        else:
            kind = prior.get("kind", "unknown")
        label = raw.get("label") if isinstance(raw.get("label"), str) else raw.get("name") if isinstance(raw.get("name"), str) else prior.get("label", model_id)
        models[model_id] = {"model": model_id, "kind": kind, "label": label[:200], "sources": prior.get("sources", []) + ["models"],
                            "enabled": any(item.get("enabled") is True for item in deployments) if deployments else prior.get("enabled")}
    return list(models.values())


def all_catalog_models(campaign, cases, observations):
    known = known_models()
    union = {model["model"]: dict(model, lastSeenAt=None) for model in known}
    for model in normalize_initial_catalog(parse_json(campaign["catalog_json"])):
        union[model["model"]] = dict(model, lastSeenAt=campaign["started_at"])
    for observation in observations:
        for model in observation["models"]:
            union[model["model"]] = dict(model, lastSeenAt=observation["observedAt"])
    for case in cases:
        if case["requestedModel"] not in union:
            model_id = case["requestedModel"]
            union[model_id] = {"model": model_id, "kind": case["kind"], "label": model_id, "sources": [], "enabled": None, "lastSeenAt": None}
    latest_complete = next((observation for observation in reversed(observations) if observation["status"] == "succeeded"), None)
    supported = {model["model"] for model in known}
    result = []
    for model in union.values():
        state = "unobserved" if not model["lastSeenAt"] else "present"
        if (model["lastSeenAt"] and latest_complete and latest_complete["observedAt"]
                and latest_complete["observedAt"] >= model["lastSeenAt"]
                and not any(item["model"] == model["model"] for item in latest_complete["models"])):
            state = "disappeared"
        result.append(dict(model, catalogState=state, paidAdapterSupported=model["model"] in supported,
                           plannedCalls=sum(case["requestedModel"] == model["model"] for case in cases),
                           observedDays=sum(observation["status"] == "succeeded" and any(item["model"] == model["model"] for item in observation["models"]) for observation in observations)))
    return result


def evidence(campaign, rows, now=None, catalog_rows=None):
    now = now or datetime.now(timezone.utc)
    if campaign is None:
        return {"configured": False, "campaign": None, "counts": {}, "days": [], "cases": [], "flags": [], "catalogObservations": [], "catalogModels": [], "exportedAt": now.isoformat()}
    start = parse_time(campaign["started_at"])
    saved = {(row["slot"], row["case_id"]): stored_case(row) for row in rows}
    if len(saved) != len(rows):
        raise SyncError("Duplicate stored case identity")
    cases = []
    planned_reservation = 0
    for slot in range(14):
        plan = planned_cases(slot)
        for case_id, kind, model, reservation in plan:
            existing = saved.pop((slot, case_id), None)
            # Retain reservations for historical calibration requests instead of repricing them.
            planned_reservation += existing["reservedMicros"] if existing is not None else reservation
            cases.append(dict(existing, retainedFromEarlierPlan=False) if existing is not None else {
                "slot": slot, "caseId": case_id, "kind": kind, "requestedModel": model,
                "retainedFromEarlierPlan": False,
                "planVersion": PLAN_VERSION, "maxOutputTokens": 8192 if kind == "chat" else None,
                "state": "missed" if now >= start + timedelta(hours=12 * (slot + 1)) else "planned",
                "requestHash": None, "responseHash": None, "reservedMicros": 0,
                "request": None, "response": None, "expected": None, "flags": [],
                "tokenVerification": "pending_official_tokenizer", "billingVerification": "pending",
            })
    # Plan upgrades may remove an unexecuted slot. An already saved request in
    # that slot remains evidence and continues consuming its original reserve.
    cases.extend(dict(case, retainedFromEarlierPlan=True) for case in saved.values())
    planned_reservation += sum(case["reservedMicros"] for case in saved.values())
    cases.sort(key=lambda case: (case["slot"], case["caseId"]))
    reserved = sum(row.get("reserved_micros", 0) for row in rows)
    flags = sorted({flag for case in cases for flag in case.get("flags", []) if isinstance(flag, str)})
    analyses = [case.get("independentAnalysis") for case in cases if isinstance(case.get("independentAnalysis"), dict)]
    observations = catalog_observations(catalog_rows or [])
    result = {
        "configured": True,
        "campaign": {"id": campaign["id"], "state": campaign["state"], "startedAt": campaign["started_at"],
                     "endsAt": campaign["ends_at"], "budgetMicros": campaign["budget_micros"], "reservedMicros": reserved,
                     "remainingMicros": max(0, campaign["budget_micros"] - reserved), "keyHint": campaign["key_hint"],
                     "planVersion": campaign["plan_version"], "pauseReason": campaign.get("pause_reason"),
                     "catalog": parse_json(campaign["catalog_json"]), "catalogHash": campaign["catalog_hash"],
                     "plannedCalls": len(cases), "plannedReservationMicros": planned_reservation, "identityVerification": "unverified",
                     "billingVerification": "pending", "tokenVerification": "needs_review" if any(item.get("status") == "needs_review" for item in analyses) else "provisional" if analyses else "pending_official_tokenizer"},
        "counts": dict(Counter(case["state"] for case in cases)), "days": [], "cases": cases, "flags": flags,
        "catalogObservations": observations, "catalogModels": all_catalog_models(campaign, cases, observations),
        "exportedAt": now.isoformat(), "exportSource": "D1 explicit-column evidence snapshot; daily aggregates are computed by the offline analyzer",
    }
    return sanitize(result)


def read_analysis(path):
    if path.stat().st_size > MAX_FILE_BYTES:
        raise SyncError("Analysis file exceeds 64 MiB")
    try:
        report = json.loads(path.read_text(encoding="utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError):
        raise SyncError("Analysis file is not valid JSON") from None
    return report


def prepare_import(report, campaign, rows):
    if not isinstance(report, dict) or report.get("schemaVersion") != 1 or not isinstance(report.get("cases"), list):
        raise SyncError("Expected offline analyzer schemaVersion 1 with cases array")
    if campaign is None or report.get("campaignId") != campaign["id"]:
        raise SyncError("Analysis campaign does not match the current campaign; nothing written")
    existing = {(row["slot"], row["case_id"]): row for row in rows}
    seen, updates, skipped = set(), [], 0
    for item in report["cases"]:
        if not isinstance(item, dict):
            raise SyncError("Invalid analysis case; nothing written")
        slot, case_id = item.get("slot"), item.get("caseId")
        if isinstance(slot, bool) or not isinstance(slot, int) or not 0 <= slot < 14 or not isinstance(case_id, str) or not case_id:
            raise SyncError("Invalid analysis case identity; nothing written")
        identity = (slot, case_id)
        if identity in seen:
            raise SyncError("Duplicate analysis case; nothing written")
        seen.add(identity)
        request_hash, response_hash = item.get("requestHash"), item.get("responseHash")
        if request_hash is None or response_hash is None:
            skipped += 1
            continue
        if not isinstance(request_hash, str) or not HASH.fullmatch(request_hash) or not isinstance(response_hash, str) or not HASH.fullmatch(response_hash):
            raise SyncError("Invalid analysis hash; nothing written")
        row = existing.get(identity)
        if not row or row.get("campaign_id") != report["campaignId"] or row.get("request_hash") != request_hash or row.get("response_hash") != response_hash:
            raise SyncError("Stale or unmatched analysis evidence; nothing written")
        if item.get("requestedModel") != row.get("model") or item.get("kind") != row.get("kind"):
            raise SyncError("Analysis model or kind differs from saved evidence; nothing written")
        if has_forbidden_field(item):
            raise SyncError("Analysis contains a credential field; nothing written")
        serialized = encode(item)
        if len(serialized.encode("utf-8")) > MAX_CASE_BYTES:
            raise SyncError("Analysis case exceeds 64 KiB; nothing written")
        updates.append((slot, case_id, request_hash, response_hash, serialized))
    return updates, skipped


def import_analysis(report, campaign, rows, execute=run_wrangler):
    updates, skipped = prepare_import(report, campaign, rows)
    if not updates:
        return {"importedCases": 0, "skippedIncompleteCases": skipped}
    statements = []
    campaign_id = sql_quote(campaign["id"])
    for slot, case_id, request_hash, response_hash, serialized in updates:
        statements.append(
            "UPDATE tokenhub_audit_cases SET independent_analysis_json=" + sql_quote(serialized) +
            f" WHERE campaign_id={campaign_id} AND campaign_id=({LATEST_ID_SQL}) AND slot={slot}" +
            f" AND case_id={sql_quote(case_id)} AND request_hash={sql_quote(request_hash)} AND response_hash={sql_quote(response_hash)}" +
            ";"
        )
    # The analysis stays out of process arguments and logs. NamedTemporaryFile is mode 0600.
    with tempfile.TemporaryDirectory(prefix="eco-geo-audit-sync-") as directory:
        path = Path(directory) / "import.sql"
        with path.open("x", encoding="utf-8") as handle:
            os.chmod(path, 0o600)
            handle.write("\n".join(statements) + "\n")
        try:
            execute(sql_file=path)
        except SyncError:
            # A CLI/upload/JSON failure may follow a committed write. Never resend.
            # Read back once to determine the actual outcome instead.
            pass
    try:
        verified_rows = execute(command=(
            "SELECT campaign_id,slot,case_id,request_hash,response_hash,independent_analysis_json "
            f"FROM tokenhub_audit_cases WHERE campaign_id={campaign_id} AND campaign_id=({LATEST_ID_SQL}) ORDER BY slot,case_id"
        ))
    except SyncError:
        raise SyncError("Import was submitted but read-back verification failed; do not resubmit, export fresh evidence to inspect the outcome") from None
    verified = {(row.get("slot"), row.get("case_id")): row for row in verified_rows}
    if len(verified) != len(verified_rows):
        raise SyncError("Import read-back returned duplicate identities; do not resubmit, export fresh evidence")
    matched = 0
    for slot, case_id, request_hash, response_hash, serialized in updates:
        row = verified.get((slot, case_id), {})
        if (row.get("campaign_id") == campaign["id"] and row.get("request_hash") == request_hash
                and row.get("response_hash") == response_hash and row.get("independent_analysis_json") == serialized):
            matched += 1
    if matched != len(updates):
        raise SyncError(f"Import read-back matched {matched}/{len(updates)} cases exactly; do not resubmit, export fresh evidence to inspect changed or unapplied rows")
    return {"importedCases": matched, "skippedIncompleteCases": skipped}


def write_private_json(path, value):
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".audit-export-", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Write getAuditStatus-compatible evidence JSON (mode 0600)")
    parser.add_argument("--import-analysis", type=Path, help="Import an offline analyzer report after matching campaign and both hashes")
    args = parser.parse_args(argv)
    if not args.output and not args.import_analysis:
        parser.error("provide --output and/or --import-analysis")
    report = read_analysis(args.import_analysis) if args.import_analysis else None
    campaign, rows = current_snapshot()
    summary = {}
    if report is not None:
        summary.update(import_analysis(report, campaign, rows))
        if args.output:
            campaign, rows = current_snapshot()
    if args.output:
        result = evidence(campaign, rows, catalog_rows=catalog_snapshot(campaign))
        write_private_json(args.output, result)
        summary.update(exportedCases=len(result["cases"]), savedCases=len(rows), counts=result["counts"])
    print(json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (SyncError, OSError, ValueError, KeyError, TypeError) as error:
        print(str(error) if isinstance(error, SyncError) else "Audit sync failed: " + type(error).__name__, file=sys.stderr)
        sys.exit(2)
