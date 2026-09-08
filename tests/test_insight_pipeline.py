import contextlib
import copy
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


class RevisionMetadataTests(unittest.TestCase):
    def setUp(self):
        self.sources = [{"id": "S1", "url": "https://example.com/a", "title": "A", "text": "Source A"},
                        {"id": "S2", "url": "https://example.org/b", "title": "B", "text": "Source B"}]
        self.article = {"title": "条件式决策", "excerpt": "比较条件与投入", "body_html": "<p>当前正文只保留条件式建议。</p>", "tags": ["GEO"]}
        self.feedback = {"required_fixes": [{"id": "r0-blocker-1", "kind": "blocker", "problem": "删除无来源的行业断言"}]}

    def good_review(self):
        return {"scores": {**dict.fromkeys(ip.SCORE_KEYS, 4), "originality": 5}, "issues": [], "blockers": [],
                "claim_checks": [{"claim": f"Concrete current article observation number {number}", "reason": "This supplied source contains the scoped observation.",
                                  "source_ids": ["S1" if number % 2 else "S2"], "verdict": "supported"} for number in range(5)]}

    def resolved_check(self):
        return {"issue_id": "r0-blocker-1", "status": "resolved", "location": "表2",
                "finding": "旧行业断言已删除，当前表2仅保留明示假设下的条件式选择。"}

    def response(self):
        return {"revision_response": [{"issue_id": "r0-blocker-1", "change": "删除行业断言", "location": "表2", "verification": "已核对新表述"}]}

    def test_short_but_valid_chinese_response_fields_are_accepted(self):
        self.assertEqual(ip._revision_response_errors(self.response(), self.feedback), [])

    def test_blank_fields_missing_duplicate_and_unknown_ids_remain_invalid(self):
        for responses in ([], [self.response()["revision_response"][0]] * 2,
                          [{**self.response()["revision_response"][0], "location": " "}],
                          [{**self.response()["revision_response"][0], "issue_id": "unknown"}]):
            with self.subTest(responses=responses):
                self.assertTrue(ip._revision_response_errors({"revision_response": responses}, self.feedback))

    def test_missing_historical_check_uses_review_format_repair(self):
        missing = self.good_review()
        repaired = {**self.good_review(), "blocker_checks": [self.resolved_check()]}
        with patch.object(ip, "request_json", side_effect=[missing, repaired]) as request:
            review = ip.review_article(self.article, self.sources, "test", "zh", required_fixes=self.feedback["required_fixes"])
        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args.kwargs["stage"], "zh-review-format-repair")
        self.assertEqual(ip.review_errors(review), [])
        self.assertIn("旧断言若已删除", request.call_args.args[0])
        self.assertIn("不要把被删旧claim列入当前claim_checks", request.call_args.args[0])

    def test_missing_historical_check_after_format_repair_cannot_pass(self):
        with patch.object(ip, "request_json", side_effect=[self.good_review(), self.good_review()]) as request:
            review = ip.review_article(self.article, self.sources, "test", "zh", required_fixes=self.feedback["required_fixes"])
        self.assertEqual(request.call_count, 2)
        self.assertTrue(ip.review_errors(review))
        self.assertTrue(any("blocker_checks" in blocker for blocker in review["blockers"]))

    def test_unresolved_or_unverifiable_history_cannot_be_cleared_by_author(self):
        for status in ("unresolved", "unverifiable"):
            value = {**self.good_review(), "blocker_checks": [{**self.resolved_check(), "status": status}]}
            with self.subTest(status=status), patch.object(ip, "request_json", return_value=value):
                review = ip.review_article({**self.article, **self.response()}, self.sources, "test", "zh", required_fixes=self.feedback["required_fixes"])
            self.assertTrue(ip.review_errors(review))
            self.assertTrue(any(f"remains {status}" in blocker for blocker in review["blockers"]))

    def test_format_repair_cannot_erase_explicit_unresolved_finding(self):
        original = {**self.good_review(), "issues": "wrong format",
                    "blocker_checks": [{**self.resolved_check(), "status": "unresolved", "finding": "旧断言仍存在于摘要中。"}]}
        repaired = {**self.good_review(), "blocker_checks": [self.resolved_check()]}
        with patch.object(ip, "request_json", side_effect=[original, repaired]):
            review = ip.review_article(self.article, self.sources, "test", "zh", required_fixes=self.feedback["required_fixes"])
        self.assertTrue(ip.review_errors(review))
        self.assertTrue(any("remains unresolved" in blocker for blocker in review["blockers"]))

    def run_two_drafts(self, metadata_result, *, final_review=None, expect_failure=False):
        first_review = {**self.good_review(), "blockers": [self.feedback["required_fixes"][0]["problem"]]}
        last_review = final_review or {**self.good_review(), "blocker_checks": [self.resolved_check()]}
        stages = []
        reviewed = []

        def request(prompt, api_key, *, stage, **kwargs):
            stages.append(stage)
            if stage == "research-brief":
                return {"decision_question": "资源应该如何分配"}
            if "draft" in stage:
                return copy.deepcopy(self.article)  # Deliberately omit author metadata.
            if stage == "zh-review":
                reviewed.append(prompt)
                return copy.deepcopy(first_review if len(reviewed) == 1 else last_review)
            if stage == "zh-revision-metadata-repair":
                if isinstance(metadata_result, Exception):
                    raise metadata_result
                return copy.deepcopy(metadata_result)
            raise AssertionError(f"Unexpected stage {stage}")

        topic = ip.gb.TopicRow(2, "条件式资源配置", {}, "Brand", "GEO")
        with tempfile.TemporaryDirectory() as directory:
            audit_path = Path(directory) / "audit.json"
            with patch.object(ip, "request_json", side_effect=request), patch.object(ip, "validate_insight", side_effect=lambda *a, **k: {"passed": True, "errors": [], "metrics": {}}), patch.dict(os.environ, {"INSIGHT_MAX_REVISIONS": "1"}):
                if expect_failure:
                    with self.assertRaisesRegex(RuntimeError, "did not pass quality gates"):
                        ip.produce_article(topic, self.sources, "test", audit_path=audit_path)
                    result = None
                else:
                    result = ip.produce_article(topic, self.sources, "test", audit_path=audit_path)
            audit = json.loads(audit_path.read_text())
        return result, audit, stages, reviewed

    def test_metadata_repair_does_not_skip_review_rewrite_article_or_consume_draft_round(self):
        result, audit, stages, reviewed = self.run_two_drafts(self.response())
        self.assertEqual(sum("draft" in stage for stage in stages), 2)
        self.assertEqual(len(reviewed), 2)
        self.assertEqual(stages[-2:], ["zh-review", "zh-revision-metadata-repair"])
        self.assertEqual(result["body_html"], self.article["body_html"])
        self.assertEqual(result["quality"]["revisions"], 1)
        attempt = audit["attempts"][1]
        self.assertTrue(attempt["structure"]["passed"])
        self.assertEqual(attempt["structure"]["errors"], [])
        self.assertEqual(attempt["review_state"], "completed")
        self.assertEqual(attempt["metadata_state"], "repaired")
        frozen = json.dumps(attempt["article"], ensure_ascii=False, sort_keys=True)
        self.assertEqual(attempt["metadata_repair"]["article_sha256"], ip.hashlib.sha256(frozen.encode()).hexdigest())

    def test_failed_auxiliary_repair_is_audited_after_independent_blocker_clearance(self):
        for metadata in ({}, RuntimeError("provider unavailable"), {**self.response(), "body_html": "ATTEMPTED_REPLACEMENT"}):
            with self.subTest(metadata=metadata):
                result, audit, stages, reviewed = self.run_two_drafts(metadata)
            self.assertTrue(audit["passed"])
            self.assertEqual(len(reviewed), 2)
            self.assertEqual(result["body_html"], self.article["body_html"])
            self.assertEqual(audit["attempts"][1]["metadata_state"], "warning")
            self.assertNotIn("ATTEMPTED_REPLACEMENT", json.dumps(audit))
            self.assertEqual(sum("draft" in stage for stage in stages), 2)

    def test_bad_metadata_never_bypasses_current_review_or_old_blockers(self):
        final_review = {**self.good_review(), "blocker_checks": [{**self.resolved_check(), "status": "unresolved"}]}
        _, audit, stages, reviewed = self.run_two_drafts(self.response(), final_review=final_review, expect_failure=True)
        self.assertFalse(audit["passed"])
        self.assertEqual(len(reviewed), 2)
        self.assertNotIn("zh-revision-metadata-repair", stages)
        self.assertEqual(audit["attempts"][1]["review_state"], "completed")

    def test_low_score_still_requires_substantive_revision_despite_metadata(self):
        final_review = {**self.good_review(), "scores": {**self.good_review()["scores"], "tradeoffs": 3}, "blocker_checks": [self.resolved_check()]}
        _, audit, stages, reviewed = self.run_two_drafts(self.response(), final_review=final_review, expect_failure=True)
        self.assertFalse(audit["passed"])
        self.assertEqual(len(reviewed), 2)
        self.assertTrue(any("tradeoffs: 3/5" in error for error in audit["attempts"][1]["errors"]))


class ResumeTests(unittest.TestCase):
    def setUp(self):
        self.topic = ip.gb.TopicRow(694, "条件式资源配置", {}, "Brand", "GEO")
        self.sources = [{"id": "S1", "url": "https://example.com/a", "title": "A", "text": "Unpublished source A body"},
                        {"id": "S2", "url": "https://example.org/b", "title": "B", "text": "Unpublished source B body"}]
        self.article = {"title": "当前比较框架", "excerpt": "同口径的条件式示例", "body_html": "<p>原计数与资源投入的当前正文。</p>", "tags": ["GEO"]}
        self.audit = {"version": "insights-v3", "row": 694, "language": "zh", "passed": False,
                      "error": "previous quality failure", "sources": ip.public_sources(self.sources),
                      "brief": {"decision_question": "应该如何分配同一预算", "decision_model": {"old_model": "discard invalid model"}},
                      "attempts": [{"revision": revision, "article": {**self.article, "body_html": f"<p>第{revision}轮旧稿</p>"},
                                    "structure": {"passed": True, "errors": [], "metrics": {}},
                                    "review": {"scores": dict.fromkeys(ip.SCORE_KEYS, 3),
                                               "blockers": ["不得编造行业事实"] if revision == 0 else ["统一增量和存量口径"] if revision == 2 else [],
                                               "issues": ["重新代入反转阈值"] if revision == 2 else []},
                                    "errors": ["prior editorial failure"]} for revision in range(3)]}

    def good_review(self, fixes):
        return {"scores": {**dict.fromkeys(ip.SCORE_KEYS, 4), "originality": 5}, "issues": [], "blockers": [],
                "claim_checks": [{"claim": f"Concrete current article observation number {number}",
                                  "reason": "The supplied source supports this scoped observation.",
                                  "source_ids": ["S1" if number % 2 else "S2"], "verdict": "supported"} for number in range(5)],
                "blocker_checks": [{"issue_id": fix["id"], "status": "resolved", "location": "表2",
                                    "finding": "当前正文已删除旧断言并统一指标口径，表2的新公式计算正确。"}
                                   for fix in fixes if fix["kind"] == "blocker"]}

    def run_resume(self, *, mode="good", audit=None, env=None):
        stages, prompts, fixes = [], {}, []

        def request(prompt, api_key, *, stage, **kwargs):
            nonlocal fixes
            stages.append(stage)
            prompts.setdefault(stage, []).append(prompt)
            if "draft" in stage:
                fixes = json.loads(prompt.split("完整修订任务：", 1)[1])["required_fixes"]
                return {**self.article, "revision_response": [{"issue_id": fix["id"], "change": "重建计算", "location": "全文",
                                                              "verification": "当前公式已代回核验"} for fix in fixes]}
            if stage in ("zh-review", "zh-review-format-repair"):
                review = self.good_review(fixes)
                if mode == "low_score":
                    review["scores"]["tradeoffs"] = 3
                elif mode == "unresolved":
                    review["blocker_checks"][0]["status"] = "unresolved"
                elif mode == "missing_checks":
                    review.pop("blocker_checks")
                elif mode == "unsupported":
                    review["claim_checks"][0]["verdict"] = "unsupported"
                return review
            raise AssertionError(f"Unexpected stage {stage}")

        with tempfile.TemporaryDirectory() as directory:
            audit_path = Path(directory) / "resumed.json"
            with patch.object(ip, "request_json", side_effect=request), \
                 patch.object(ip, "validate_insight", return_value={"passed": mode != "bad_structure", "errors": ["structure rejected"] if mode == "bad_structure" else [], "metrics": {}}), \
                 patch.dict(os.environ, {"INSIGHT_RESUME_MAX_ATTEMPTS": "3", **(env or {})}), \
                 contextlib.redirect_stdout(io.StringIO()):
                if mode == "good":
                    article = ip.produce_article(self.topic, self.sources, "test", audit_path=audit_path,
                                                 resume_audit=self.audit if audit is None else audit)
                else:
                    with self.assertRaisesRegex(RuntimeError, "did not pass quality gates"):
                        ip.produce_article(self.topic, self.sources, "test", audit_path=audit_path,
                                           resume_audit=self.audit if audit is None else audit)
                    article = None
            saved = json.loads(audit_path.read_text())
        return article, saved, stages, prompts

    def test_resume_preserves_authored_history_and_skips_brief_but_reviews_new_draft(self):
        original = copy.deepcopy(self.audit)
        article, saved, stages, prompts = self.run_resume()
        self.assertEqual(self.audit, original)
        self.assertEqual(saved["brief"], original["brief"])
        self.assertEqual(saved["attempts"][:3], original["attempts"])
        self.assertEqual(stages, ["zh-draft-3", "zh-review"])
        self.assertIn("第2轮旧稿", prompts["zh-draft-3"][0])
        self.assertEqual(article["quality"]["revisions"], 3)
        checks = saved["attempts"][-1]["review"]["blocker_checks"]
        self.assertEqual({check["issue_id"] for check in checks}, {"r0-blocker-1", "r2-blocker-1"})
        self.assertTrue(saved["passed"])
        self.assertNotIn("error", saved)
        self.assertEqual(saved["resume_history"][-1]["after_revision"], 2)
        self.assertTrue(saved["resume_history"][-1]["source_fingerprints_verified"])
        self.assertEqual(saved["attempts"][-1]["metadata_errors"], [])
        for source in self.sources:
            self.assertNotIn(source["text"], json.dumps(saved))

    def test_old_pass_never_skips_new_draft_and_independent_review(self):
        previously_passed = {**self.audit, "passed": True}
        _, saved, stages, _ = self.run_resume(audit=previously_passed)
        self.assertEqual(stages, ["zh-draft-3", "zh-review"])
        self.assertTrue(saved["resume_history"][-1]["previous_passed"])

    def test_source_mismatch_rejected_before_request_or_destination_write(self):
        mutations = [lambda s: s[0].update(id="S99"), lambda s: s[0].update(url="https://example.com/changed"),
                     lambda s: s[0].update(text="Changed source body", text_sha256=self.audit["sources"][0]["text_sha256"]),
                     lambda s: s.pop(), lambda s: s.append({**s[0], "id": "S3"}), lambda s: s.append(dict(s[0]))]
        for mutate in mutations:
            sources = copy.deepcopy(self.sources)
            mutate(sources)
            with self.subTest(sources=sources), tempfile.TemporaryDirectory() as directory:
                destination = Path(directory) / "audit.json"
                destination.write_text("existing audit must survive")
                with patch.object(ip, "request_json") as request, self.assertRaises(ValueError):
                    ip.produce_article(self.topic, sources, "test", audit_path=destination, resume_audit=self.audit)
                request.assert_not_called()
                self.assertEqual(destination.read_text(), "existing audit must survive")

    def test_incomplete_or_other_topic_resume_rejected(self):
        mutations = [lambda a: a.update(row=695), lambda a: a.update(language="en"), lambda a: a.update(brief={}),
                     lambda a: a.update(attempts=[]), lambda a: a["attempts"][-1].pop("article"),
                     lambda a: a["attempts"][-1].update(revision=0), lambda a: a["sources"][0].pop("text_sha256")]
        for mutate in mutations:
            audit = copy.deepcopy(self.audit)
            mutate(audit)
            with self.subTest(audit=audit), tempfile.TemporaryDirectory() as directory:
                destination = Path(directory) / "audit.json"
                with patch.object(ip, "request_json") as request, self.assertRaises(ValueError):
                    ip.produce_article(self.topic, self.sources, "test", audit_path=destination, resume_audit=audit)
                request.assert_not_called()
                self.assertFalse(destination.exists())
        with self.assertRaisesRegex(ValueError, "Chinese"):
            ip._resume_article_audit({**self.audit, "language": "en"}, self.topic, self.sources, "en")

    def test_resume_is_capped_at_three_new_attempts_independent_of_normal_budget(self):
        _, saved, stages, _ = self.run_resume(mode="low_score", env={"INSIGHT_MAX_REVISIONS": "99"})
        self.assertEqual([stage for stage in stages if "draft" in stage], ["zh-draft-3", "zh-draft-4", "zh-draft-5"])
        self.assertEqual([attempt["revision"] for attempt in saved["attempts"]], list(range(6)))
        self.assertFalse(saved["passed"])
        self.assertIn("tradeoffs: 3/5", " ".join(saved["attempts"][-1]["errors"]))

    def test_resume_budget_may_be_lower_but_never_exceed_three(self):
        _, saved, stages, _ = self.run_resume(mode="low_score", env={"INSIGHT_RESUME_MAX_ATTEMPTS": "1"})
        self.assertEqual([stage for stage in stages if "draft" in stage], ["zh-draft-3"])
        self.assertEqual(len(saved["attempts"]), 4)
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"INSIGHT_RESUME_MAX_ATTEMPTS": "4"}), \
             patch.object(ip, "request_json") as request, self.assertRaisesRegex(ValueError, "between 1 and 3"):
            ip.produce_article(self.topic, self.sources, "test", audit_path=Path(directory) / "audit.json", resume_audit=self.audit)
        request.assert_not_called()

    def test_resume_cannot_erase_historical_blockers_or_current_fact_failures(self):
        for mode in ("unresolved", "missing_checks", "unsupported"):
            with self.subTest(mode=mode):
                _, saved, stages, _ = self.run_resume(mode=mode, env={"INSIGHT_RESUME_MAX_ATTEMPTS": "1"})
                self.assertFalse(saved["passed"])
                self.assertTrue(saved["attempts"][-1]["review"]["blockers"])
                self.assertEqual(saved["attempts"][-1]["review_state"], "completed")
                if mode == "missing_checks":
                    self.assertEqual(stages[-1], "zh-review-format-repair")

    def test_resume_still_rejects_invalid_structure(self):
        _, saved, stages, _ = self.run_resume(mode="bad_structure", env={"INSIGHT_RESUME_MAX_ATTEMPTS": "1"})
        self.assertFalse(saved["passed"])
        self.assertEqual(saved["attempts"][-1]["errors"], ["structure rejected"])
        self.assertNotIn("zh-review", stages)


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
