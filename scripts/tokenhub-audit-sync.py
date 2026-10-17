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
    try:
        payload = json.loads(completed.stdout)
    except ValueError:
        raise SyncError("Wrangler did not return valid JSON; no raw output logged") from None
    return wrangler_rows(payload)


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


def stored_case(row):
    analysis = parse_json(row.get("independent_analysis_json"))
    billing = parse_json(row.get("billing_evidence_json"))
    return {
        "slot": row["slot"], "caseId": row["case_id"], "kind": row["kind"], "requestedModel": row["model"],
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
        "request": parse_json(row.get("request_json")), "response": parse_json(row.get("response_json")),
        "expected": parse_json(row.get("expected_json")), "priceSnapshot": parse_json(row.get("price_json")),
        "priceHash": row.get("price_hash"), "creationResponse": parse_json(row.get("creation_json")),
        "headers": parse_json(row.get("headers_json")), "pollCount": row.get("poll_count", 0),
    }


def parse_time(value):
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result
    except (ValueError, TypeError, AttributeError):
        raise SyncError("Campaign timestamp is invalid") from None


def evidence(campaign, rows, now=None):
    now = now or datetime.now(timezone.utc)
    if campaign is None:
        return {"configured": False, "campaign": None, "counts": {}, "days": [], "cases": [], "flags": [], "exportedAt": now.isoformat()}
    start = parse_time(campaign["started_at"])
    saved = {(row["slot"], row["case_id"]): stored_case(row) for row in rows}
    if len(saved) != len(rows):
        raise SyncError("Duplicate stored case identity")
    cases = []
    for slot in range(14):
        plan = [(f"{model}:{variant}", "chat", model) for model in CHAT_MODELS for variant in ("short", "long")]
        if slot in (0, 13):
            plan += [("seedream-image", "image", "dola-seedream-5-0-pro-260628"), ("seedance-video", "video", "dreamina-seedance-2-0-260128")]
        for case_id, kind, model in plan:
            cases.append(saved.pop((slot, case_id), None) or {
                "slot": slot, "caseId": case_id, "kind": kind, "requestedModel": model,
                "state": "missed" if now >= start + timedelta(hours=12 * (slot + 1)) else "planned",
                "requestHash": None, "responseHash": None, "reservedMicros": 0,
                "request": None, "response": None, "expected": None, "flags": [],
                "tokenVerification": "pending_official_tokenizer", "billingVerification": "pending",
            })
    if saved:
        raise SyncError("Stored cases do not match this script's audit plan; update the script before exporting")
    reserved = sum(row.get("reserved_micros", 0) for row in rows)
    flags = sorted({flag for case in cases for flag in case.get("flags", []) if isinstance(flag, str)})
    analyses = [case.get("independentAnalysis") for case in cases if isinstance(case.get("independentAnalysis"), dict)]
    result = {
        "configured": True,
        "campaign": {"id": campaign["id"], "state": campaign["state"], "startedAt": campaign["started_at"],
                     "endsAt": campaign["ends_at"], "budgetMicros": campaign["budget_micros"], "reservedMicros": reserved,
                     "remainingMicros": max(0, campaign["budget_micros"] - reserved), "keyHint": campaign["key_hint"],
                     "planVersion": campaign["plan_version"], "pauseReason": campaign.get("pause_reason"),
                     "catalog": parse_json(campaign["catalog_json"]), "catalogHash": campaign["catalog_hash"],
                     "plannedCalls": 116, "plannedReservationMicros": 4_800_000, "identityVerification": "unverified",
                     "billingVerification": "pending", "tokenVerification": "needs_review" if any(item.get("status") == "needs_review" for item in analyses) else "provisional" if analyses else "pending_official_tokenizer"},
        "counts": dict(Counter(case["state"] for case in cases)), "days": [], "cases": cases, "flags": flags,
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
            " RETURNING slot,case_id;"
        )
    # The analysis stays out of process arguments and logs. NamedTemporaryFile is mode 0600.
    with tempfile.TemporaryDirectory(prefix="eco-geo-audit-sync-") as directory:
        path = Path(directory) / "import.sql"
        with path.open("x", encoding="utf-8") as handle:
            os.chmod(path, 0o600)
            handle.write("\n".join(statements) + "\n")
        changed = execute(sql_file=path)
    expected = {(slot, case_id) for slot, case_id, *_ in updates}
    actual = {(row.get("slot"), row.get("case_id")) for row in changed}
    if actual != expected or len(changed) != len(expected):
        raise SyncError(f"Import guarded against changed evidence: {len(actual & expected)}/{len(expected)} cases matched; export again before retrying")
    return {"importedCases": len(updates), "skippedIncompleteCases": skipped}


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
        result = evidence(campaign, rows)
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
