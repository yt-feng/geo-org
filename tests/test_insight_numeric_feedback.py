"""Precise, bounded numeric repair feedback without relaxing fidelity gates."""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from insight_quality import _numeric_blocks, _numbers, _parse, validate_insight
from test_insight_quality import SOURCES, translated_article, valid_article


class NumericRepairFeedbackTests(unittest.TestCase):
    def compare(self, source, translated):
        return validate_insight(translated, SOURCES, lang="en", source_article=source)

    def test_zero_word_preserves_meaning_but_still_requires_explicit_numeral_repair(self):
        # Production failure: the model translated ΔQ=0 as "ΔQ is zero", then
        # repeated that wording through all retries. Another source-written 零
        # in the same paragraph means counting every English "zero" is unsound.
        source = valid_article()
        translated = translated_article(source)
        source["body_html"] += "<p>若E0=0且连续两期增量ΔQ=0，应停止。零增量不代表成功。</p>"
        translated["body_html"] += (
            "<p>If E0=0 and incremental ΔQ is zero for two consecutive periods, "
            "stop. Zero increment does not represent success.</p>"
        )
        before = deepcopy(translated)
        result = self.compare(source, translated)
        self.assertFalse(result["passed"])
        self.assertEqual(translated, before)
        changes = result["metrics"]["translation"]["numeric_changes"]["body_html"]
        self.assertEqual(changes["missing"], {"0": 1})
        self.assertEqual(changes["added"], {})
        self.assertEqual(changes["block_alignment"], "structural_position")
        self.assertEqual(changes["block_differences_total"], 1)
        difference = changes["block_differences"][0]
        self.assertIn("ΔQ=0", difference["source"]["text"])
        self.assertIn("ΔQ is zero", difference["translated"]["text"])
        self.assertEqual(difference["source"]["path"], difference["translated"]["path"])
        self.assertEqual(difference["source"]["block_index"], difference["translated"]["block_index"])
        self.assertEqual(difference["missing"], {"0": 1})

        translated["body_html"] = translated["body_html"].replace("ΔQ is zero", "ΔQ=0")
        self.assertTrue(self.compare(source, translated)["passed"])

    def test_context_keeps_inline_equations_together_and_does_not_duplicate_container_numbers(self):
        parser = _parse(
            "<section>Before 1<p>Value 2 and <strong>3</strong>.<br>After line break.</p>"
            "After 4<table><tbody><tr><td>Cell 5</td></tr></tbody></table></section>"
        )
        blocks = _numeric_blocks(parser)
        numbers = sum((Counter(block["numbers"]) for block in blocks), Counter())
        self.assertEqual(numbers, _numbers(parser.root.text()))
        self.assertEqual(numbers, Counter({str(value): 1 for value in range(1, 6)}))
        self.assertEqual([block["tag"] for block in blocks], ["section", "p", "section", "td"])
        self.assertEqual([block["block_index"] for block in blocks], [1, 2, 3, 4])
        self.assertEqual(blocks[2]["fragment_index"], 2)
        self.assertIn("Value 2 and 3.", blocks[1]["text"])

    def test_changed_table_value_reports_specific_cell_and_both_counters(self):
        source = valid_article()
        source["body_html"] = source["body_html"].replace("<td>试点</td>", "<td>试点 20</td>", 1)
        translated = translated_article(source)
        translated["body_html"] = translated["body_html"].replace(" 20</td>", " 25</td>", 1)
        result = self.compare(source, translated)
        self.assertFalse(result["passed"])
        changes = result["metrics"]["translation"]["numeric_changes"]["body_html"]
        self.assertEqual(changes["block_differences_total"], 1)
        difference = changes["block_differences"][0]
        self.assertEqual(difference["source"]["tag"], "td")
        self.assertIn("/table[1]/tbody[1]/tr[1]/td[1]", difference["source"]["path"])
        self.assertEqual(difference["missing"], {"20": 1})
        self.assertEqual(difference["added"], {"25": 1})

    def test_layout_changes_do_not_create_misleading_paragraph_pairs(self):
        source = valid_article()
        translated = translated_article(source)
        source["body_html"] += "<p>应保留 987 天。</p>"
        result = self.compare(source, translated)
        self.assertFalse(result["passed"])
        changes = result["metrics"]["translation"]["numeric_changes"]["body_html"]
        self.assertEqual(changes["block_alignment"], "unpaired_candidates")
        self.assertEqual(changes["block_differences_total"], 1)
        difference = changes["block_differences"][0]
        self.assertIsNone(difference["translated"])
        self.assertEqual(difference["candidate_tokens"], {"987": 1})
        self.assertNotIn("missing", difference)

    def test_many_long_differences_are_bounded_and_report_truncation(self):
        source = valid_article()
        translated = translated_article(source)
        for index in range(10):
            source["body_html"] += f"<p>{index + 101} " + "原文。" * 1000 + "</p>"
            translated["body_html"] += f"<p>{index + 201} " + "Translation. " * 1000 + "</p>"
        result = self.compare(source, translated)
        changes = result["metrics"]["translation"]["numeric_changes"]["body_html"]
        self.assertEqual(changes["block_differences_total"], 10)
        self.assertTrue(changes["block_differences_truncated"])
        self.assertEqual(len(changes["block_differences"]), 4)
        length = 0
        for difference in changes["block_differences"]:
            for side in ("source", "translated"):
                self.assertTrue(difference[side]["text_truncated"])
                length += len(difference[side]["text"])
        self.assertLessEqual(length, 9600)

    def test_title_and_excerpt_receive_field_context(self):
        source = valid_article()
        source["title"] += " 80"
        source["excerpt"] += " 30"
        translated = translated_article(source)
        translated["title"] = translated["title"].replace("80", "90")
        translated["excerpt"] = translated["excerpt"].replace("30", "60")
        result = self.compare(source, translated)
        self.assertFalse(result["passed"])
        for field, old, new in (("title", "80", "90"), ("excerpt", "30", "60")):
            changes = result["metrics"]["translation"]["numeric_changes"][field]
            difference = changes["block_differences"][0]
            self.assertEqual(difference["source"]["path"], field)
            self.assertEqual(difference["missing"], {old: 1})
            self.assertEqual(difference["added"], {new: 1})


if __name__ == "__main__":
    unittest.main()
