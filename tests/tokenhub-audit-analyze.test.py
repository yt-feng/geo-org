"""Offline regression tests; no API credentials or inference calls.

Run with .artifacts/tokenhub-audit/venv/bin/python tests/tokenhub-audit-analyze.test.py
Pinned local JSON files are required for the tokenizer-dependent checks.
"""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("tokenhub_audit_analysis", ROOT / "scripts/tokenhub-audit-analyze.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
MODEL = "deepseek-v4-flash-ga-260731"


class AuditAnalysis(unittest.TestCase):
    def setUp(self):
        self.tokenizers = audit.LocalTokenizers(ROOT / "scripts/tokenhub-tokenizers/manifest.json", ROOT / ".artifacts/tokenhub-audit/tokenizers")
        self.tok = self.tokenizers.get(MODEL)
        self.answer = json.dumps({"answers": [2, 3, 5, 7], "nonce": "offline-fixture"})
        self.base = {"slot": 0, "caseId": MODEL + ":short", "kind": "chat", "requestedModel": MODEL, "state": "succeeded", "httpStatus": 200,
                     "request": {"messages": [{"role": "user", "content": "Return four integers 2,3,5,7."}], "max_tokens": 4096},
                     "expected": {"answers": [2, 3, 5, 7], "nonce": "offline-fixture", "suite": "anchor"},
                     "response": {"model": MODEL, "choices": [{"finish_reason": "stop", "message": {"content": self.answer, "reasoning_content": "Compute four integers."}}]}}

    def fill(self, case):
        if self.tok is None:
            self.skipTest("Pinned tokenizer files/library unavailable; run analyzer --self-test")
        prompt = audit.count(self.tok, audit.prompt_candidates(case["request"])["thinking"])
        completion = audit.count(self.tok, "Compute four integers.</think>" + self.answer + audit.EOS)
        case["response"]["usage"] = {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": prompt + completion}
        return case

    def test_pinned_tokenizer_and_offline_execution(self):
        with patch("socket.create_connection", side_effect=AssertionError("Unexpected network request")):
            self.assertIsNotNone(self.tok, "Official files and tokenizers==0.22.1 must be installed for full verification")
            self.assertEqual(self.tokenizers.status[MODEL]["selfTestTokens"], 14)
            result = audit.analyze({"cases": [self.fill(copy.deepcopy(self.base))]}, self.tokenizers, "fixture")
        self.assertEqual(result["dailyCapability"][0]["score"], 100)
        self.assertEqual(result["scoreScale"], "0_to_100_percent")
        self.assertEqual(result["cases"][0]["status"], "provisional")
        self.assertEqual(result["billingVerification"], "pending_actual_ledger")
        self.assertTrue(result["identityVerification"].startswith("unverified"))

    def test_pair_exact_and_inflated(self):
        short = self.fill(copy.deepcopy(self.base))
        long = copy.deepcopy(self.base)
        long["caseId"] = MODEL + ":long"
        long["request"]["messages"][0]["content"] = "Irrelevant reference 17 29 33.\n" + long["request"]["messages"][0]["content"]
        self.fill(long)
        result = audit.analyze({"cases": [short, long]}, self.tokenizers, "fixture")
        self.assertEqual(result["pairs"][0]["residual"], 0)
        self.assertEqual(result["dailyCapability"][0]["bySuite"]["anchor"]["score"], 100)
        long["response"]["usage"]["prompt_tokens"] += 100
        long["response"]["usage"]["total_tokens"] += 100
        result = audit.analyze({"cases": [short, long]}, self.tokenizers, "fixture")
        self.assertEqual(result["materialPairDifferences"], 1)

    def test_usage_sum_missing_and_limit(self):
        case = self.fill(copy.deepcopy(self.base))
        case["response"]["usage"]["total_tokens"] += 1
        self.assertIn("usage_sum_mismatch", audit.analyze_case(case, self.tokenizers)["findings"])
        case["response"]["usage"] = None
        self.assertIn("missing_usage", audit.analyze_case(case, self.tokenizers)["findings"])
        case["response"]["usage"] = {"prompt_tokens": 1, "completion_tokens": 4097, "total_tokens": 4098}
        self.assertIn("completion_exceeds_requested_limit_requires_semantics_check", audit.analyze_case(case, self.tokenizers)["findings"])

    def test_truncated_empty_and_failure_are_visible_not_scored(self):
        valid = self.fill(copy.deepcopy(self.base))
        truncated, empty, failed = copy.deepcopy(valid), copy.deepcopy(valid), copy.deepcopy(valid)
        truncated["response"]["choices"][0]["finish_reason"] = "length"
        empty["response"]["choices"][0]["message"]["content"] = ""
        failed.update(httpStatus=503, response={"error": "fixture"})
        result = audit.analyze({"cases": [valid, truncated, empty, failed]}, self.tokenizers, "fixture")
        daily = result["dailyCapability"][0]
        self.assertEqual((daily["total"], daily["score"]), (4, 100))
        self.assertEqual(daily["truncationRateAmongResponses"], .25)
        self.assertEqual(daily["emptyRequests"], 1)
        self.assertEqual(daily["requestFailures"], 1)

    def test_nonce_and_numeric_score(self):
        case = copy.deepcopy(self.base)
        case["response"]["choices"][0]["message"]["content"] = json.dumps({"answers": [2.0, 3, 6, 7], "nonce": "offline-fixture"})
        self.assertEqual(audit.capability(case, case["response"])["score"], 75)
        case["response"]["choices"][0]["message"]["content"] = json.dumps({"answers": [2, 3, 5, 7], "nonce": "stale-cache"})
        self.assertIsNone(audit.capability(case, case["response"])["score"])
        result = audit.analyze({"cases": [case]}, self.tokenizers, "fixture")
        self.assertEqual(result["dailyCapability"][0]["nonceMismatchRequests"], 1)
        self.assertEqual(result["dailyCapability"][0]["total"], 0)
        case["response"]["choices"][0]["message"]["content"] = "{}"
        self.assertEqual(audit.capability(case, case["response"])["status"], "stale_or_mismatched_nonce")
        case["response"]["choices"][0]["message"]["content"] = "not JSON"
        self.assertEqual(audit.capability(case, case["response"])["score"], 0)

    def test_reasoning_aliases_do_not_double_count(self):
        case = self.fill(copy.deepcopy(self.base))
        message = case["response"]["choices"][0]["message"]
        message["reasoning"] = message["reasoning_content"]
        message["reasoning_details"] = [{"type": "reasoning.text", "text": message["reasoning_content"]}]
        result = audit.analyze_case(case, self.tokenizers)
        self.assertEqual(result["localTokens"]["visibleReasoningTokens"], audit.count(self.tok, message["reasoning"]))
        self.assertTrue(result["localTokens"]["reasoningRepresentationsAgree"])
        del message["reasoning_content"]
        self.assertEqual(audit.analyze_case(case, self.tokenizers)["localTokens"]["reasoningSource"], "reasoning")
        del message["reasoning"]
        self.assertEqual(audit.analyze_case(case, self.tokenizers)["localTokens"]["reasoningSource"], "reasoning_details_text")

    def test_reasoning_opaque_and_disagreeing_representations(self):
        value = audit.visible_reasoning({"reasoning_content": "first", "reasoning": "different", "reasoning_details": [{"type": "reasoning.encrypted", "data": "opaque"}]})
        self.assertEqual(value["selected"], "first")
        self.assertFalse(value["representationsAgree"])
        self.assertTrue(value["incompleteOrOpaque"])
        summary = audit.visible_reasoning({"reasoning_details": [{"type": "reasoning.summary", "summary": "shortened"}]})
        self.assertIsNone(summary["selected"])
        self.assertTrue(summary["incompleteOrOpaque"])

    def test_model_declaration_glm_and_planned(self):
        case = self.fill(copy.deepcopy(self.base))
        case["response"]["model"] = "different-model"
        self.assertEqual(audit.analyze_case(case, self.tokenizers)["status"], "needs_review")
        case["requestedModel"] = "glm-5-2-260617"
        case["response"]["choices"][0]["message"] = {"content": self.answer, "reasoning": "visible GLM reasoning"}
        result = audit.analyze_case(case, self.tokenizers)
        self.assertEqual(result["tokenVerification"], "insufficient_evidence_tokenizer_unavailable")
        self.assertEqual(result["reasoningEvidence"]["source"], "reasoning")
        planned = {"slot": 1, "caseId": MODEL + ":short", "kind": "chat", "requestedModel": MODEL, "state": "planned"}
        self.assertEqual(audit.analyze_case(planned, self.tokenizers)["status"], "insufficient_evidence")

    def test_unsupported_template_not_guessed(self):
        case = self.fill(copy.deepcopy(self.base))
        case["request"]["tools"] = [{"function": {"name": "fixture"}}]
        self.assertNotIn("promptCandidates", audit.analyze_case(case, self.tokenizers)["localTokens"])

    def test_corrupt_manifest_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = copy.deepcopy(self.tokenizers.manifest)
            manifest["models"][MODEL]["files"]["tokenizer.json"]["sha256"] = "0" * 64
            path = Path(tmp) / "manifest.json"
            path.write_text(json.dumps(manifest))
            checked = audit.LocalTokenizers(path, self.tokenizers.directory)
            self.assertIsNone(checked.get(MODEL))
            self.assertEqual(checked.status[MODEL]["status"], "unavailable")

    def test_advertised_estimate_is_not_actual_debit(self):
        def price(micros):
            return {"amount": {"currencyCode": "USD", "unitsMicros": micros}, "display": "USD x / 1M tokens"}
        case = copy.deepcopy(self.base)
        case["derivedExpectedCostMicros"] = 182
        case["priceSnapshot"] = {"data": {"currencyCode": "USD", "data": [{"id": MODEL, "deployments": [{"enabled": True, "pricing": {"input": price(1000000), "output": price(2000000), "cacheRead": price(100000)}}]}]}}
        usage = {"prompt_tokens": 100, "completion_tokens": 50, "prompt_tokens_details": {"cached_tokens": 20}}
        result = audit.estimated_cost(case, case["response"], usage)
        self.assertEqual(result["independentEstimateMicros"], 182)
        self.assertTrue(result["estimateMatchesServer"])
        self.assertEqual(result["status"], "pending_actual_ledger")
        case["priceSnapshot"]["data"]["currencyCode"] = "EUR"
        self.assertIsNone(audit.estimated_cost(case, case["response"], usage)["independentEstimateMicros"])

    def test_output_limits_follow_request_and_daily_cohorts_stay_separate(self):
        old = self.fill(copy.deepcopy(self.base))
        old["response"]["choices"][0]["finish_reason"] = "length"
        old["response"]["usage"] = {"prompt_tokens": 50, "completion_tokens": 4096, "total_tokens": 4146}
        new = self.fill(copy.deepcopy(self.base))
        new["slot"] = 1
        new["expected"]["suite"] = "fresh"
        new["request"]["max_tokens"] = 8192
        new["response"]["usage"] = {"prompt_tokens": 50, "completion_tokens": 5000, "total_tokens": 5050}
        result = audit.analyze({"cases": [old, new]}, self.tokenizers, "fixture")
        self.assertNotIn("completion_exceeds_requested_limit_requires_semantics_check", result["cases"][1]["findings"])
        self.assertEqual(result["cases"][0]["maxTokens"], 4096)
        self.assertEqual(result["cases"][1]["configurationCohort"], "max_tokens:8192")
        self.assertEqual(len(result["dailyCapability"]), 2)
        by_limit = {row["maxTokens"]: row for row in result["dailyCapability"]}
        self.assertIsNone(by_limit[4096]["score"])
        self.assertEqual(by_limit[4096]["truncatedRequests"], 1)
        self.assertEqual(by_limit[4096]["total"], 0)
        self.assertEqual(by_limit[8192]["score"], 100)
        self.assertEqual(by_limit[8192]["total"], 4)
        mixed_pair = copy.deepcopy(new)
        mixed_pair["slot"] = 0
        mixed_pair["caseId"] = MODEL + ":long"
        paired = audit.analyze({"cases": [old, mixed_pair]}, self.tokenizers, "fixture")
        self.assertEqual(paired["pairs"][0]["status"], "mixed_configuration_not_compared")
        new["response"]["usage"] = {"prompt_tokens": 50, "completion_tokens": 8193, "total_tokens": 8243}
        self.assertIn("completion_exceeds_requested_limit_requires_semantics_check", audit.analyze_case(new, self.tokenizers)["findings"])


if __name__ == "__main__":
    unittest.main()
