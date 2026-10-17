#!/usr/bin/env python3
"""Offline evidence analysis. No network, credentials, model execution or remote code.

Input: getAuditStatus(..., true) JSON export. Output contains counts and findings,
not request/response text. See docs/tokenhub-seven-day-audit.md for limitations.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
BOS, EOS = "<｜begin▁of▁sentence｜>", "<｜end▁of▁sentence｜>"
USER, ASSISTANT = "<｜User｜>", "<｜Assistant｜>"


def obj(value):
    return value if isinstance(value, dict) else {}


def integer(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    data = path.read_bytes()
    if len(data) > 64 * 1024 * 1024:
        raise ValueError("Evidence JSON exceeds 64 MiB; split exports before analysis")
    return json.loads(data), digest(data)


class LocalTokenizers:
    def __init__(self, manifest_path, directory):
        self.manifest, self.manifest_hash = read_json(manifest_path)
        self.directory, self.loaded, self.status = directory, {}, {}
        try:
            import tokenizers
            self.library = tokenizers
            self.version = tokenizers.__version__
        except ImportError:
            self.library, self.version = None, None

    def get(self, model):
        if model in self.status:
            return self.loaded.get(model)
        entry = obj(self.manifest.get("models")).get(model)
        if not entry:
            self.status[model] = {"status": "unavailable", "reason": "No independently pinned tokenizer for this model version"}
            return None
        status = {"repository": entry["repository"], "commit": entry["commit"], "mapping": entry["model_mapping"]}
        self.status[model] = status
        if self.library is None:
            status.update(status="unavailable", reason="Install pinned tokenizers library; no network lookup was attempted")
            return None
        if self.version != self.manifest.get("tokenizers_version"):
            status.update(status="unavailable", reason="tokenizers library version does not match manifest")
            return None
        try:
            directory = self.directory / entry["repository"].split("/")[-1]
            # All downloaded evidence is checked. Python source is never imported or executed.
            for filename, expected in entry["files"].items():
                path = directory / filename
                if digest(path.read_bytes()) != expected["sha256"]:
                    raise ValueError("Pinned file hash mismatch: " + filename)
            tokenizer = self.library.Tokenizer.from_file(str(directory / "tokenizer.json"))
            test = entry["self_test"]
            ids = tokenizer.encode(test["text"], add_special_tokens=False).ids
            ids_hash = digest(json.dumps(ids, separators=(",", ":")).encode())
            if len(ids) != test["token_count"] or ids_hash != test["token_ids_sha256"]:
                raise ValueError("Pinned tokenizer self-test mismatch")
            self.loaded[model] = tokenizer
            status.update(status="available", selfTest="matched", selfTestTokens=len(ids))
            return tokenizer
        except Exception as error:
            # No input contents or secret values are included in diagnostics.
            status.update(status="unavailable", reason=type(error).__name__ + ": local file/hash/self-test validation failed")
            return None


def count(tokenizer, text):
    return len(tokenizer.encode(text, add_special_tokens=False).ids)


def visible_reasoning(message):
    """Choose one visible representation; never sum duplicate provider fields.

    Summaries and encrypted blobs are not the complete generated reasoning.
    Different visible representations stay ambiguous, not concatenated together.
    """
    sources, incomplete = {}, False
    for name in ("reasoning_content", "reasoning"):
        value = message.get(name)
        if isinstance(value, str):
            sources[name] = value
        elif value is not None:
            incomplete = True
    details = message.get("reasoning_details")
    if isinstance(details, list):
        texts, seen_chunks = [], set()
        for item in details:
            item = obj(item)
            if item.get("type") == "reasoning.text" and isinstance(item.get("text"), str):
                identifier = item.get("id")
                chunk = (identifier, item["text"])
                if isinstance(identifier, str) and chunk in seen_chunks:
                    continue
                if isinstance(identifier, str):
                    seen_chunks.add(chunk)
                texts.append(item["text"])
            else:
                incomplete = True
        if texts:
            sources["reasoning_details_text"] = "".join(texts)
    elif details is not None:
        incomplete = True
    source = next((name for name, value in sources.items() if value), next(iter(sources), None))
    selected = sources.get(source) if source else None
    distinct = {value for value in sources.values() if value}
    return {"source": source, "selected": selected, "sources": sources, "representationsAgree": len(distinct) <= 1,
            "incompleteOrOpaque": incomplete, "note": "One representation counted; summaries/encrypted data are not raw reasoning"}


def prompt_candidates(body):
    """Reviewed subset of official encoding: optional system then one user only.

    Deliberately not a generic copied chat template. All unsupported features
    return no candidate. Upstream framing remains unverified even for this subset.
    """
    messages = body.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 2:
        return None
    if body.get("tools") or body.get("response_format") or body.get("reasoning_effort") not in (None, "low"):
        return None
    if any(not isinstance(m, dict) or not isinstance(m.get("content"), str) or set(m) - {"role", "content"} for m in messages):
        return None
    roles = [m["role"] for m in messages]
    if roles not in (["user"], ["system", "user"]):
        return None
    system = messages[0]["content"] if len(messages) == 2 else ""
    prefix = BOS + system + USER + messages[-1]["content"] + ASSISTANT
    return {"chat": prefix + "</think>", "thinking": prefix + "<think>"}


def capability(case, response):
    http_status = case.get("httpStatus")
    if integer(http_status) and not 200 <= http_status < 300:
        return {"status": "request_failed", "score": None}
    expected = obj(case.get("expected"))
    answers = expected.get("answers")
    choice = obj((response.get("choices") or [{}])[0])
    content = obj(choice.get("message")).get("content")
    if choice.get("finish_reason") == "length":
        return {"status": "truncated", "correct": None, "total": len(answers) if isinstance(answers, list) else None, "score": None}
    if not isinstance(answers, list) or not answers:
        return {"status": "ungradable", "reason": "Missing independently generated expected answers", "score": None}
    if not isinstance(content, str) or not content.strip():
        return {"status": "empty", "score": None}
    parsed, parsed_ok = None, False
    if isinstance(content, str):
        try:
            parsed = json.loads(re.sub(r"\s*```$", "", re.sub(r"^```(?:json)?\s*", "", content.strip(), flags=re.I)))
            parsed_ok = True
        except ValueError:
            pass
    parsed = obj(parsed)
    actual = parsed.get("answers")
    checks = [isinstance(actual, list) and i < len(actual) and not isinstance(actual[i], bool) and isinstance(actual[i], (int, float)) and actual[i] == answer for i, answer in enumerate(answers)]
    nonce_matches = parsed.get("nonce") == expected.get("nonce") and isinstance(expected.get("nonce"), str)
    # A replay is a response-integrity failure, not an ability score on this task.
    if parsed_ok and not nonce_matches:
        return {"status": "stale_or_mismatched_nonce", "correct": 0, "total": 0, "score": None, "subitems": checks, "nonceMatches": False}
    correct = sum(checks) if nonce_matches else 0
    return {"status": "scored" if parsed_ok else "invalid_json", "correct": correct, "total": len(answers),
            "score": correct / len(answers) * 100, "subitems": checks, "nonceMatches": nonce_matches,
            "exactAnswerLength": isinstance(actual, list) and len(actual) == len(answers)}


def estimated_cost(case, response, usage):
    """Recompute the advertised estimate; never present it as actual payment."""
    result = {"status": "pending_actual_ledger", "derivedExpectedCostMicros": case.get("derivedExpectedCostMicros"),
              "independentEstimateMicros": None, "note": "Usage-based estimate is not an independently reconciled debit"}
    try:
        catalog = obj(obj(case.get("priceSnapshot")).get("data"))
        if catalog.get("currencyCode") != "USD":
            return result
        models = [m for m in catalog.get("data", []) if obj(m).get("id") == case.get("requestedModel")]
        if len(models) != 1:
            return result
        prices = [d["pricing"] for d in models[0].get("deployments", []) if obj(d).get("enabled") is True and isinstance(d.get("pricing"), dict)]
        if not prices:
            return result
        values = []
        for pricing in prices:
            def amount(field, tokens=True):
                price = obj(field)
                money = obj(price.get("amount"))
                if money.get("currencyCode") != "USD" or not integer(money.get("unitsMicros")):
                    raise ValueError("Invalid money")
                if tokens and not re.search(r"/\s*1M tokens$", str(price.get("display", ""))):
                    raise ValueError("Unverified price unit")
                return money["unitsMicros"]
            kind = case.get("kind")
            if kind == "chat":
                prompt, completion = usage.get("prompt_tokens"), usage.get("completion_tokens")
                if not integer(prompt) or not integer(completion):
                    return result
                cached = obj(usage.get("prompt_tokens_details")).get("cached_tokens", usage.get("prompt_cache_hit_tokens", 0))
                if not integer(cached) or cached > prompt:
                    return result
                numerator = (prompt - cached) * amount(pricing.get("input")) + completion * amount(pricing.get("output"))
                if cached:
                    numerator += cached * amount(pricing.get("cacheRead"))
                values.append((numerator + 999999) // 1000000)
            elif kind == "image":
                fixed = obj(pricing.get("fixed"))
                if fixed.get("priceUnit") != "image":
                    return result
                images = [i for i in response.get("data", []) if isinstance(obj(i).get("url"), str) and not obj(i).get("error")]
                values.append(len(images) * amount(fixed, False))
            elif kind == "video" and integer(usage.get("completion_tokens")):
                rate = amount(obj(pricing.get("video")).get("withoutVideo480p"))
                request = obj(case.get("request"))
                if request.get("resolution") != "480p" or any(obj(c).get("type") == "video_url" for c in request.get("content", [])):
                    return result
                values.append((usage["completion_tokens"] * rate + 999999) // 1000000)
        if values and len(set(values)) == 1:
            result.update(independentEstimateMicros=values[0], estimateMatchesServer=values[0] == case.get("derivedExpectedCostMicros"))
    except (TypeError, KeyError, ValueError):
        pass
    return result


def analyze_case(case, tokenizers):
    raw_response, body = obj(case.get("response")), obj(case.get("request"))
    response = obj(raw_response.get("data")) or raw_response
    model, kind = case.get("requestedModel"), case.get("kind")
    slot = case.get("slot")
    max_tokens = body.get("max_tokens") if integer(body.get("max_tokens")) else None
    result = {"slot": slot, "day": slot // 2 + 1 if integer(slot) else None, "caseId": case.get("caseId"),
              "kind": kind, "requestedModel": model, "state": case.get("state"), "findings": [], "status": "provisional",
              "requestHash": case.get("requestHash"), "responseHash": case.get("responseHash"),
              "suite": obj(case.get("expected")).get("suite"), "difficultyVersion": obj(case.get("expected")).get("difficultyVersion"),
              "maxTokens": max_tokens,
              "configurationCohort": "max_tokens:" + str(max_tokens) if max_tokens is not None else "max_tokens:unknown"}
    if not response:
        result.update(status="insufficient_evidence", tokenVerification="insufficient_evidence_response_unavailable", evidence="not_available", capability={"status": "not_run", "score": None})
        return result
    returned = response.get("model", case.get("returnedModel"))
    result["identity"] = {"status": "unverified", "returnedModel": returned,
                          "declarationMatchesRequest": returned == model if returned else None,
                          "routeDeclaration": response.get("extra_fields"),
                          "note": "Response fields are provider declarations, not authenticated model provenance"}
    if returned and returned != model:
        result["findings"].append("model_declaration_differs_requires_alias_or_route_explanation")
    # Full extra_fields may include arbitrary text. Preserve only declared routing fields.
    extra = obj(response.get("extra_fields"))
    result["identity"]["routeDeclaration"] = {k: extra[k] for k in ("provider", "model", "model_used", "provider_used", "cache_hit") if k in extra}
    usage = obj(response.get("usage")) or obj(raw_response.get("usage")) or obj(case.get("usage"))
    result["usage"] = {k: usage.get(k) for k in ("prompt_tokens", "completion_tokens", "total_tokens")}
    result["billing"] = estimated_cost(case, response, usage)
    if result["billing"].get("estimateMatchesServer") is False:
        result["findings"].append("independent_and_server_cost_estimates_differ")
    if not usage:
        result["findings"].append("missing_usage")
    elif kind == "chat":
        fields = [usage.get(k) for k in ("prompt_tokens", "completion_tokens", "total_tokens")]
        if not all(integer(x) for x in fields):
            result["findings"].append("missing_or_invalid_integer_usage")
        elif fields[0] + fields[1] != fields[2]:
            result["findings"].append("usage_sum_mismatch")
        hit, miss = usage.get("prompt_cache_hit_tokens"), usage.get("prompt_cache_miss_tokens")
        if integer(hit) and integer(miss) and integer(fields[0]) and hit + miss != fields[0]:
            result["findings"].append("cache_breakdown_sum_mismatch")
        reasoning = obj(usage.get("completion_tokens_details")).get("reasoning_tokens")
        if integer(reasoning) and integer(fields[1]) and reasoning > fields[1]:
            result["findings"].append("reasoning_count_exceeds_completion")
    if kind != "chat":
        result["mediaVerification"] = "pending_actual_file_metadata_and_visual_review"
        result["tokenVerification"] = "not_a_text_tokenizer_check"
        result["status"] = "needs_review" if result["findings"] else "insufficient_evidence"
        return result
    choice = obj((response.get("choices") or [{}])[0])
    message = obj(choice.get("message"))
    reasoning_evidence = visible_reasoning(message)
    result["reasoningEvidence"] = {"source": reasoning_evidence["source"],
                                   "sourceCharacterLengths": {name: len(text) for name, text in reasoning_evidence["sources"].items()},
                                   "representationsAgree": reasoning_evidence["representationsAgree"],
                                   "incompleteOrOpaque": reasoning_evidence["incompleteOrOpaque"]}
    result["capability"] = capability(case, response)
    if result["capability"].get("status") == "empty":
        result["findings"].append("empty_answer_excluded_from_capability_score")
    if result["capability"].get("status") == "stale_or_mismatched_nonce":
        result["findings"].append("nonce_mismatch_excluded_from_capability_score")
    if choice.get("finish_reason") == "length":
        result["findings"].append("output_truncated_excluded_from_capability_score")
    if obj(case.get("grading")).get("score") is not None and result["capability"].get("score") != obj(case.get("grading")).get("score"):
        result["findings"].append("server_and_independent_grading_differ")
    if integer(max_tokens) and integer(usage.get("completion_tokens")) and usage["completion_tokens"] > max_tokens:
        result["findings"].append("completion_exceeds_requested_limit_requires_semantics_check")
    tokenizer = tokenizers.get(model)
    if tokenizer is None:
        result["tokenVerification"] = "insufficient_evidence_tokenizer_unavailable"
        result["status"] = "needs_review" if result["findings"] else "insufficient_evidence"
        return result
    texts = [m["content"] for m in body.get("messages", []) if isinstance(m, dict) and isinstance(m.get("content"), str)]
    candidates = prompt_candidates(body)
    local = {"status": "provisional", "templateConfirmedByUpstream": False,
             "promptTextTokensSeparately": sum(count(tokenizer, text) for text in texts),
             "promptUtf8Bytes": sum(len(text.encode()) for text in texts),
             "visibleOutputTokens": count(tokenizer, message.get("content") or "") if isinstance(message.get("content"), (str, type(None))) else None,
             "visibleReasoningTokens": count(tokenizer, reasoning_evidence["selected"]) if reasoning_evidence["selected"] is not None else None,
             "reasoningSource": reasoning_evidence["source"],
             "reasoningSourceTokenCounts": {name: count(tokenizer, text) for name, text in reasoning_evidence["sources"].items()},
             "reasoningRepresentationsAgree": reasoning_evidence["representationsAgree"],
             "reasoningIncompleteOrOpaque": reasoning_evidence["incompleteOrOpaque"],
             "reportedReasoningTokens": obj(usage.get("completion_tokens_details")).get("reasoning_tokens"),
             "thinkingRequest": body.get("thinking"), "reasoningMayBeHidden": True}
    if candidates:
        local["promptCandidates"] = {mode: count(tokenizer, text) for mode, text in candidates.items()}
        reported = usage.get("prompt_tokens")
        local["promptResiduals"] = {mode: reported - value for mode, value in local["promptCandidates"].items()} if integer(reported) else None
    visible = message.get("content")
    reasoning = reasoning_evidence["selected"]
    if isinstance(visible, str) and not message.get("tool_calls"):
        local["completionCandidates"] = {"chat_with_eos": count(tokenizer, visible + EOS)}
        if isinstance(reasoning, str):
            local["completionCandidates"]["visible_thinking_with_eos"] = count(tokenizer, reasoning + "</think>" + visible + EOS)
        reported = usage.get("completion_tokens")
        local["completionResiduals"] = {mode: reported - value for mode, value in local["completionCandidates"].items()} if integer(reported) else None
    result.update(localTokens=local, tokenVerification="provisional_local_counts_not_model_authentication")
    if result["findings"]:
        result["status"] = "needs_review"
    return result


def pair_checks(cases):
    pairs = defaultdict(dict)
    for case in cases:
        if case.get("kind") == "chat" and isinstance(case.get("caseId"), str):
            variant = case["caseId"].rsplit(":", 1)[-1]
            if variant in ("short", "long"):
                pairs[(case["slot"], case["requestedModel"])][variant] = case
    results = []
    for (slot, model), pair in sorted(pairs.items()):
        result = {"slot": slot, "requestedModel": model, "status": "insufficient_evidence"}
        a, b = pair.get("short", {}), pair.get("long", {})
        result["maxTokens"] = {"short": a.get("maxTokens"), "long": b.get("maxTokens")}
        if a.get("maxTokens") is not None and b.get("maxTokens") is not None and a["maxTokens"] != b["maxTokens"]:
            result["status"] = "mixed_configuration_not_compared"
            results.append(result)
            continue
        au, bu = obj(a.get("usage")).get("prompt_tokens"), obj(b.get("usage")).get("prompt_tokens")
        ac = obj(obj(a.get("localTokens")).get("promptCandidates"))
        bc = obj(obj(b.get("localTokens")).get("promptCandidates"))
        if integer(au) and integer(bu) and "chat" in ac and "chat" in bc:
            expected, actual = bc["chat"] - ac["chat"], bu - au
            residual = actual - expected
            result.update(expectedDelta=expected, reportedDelta=actual, residual=residual,
                          status="consistent_provisional" if residual == 0 else "difference_needs_explanation",
                          materialDifference=abs(residual) > max(8, abs(expected) * .02))
        results.append(result)
    return results


def daily_scores(cases):
    groups = defaultdict(list)
    for case in cases:
        if case.get("kind") == "chat":
            groups[(case.get("day"), case.get("requestedModel"), case.get("maxTokens"))].append(case)
    results = []
    # Unknown/planned limits remain separate; do not infer a new cap for old requests.
    sort_key = lambda item: (item[0][0] or 0, item[0][1] or "", item[0][2] if item[0][2] is not None else -1)
    for (day, model, max_tokens), rows in sorted(groups.items(), key=sort_key):
        scored = [obj(r.get("capability")) for r in rows if obj(r.get("capability")).get("score") is not None]
        correct, total = sum(x["correct"] for x in scored), sum(x["total"] for x in scored)
        # Short/long siblings share answers; subitems and repetitions are not independent trials.
        distinct_slots = len({r["slot"] for r in rows if obj(r.get("capability")).get("score") is not None})
        received = sum(r.get("evidence") != "not_available" for r in rows)
        truncated = sum(obj(r.get("capability")).get("status") == "truncated" for r in rows)
        by_suite = {}
        for suite in ("anchor", "fresh"):
            scores = [obj(r.get("capability")) for r in rows if r.get("suite") == suite and obj(r.get("capability")).get("score") is not None]
            suite_correct, suite_total = sum(x["correct"] for x in scores), sum(x["total"] for x in scores)
            by_suite[suite] = {"correct": suite_correct, "total": suite_total, "score": suite_correct / suite_total * 100 if suite_total else None}
        results.append({"day": day, "model": model, "maxTokens": max_tokens,
                        "configurationCohort": "max_tokens:" + str(max_tokens) if max_tokens is not None else "max_tokens:unknown",
                        "correct": correct, "total": total,
                        "score": correct / total * 100 if total else None, "scoredRequests": len(scored),
                        "distinctTaskBatteries": distinct_slots, "plannedRequests": len(rows),
                        "receivedResponses": received, "truncatedRequests": truncated,
                        "truncationRateAmongResponses": truncated / received if received else None,
                        "requestFailures": sum(obj(r.get("capability")).get("status") == "request_failed" for r in rows),
                        "emptyRequests": sum(obj(r.get("capability")).get("status") == "empty" for r in rows),
                        "nonceMismatchRequests": sum(obj(r.get("capability")).get("status") == "stale_or_mismatched_nonce" for r in rows),
                        "bySuite": by_suite,
                        "evidence": "small_correlated_sample_not_IQ_or_identity_proof"})
    return results


def analyze(evidence, tokenizers, evidence_hash):
    if not isinstance(evidence, dict) or not isinstance(evidence.get("cases"), list):
        raise ValueError("Expected getAuditStatus evidence object with cases array")
    cases = [analyze_case(obj(case), tokenizers) for case in evidence["cases"]]
    flags = Counter(flag for case in cases for flag in case["findings"])
    pairs = pair_checks(cases)
    material = sum(pair.get("materialDifference", False) for pair in pairs)
    return {"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(),
            "evidenceSha256": evidence_hash, "campaignId": obj(evidence.get("campaign")).get("id"), "scoreScale": "0_to_100_percent",
            "overall": "findings_need_review" if flags or material else "insufficient_evidence_for_authenticity_or_billing_verdict",
            "identityVerification": "unverified_no_original_provider_control",
            "billingVerification": "pending_actual_ledger", "tokenVerification": "provisional",
            "tokenizerManifestSha256": tokenizers.manifest_hash, "tokenizersLibraryVersion": tokenizers.version,
            "tokenizers": tokenizers.status, "findingCounts": dict(flags), "materialPairDifferences": material,
            "dailyCapability": daily_scores(cases), "pairs": pairs, "cases": cases,
            "limitations": ["No official API control group: capability scores do not establish model identity or human IQ.",
                            "Pinned tokenizers provide independent counts, but upstream model mapping, prompt framing and hidden reasoning are unverified.",
                            "Short/long pairs reuse subitems; 112 requests are not 112 independent model-identity trials.",
                            "Daily capability rows are separated by requested max_tokens; do not combine different configuration cohorts into one trend.",
                            "Usage estimates do not prove actual debits. Price, invoice, cache, reasoning and media metadata require reconciliation.",
                            "No detected anomaly in this sample is not proof of absence."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path, nargs="?")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--manifest", type=Path, default=ROOT / "scripts/tokenhub-tokenizers/manifest.json")
    parser.add_argument("--tokenizer-dir", type=Path, default=ROOT / ".artifacts/tokenhub-audit/tokenizers")
    parser.add_argument("--self-test", action="store_true", help="Verify local official file hashes and reproducible tokenizer counts")
    args = parser.parse_args()
    tokenizers = LocalTokenizers(args.manifest, args.tokenizer_dir)
    if args.self_test:
        for model in tokenizers.manifest["models"]:
            tokenizers.get(model)
        print(json.dumps({"tokenizers": tokenizers.status}, indent=2, ensure_ascii=False))
        return 0 if all(x["status"] == "available" for x in tokenizers.status.values()) else 2
    if not args.evidence:
        parser.error("evidence path is required unless --self-test is set")
    evidence, evidence_hash = read_json(args.evidence)
    result = analyze(evidence, tokenizers, evidence_hash)
    serialized = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized)
        print(json.dumps({"output": str(args.output), "cases": len(result["cases"]), "overall": result["overall"]}))
    else:
        print(serialized, end="")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError) as error:
        print("Cannot analyze evidence: " + type(error).__name__, file=sys.stderr)
        sys.exit(2)
