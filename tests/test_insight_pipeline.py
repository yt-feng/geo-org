import contextlib
import io
import json
import os
import queue
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import insight_pipeline as ip
import generate_daily_blog as daily


class ProviderResponse(io.BytesIO):
    def __init__(self, body, content_type="text/event-stream"):
        super().__init__(body.encode() if isinstance(body, str) else body)
        self.headers = {"Content-Type": content_type}


def event(delta=None, finish_reason=None, *, usage=None):
    value = {"choices": [{"index": 0, "delta": delta or {}, "finish_reason": finish_reason}]}
    if usage is not None:
        value["usage"] = usage
    return "data: " + json.dumps(value, ensure_ascii=False) + "\n\n"


class StreamingTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"INSIGHT_API_TIMEOUT": "300", "INSIGHT_API_DEADLINE": "1200"})
        environment.start()
        self.addCleanup(environment.stop)
        retries = patch.object(ip.gb, "RETRIES", 1)
        retries.start()
        self.addCleanup(retries.stop)

    def request(self, body, *, content_type="text/event-stream"):
        logs = io.StringIO()
        with patch.object(ip.urllib.request, "urlopen", return_value=ProviderResponse(body, content_type)) as opener, contextlib.redirect_stdout(logs):
            result = ip.request_json("Return article JSON. SOURCE_PRIVATE_SENTINEL", "KEY_PRIVATE_SENTINEL", stage="test-stream")
        return result, logs.getvalue(), opener

    def test_streamed_content_usage_and_reasoning_separation(self):
        secret_reasoning = "REASONING_PRIVATE_SENTINEL"
        usage = {"prompt_tokens": 100, "completion_tokens": 200, "total_tokens": 300,
                 "completion_tokens_details": {"reasoning_tokens": 150, "raw": secret_reasoning},
                 "provider_debug": "KEY_PRIVATE_SENTINEL"}
        body = ": keep-alive\n\n" + event({"role": "assistant", "reasoning_content": secret_reasoning})
        body += event({"content": '{"title":"正文","body_html":'})
        body += event({"content": '"<p>完整文章</p>"}'}) + event(finish_reason="stop", usage=usage) + "data: [DONE]\n\n"
        result, logs, opener = self.request(body)
        self.assertEqual(result, {"title": "正文", "body_html": "<p>完整文章</p>"})
        payload = json.loads(opener.call_args.args[0].data)
        self.assertIs(payload["stream"], True)
        self.assertEqual(payload["stream_options"], {"include_usage": True})
        self.assertEqual(opener.call_args.kwargs["timeout"], 300)
        self.assertIn('"reasoning_tokens": 150', logs)
        for private in (secret_reasoning, "KEY_PRIVATE_SENTINEL", "SOURCE_PRIVATE_SENTINEL", "完整文章"):
            self.assertNotIn(private, logs)
        with tempfile.TemporaryDirectory() as directory:
            audit_path = Path(directory) / "audit.json"
            ip.write_audit(audit_path, {"article": result})
            self.assertNotIn(secret_reasoning, audit_path.read_text())

    def test_usage_only_terminal_chunk_is_compatible(self):
        body = event({"content": '{"ok":true}'}) + event(finish_reason="stop")
        body += 'data: {"choices":[],"usage":{"total_tokens":42}}\n\ndata: [DONE]\n\n'
        result, logs, _ = self.request(body)
        self.assertEqual(result, {"ok": True})
        self.assertIn('"total_tokens": 42', logs)

    def test_missing_done_is_rejected_even_when_json_and_finish_are_complete(self):
        with self.assertRaisesRegex(RuntimeError, r"missing \[DONE\]"):
            self.request(event({"content": '{"ok":true}'}, finish_reason="stop"))

    def test_done_without_stop_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "incomplete output"):
            self.request(event({"content": '{"ok":true}'}) + "data: [DONE]\n\n")

    def test_length_cutoff_rejected_even_if_json_parses(self):
        with self.assertRaisesRegex(RuntimeError, "incomplete output \\(length\\)"):
            self.request(event({"content": '{"ok":true}'}, finish_reason="length") + "data: [DONE]\n\n")

    def test_length_cutoff_does_not_retry_identical_budget(self):
        body = event({"content": '{"ok":true}'}, finish_reason="length") + "data: [DONE]\n\n"
        logs = io.StringIO()
        with patch.object(ip.gb, "RETRIES", 3), patch.object(ip.urllib.request, "urlopen", return_value=ProviderResponse(body)) as opener, contextlib.redirect_stdout(logs):
            with self.assertRaisesRegex(RuntimeError, "identical-budget retry disabled"):
                ip.request_json("prompt", "key", stage="test-length", max_tokens=24000)
        self.assertEqual(opener.call_count, 1)
        self.assertIn("increase this stage's max_tokens", logs.getvalue())

    def test_error_chunk_and_malformed_json_do_not_expose_provider_body(self):
        for body in ('data: {"error":{"message":"KEY_PRIVATE_SENTINEL SOURCE_PRIVATE_SENTINEL"}}\n\n',
                     'data: INVALID_PROVIDER_PRIVATE_SENTINEL\n\n',
                     event({"content": "SOURCE_PRIVATE_SENTINEL"}, finish_reason="stop") + "data: [DONE]\n\n"):
            logs = io.StringIO()
            with self.subTest(body=body), patch.object(ip.urllib.request, "urlopen", return_value=ProviderResponse(body)), contextlib.redirect_stdout(logs):
                with self.assertRaises(RuntimeError) as error:
                    ip.request_json("source", "key", stage="test-error")
            combined = logs.getvalue() + str(error.exception)
            self.assertNotIn("PRIVATE_SENTINEL", combined)
            self.assertIn("failed", combined)

    def test_nonstream_json_compatibility_does_not_keep_reasoning(self):
        body = {"choices": [{"finish_reason": "stop", "message": {"content": '{"ok":true}', "reasoning_content": "REASONING_PRIVATE_SENTINEL"}}],
                "usage": {"total_tokens": 30, "unsafe": "PRIVATE_SENTINEL"}}
        result, logs, _ = self.request(json.dumps(body), content_type="application/json")
        self.assertEqual(result, {"ok": True})
        self.assertNotIn("PRIVATE_SENTINEL", logs + json.dumps(result))

    def test_retry_logs_fixed_reason_without_oserror_text(self):
        logs = io.StringIO()
        success = event({"content": '{"ok":true}'}, finish_reason="stop") + "data: [DONE]\n\n"
        with patch.object(ip.gb, "RETRIES", 2), patch.object(ip.urllib.request, "urlopen", side_effect=[TimeoutError("KEY_PRIVATE_SENTINEL"), ProviderResponse(success)]), patch.object(ip.time, "sleep"), contextlib.redirect_stdout(logs):
            result = ip.request_json("prompt", "key", stage="test-retry")
        self.assertEqual(result, {"ok": True})
        self.assertIn("provider idle read timeout", logs.getvalue())
        self.assertNotIn("PRIVATE_SENTINEL", logs.getvalue())

    def test_http_authentication_error_is_not_retried_or_dumped(self):
        error = ip.urllib.error.HTTPError("https://provider.example/", 401, "KEY_PRIVATE_SENTINEL", {}, io.BytesIO(b"SOURCE_PRIVATE_SENTINEL"))
        with patch.object(ip.gb, "RETRIES", 3), patch.object(ip.urllib.request, "urlopen", side_effect=error) as opener:
            with self.assertRaisesRegex(RuntimeError, "provider HTTP 401") as failed:
                ip.request_json("prompt", "key", stage="test-auth")
        self.assertEqual(opener.call_count, 1)
        self.assertNotIn("PRIVATE_SENTINEL", str(failed.exception))

    def test_heartbeat_occurs_without_waiting_for_any_content(self):
        fake_queue = MagicMock()
        fake_queue.get.side_effect = [queue.Empty, (True, ('{"ok":true}', {}))]
        logs = io.StringIO()
        with patch.object(ip.queue, "Queue", return_value=fake_queue), patch.object(ip.threading, "Thread"), patch.object(ip.time, "monotonic", side_effect=[0, 0, 60, 60, 60]), contextlib.redirect_stdout(logs):
            result = ip._completion_attempt(None, "test-progress", 300, 1200)
        self.assertEqual(result, ('{"ok":true}', {}))
        self.assertEqual(logs.getvalue().strip(), "Insight test-progress: progress content_chars=0 elapsed=60s")

    def test_overall_deadline_does_not_wait_for_a_blocked_read(self):
        released = threading.Event()
        closed = threading.Event()

        class BlockingResponse:
            headers = {"Content-Type": "text/event-stream"}

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.close()

            def readline(self, size):
                released.wait(1)
                return b""

            def close(self):
                closed.set()
                released.set()

        started = time.monotonic()
        with patch.object(ip.urllib.request, "urlopen", return_value=BlockingResponse()):
            with self.assertRaisesRegex(ip._CompletionError, "overall deadline"):
                ip._completion_attempt(None, "test-deadline", 300, 0.03)
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertTrue(closed.wait(0.2))


class PipelineTests(unittest.TestCase):
    def test_malformed_article_is_never_replaced_with_template(self):
        for raw in ({}, {"title": "Title", "excerpt": "Intro", "body_html": ""}):
            with self.assertRaises(ValueError):
                ip.normalize_article(raw, "zh")

    def test_review_thresholds_fail_closed(self):
        good = {"scores": dict.fromkeys(ip.SCORE_KEYS, 5), "issues": [], "blockers": []}
        self.assertEqual(ip.review_errors(good), [])
        self.assertTrue(ip.review_errors({**good, "scores": dict.fromkeys(ip.SCORE_KEYS, 4)}))
        self.assertTrue(ip.review_errors({**good, "blockers": ["unsupported external claim"]}))
        self.assertTrue(ip.review_errors({"scores": {"thesis": 5}}))

    def test_truncation_rejected_even_if_content_parses(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({"choices": [{
            "finish_reason": "length", "message": {"content": '{"title":"valid JSON"}'}}]})
        with patch.object(ip.urllib.request, "urlopen", return_value=response), patch.object(ip.gb, "RETRIES", 1):
            with self.assertRaisesRegex(RuntimeError, "incomplete output"):
                ip.request_json("test", "test-key", stage="test")

    def test_source_bodies_are_not_published(self):
        sources = [{"id": "S1", "url": "https://example.org/a", "title": "Research", "text": "copyrighted source body"}]
        public = ip.public_sources(sources)
        self.assertNotIn("text", public[0])
        self.assertEqual(len(public[0]["text_sha256"]), 64)

    def test_empty_or_repeated_claim_checks_cannot_pass(self):
        bad = {"scores": dict.fromkeys(ip.SCORE_KEYS, 5), "issues": [], "blockers": [],
               "claim_checks": [{"verdict": "inference"}] * 5}
        with patch.object(ip, "request_json", return_value=bad):
            review = ip.review_article({}, [{"id": "S1", "text": "source"}], "test", "zh")
        self.assertTrue(ip.review_errors(review))

    def test_translation_failure_leaves_site_untouched(self):
        topic = ip.gb.TopicRow(2, "Example", {}, "Brand", "GEO")
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "blog"
            out.mkdir()
            (out / "posts.json").write_text("[]")
            source = [{"id": "S1", "url": "https://example.org/a", "title": "Source", "text": "text"}]
            with patch.dict(ip.os.environ, {"DEEPSEEK_API_KEY": "test"}), \
                 patch.object(daily.gb, "read_topics", return_value=[topic]), \
                 patch.object(daily, "fetch_news_items", return_value=[]), \
                 patch.object(daily, "fetch_tavily_market_items", return_value=[]), \
                 patch.object(daily, "build_research_pack", return_value=source), \
                 patch.object(ip, "produce_article", side_effect=[{"title":"Title"}, RuntimeError("Arabic omitted evidence")]), \
                 patch.object(daily.i18n_site, "ensure_language_scaffold") as scaffold, \
                 patch.object(daily, "write_indexes") as indexes:
                with self.assertRaisesRegex(RuntimeError, "omitted evidence"):
                    daily.generate_daily_article(Path("unused.xlsx"), out, 2, False)
                scaffold.assert_not_called()
                indexes.assert_not_called()
                self.assertEqual((out / "posts.json").read_text(), "[]")
                self.assertFalse((out / "articles").exists())


if __name__ == "__main__":
    unittest.main()
