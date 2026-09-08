import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import generate_daily_blog as daily


class ResumeInputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.topic = SimpleNamespace(idx=694, title="Agriculture decision")
        self.path = self.root / daily.gb.slugify(self.topic.title, self.topic.idx) / "zh.json"
        self.path.parent.mkdir()
        self.audit = {"row": 694, "language": "zh", "passed": False,
                      "attempts": [{"revision": 2}], "sources": [{"id": "S1"}]}

    def save(self):
        self.path.write_text(json.dumps(self.audit), encoding="utf-8")

    def test_loads_only_selected_failed_topic(self):
        self.save()
        self.assertEqual(daily.load_resume_audit(self.root, self.topic), self.audit)

    def test_wrong_row_or_language_rejected(self):
        for field, value in [("row", 695), ("language", "ar")]:
            with self.subTest(field=field):
                previous = self.audit[field]
                self.audit[field] = value
                self.save()
                with self.assertRaisesRegex(ValueError, "match selected"):
                    daily.load_resume_audit(self.root, self.topic)
                self.audit[field] = previous

    def test_passed_or_empty_audit_rejected(self):
        for field, value in [("passed", True), ("attempts", []), ("sources", [])]:
            with self.subTest(field=field):
                previous = self.audit[field]
                self.audit[field] = value
                self.save()
                with self.assertRaisesRegex(ValueError, "failed audit"):
                    daily.load_resume_audit(self.root, self.topic)
                self.audit[field] = previous

    def test_missing_selected_article_does_not_resume_another_topic(self):
        with self.assertRaisesRegex(ValueError, "No resume audit"):
            daily.load_resume_audit(self.root, self.topic)


if __name__ == "__main__":
    unittest.main()
