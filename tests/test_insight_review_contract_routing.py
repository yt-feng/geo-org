"""Real 25/30 reviewed article must not be rewritten for reviewer formatting."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import insight_pipeline as ip
from deepseek_cost_policy import CostDeferredError


class ReviewContractRoutingTests(unittest.TestCase):
    def setUp(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/row709-review-contract-failure.json").read_text())
        self.article = fixture["article"]
        self.review = fixture["recorded_review"]
        self.assertEqual(self.review["blockers"], fixture["application_generated_blockers"])
        self.review["blockers"] = []  # Remove only the recorded application diagnostics for provider replay.
        self.sources = [{**source, "text": "Deterministic provider replay; no source claim is independently evaluated by this test."} for source in fixture["sources"]]
        self.topic = ip.gb.TopicRow(709, "Decision comparison", {}, "Brand", "GEO")
        self.resume = {"version": "insights-v3", "row": 709, "language": "zh", "passed": False,
            "brief": {"decision_question": "Choose feasible actions under a common budget"},
            "sources": ip.public_sources(self.sources), "attempts": [{"revision": 4,
                "article": deepcopy(self.article), "structure": ip.validate_insight(self.article, self.sources),
                "review": {}, "errors": [], "review_state": "completed"}]}
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "zh.json"

    def produce(self, replies, *, resume=None, editorial=True):
        with patch.object(ip, "request_json", side_effect=deepcopy(replies)) as request:
            result = ip.produce_article(self.topic, self.sources, "key", resume_audit=resume or self.resume,
                editorial_revision=self.article if editorial else None, audit_path=self.path)
        return result, [call.kwargs["stage"] for call in request.call_args_list]

    def test_real_concise_findings_are_valid_without_invented_missing_ids_or_extra_calls(self):
        entries = self.review["decision_check_coverage"]["checks"]
        short = {entry["check_id"] for entry in entries if len(entry["finding"].strip()) < 20}
        self.assertEqual(short, {"zero_b", "unstable", "incomparable"})
        self.assertEqual(len(entries), 53)
        self.assertEqual(len({entry["check_id"] for entry in entries}), 53)
        self.assertEqual(sum(self.review["scores"].values()), 25)
        self.assertEqual(ip._decision_coverage_contract_errors(self.article, self.review), [])
        result, stages = self.produce([self.review])
        self.assertEqual(stages, ["zh-review"])
        self.assertEqual(result["body_html"], self.article["body_html"])
        self.assertEqual(result["decision_checks"], self.article["decision_checks"])
        self.assertEqual(result["quality"]["scores"], self.review["scores"])

    def test_actual_missing_id_repairs_only_the_same_article_review_once(self):
        broken = deepcopy(self.review)
        broken["decision_check_coverage"]["checks"].pop()
        result, stages = self.produce([broken, self.review])
        self.assertEqual(stages, ["zh-review", "zh-review-format-repair"])
        saved = json.loads(self.path.read_text())
        last = saved["attempts"][-1]
        self.assertEqual(len(saved["attempts"]), 2)
        self.assertEqual(last["review"]["format_repair"]["article_sha256"], ip._article_sha256(result))
        self.assertEqual(last["review"]["format_repair"]["decision_checks_sha256"], ip._audit_sha256(self.article["decision_checks"]))
        self.assertEqual(result["body_html"], self.article["body_html"])

    def test_still_missing_after_one_repair_checkpoints_pending_without_author_rewrite(self):
        broken = deepcopy(self.review)
        broken["decision_check_coverage"]["checks"].pop()
        with patch.object(ip, "request_json", side_effect=[deepcopy(broken), deepcopy(broken)]) as request:
            with self.assertRaises(ip.InsightReviewPendingError):
                ip.produce_article(self.topic, self.sources, "key", resume_audit=self.resume,
                                   editorial_revision=self.article, audit_path=self.path)
        self.assertEqual([call.kwargs["stage"] for call in request.call_args_list], ["zh-review", "zh-review-format-repair"])
        saved = json.loads(self.path.read_text())
        self.assertFalse(saved["passed"])
        self.assertEqual(saved["attempts"][-1]["review_state"], "review_pending")
        self.assertEqual(saved["attempts"][-1]["article"], self.article)
        self.assertTrue(ip.review_errors(saved["attempts"][-1]["review"]))
        self.assertEqual(saved["attempts"][-1]["review"]["blockers"], [])
        self.assertFalse(any(item["kind"] == "blocker" for item in ip._revision_feedback(saved)["required_fixes"]))
        for field in ("body_html", "decision_checks"):
            changed = deepcopy(saved)
            if field == "body_html": changed["attempts"][-1]["article"][field] += "<p>Unreviewed change</p>"
            else: changed["attempts"][-1]["article"][field]["cases"][0]["expected_choice"] = "ALTERED"
            with self.subTest(field=field), patch.object(ip, "request_json") as no_request:
                destination_before = self.path.read_bytes()
                with self.assertRaisesRegex(ValueError, "fingerprint changed"):
                    ip.produce_article(self.topic, self.sources, "key", resume_audit=changed, audit_path=self.path)
                no_request.assert_not_called()
                self.assertEqual(self.path.read_bytes(), destination_before)
        # Continuation retries the exact draft's review, never an author call or
        # an auxiliary explanation request for unchanged article content.
        result, stages = self.produce([self.review], resume=saved, editorial=False)
        self.assertEqual(stages, ["zh-review"])
        self.assertEqual(result["body_html"], self.article["body_html"])
        self.assertEqual(result["decision_checks"], self.article["decision_checks"])
        self.assertEqual(json.loads(self.path.read_text())["attempts"][-1]["draft_origin"], "review_only_resume")

    def test_empty_duplicate_unknown_and_missing_fields_are_review_contract_failures(self):
        for kind in ("empty", "duplicate", "unknown", "missing_array", "invalid_verdict"):
            broken = deepcopy(self.review)
            coverage = broken["decision_check_coverage"]
            if kind == "empty": coverage["checks"][0]["finding"] = " "
            elif kind == "duplicate": coverage["checks"].append(deepcopy(coverage["checks"][0]))
            elif kind == "unknown": coverage["checks"][0]["check_id"] = "unknown"
            elif kind == "missing_array": coverage.pop("checks")
            else: coverage["verdict"] = "unrecognized"
            with self.subTest(kind=kind):
                result, stages = self.produce([broken, self.review])
                self.assertEqual(stages, ["zh-review", "zh-review-format-repair"])
                self.assertEqual(result["body_html"], self.article["body_html"])

    def test_incomplete_real_coverage_survives_format_repair(self):
        broken = deepcopy(self.review)
        broken["decision_check_coverage"].update(verdict="incomplete", missing_checks=["New threshold R is absent from all case inputs"])
        broken["decision_check_coverage"]["checks"].pop()
        with patch.object(ip, "request_json", side_effect=[broken, deepcopy(self.review)]):
            result = ip.review_article(self.article, self.sources, "key", "zh")
        self.assertIn("New threshold R is absent", " ".join(result["blockers"]))
        self.assertTrue(ip.review_errors(result))
        self.assertNotEqual(result.get("review_status"), "format_invalid")

    def test_original_unsupported_claim_and_unresolved_history_cannot_disappear(self):
        broken = deepcopy(self.review)
        broken["decision_check_coverage"]["checks"].pop()
        broken["claim_checks"][0]["verdict"] = "unsupported"
        broken["blocker_checks"][0]["status"] = "unresolved"
        with patch.object(ip, "request_json", side_effect=[broken, deepcopy(self.review)]):
            result = ip.review_article(self.article, self.sources, "key", "zh")
        self.assertTrue(any("unsupported claim" in item for item in result["blockers"]))
        self.assertTrue(any("remains unresolved" in item for item in result["blockers"]))

    def test_review_provider_failure_retains_exact_draft_for_review_only_resume(self):
        with patch.object(ip, "request_json", side_effect=RuntimeError("provider unavailable")) as request:
            with self.assertRaisesRegex(RuntimeError, "provider unavailable"):
                ip.produce_article(self.topic, self.sources, "key", resume_audit=self.resume,
                                   editorial_revision=self.article, audit_path=self.path)
        self.assertEqual(request.call_count, 1)
        saved = json.loads(self.path.read_text())
        self.assertEqual(saved["attempts"][-1]["review_state"], "review_pending")
        result, stages = self.produce([self.review], resume=saved, editorial=False)
        self.assertEqual(stages, ["zh-review"])
        self.assertEqual(result["body_html"], self.article["body_html"])

    def test_interrupted_format_repair_preserves_first_review_findings_and_error_type(self):
        for error in (RuntimeError("provider unavailable"), CostDeferredError("deferred by unchanged cost policy")):
            broken = deepcopy(self.review)
            broken["decision_check_coverage"]["checks"].pop()
            broken["decision_check_coverage"].update(verdict="incomplete", missing_checks=["New threshold R is absent from case inputs"])
            broken["claim_checks"][0]["verdict"] = "unsupported"
            broken["blocker_checks"][0]["status"] = "unresolved"
            with self.subTest(error=type(error).__name__), patch.object(ip, "request_json", side_effect=[broken, error]) as request:
                with self.assertRaises(type(error)) as caught:
                    ip.produce_article(self.topic, self.sources, "key", resume_audit=self.resume,
                                       editorial_revision=self.article, audit_path=self.path)
                self.assertIs(caught.exception, error)
                self.assertEqual([call.kwargs["stage"] for call in request.call_args_list], ["zh-review", "zh-review-format-repair"])
                saved = json.loads(self.path.read_text())
                last = saved["attempts"][-1]
                self.assertEqual(last["review_state"], "review_pending")
                self.assertEqual(last["article"], self.article)
                blockers = " ".join(last["review"]["blockers"])
                self.assertIn("New threshold R", blockers)
                self.assertIn("unsupported claim", blockers)
                self.assertIn("remains unresolved", blockers)
                self.assertEqual(last["review"]["format_repair"]["article_sha256"], last["article_sha256"])
                feedback = ip._revision_feedback(saved)
                self.assertTrue(feedback["required_fixes"])
                self.assertNotIn("every submitted check ID", " ".join(feedback["failures"]))
                self.assertIn("New threshold R", " ".join(fix["problem"] for fix in feedback["required_fixes"]))

    def test_checked_draft_without_valid_review_json_stays_pending_not_rewritten_or_published(self):
        with patch.object(ip, "request_json", side_effect=ValueError("model response is not valid JSON")) as request:
            with self.assertRaisesRegex(ValueError, "not valid JSON"):
                ip.produce_article(self.topic, self.sources, "key", resume_audit=self.resume,
                                   editorial_revision=self.article, audit_path=self.path)
        self.assertEqual([call.kwargs["stage"] for call in request.call_args_list], ["zh-review"])
        saved = json.loads(self.path.read_text())
        self.assertFalse(saved["passed"])
        self.assertEqual(saved["attempts"][-1]["review_state"], "review_pending")
        result, stages = self.produce([self.review], resume=saved, editorial=False)
        self.assertEqual(stages, ["zh-review"])
        self.assertEqual(result["body_html"], self.article["body_html"])

    def test_saved_pass_fresh_source_review_keeps_interrupted_findings_and_can_resume_review_only(self):
        self.produce([self.review])
        passed = json.loads(self.path.read_text())
        ip.validate_passed_chinese_audit(passed, self.topic)
        fresh_sources = deepcopy(self.sources)
        fresh_sources[0]["title"] += " (source metadata refreshed)"
        broken = deepcopy(self.review)
        broken["decision_check_coverage"]["checks"].pop()
        broken["decision_check_coverage"].update(verdict="incomplete", missing_checks=["A newly noted boundary still needs independent verification"])
        error = CostDeferredError("deferred while repairing fresh source review")
        with patch.object(ip, "request_json", side_effect=[broken, error]) as request:
            with self.assertRaises(CostDeferredError) as caught:
                ip.reuse_passed_chinese_audit(self.topic, fresh_sources, "key", resume_audit=passed, audit_path=self.path)
        self.assertIs(caught.exception, error)
        self.assertEqual([call.kwargs["stage"] for call in request.call_args_list], ["zh-review", "zh-review-format-repair"])
        pending = json.loads(self.path.read_text())
        last = pending["attempts"][-1]
        self.assertEqual(last["draft_origin"], "saved_chinese_fresh_review")
        self.assertEqual(last["review_state"], "review_pending")
        self.assertIn("newly noted boundary", " ".join(last["review"]["blockers"]))
        self.assertEqual(last["article_sha256"], ip._article_sha256(self.article))
        self.assertEqual(last["decision_checks_sha256"], ip._audit_sha256(self.article["decision_checks"]))
        reviewed = deepcopy(self.review)
        reviewed["blocker_checks"] = [{"issue_id": fix["id"], "status": "resolved", "location": "Table 2",
            "finding": "The fresh review independently rechecked this same article boundary against its complete ordered rules."}
            for fix in ip._revision_feedback(pending)["required_fixes"] if fix["kind"] == "blocker"]
        with patch.object(ip, "request_json", return_value=reviewed) as request:
            result = ip.produce_article(self.topic, fresh_sources, "key", resume_audit=pending, audit_path=self.path)
        self.assertEqual([call.kwargs["stage"] for call in request.call_args_list], ["zh-review"])
        self.assertEqual(result["body_html"], self.article["body_html"])
        ip.validate_passed_chinese_audit(json.loads(self.path.read_text()), self.topic)


if __name__ == "__main__":
    unittest.main()
