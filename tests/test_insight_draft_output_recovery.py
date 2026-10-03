"""Production draft recovery never treats incomplete provider output as a pass."""
import contextlib
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import insight_pipeline as ip


class DraftOutputRecoveryTests(unittest.TestCase):
    def run_requests(self, results, stage="zh-draft-5", thinking="enabled"):
        payloads = []
        def attempt(request, *args):
            payloads.append(json.loads(request.data))
            value = results[len(payloads) - 1]
            if isinstance(value, Exception):
                raise value
            return value, {}
        with patch.dict(os.environ, {"INSIGHT_LENGTH_RETRY_MAX_TOKENS": "96000"}), \
                patch.object(ip.gb, "RETRIES", 2), patch.object(ip, "begin_request"), \
                patch.object(ip, "complete_request") as account, \
                patch.object(ip, "_completion_attempt", side_effect=attempt), \
                patch.object(ip.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
            result = ip.request_json("SOURCE_SENTINEL; original blocker r2-blocker-7", "unused",
                                     stage=stage, max_tokens=48000, thinking=thinking)
        return result, payloads, account

    def test_production_invalid_json_then_complete_draft_uses_direct_output(self):
        result, payloads, _ = self.run_requests(['{"title":', '{"title":"complete"}'])
        self.assertEqual(result, {"title": "complete"})
        self.assertEqual([p["thinking"]["type"] for p in payloads], ["enabled", "disabled"])
        self.assertEqual([p["max_tokens"] for p in payloads], [48000, 48000])
        self.assertIn("SOURCE_SENTINEL", payloads[1]["messages"][1]["content"])
        self.assertIn("r2-blocker-7", payloads[1]["messages"][1]["content"])
        self.assertIn("独立审稿和发布门槛不变", payloads[1]["messages"][1]["content"])
        self.assertEqual(payloads[0]["model"], payloads[1]["model"])
        self.assertNotIn("draft_output_recovery", payloads[1])

    def test_production_cutoff_recovery_preserves_larger_budget_and_usage(self):
        result, payloads, account = self.run_requests([
            ip._OutputLimitError("incomplete output (length)", usage={"completion_tokens":48000}), '{}'])
        self.assertEqual(result, {})
        self.assertEqual([p["thinking"]["type"] for p in payloads], ["enabled", "disabled"])
        self.assertEqual([p["max_tokens"] for p in payloads], [48000, 96000])
        self.assertTrue(any(c.kwargs.get("status") == "output_limit" for c in account.call_args_list))

    def test_independent_review_reasoning_never_changes_for_format_recovery(self):
        _, payloads, _ = self.run_requests(['invalid', '{}'], stage="zh-review")
        self.assertEqual([p["thinking"]["type"] for p in payloads], ["enabled", "enabled"])
        self.assertEqual(payloads[0]["messages"], payloads[1]["messages"])

    def test_independent_review_reasoning_never_changes_for_cutoff_recovery(self):
        _, payloads, _ = self.run_requests([ip._OutputLimitError("length"), '{}'], stage="zh-review")
        self.assertEqual([p["thinking"]["type"] for p in payloads], ["enabled", "enabled"])

    def test_invalid_json_then_last_attempt_cutoff_still_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "bounded length recovery exhausted"):
            self.run_requests(['invalid', ip._OutputLimitError("incomplete output (length)")])

    def test_output_recovery_does_not_add_paid_requests_after_two_cutoffs(self):
        with self.assertRaisesRegex(RuntimeError, "bounded length recovery exhausted"):
            self.run_requests([ip._OutputLimitError("length"), ip._OutputLimitError("length")])

    def test_saved_recovery_starts_direct_output_without_extra_request(self):
        payloads=[]
        def attempt(request,*args):
            payloads.append(json.loads(request.data));return '{}',{}
        with patch.object(ip, "begin_request"), patch.object(ip, "complete_request"), \
                patch.object(ip, "_completion_attempt", side_effect=attempt), \
                contextlib.redirect_stdout(io.StringIO()):
            ip.request_json("original blockers remain", "unused", stage="zh-draft-8",
                            thinking="enabled", output_recovery=True)
        self.assertEqual(len(payloads),1)
        self.assertEqual(payloads[0]["thinking"]["type"],"disabled")
        self.assertEqual(payloads[0]["max_tokens"],48000)
        self.assertIn("original blockers remain",payloads[0]["messages"][-1]["content"])

    def test_recovery_is_remembered_even_when_budget_blocks_the_retry(self):
        remembered=[]
        with patch.object(ip.gb, "RETRIES", 2), patch.object(ip, "begin_request",
                side_effect=["ticket",RuntimeError("run token budget reached")]), \
                patch.object(ip, "complete_request"), \
                patch.object(ip, "_completion_attempt", side_effect=ip._OutputLimitError("length")), \
                contextlib.redirect_stdout(io.StringIO()),self.assertRaisesRegex(RuntimeError,"run token budget"):
            ip.request_json("source", "unused", stage="zh-draft-7", thinking="enabled",
                            on_output_recovery=lambda:remembered.append(True))
        self.assertEqual(remembered,[True])

    def test_source_bound_resume_preserves_recovery_and_review_obligations(self):
        import copy
        from test_insight_revision_history import RevisionHistoryTests
        fixture=RevisionHistoryTests();fixture.setUp()
        for error in ("incomplete output (length); bounded length recovery exhausted",
                      "DeepSeek deferred: run token budget reached"):
            original=copy.deepcopy(fixture.audit)
            original["error"]=error
            original["attempts"][-1]["draft_thinking"]="enabled"
            original["attempts"][-1]["structure"]["passed"]=False
            resumed=ip._resume_article_audit(original,fixture.topic,fixture.sources,"zh")
            self.assertTrue(resumed["draft_output_recovery"])
            self.assertFalse(resumed["passed"])
            self.assertEqual(resumed["attempts"],original["attempts"])
            self.assertEqual(resumed["resume_history"][-1]["previous_error"],error)
            self.assertNotIn("draft_output_recovery",original)

    def test_output_recovery_is_idempotent_and_only_targets_drafts(self):
        payload = {"thinking":{"type":"enabled"}, "messages":[{"content":"original"}]}
        ip._recover_draft_output(payload, "research-brief")
        self.assertEqual(payload["thinking"]["type"], "enabled")
        with contextlib.redirect_stdout(io.StringIO()):
            ip._recover_draft_output(payload, "zh-draft-4")
            once = json.dumps(payload)
            ip._recover_draft_output(payload, "zh-draft-4")
        self.assertEqual(json.dumps(payload), once)


if __name__ == "__main__":
    unittest.main()
