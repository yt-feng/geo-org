"""Production budget regression, exact boundaries, and fail-closed integration."""
from copy import deepcopy
from fractions import Fraction
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from insight_decision_checks import CheckError, evaluate, validate_decision_checks
import insight_pipeline as ip
from insight_quality import validate_insight
from test_insight_quality import valid_article, SOURCES
from decision_check_fixture import with_decision_checks, coverage_review


class DecisionCheckTests(unittest.TestCase):
    def test_intermediate_fraction_size_is_bounded(self):
        value = Fraction(999999999999999)
        with self.assertRaisesRegex(CheckError, "256-bit"):
            for _ in range(40):
                value = evaluate("x * x", {"x": value})

    def test_omitted_quantified_budget_and_constant_cases_are_rejected(self):
        article = with_decision_checks(valid_article())
        article["decision_checks"]["budgets"] = []
        article["decision_checks"]["cases"][0]["rules"] = [{"when": "True", "choice": "A"}]
        errors = " ".join(validate_decision_checks(article)["errors"])
        self.assertIn("quantified capacity", errors)
        self.assertIn("input-dependent", errors)

    def test_format_repair_cannot_erase_incomplete_coverage_finding(self):
        article = with_decision_checks(valid_article())
        sources = [{**item, "text": "Scoped source evidence.", "excerpt_start": 0, "excerpt_end": 23, "body_chars": 23, "excerpt_truncated": False} for item in SOURCES]
        good = {"scores": dict.fromkeys(ip.SCORE_KEYS, 5), "issues": [], "blockers": [],
            "decision_check_coverage": coverage_review(article),
            "claim_checks": [{"claim": f"Claim number {n}", "source_ids": ["S1" if n % 2 else "S2"],
                              "verdict": "supported", "reason": "Scoped evidence for claim."} for n in range(5)]}
        first = deepcopy(good)
        del first["scores"]["thesis"]
        first["decision_check_coverage"].update({"verdict": "incomplete", "missing_checks": ["shared prerequisite cost omitted"]})
        with patch.object(ip, "request_json", side_effect=[first, good]):
            result = ip.review_article(article, sources, "key", "zh")
        self.assertIn("shared prerequisite cost omitted", " ".join(result["blockers"]))


    def test_early_true_rule_and_duplicate_scenarios_cannot_fake_coverage(self):
        article = with_decision_checks(valid_article())
        article["decision_checks"]["cases"][0]["rules"].insert(0, {"when": "True", "choice": "A"})
        self.assertIn("final fallback", " ".join(validate_decision_checks(article)["errors"]))
        article = with_decision_checks(valid_article())
        article["decision_checks"]["cases"][1]["inputs"] = article["decision_checks"]["cases"][0]["inputs"].copy()
        self.assertIn("duplicate scenario", " ".join(validate_decision_checks(article)["errors"]))


    def test_fresh_source_review_keeps_checks_fingerprint_for_next_resume(self):
        article = with_decision_checks(valid_article())
        sources = [{**item, "text": "Scoped source evidence.", "excerpt_start": 0, "excerpt_end": 23, "body_chars": 23, "excerpt_truncated": False} for item in SOURCES]
        topic = ip.gb.TopicRow(709, "Comparison", {}, "Brand", "GEO")
        good = {"scores": dict.fromkeys(ip.SCORE_KEYS, 5), "issues": [], "blockers": [],
            "decision_check_coverage": coverage_review(article),
            "claim_checks": [{"claim": f"Claim number {n}", "source_ids": ["S1" if n % 2 else "S2"],
                              "verdict": "supported", "reason": "Scoped evidence for claim."} for n in range(5)]}
        with tempfile.TemporaryDirectory() as directory:
            first_path, next_path = Path(directory) / "first.json", Path(directory) / "next.json"
            with patch.object(ip, "request_json", side_effect=[{"decision_question":"Compare full resource costs"}, article]), patch.object(ip, "review_article", return_value=good):
                ip.produce_article(topic, sources, "key", audit_path=first_path)
            first = json.loads(first_path.read_text())
            sources[0]["scope_notes"] = "New metadata requires independent review"
            with patch.object(ip, "review_article", return_value=good):
                ip.reuse_passed_chinese_audit(topic, sources, "key", resume_audit=first, audit_path=next_path)
            following = json.loads(next_path.read_text())
            ip.validate_passed_chinese_audit(following, topic)
            self.assertEqual(following["attempts"][-1]["decision_checks_sha256"], ip._audit_sha256(article["decision_checks"]))
            following["attempts"][-1]["article"]["decision_checks"]["calculations"][0]["expected"] = "6"
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                ip.validate_passed_chinese_audit(following, topic)


    def test_auxiliary_metadata_repair_then_passed_checkpoint_can_resume(self):
        from test_daily_resume_passed import PassedChineseResumeTests
        fixture = PassedChineseResumeTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        candidate = with_decision_checks(valid_article())
        resume = deepcopy(fixture.audit)
        resume["passed"] = False
        resume["attempts"][-1]["review"]["blockers"] = ["Retest the latest decision boundary"]
        resume["attempts"][-1]["errors"] = ["Retest the latest decision boundary"]
        fixes = ip._revision_feedback(resume)["required_fixes"]
        good = fixture.good_review()
        good["decision_check_coverage"] = coverage_review(candidate)
        good["blocker_checks"] = [{"issue_id": item["id"], "status": "resolved", "location": "current body",
                                   "finding": "Independent check of the current formula and current body resolves the finding."}
                                  for item in fixes if item["kind"] == "blocker"]
        responses = [{"issue_id": item["id"], "change": "Current verified formula retained", "location": "current body",
                      "verification": "Compared current inputs and decision rule with independent finding."} for item in fixes]
        path = fixture.root / "metadata-repaired.json"
        with patch.object(ip, "review_article", return_value=good), patch.object(ip, "request_json", return_value={"revision_response": responses}) as request:
            ip.produce_article(fixture.topic, fixture.sources, "key", resume_audit=resume,
                               editorial_revision=candidate, audit_path=path)
        self.assertEqual([call.kwargs["stage"] for call in request.call_args_list], ["zh-revision-metadata-repair"])
        saved = json.loads(path.read_text())
        self.assertEqual(saved["attempts"][-1]["metadata_state"], "repaired")
        ip.validate_passed_chinese_audit(saved, fixture.topic)
        with patch.object(ip, "request_json") as draft, patch.object(ip, "review_article") as review:
            ip.reuse_passed_chinese_audit(fixture.topic, fixture.sources, "key", resume_audit=saved,
                                        audit_path=fixture.root / "resumed.json")
        draft.assert_not_called()
        review.assert_not_called()


    def test_exact_decimal_threshold_and_strict_boundary(self):
        self.assertEqual(evaluate("0.15 * 48", {}), Fraction(36, 5))
        self.assertFalse(evaluate("7.2 > 0.15 * 48", {}))
        self.assertTrue(evaluate("7.2 == 0.15 * 48", {}))
        self.assertTrue(evaluate("8 > 0.15 * 48", {}))

    def test_no_execution_or_unbounded_expressions(self):
        for expression in ("__import__('os').system('echo bad')", "a.real", "a[0]", "9**999", "2%1", "1e300", "True + 1", "False and x.bad()"):
            with self.subTest(expression=expression), self.assertRaises(CheckError):
                evaluate(expression, {"a": Fraction(1)})
        with self.assertRaisesRegex(CheckError, "zero"):
            evaluate("40 / 0", {})

    def test_short_circuit_zero_guard(self):
        self.assertFalse(evaluate("gain > 0 and 40 / gain < 8", {"gain": Fraction(0)}))

    def test_reproduces_row709_old_gate_pass_but_joint_budget_rejection(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/row709-budget-production-failure.json").read_text())
        article = fixture["article"]
        self.assertTrue(validate_insight(article, fixture["sources"])["passed"])
        self.assertIn("76h ≤ 80h", " ".join(fixture["review_blockers"]))
        # These are the actual final-draft inputs. Quotes are verbatim article
        # text, not a synthetic replacement that fixes the old failure.
        quote = "A_full = 12 + 20 + 8 = 40 小时；B_full = 12 + 28 + 8 = 48 小时。"
        checks = with_decision_checks(valid_article())["decision_checks"]
        for group in ("calculations", "budgets", "cases"):
            for item in checks[group]: item["quote"] = quote
        checks["budgets"][0]["capacity"] = "80"
        article["decision_checks"] = checks
        result = validate_insight(article, fixture["sources"], require_decision_checks=True)
        self.assertFalse(result["passed"])
        self.assertIn("combined 76 <= capacity 80", " ".join(result["errors"]))

    def test_missing_check_protocol_new_draft_fails_legacy_read_stays_valid(self):
        article = valid_article()
        self.assertTrue(validate_insight(article, SOURCES)["passed"])
        result = validate_insight(article, SOURCES, require_decision_checks=True)
        self.assertFalse(result["passed"])
        self.assertIn("required", " ".join(result["errors"]))

    def test_ordered_rule_precedes_efficiency_reversal(self):
        article = with_decision_checks(valid_article())
        case = article["decision_checks"]["cases"][1]
        case["inputs"].update({"errors": "5", "sample": "25", "limit": "0.10"})
        case["rules"].insert(0, {"when": "errors / sample > limit", "choice": "A"})
        result = validate_decision_checks(article)
        self.assertIn("computed A, expected B", " ".join(result["errors"]))
        case["expected_choice"] = "A"
        self.assertTrue(validate_decision_checks(article)["passed"])

    def test_undefined_zero_return_must_be_guarded_and_no_case_can_be_uncovered(self):
        article = with_decision_checks(valid_article())
        case = article["decision_checks"]["cases"][0]
        case["inputs"]["b_gain"] = "0"
        case["derived"] = [{"name": "unit_cost", "expression": "48 / b_gain"}]
        self.assertIn("division by zero", " ".join(validate_decision_checks(article)["errors"]))
        case["derived"] = []
        case["rules"] = [{"when": "b_gain > 0", "choice": "B"}]
        self.assertIn("no ordered rule", " ".join(validate_decision_checks(article)["errors"]))

    def test_stale_quotes_changed_expectations_and_invalid_costs_are_rejected(self):
        changes = [("calculations", "quote", "已被正文删除的原始算式与错误基准"),
                   ("calculations", "expected", "6"), ("budgets", "shared", "41"),
                   ("budgets", "capacity", "NaN")]
        for group, key, value in changes:
            article = with_decision_checks(valid_article())
            article["decision_checks"][group][0][key] = value
            with self.subTest(group=group, key=key):
                self.assertFalse(validate_decision_checks(article)["passed"])

    def test_checks_preserved_normalization_but_not_required_of_translation(self):
        raw = with_decision_checks(valid_article())
        self.assertEqual(ip.normalize_article(raw, "zh")["decision_checks"], raw["decision_checks"])
        self.assertNotIn("decision_checks", ip.normalize_article(raw, "en"))
        # Translation fingerprints cover visible content and stay compatible.
        without = {key: value for key, value in raw.items() if key != "decision_checks"}
        self.assertEqual(ip._article_sha256(raw), ip._article_sha256(without))

    def test_no_paid_review_when_computation_failed_and_audit_keeps_feedback(self):
        raw = with_decision_checks(valid_article())
        raw["decision_checks"]["budgets"][0]["capacity"] = "80"
        sources = [{**item, "text": "Scoped source evidence.", "excerpt_start": 0, "excerpt_end": 23, "body_chars": 23, "excerpt_truncated": False} for item in SOURCES]
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {"INSIGHT_MAX_REVISIONS": "0"}), \
                patch.object(ip, "request_json", side_effect=[{}, raw]) as request, patch.object(ip, "review_article") as review:
            path = Path(directory) / "zh.json"
            with self.assertRaises(ip.InsightQualityError):
                ip.produce_article(ip.gb.TopicRow(709, "Comparison", {}, "Brand", "GEO"), sources, "key", audit_path=path)
            audit = json.loads(path.read_text())
            self.assertFalse(audit["passed"])
            self.assertIn("combined 76", " ".join(audit["attempts"][0]["errors"]))
            self.assertEqual(len(request.call_args_list), 2)
            review.assert_not_called()
            self.assertFalse(ip._revision_feedback(audit)["decision_checks"]["passed"])
            self.assertTrue(ip._factual_repair_required(ip._revision_feedback(audit)))

    def test_arithmetic_pass_cannot_replace_independent_coverage_or_source_review(self):
        article = with_decision_checks(valid_article())
        sources = [{**item, "text": "Scoped source evidence.", "excerpt_start": 0, "excerpt_end": 23, "body_chars": 23, "excerpt_truncated": False} for item in SOURCES]
        review = {"scores": dict.fromkeys(ip.SCORE_KEYS, 5), "issues": [], "blockers": [],
            "claim_checks": [{"claim": f"Claim number {n}", "source_ids": ["S1" if n % 2 else "S2"],
                              "verdict": "supported", "reason": "Scoped evidence for claim."} for n in range(5)]}
        with patch.object(ip, "request_json", return_value=review):
            result = ip.review_article(article, sources, "key", "zh")
        self.assertEqual(result["review_status"], "format_invalid")
        self.assertTrue(any("coverage" in value for value in result["review_contract_errors"]))

    def test_new_checked_draft_cannot_publish_with_unavailable_semantic_review(self):
        raw = with_decision_checks(valid_article())
        sources = [{**item, "text": "Scoped source evidence.", "excerpt_start": 0, "excerpt_end": 23, "body_chars": 23, "excerpt_truncated": False} for item in SOURCES]
        with tempfile.TemporaryDirectory() as directory, patch.object(ip, "request_json", side_effect=[{}, raw]), \
                patch.object(ip, "review_article", side_effect=RuntimeError("completion content is not valid JSON")):
            path = Path(directory) / "zh.json"
            with self.assertRaisesRegex(RuntimeError, "not valid JSON"):
                ip.produce_article(ip.gb.TopicRow(709, "Comparison", {}, "Brand", "GEO"), sources, "key", audit_path=path)
            self.assertFalse(json.loads(path.read_text())["passed"])


if __name__ == "__main__":
    unittest.main()
