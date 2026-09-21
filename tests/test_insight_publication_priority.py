import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import insight_pipeline as pipeline
from insight_quality import validate_translation_publication


SOURCE = {"title": "GEO：持续发布", "excerpt": "预算为100元。", "tags": ["GEO"],
          "body_html": '<section><h2>发布</h2><p>预算100元，查看<a href="https://example.org">来源</a>。</p></section>'}
TRANSLATION = {"title": "GEO: Keep publishing", "excerpt": "Budget: 100 yuan.", "tags": ["GEO"],
    "body_html": '<section><h2>Publishing</h2><p>The budget is 100 yuan; see <a href="https://example.org">the source</a>.</p></section>',
    "translation_provenance": {"provider": "hymt-cpu", "paid_provider_requests": 0,
                               "quality_warnings": [{"block": "title", "warning": "Ordinary wording difference"}]}}


class PublicationPriorityTests(unittest.TestCase):
    def test_editorial_score_length_and_numeric_differences_are_notes(self):
        article = copy.deepcopy(TRANSLATION)
        article["body_html"] = article["body_html"].replace("100 yuan", "100.0 yuan")
        gate = validate_translation_publication(article, [], "en", SOURCE)
        self.assertTrue(gate["passed"])
        self.assertTrue(gate["warnings"])
        self.assertFalse(gate["metrics"]["semantic_review_required"])

    def test_translation_does_not_make_any_paid_review_or_drafting_call(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(pipeline, "translate_article_offline", return_value=copy.deepcopy(TRANSLATION)), \
                patch.object(pipeline, "review_article", side_effect=AssertionError("No paid locale review")) as review, \
                patch.object(pipeline, "request_json", side_effect=AssertionError("No paid locale drafting")) as draft:
            path = Path(directory) / "en.json"
            result = pipeline.produce_article(pipeline.gb.TopicRow(2, "Example", {}, "Brand", "GEO"),
                [], "unused", lang="en", original=SOURCE, audit_path=path)
            audit = json.loads(path.read_text())
        self.assertTrue(audit["passed"])
        self.assertEqual(audit["attempts"][0]["review_state"], "not_required_offline_translation")
        self.assertTrue(result["quality"]["warnings"])
        self.assertNotIn("scores", result["quality"])
        review.assert_not_called(); draft.assert_not_called()

    def test_empty_body_and_changed_links_still_do_not_publish(self):
        for body in ("", '<section><h2>Publishing</h2><p></p></section>',
                     TRANSLATION["body_html"].replace("https://example.org", "https://example.com")):
            with self.subTest(body=body):
                self.assertFalse(validate_translation_publication({**TRANSLATION, "body_html": body}, [], "en", SOURCE)["passed"])

    def test_lost_substantial_paragraph_does_not_publish(self):
        source = {**SOURCE, "body_html": "<p>" + "这是完整的源段落。" * 50 + "</p>"}
        article = {**TRANSLATION, "body_html": "<p>Only a fragment.</p>"}
        self.assertFalse(validate_translation_publication(article, [], "en", source)["passed"])

    def test_normal_language_length_difference_does_not_block(self):
        source = {**SOURCE, "body_html": "<p>" + "这是完整的源段落。" * 25 + "</p>"}
        article = {**TRANSLATION, "body_html": "<p>" + "A complete translated paragraph. " * 4 + "</p>"}
        self.assertTrue(validate_translation_publication(article, [], "en", source)["passed"])


if __name__ == "__main__":
    unittest.main()
