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
