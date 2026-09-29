import contextlib
import copy
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import insight_pipeline as ip


class RevisionHistoryTests(unittest.TestCase):
    def setUp(self):
        self.topic = ip.gb.TopicRow(698, "共同预算下的投入比较", {}, "Brand", "GEO")
        self.sources = [{"id": "S1", "url": "https://example.com/source",
                         "title": "Source", "text": "Source observation."},
                        {"id": "S2", "url": "https://example.org/source",
                         "title": "Second source", "text": "Independent source observation."}]
        self.article = {"title": "同口径比较", "excerpt": "按完整工时和增量比较。",
                        "body_html": "<p>基础修复的增量和剩余工时均纳入比较。</p>", "tags": ["GEO"]}
        self.base_increment = "基础修复产生的合格引用增量必须同时计入 A/B。"
        self.unused_budget = "修复空间耗尽后，说明 A 剩余工时的分配。"
        self.structure_error = "The revised article must preserve the source-reference table."
        self.audit = {"version": "insights-v3", "row": self.topic.idx, "language": "zh",
                      "passed": False, "sources": ip.public_sources(self.sources),
                      "brief": {"decision_question": "如何分配相同工时"}, "attempts": [
                          {"revision": 0, "article": copy.deepcopy(self.article),
                           "structure": {"passed": True, "errors": [], "metrics": {}},
                           "review": {"scores": dict.fromkeys(ip.SCORE_KEYS, 3),
                                      "blockers": ["错误率分母必须明确。"],
                                      "issues": [self.base_increment, self.unused_budget]},
                           "errors": ["editorial review failed"]},
                          {"revision": 1, "article": copy.deepcopy(self.article),
                           "structure": {"passed": False, "errors": [self.structure_error], "metrics": {}},
                           "errors": [self.structure_error]},
                          {"revision": 2, "article": copy.deepcopy(self.article),
                           "structure": {"passed": True, "errors": [], "metrics": {}},
                           "review": {"scores": dict.fromkeys(ip.SCORE_KEYS, 3), "blockers": [],
                                      "issues": ["用整数错误观测数表达触发条件。"]},
                           "errors": ["editorial review failed"]},
                      ]}
        self.expected_ids = ["r0-blocker-1", "r0-issue-1", "r0-issue-2", "r1-structure-1", "r2-issue-1"]

    def test_omitted_earlier_findings_remain_obligations_after_three_attempts(self):
        original = copy.deepcopy(self.audit)
        early = ip._revision_feedback({**self.audit, "attempts": self.audit["attempts"][:1]})
        final = ip._revision_feedback(self.audit)
        self.assertEqual([fix["id"] for fix in final["required_fixes"]], self.expected_ids)
        final_by_id = {fix["id"]: fix for fix in final["required_fixes"]}
        for fix in early["required_fixes"]:
            self.assertEqual(final_by_id[fix["id"]], fix)
        self.assertEqual(final_by_id["r1-structure-1"]["problem"], self.structure_error)
        self.assertEqual(final["scores"], self.audit["attempts"][-1]["review"]["scores"])
        self.assertEqual(self.audit, original)

    def test_resume_sends_omitted_findings_to_author_without_promoting_them_to_blockers(self):
        original = copy.deepcopy(self.audit)
        stages = []
        reviewed_prompts = []

        def request(prompt, api_key, *, stage, **kwargs):
            stages.append(stage)
            if stage == "zh-draft-3":
                self.assertEqual(kwargs["thinking"], "enabled")
                feedback = json.loads(prompt.split("完整修订任务：", 1)[1])
                self.assertEqual([fix["id"] for fix in feedback["required_fixes"]], self.expected_ids)
                self.assertIn(self.base_increment, prompt)
                self.assertIn(self.unused_budget, prompt)
                return {**self.article, "revision_response": [
                    {"issue_id": fix["id"], "change": "保留对应修正", "location": "正文",
                     "verification": "逐项核对本轮正文"} for fix in feedback["required_fixes"]]}
            if stage == "zh-review":
                reviewed_prompts.append(prompt)
                return {"scores": {**dict.fromkeys(ip.SCORE_KEYS, 4), "originality": 5},
                        "issues": [], "blockers": [],
                        "claim_checks": [{"claim": f"Scoped observation {number}",
                                          "source_ids": ["S1" if number % 2 else "S2"],
                                          "verdict": "supported", "reason": "Supported by the supplied source."}
                                         for number in range(5)],
                        "blocker_checks": [{"issue_id": "r0-blocker-1", "status": "resolved",
                                            "location": "正文", "finding": "本轮分母定义已经明确。"}]}
            raise AssertionError(f"Unexpected stage {stage}")

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "zh.json"
            with patch.object(ip, "request_json", side_effect=request), \
                 patch.object(ip, "validate_insight", return_value={"passed": True, "errors": [], "metrics": {}}), \
                 patch.dict(os.environ, {"INSIGHT_RESUME_MAX_ATTEMPTS": "1"}), \
                 contextlib.redirect_stdout(io.StringIO()):
                article = ip.produce_article(self.topic, self.sources, "test", audit_path=destination,
                                             resume_audit=self.audit)
            saved = json.loads(destination.read_text())

        self.assertEqual(stages, ["zh-draft-3", "zh-review"])
        self.assertEqual(saved["attempts"][:3], original["attempts"])
        self.assertEqual(saved["attempts"][-1]["draft_thinking"], "enabled")
        self.assertEqual([fix["id"] for fix in saved["attempts"][-1]["feedback_applied"]["required_fixes"]],
                         self.expected_ids)
        blocker_json = reviewed_prompts[0].split("待核历史blocker：", 1)[1].split("\n语言：", 1)[0]
        self.assertEqual([fix["id"] for fix in json.loads(blocker_json)], ["r0-blocker-1"])
        self.assertTrue(saved["passed"])
        self.assertEqual(article["quality"]["revisions"], 3)
        self.assertEqual(self.audit, original)


class ReviewedRepairTests(unittest.TestCase):
    def setUp(self):
        fixture = Path(__file__).parent / "fixtures/daily-row707-production-reviews.json"
        self.fixture = json.loads(fixture.read_text())
        self.audit = self.fixture["audit"]

    def test_real_row707_preserves_all_ids_and_latest_independent_findings(self):
        original = copy.deepcopy(self.audit)
        feedback = ip._revision_feedback(self.audit)
        expected_ids = [f"r{a['revision']}-{kind}-{n}"
                        for a in self.audit["attempts"]
                        for kind, items in (("blocker", a["review"].get("blockers", [])),
                                            ("structure", a["structure"].get("errors", [])),
                                            ("issue", a["review"].get("issues", [])))
                        for n, _ in enumerate(items, 1)]
        fixes = {fix["id"]: fix for fix in feedback["required_fixes"]}
        self.assertEqual(list(fixes), expected_ids)
        self.assertEqual(len(fixes), 37)
        latest = self.audit["attempts"][-1]
        for check in latest["review"]["blocker_checks"]:
            carried = fixes[check["issue_id"]]["latest_independent_check"]
            self.assertEqual(carried, {"reviewed_revision": 2,
                "reviewed_article_sha256": self.fixture["reviewed_last_article_sha256"],
                **{key: check[key] for key in ("status", "scope", "location", "finding")}})
        focus = feedback["repair_focus"]
        self.assertEqual(len(focus["preserve_and_recheck_resolved_ids"]), 8)
        self.assertIn("r1-blocker-3", focus["unresolved_or_unverified_blocker_ids"])
        self.assertIn("r2-blocker-1", focus["unresolved_or_unverified_blocker_ids"])
        self.assertIn("0.80", fixes["r1-blocker-1"]["latest_independent_check"]["finding"])
        self.assertTrue(ip._factual_repair_required(feedback))
        self.assertEqual(self.audit, original)

    def test_real_row707_remains_blocked_even_with_resolved_feedback_and_fallback_flag(self):
        latest = self.audit["attempts"][-1]
        review = copy.deepcopy(latest["review"])
        review["publication_fallback"] = True
        ip._revision_feedback(self.audit)
        errors = ip._publication_blocking_errors(review, self.audit["sources"],
                    ip._prior_publication_blockers(self.audit, latest))
        self.assertTrue(any("Q_cap" in error for error in errors))
        self.assertTrue(any("r1-blocker-3" in error and "unresolved" in error for error in errors))
        self.assertFalse(self.audit["passed"])

    def test_missing_or_later_unresolved_check_never_inherits_an_earlier_pass(self):
        first = self.audit["attempts"][-2]["review"]["blocker_checks"][0]
        issue = first["issue_id"]
        latest = self.audit["attempts"][-1]
        latest["review"]["blocker_checks"] = [{**first, "status": "unresolved", "finding": "本轮错误重新出现"}]
        feedback = ip._revision_feedback(self.audit)
        fix = next(f for f in feedback["required_fixes"] if f["id"] == issue)
        self.assertEqual(fix["latest_independent_check"]["finding"], "本轮错误重新出现")
        self.assertIn(issue, feedback["repair_focus"]["unresolved_or_unverified_blocker_ids"])
        latest["review"]["blocker_checks"] = None
        feedback = ip._revision_feedback(self.audit)
        self.assertNotIn("latest_independent_check", next(f for f in feedback["required_fixes"] if f["id"] == issue))
        self.assertIn(issue, feedback["repair_focus"]["unresolved_or_unverified_blocker_ids"])

    def test_reasoning_mode_is_selective_and_keeps_request_and_token_budget(self):
        resolved = {"required_fixes": [{"kind": "blocker", "latest_independent_check": {"status": "resolved"}}]}
        self.assertFalse(ip._factual_repair_required({}))
        self.assertFalse(ip._factual_repair_required({"required_fixes": [{"kind": "issue"}]}))
        self.assertFalse(ip._factual_repair_required(resolved))
        self.assertTrue(ip._factual_repair_required({"claim_checks": [{"verdict": "unsupported"}]}))
        with patch.dict(os.environ, {"INSIGHT_THINKING": "disabled", "INSIGHT_REVIEW_THINKING": "enabled"}), \
                patch.object(ip, "begin_request") as admission, patch.object(ip, "complete_request"), \
                patch.object(ip, "_completion_attempt", return_value=("{}", {})), \
                contextlib.redirect_stdout(io.StringIO()):
            ip.request_json("initial", "unused", stage="zh-draft-0", max_tokens=48000)
            ip.request_json("repair", "unused", stage="zh-draft-3", max_tokens=48000, thinking="enabled")
            ip.request_json("review", "unused", stage="zh-review", max_tokens=48000)
        self.assertEqual([call.args[1]["thinking"]["type"] for call in admission.call_args_list],
                         ["disabled", "enabled", "enabled"])
        self.assertEqual([call.args[1]["max_tokens"] for call in admission.call_args_list], [48000]*3)
        self.assertEqual([call.args[0] for call in admission.call_args_list],
                         ["zh-draft-0", "zh-draft-3", "zh-review"])
        with patch.object(ip, "begin_request") as admission, self.assertRaises(ValueError):
            ip.request_json("invalid", "unused", stage="zh-draft-3", thinking="invalid")
        admission.assert_not_called()

    def test_conflicting_duplicate_checks_remain_unverified_in_both_orders(self):
        latest = self.audit["attempts"][-1]
        unresolved = next(check for check in latest["review"]["blocker_checks"]
                          if check["status"] == "unresolved")
        resolved = {**unresolved, "status": "resolved", "finding": "重复记录声称已修复"}
        issue_id = unresolved["issue_id"]
        required = ip._prior_publication_blockers(self.audit, latest)
        for pair in ([unresolved, resolved], [resolved, unresolved]):
            with self.subTest(order=[check["status"] for check in pair]):
                latest["review"]["blocker_checks"] = copy.deepcopy(pair)
                feedback = ip._revision_feedback(self.audit)
                fix = next(f for f in feedback["required_fixes"] if f["id"] == issue_id)
                self.assertNotIn("latest_independent_check", fix)
                self.assertIn(issue_id, feedback["repair_focus"]["unresolved_or_unverified_blocker_ids"])
                self.assertNotIn(issue_id, feedback["repair_focus"]["preserve_and_recheck_resolved_ids"])
                self.assertTrue(ip._factual_repair_required(feedback))
                self.assertIn(f"blocker_checks repeats {issue_id}",
                              ip._blocker_check_errors(latest["review"], required))
                self.assertEqual(latest["review"]["blocker_checks"], pair)


if __name__ == "__main__":
    unittest.main()
