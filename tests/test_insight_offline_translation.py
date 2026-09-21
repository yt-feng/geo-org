import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import insight_offline_translation as offline
import insight_pipeline as ip
import hymt_offline_translation as hymt
from financial_quantity_integrity import quantity_issues
from deepseek_cost_policy import CostDeferredError

SOURCE = {"title": "Eco-GEO：标题", "excerpt": "预算为100元。",
          "body_html": '<section data-role="analysis"><h2>条件</h2><p>份额为<strong>5%</strong>，见<a href="https://example.org/a?x=1&amp;y=2" data-source-id="S1">[S1]</a>。</p><table><tr><th>方案</th><td>100元</td></tr></table></section>',
          "tags": ["GEO", "分析"]}
REPLACEMENTS = {"标题": "Title", "预算为": "The budget is ", "条件": "Conditions",
                "份额为": "The share is ", "，见": ", see ", "方案": "Option",
                "分析": "Analysis", "元": " yuan", "。": ".", "新": "New "}


class FakeTranslator:
    model_id = "test-pinned-model"

    def __init__(self, fail_at=None):
        self.calls = []
        self.fail_at = fail_at

    def translate(self, text, target, source):
        self.calls.append(text)
        if len(self.calls) == self.fail_at:
            raise offline.OfflineTranslationError("interrupted")
        for old, new in REPLACEMENTS.items():
            text = text.replace(old, new)
        return text


class OfflineArticleTests(unittest.TestCase):
    def test_arabic_currency_and_date_aliases_preserve_quantity_identity(self):
        for source, translated in (("预算为1000元。", "الميزانية 1000 يوان."),
                                   ("2026年9月21日", "21 سبتمبر 2026"),
                                   ("2026年9月", "سبتمبر 2026"),
                                   ("100港元", "100 دولار هونغ كونغ")):
            with self.subTest(source=source):
                self.assertEqual(quantity_issues(source, translated, "zh", "ar"), [])
        self.assertTrue(quantity_issues("1000元", "1000 دولار", "zh", "ar"))
        self.assertTrue(quantity_issues("2026年9月21日", "22 سبتمبر 2026", "zh", "ar"))

    def test_preserves_complete_inline_context_html_numbers_urls_and_terms(self):
        translator = FakeTranslator()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            result = offline.translate_article(SOURCE, "en", checkpoint_path=path, translator=translator)
            self.assertTrue(json.loads(path.read_text())["complete"])
        self.assertEqual(offline._TAG.findall(SOURCE["body_html"]), offline._TAG.findall(result["body_html"]))
        self.assertEqual(result["translation_provenance"]["paid_provider_requests"], 0)
        self.assertTrue(any('份额为<strong>5%</strong>，见<a ' in text for text in translator.calls))
        self.assertIn('data-source-id="S1"', result["body_html"])

    def test_interruption_resumes_only_missing_blocks(self):
        first = FakeTranslator(fail_at=4)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            with self.assertRaisesRegex(offline.OfflineTranslationError, "interrupted"):
                offline.translate_article(SOURCE, "en", checkpoint_path=path, translator=first)
            saved = json.loads(path.read_text())
            self.assertFalse(saved["complete"])
            self.assertEqual(len(saved["blocks"]), 3)
            second = FakeTranslator()
            result = offline.translate_article(SOURCE, "en", checkpoint_path=path, translator=second)
            self.assertEqual(result["translation_provenance"]["reused_blocks"], 3)
            self.assertTrue(set(first.calls[:3]).isdisjoint(second.calls))

    def test_changed_source_or_model_never_reuses_article_checkpoint(self):
        for change in ("source", "model"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "checkpoint.json"
                offline.translate_article(SOURCE, "en", checkpoint_path=path, translator=FakeTranslator())
                source, translator = copy.deepcopy(SOURCE), FakeTranslator()
                if change == "source":
                    source["title"] += "新"
                else:
                    translator.model_id = "another-pinned-model"
                result = offline.translate_article(source, "en", checkpoint_path=path, translator=translator)
                self.assertEqual(result["translation_provenance"]["reused_blocks"], 0)

    def test_tampered_checkpoint_block_is_retranslated(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            offline.translate_article(SOURCE, "en", checkpoint_path=path, translator=FakeTranslator())
            state = json.loads(path.read_text())
            state["blocks"]["excerpt"]["translation"] = "The budget is 900 yuan."
            # Even a recomputed output digest must pass source quantity checks.
            state["blocks"]["excerpt"]["translation_sha256"] = offline.digest(state["blocks"]["excerpt"]["translation"])
            path.write_text(json.dumps(state))
            translator = FakeTranslator()
            result = offline.translate_article(SOURCE, "en", checkpoint_path=path, translator=translator)
            self.assertEqual(translator.calls, [SOURCE["excerpt"]])
            self.assertEqual(result["excerpt"], "The budget is 100 yuan.")

    def test_rejects_changed_html_url_term_number_and_retained_chinese(self):
        pairs = [('<strong>5%</strong>', '<em>5%</em>'),
                 ('<a href="https://example.org/a">来源</a>', '<a href="https://example.org/b">Source</a>'),
                 ('GEO分析', 'SEO Analysis'), ('预算100元', 'Budget 900 yuan'), ('中文原文', '中文原文'),
                 ('来源[S1]', 'Source[S2]'), ('错误率≤5%', 'Error rate≥5%')]
        for source, result in pairs:
            with self.subTest(source=source), self.assertRaises(offline.OfflineTranslationError):
                offline.validate_block(source, result, "en")

    def test_protected_tokens_include_citations_and_geo_vocabulary(self):
        masked, protected, _ = hymt._mask('Eco-GEO与AI搜索：<a href="https://example.org">[S1]</a>', "ar")
        for token in ("Eco-GEO", "AI", "[S1]"):
            self.assertIn(token, protected.values())
            self.assertNotIn(token, masked)


class OfflinePipelineTests(unittest.TestCase):
    def run_pipeline(self, *, failed_review=False, translation_failure=False):
        raw = copy.deepcopy(SOURCE)
        raw.update({"title": "Eco-GEO: Title", "excerpt": "Budget 100 yuan", "tags": "GEO, Analysis",
                    "translation_provenance": {"paid_provider_requests": 0, "provider": "hymt-cpu"}})
        review = {"scores": dict.fromkeys(ip.SCORE_KEYS, 5), "issues": [],
                  "blockers": ["source issue requires inspection"] if failed_review else []}
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict(os.environ, {"INSIGHT_MAX_REVISIONS": "5", "INSIGHT_OFFLINE_CHECKPOINT_DIR": directory}), \
                patch.object(ip, "translate_article_offline", side_effect=offline.OfflineTranslationError("local failure") if translation_failure else None,
                             return_value=raw) as translate, \
                patch.object(ip, "validate_insight", return_value={"passed": True, "errors": [], "metrics": {}}), \
                patch.object(ip, "review_article", return_value=review) as reviewer, \
                patch.object(ip, "request_json", side_effect=AssertionError("paid drafting must never run")) as paid:
            path = Path(directory) / "en.json"
            invoke = lambda: ip.produce_article(ip.gb.TopicRow(2, "Example", {}, "Brand", "GEO"), [], "key",
                                               lang="en", original=SOURCE, audit_path=path)
            if failed_review or translation_failure:
                with self.assertRaises((ip.InsightQualityError, offline.OfflineTranslationError)):
                    invoke()
            else:
                invoke()
            paid.assert_not_called()
            self.assertEqual(translate.call_count, 1)
            self.assertEqual(reviewer.call_count, 0 if translation_failure else 1)
            return json.loads(path.read_text())

    def test_paid_model_only_reviews_an_offline_translation(self):
        audit = self.run_pipeline()
        self.assertTrue(audit["passed"])
        self.assertEqual(audit["attempts"][0]["draft_origin"], "offline_translation")

    def test_failed_review_does_not_cause_full_paid_retranslation_or_repeated_review(self):
        audit = self.run_pipeline(failed_review=True)
        self.assertFalse(audit["passed"])
        self.assertEqual(len(audit["attempts"]), 1)

    def test_offline_failure_stops_before_any_paid_review_or_fallback(self):
        self.assertFalse(self.run_pipeline(translation_failure=True)["passed"])


class PipelineCostBoundaryTests(unittest.TestCase):
    def test_peak_rejection_never_sends_request_or_retries(self):
        with patch.object(ip, "begin_request", side_effect=CostDeferredError("peak")) as admission, \
                patch.object(ip, "complete_request") as completion, patch.object(ip, "_completion_attempt") as request:
            with self.assertRaises(CostDeferredError):
                ip.request_json("prompt", "unused", stage="zh-draft")
            self.assertEqual(admission.call_count, 1)
            request.assert_not_called()
            completion.assert_not_called()

    def test_known_usage_is_recorded_before_json_parse_failure(self):
        with patch.object(ip, "begin_request", return_value="ticket"), patch.object(ip, "complete_request") as completion, \
                patch.object(ip.gb, "RETRIES", 1), patch.object(ip, "_completion_attempt", return_value=("malformed", {"total_tokens": 123})):
            with self.assertRaises(RuntimeError):
                ip.request_json("prompt", "unused", stage="zh-draft")
            completion.assert_called_once_with("ticket", usage={"total_tokens": 123})

    def test_transport_failure_retains_reservation_and_does_not_report_zero_usage(self):
        with patch.object(ip, "begin_request", return_value="ticket"), patch.object(ip, "complete_request") as completion, \
                patch.object(ip, "_completion_attempt", side_effect=RuntimeError("disconnected")):
            with self.assertRaises(RuntimeError):
                ip.request_json("prompt", "unused", stage="zh-draft")
            completion.assert_called_once_with("ticket", status="failed_unknown_usage")

    def test_review_thinking_remains_independent_of_drafting_setting(self):
        for environment in ({}, {"INSIGHT_THINKING": "disabled", "INSIGHT_REVIEW_THINKING": "enabled"}):
            with self.subTest(environment=environment), patch.dict(os.environ, environment, clear=True), \
                    patch.object(ip, "begin_request") as admission, patch.object(ip, "complete_request"), \
                    patch.object(ip, "_completion_attempt", return_value=("{}", {})):
                ip.request_json("prompt", "unused", stage="zh-draft")
                ip.request_json("prompt", "unused", stage="en-review")
                self.assertEqual([call.args[1]["thinking"]["type"] for call in admission.call_args_list], ["disabled", "enabled"])


if __name__ == "__main__":
    unittest.main()
