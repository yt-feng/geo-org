import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import insight_pipeline as ip
import generate_daily_blog as daily


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
