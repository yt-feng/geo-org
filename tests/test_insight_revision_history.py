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
        self.assertEqual([fix["id"] for fix in saved["attempts"][-1]["feedback_applied"]["required_fixes"]],
                         self.expected_ids)
        blocker_json = reviewed_prompts[0].split("待核历史blocker：", 1)[1].split("\n语言：", 1)[0]
        self.assertEqual([fix["id"] for fix in json.loads(blocker_json)], ["r0-blocker-1"])
        self.assertTrue(saved["passed"])
        self.assertEqual(article["quality"]["revisions"], 3)
        self.assertEqual(self.audit, original)


if __name__ == "__main__":
    unittest.main()
