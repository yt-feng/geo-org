"""A rejected completion must retain confirmed billing without accepting text."""
import contextlib
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import deepseek_cost_policy as policy
import insight_pipeline as ip


class Response(io.BytesIO):
    def __init__(self, body, content_type="text/event-stream"):
        super().__init__(body.encode())
        self.headers = {"Content-Type": content_type}


def chunk(content=None, finish=None, usage=None):
    value = {"choices": [{"index": 0, "delta": {"content": content}, "finish_reason": finish}]}
    if usage is not None:
        value["usage"] = usage
    return "data: " + json.dumps(value) + "\n\n"


class CutoffUsageTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "usage.jsonl"
        patches = [
            patch.dict(os.environ, {"DEEPSEEK_USAGE_LOG": str(self.path),
                "DEEPSEEK_MAX_RUN_REQUESTS": "12", "DEEPSEEK_MAX_RUN_TOKENS": "600000",
                "INSIGHT_LENGTH_RETRY_MAX_TOKENS": "96000"}),
            patch.object(policy, "utcnow", return_value=datetime(2026, 9, 30, 23, 0, tzinfo=timezone.utc)),
            patch.object(ip.gb, "RETRIES", 1),
            patch.object(ip.time, "sleep"),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def events(self):
        return [json.loads(line) for line in self.path.read_text().splitlines()]

    def reject(self, body, content_type="text/event-stream"):
        with patch.object(ip.urllib.request, "urlopen", return_value=Response(body, content_type)), \
                contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
            ip.request_json("prompt", "test-key", stage="cutoff", max_tokens=100)
        return self.events()[-1]

    def test_length_terminal_usage_is_accounted_but_partial_json_never_returns(self):
        body = chunk('{"looks_complete":true}', "length")
        body += 'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":100,"total_tokens":200,"debug":"PRIVATE_SENTINEL"}}\n\n'
        result = self.reject(body + "data: [DONE]\n\n")
        self.assertEqual(result["status"], "output_limit")
        self.assertTrue(result["usage_known"])
        self.assertEqual(result["accounted_tokens"], 200)
        self.assertNotIn("PRIVATE_SENTINEL", self.path.read_text())

    def test_length_usage_on_finish_chunk_is_accounted(self):
        result = self.reject(chunk('{"partial":', "length", {"total_tokens":200}) + "data: [DONE]\n\n")
        self.assertEqual(result["accounted_tokens"], 200)

    def test_nonstream_cutoff_keeps_confirmed_usage(self):
        body = json.dumps({"choices": [{"finish_reason": "length", "message": {"content": '{"partial":'}}],
            "usage": {"total_tokens": 200}})
        result = self.reject(body, "application/json")
        self.assertEqual(result["accounted_tokens"], 200)

    def test_unfinished_or_malformed_stream_cannot_release_reservation(self):
        finish = chunk('{"partial":', "length", {"total_tokens":200})
        for suffix in ("", "data: broken\n\n", chunk("extra") + "data: [DONE]\n\n",
                chunk(finish="length") + "data: [DONE]\n\n"):
            with self.subTest(suffix=suffix):
                self.path.unlink(missing_ok=True)
                result = self.reject(finish + suffix)
                self.assertFalse(result["usage_known"])
                self.assertEqual(result["accounted_tokens"], self.events()[0]["reserved_tokens"])

    def test_missing_or_invalid_usage_retains_full_reservation(self):
        for usage in (None, {}, {"total_tokens": 0}, {"total_tokens": True}, {"total_tokens": -1},
                {"total_tokens": 1, "prompt_tokens": -1},
                {"total_tokens": 1, "completion_tokens_details": {"reasoning_tokens": "invalid"}}):
            with self.subTest(usage=usage):
                self.path.unlink(missing_ok=True)
                result = self.reject(chunk('{"partial":', "length", usage) + "data: [DONE]\n\n")
                self.assertFalse(result["usage_known"])
                self.assertEqual(result["accounted_tokens"], self.events()[0]["reserved_tokens"])

    def test_total_smaller_than_known_parts_retains_full_reservation(self):
        for usage in ({"prompt_tokens": 100, "total_tokens": 1},
                {"completion_tokens": 100, "total_tokens": 1},
                {"prompt_tokens": 100, "completion_tokens": 100, "total_tokens": 150},
                {"prompt_cache_hit_tokens": 100, "total_tokens": 1},
                {"prompt_cache_miss_tokens": 100, "total_tokens": 1},
                {"completion_tokens_details": {"reasoning_tokens": 100}, "total_tokens": 1},
                {"prompt_cache_hit_tokens": 80, "prompt_cache_miss_tokens": 80, "total_tokens": 100},
                {"prompt_cache_hit_tokens": 80, "prompt_cache_miss_tokens": 80, "prompt_tokens": 100, "total_tokens": 200},
                {"completion_tokens_details": {"reasoning_tokens": 150}, "completion_tokens": 100, "total_tokens": 200}):
            with self.subTest(usage=usage):
                self.path.unlink(missing_ok=True)
                result = self.reject(chunk('{"partial":', "length", usage) + "data: [DONE]\n\n")
                self.assertFalse(result["usage_known"])
                self.assertEqual(result["accounted_tokens"], self.events()[0]["reserved_tokens"])

    def test_decreasing_terminal_usage_cannot_reduce_accounted_tokens(self):
        for terminal in (1, -1, "invalid"):
            with self.subTest(terminal=terminal):
                self.path.unlink(missing_ok=True)
                body = chunk('{"partial":', "length", {"total_tokens": 200})
                body += 'data: ' + json.dumps({"choices": [], "usage": {"total_tokens": terminal}}) + '\n\ndata: [DONE]\n\n'
                result = self.reject(body)
                self.assertFalse(result["usage_known"])
                self.assertEqual(result["accounted_tokens"], self.events()[0]["reserved_tokens"])

    def test_increasing_terminal_usage_preserves_final_total(self):
        body = chunk('{"partial":', "length", {"total_tokens": 100})
        body += 'data: {"choices":[],"usage":{"total_tokens":200}}\n\ndata: [DONE]\n\n'
        result = self.reject(body)
        self.assertTrue(result["usage_known"])
        self.assertEqual(result["accounted_tokens"], 200)

    def test_confirmed_usage_allows_bounded_retry_under_unchanged_token_cap(self):
        messages = [{"role": "system", "content": ip.SYSTEM}, {"role": "user", "content": "prompt"}]
        second_reserve = len(json.dumps(messages, ensure_ascii=False).encode()) + 200 + 4096
        cutoff = chunk('{"partial":', "length", {"total_tokens":200}) + "data: [DONE]\n\n"
        success = chunk('{"complete":true}', "stop", {"total_tokens":100}) + "data: [DONE]\n\n"
        with patch.dict(os.environ, {"DEEPSEEK_MAX_RUN_TOKENS": str(second_reserve + 200)}), \
                patch.object(ip.gb, "RETRIES", 2), \
                patch.object(ip.urllib.request, "urlopen", side_effect=[Response(cutoff), Response(success)]) as opener, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(ip.request_json("prompt", "key", stage="cutoff", max_tokens=100), {"complete": True})
        self.assertEqual(opener.call_count, 2)
        self.assertEqual([event["accounted_tokens"] for event in self.events() if event["event"] == "result"], [200, 100])

    def test_unknown_usage_still_blocks_retry_under_same_token_cap(self):
        messages = [{"role": "system", "content": ip.SYSTEM}, {"role": "user", "content": "prompt"}]
        second_reserve = len(json.dumps(messages, ensure_ascii=False).encode()) + 200 + 4096
        cutoff = chunk('{"partial":', "length") + "data: [DONE]\n\n"
        with patch.dict(os.environ, {"DEEPSEEK_MAX_RUN_TOKENS": str(second_reserve + 200)}), \
                patch.object(ip.gb, "RETRIES", 2), \
                patch.object(ip.urllib.request, "urlopen", return_value=Response(cutoff)) as opener, \
                contextlib.redirect_stdout(io.StringIO()), self.assertRaises(policy.CostDeferredError):
            ip.request_json("prompt", "key", stage="cutoff", max_tokens=100)
        self.assertEqual(opener.call_count, 1)
        self.assertFalse(self.events()[-1]["usage_known"])


if __name__ == "__main__":
    unittest.main()
