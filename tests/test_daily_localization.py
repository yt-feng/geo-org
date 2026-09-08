import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import generate_daily_blog as daily


class LocalizationTests(unittest.TestCase):
    def test_independent_reviews_run_together_and_return_complete_pair(self):
        both_started = threading.Barrier(2)
        original = {"title": "Chinese original"}

        def review(*args, lang, original, audit_path):
            both_started.wait(timeout=2)
            self.assertEqual(audit_path.name, lang + ".json")
            return {"title": lang, "original_title": original["title"]}

        with patch.object(daily.insight_pipeline, "produce_article", side_effect=review):
            results = daily.localize_reviewed_article(None, [], "test", original, Path("audit"))
        self.assertEqual(set(results), {"en", "ar"})
        self.assertEqual(results["ar"]["original_title"], original["title"])

    def test_one_rejected_translation_rejects_the_complete_pair(self):
        both_started = threading.Barrier(2)

        def review(*args, lang, **kwargs):
            both_started.wait(timeout=2)
            if lang == "ar":
                raise RuntimeError("Translation omitted evidence")
            return {"title": "Reviewed English"}

        with patch.object(daily.insight_pipeline, "produce_article", side_effect=review):
            with self.assertRaisesRegex(RuntimeError, "omitted evidence"):
                daily.localize_reviewed_article(None, [], "test", {}, Path("audit"))


if __name__ == "__main__":
    unittest.main()
