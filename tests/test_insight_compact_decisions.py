"""Lossless compaction of real repeated rules, plus strict repair-ID validation."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from insight_decision_checks import compact_decision_checks, expand_decision_case, validate_decision_checks
import insight_pipeline as ip
from decision_check_fixture import with_decision_checks, coverage_review
from test_insight_quality import valid_article


def bytesize(value):
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())


class SharedModelTests(unittest.TestCase):
    def fixture(self):
        return json.loads((Path(__file__).parent / "fixtures/row709-shared-rules-recovery.json").read_text())["article"]

    def test_real_recovery_preserves_all_23_case_results_and_reduces_check_bytes(self):
        article = self.fixture()
        original = deepcopy(article)
        before = validate_decision_checks(article)
        self.assertTrue(before["passed"], before["errors"])
        projected = ip._prompt_article(article)
        checks = projected["decision_checks"]
        self.assertEqual(checks["version"], 2)
        self.assertEqual(len(checks["models"]), 1)
        self.assertEqual(len(checks["cases"]), 23)
        self.assertEqual(validate_decision_checks(projected), before)
        self.assertEqual([item["id"] for item in checks["cases"]], [item["id"] for item in article["decision_checks"]["cases"]])
        self.assertEqual(article, original)
        self.assertLess(bytesize(checks), bytesize(article["decision_checks"]) * .5)
        self.assertEqual(compact_decision_checks(checks), checks)
        for case, old in zip(checks["cases"], article["decision_checks"]["cases"]):
            expanded = expand_decision_case(case, checks["models"])
            self.assertEqual(expanded["inputs"], old["inputs"])
            self.assertEqual(expanded["rules"], old["rules"])
            self.assertEqual(expanded["derived"], old.get("derived", []))

    def test_models_keep_different_programs_separate(self):
        article = with_decision_checks(valid_article())
        article["decision_checks"]["cases"][1]["rules"][0]["when"] = "b_gain > 8"
        projected = ip._prompt_article(article)
        self.assertEqual(len(projected["decision_checks"]["models"]), 2)
        self.assertEqual(validate_decision_checks(projected), validate_decision_checks(article))

    def test_missing_inputs_are_not_filled_with_defaults_from_other_cases(self):
        article = with_decision_checks(valid_article())
        article["decision_checks"]["cases"][0]["inputs"]["optional"] = "4"
        checks = compact_decision_checks(article["decision_checks"])
        self.assertNotIn("optional", checks["models"]["model_1"]["inputs"])
        self.assertEqual(checks["cases"][0]["inputs"]["optional"], "4")
        self.assertNotIn("optional", expand_decision_case(checks["cases"][1], checks["models"])["inputs"])

    def test_shared_rule_mutation_changes_all_cases_and_still_fails_expected_choice(self):
        article = ip._prompt_article(with_decision_checks(valid_article()))
        article["decision_checks"]["models"]["model_1"]["rules"][0]["when"] = "b_gain >= 7"
        result = validate_decision_checks(article)
        self.assertFalse(result["passed"])
        self.assertIn("computed B, expected A", " ".join(result["errors"]))

    def test_unknown_unused_or_ambiguous_shared_programs_are_rejected(self):
        for mutation in ("missing", "unused", "local_rules", "shadow_derived"):
            article = ip._prompt_article(with_decision_checks(valid_article()))
            checks = article["decision_checks"]
            if mutation == "missing": checks["cases"][0]["model"] = "unknown"
            elif mutation == "unused": checks["models"]["unused"] = deepcopy(checks["models"]["model_1"])
            elif mutation == "local_rules": checks["cases"][0]["rules"] = [{"when": "True", "choice": "A"}]
            else: checks["models"]["model_1"]["derived"] = [{"name": "b_gain", "expression": "1 + 1"}]
            with self.subTest(mutation=mutation):
                self.assertFalse(validate_decision_checks(article)["passed"])

    def test_duplicate_effective_inputs_after_inheritance_are_rejected(self):
        article = ip._prompt_article(with_decision_checks(valid_article()))
        checks = article["decision_checks"]
        checks["cases"][1]["inputs"] = checks["cases"][0]["inputs"].copy()
        self.assertIn("duplicate scenario", " ".join(validate_decision_checks(article)["errors"]))

    def test_compact_prompt_preserves_all_visible_content_and_review_ids(self):
        article = self.fixture()
        projection = ip._prompt_article(article)
        for key in ("title", "excerpt", "body_html", "tags"):
            self.assertEqual(projection[key], article[key])
        raw_ids = {item["id"] for group in ("calculations", "budgets", "cases") for item in article["decision_checks"][group]}
        compact_ids = {item["id"] for group in ("calculations", "budgets", "cases") for item in projection["decision_checks"][group]}
        self.assertEqual(raw_ids, compact_ids)

    def test_feedback_projection_keeps_every_problem_and_independent_finding(self):
        feedback = {"failures": ["Unresolved budget contradiction"], "scores": {"evidence": 3},
            "required_fixes": [{"id": "r3-blocker-2", "kind": "blocker", "problem": "Full unabridged problem",
                "instruction": "Common instruction", "latest_independent_check": {"status": "unresolved", "finding": "Full independent finding", "location": "Table 1"}}],
            "decision_checks": {"passed": False, "errors": ["Exact failure"], "results": [{"id": "boundary", "chosen": "C", "rule_index": 2, "values": {"budget": "76"}}]}}
        original = deepcopy(feedback)
        compact = ip._prompt_feedback(feedback)
        self.assertEqual(feedback, original)
        self.assertEqual(compact["required_fixes"][0], {key: value for key, value in feedback["required_fixes"][0].items() if key != "instruction"})
        self.assertEqual(compact["failures"], feedback["failures"])
        self.assertEqual(compact["decision_checks"]["errors"], ["Exact failure"])
        self.assertEqual(compact["decision_checks"]["results"], [{"id": "boundary", "chosen": "C", "rule_index": 2}])


class GroupedAuthorResponseTests(unittest.TestCase):
    def setUp(self):
        self.feedback = {"required_fixes": [{"id": value, "kind": "blocker", "problem": "Unchanged independent obligation"} for value in ("r0-blocker-1", "r1-blocker-1", "r1-issue-1")]}
        self.response = {"revision_response": [
            {"issue_ids": ["r0-blocker-1", "r1-blocker-1"], "change": "Both findings concern the same repaired formula", "location": "economics table", "verification": "Current formula and boundary inputs were recomputed"},
            {"issue_id": "r1-issue-1", "change": "Separate source qualifier restored", "location": "source paragraph", "verification": "Current claim matches evidence boundary"}]}

    def test_shared_explanation_expands_to_every_id_without_mutation(self):
        original = deepcopy(self.response)
        self.assertEqual(ip._revision_response_errors(self.response, self.feedback), [])
        entries = ip._revision_response_entries(self.response["revision_response"])
        self.assertEqual([entry["issue_id"] for entry in entries], [item["id"] for item in self.feedback["required_fixes"]])
        self.assertEqual(self.response, original)

    def test_issue_count_bound_applies_to_single_and_mixed_entries(self):
        single = {"issue_id": "single", "change": "x", "location": "y", "verification": "z"}
        for raw in ([single] * 2001, [{"issue_ids": [str(index) for index in range(500)], "change": "x", "location": "y", "verification": "z"}] * 4 + [single]):
            with self.assertRaisesRegex(ValueError, "bounded issue count"):
                ip._revision_response_entries(raw)


    def test_v2_grouped_authored_revision_keeps_passed_checkpoint_resumable(self):
        from test_daily_resume_passed import PassedChineseResumeTests
        fixture = PassedChineseResumeTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        candidate = ip._prompt_article(with_decision_checks(valid_article()))
        fixes = ip._revision_feedback(fixture.audit)["required_fixes"]
        candidate["revision_response"] = [{"issue_ids": [item["id"] for item in fixes],
            "change": "Current shared decision model preserves the corrected inputs",
            "location": "current arithmetic example", "verification": "Every case is recomputed under the same current program"}]
        review = fixture.good_review()
        review["decision_check_coverage"] = coverage_review(candidate)
        with patch.object(ip, "review_article", return_value=review), patch.object(ip, "request_json") as request:
            ip.produce_article(fixture.topic, fixture.sources, "key", resume_audit=fixture.audit,
                               editorial_revision=candidate, audit_path=fixture.destination)
        request.assert_not_called()
        saved = json.loads(fixture.destination.read_text())
        self.assertEqual(saved["attempts"][-1]["metadata_state"], "valid")
        self.assertEqual(saved["attempts"][-1]["article"]["decision_checks"]["version"], 2)
        ip.validate_passed_chinese_audit(saved, fixture.topic)
        with patch.object(ip, "request_json") as request, patch.object(ip, "review_article") as reviewer:
            ip.reuse_passed_chinese_audit(fixture.topic, fixture.sources, "key", resume_audit=saved,
                                        audit_path=fixture.root / "resumed-v2.json")
        request.assert_not_called()
        reviewer.assert_not_called()


    def test_duplicate_unknown_missing_and_mixed_id_forms_stay_invalid(self):
        for case in ("duplicate", "unknown", "missing", "both", "empty", "bad_type", "missing_verification"):
            response = deepcopy(self.response)
            group = response["revision_response"][0]
            if case == "duplicate": group["issue_ids"].append("r1-issue-1")
            elif case == "unknown": group["issue_ids"].append("unknown")
            elif case == "missing": group["issue_ids"].pop()
            elif case == "both": group["issue_id"] = "r0-blocker-1"
            elif case == "empty": group["issue_ids"] = []
            elif case == "bad_type": group["issue_ids"] = "r0-blocker-1"
            else: group["verification"] = ""
            with self.subTest(case=case):
                self.assertTrue(ip._revision_response_errors(response, self.feedback))


if __name__ == "__main__":
    unittest.main()
