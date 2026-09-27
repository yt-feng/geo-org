"""A blocked source must remain visible while following pending days are checked."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check_daily_research as preflight
from insight_research import ResearchError


class ResearchPreflightTests(unittest.TestCase):
    def test_failed_today_does_not_hide_tomorrow_or_publish_or_store_source_text(self):
        topics = [preflight.daily.gb.TopicRow(n, f"Topic {n}", {}, "GEO", "GEO") for n in (705, 706, 707)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            posts = root / "posts.json"
            posts.write_text('[{"row":"705"}]')
            before = posts.read_bytes()
            with mock.patch.object(preflight.daily.gb, "read_topics", return_value=topics), \
                    mock.patch.object(preflight.daily, "fetch_news_items", return_value=[]), \
                    mock.patch.object(preflight.daily, "fetch_tavily_market_items", return_value=[]), \
                    mock.patch.object(preflight.daily, "build_research_pack", side_effect=[
                        ResearchError("Missing industry evidence: legal_services"),
                        [{"id": "S1", "url": "https://www.oecd.org/source", "text": "PRIVATE_RAW_SOURCE_BODY"}]]), \
                    mock.patch.object(preflight.insight_pipeline, "produce_article", side_effect=AssertionError("No drafting")):
                report = preflight.check_pending_topics(root / "input.xlsx", root, 3)
            self.assertFalse(report["passed"])
            self.assertEqual([check["row"] for check in report["checks"]], [706, 707])
            self.assertFalse(report["checks"][0]["passed"])
            self.assertTrue(report["checks"][1]["passed"])
            self.assertIn("Missing industry evidence", report["checks"][0]["error"])
            self.assertNotIn("PRIVATE_RAW_SOURCE_BODY", json.dumps(report))
            self.assertEqual(posts.read_bytes(), before)
            self.assertEqual(list(root.iterdir()), [posts])

    def test_count_is_bounded_before_reading_backlog(self):
        with mock.patch.object(preflight.daily.gb, "read_topics") as read:
            for count in (0, 6):
                with self.assertRaisesRegex(ValueError, "between 1 and 5"):
                    preflight.check_pending_topics(Path("missing.xlsx"), Path("blog"), count)
            read.assert_not_called()


if __name__ == "__main__":
    unittest.main()
