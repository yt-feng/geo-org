import json
import os
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import deepseek_cost_policy as policy


class CostPolicyTests(unittest.TestCase):
    def instant(self, value):
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)

    def test_weekday_peak_boundaries_and_noon_gap(self):
        for value in ("2026-09-21T01:00:00", "2026-09-21T03:59:59", "2026-09-21T06:00:00", "2026-09-21T09:59:59"):
            with self.subTest(value=value), self.assertRaises(policy.CostDeferredError):
                policy.assert_offpeak(10, now=self.instant(value))
        for value in ("2026-09-21T04:00:00", "2026-09-21T05:00:00", "2026-09-21T10:00:00"):
            policy.assert_offpeak(10, now=self.instant(value))

    def test_request_deadline_and_margin_cannot_cross_peak(self):
        with self.assertRaises(policy.CostDeferredError):
            policy.assert_offpeak(1200, now=self.instant("2026-09-21T05:40:00"))
        policy.assert_offpeak(1200, now=self.instant("2026-09-21T05:38:00"))

    def test_weekends_and_midnight(self):
        policy.assert_offpeak(1200, now=self.instant("2026-09-20T01:30:00"))
        with self.assertRaises(policy.CostDeferredError):
            policy.assert_offpeak(7200, now=self.instant("2026-09-20T23:30:00"))

    def test_naive_clock_is_rejected(self):
        with self.assertRaises(ValueError):
            policy.assert_offpeak(now=datetime(2026, 9, 21))

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "usage.jsonl"
        env = patch.dict(os.environ, {"DEEPSEEK_USAGE_LOG": str(self.path),
            "DEEPSEEK_MAX_RUN_REQUESTS": "12", "DEEPSEEK_MAX_RUN_TOKENS": "600000"})
        env.start(); self.addCleanup(env.stop)
        clock = patch.object(policy, "utcnow", return_value=self.instant("2026-09-21T18:17:00"))
        self.clock = clock.start(); self.addCleanup(clock.stop)
        self.payload = {"model": "deepseek-flash", "max_tokens": 1000,
            "messages": [{"role": "user", "content": "PRIVATE_SOURCE_SENTINEL"}]}

    def test_unknown_failed_usage_retains_reservation_and_retry_counts(self):
        with patch.dict(os.environ, {"DEEPSEEK_MAX_RUN_TOKENS": "6000"}):
            ticket = policy.begin_request("zh-draft-0", self.payload, 1200)
            policy.complete_request(ticket, status="failed_unknown_usage")
            with self.assertRaises(policy.CostDeferredError):
                policy.begin_request("zh-draft-0", self.payload, 1200)
        events = [json.loads(line) for line in self.path.read_text().splitlines()]
        self.assertFalse(events[-1]["usage_known"])
        self.assertEqual(events[-1]["accounted_tokens"], events[0]["reserved_tokens"])

    def test_actual_usage_releases_reservation_without_logging_content(self):
        with patch.dict(os.environ, {"DEEPSEEK_MAX_RUN_TOKENS": "6000"}):
            ticket = policy.begin_request("en-review-0", self.payload, 1200)
            policy.complete_request(ticket, {"prompt_tokens": 100, "completion_tokens": 100,
                "total_tokens": 200, "debug": "PRIVATE_KEY_SENTINEL"})
            policy.begin_request("ar-review-0", self.payload, 1200)
        text = self.path.read_text()
        self.assertNotIn("PRIVATE_SOURCE_SENTINEL", text)
        self.assertNotIn("PRIVATE_KEY_SENTINEL", text)

    def test_empty_usage_is_unknown_and_results_idempotent(self):
        ticket = policy.begin_request("research-brief", self.payload, 1200)
        policy.complete_request(ticket, {})
        policy.complete_request(ticket, status="failed_unknown_usage")
        events = [json.loads(line) for line in self.path.read_text().splitlines()]
        self.assertEqual(len(events), 2)
        self.assertFalse(events[-1]["usage_known"])

    def test_inflight_requests_are_reserved_and_counted(self):
        with patch.dict(os.environ, {"DEEPSEEK_MAX_RUN_REQUESTS": "1"}):
            policy.begin_request("zh-review-0", self.payload, 1200)
            with self.assertRaises(policy.CostDeferredError):
                policy.begin_request("ar-review-0", self.payload, 1200)

    def test_corrupt_ledger_blocks_without_overwrite(self):
        self.path.write_text("incomplete-json")
        with self.assertRaises(policy.CostDeferredError):
            policy.begin_request("research-brief", self.payload, 1200)
        self.assertEqual(self.path.read_text(), "incomplete-json")

    def test_refused_peak_call_does_not_create_usage_event(self):
        with patch.object(policy, "utcnow", return_value=self.instant("2026-09-21T06:00:00")), self.assertRaises(policy.CostDeferredError):
            policy.begin_request("research-brief", self.payload, 1200)
        self.assertFalse(self.path.exists())

    def test_concurrent_locale_requests_share_one_budget(self):
        def admit(_):
            try:
                return policy.begin_request("locale-review", self.payload, 1200)
            except policy.CostDeferredError:
                return None
        with patch.dict(os.environ, {"DEEPSEEK_MAX_RUN_REQUESTS": "7"}), ThreadPoolExecutor(max_workers=16) as executor:
            tickets = list(executor.map(admit, range(32)))
        self.assertEqual(len([ticket for ticket in tickets if ticket]), 7)
        self.assertEqual(len(self.path.read_text().splitlines()), 7)

    def test_provider_retry_rechecks_clock_before_network(self):
        import insight_pipeline as pipeline
        def fail_then_enter_peak(*args):
            self.clock.return_value = self.instant("2026-09-22T01:00:00")
            raise pipeline._CompletionError("temporary transport error")
        with patch.object(pipeline, "_completion_attempt", side_effect=fail_then_enter_peak) as transport, \
                patch.object(pipeline.gb, "RETRIES", 2), patch.object(pipeline.time, "sleep"):
            with self.assertRaises(policy.CostDeferredError):
                pipeline.request_json("Only a mocked request", "unused-test-key", stage="zh-draft-0", max_tokens=1000)
        self.assertEqual(transport.call_count, 1)
        events = [json.loads(line) for line in self.path.read_text().splitlines()]
        self.assertEqual(len(events), 2)
        self.assertFalse(events[-1]["usage_known"])


if __name__ == "__main__":
    unittest.main()
