"""Bind the manually reviewed 707 pages to their arithmetic and review receipt."""
import hashlib
import json
import re
import sys
import unittest
from fractions import Fraction as F
from pathlib import Path
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from insight_quality import _parse, validate_insight, validate_translation_publication

SLUG = '00707-geo-0-1-ai-6a821aba'


def article(language):
    blog = ROOT / ('' if language == 'zh' else language) / 'blog'
    posts = json.loads((blog / 'posts.json').read_text())
    matches = [post for post in posts if post['slug'] == SLUG]
    assert len(matches) == 1
    page = (blog / 'articles' / SLUG / 'index.html').read_text()
    body = page.split('<div class="content">', 1)[1].split('<section class="source-list">', 1)[0]
    return {**matches[0], 'body_html': body}


def normalized(text):
    text = unicodedata.normalize('NFKC', text).translate(str.maketrans({'−': '-', '٫': '.', '٬': ',', '،': ',', '؛': ';'}))
    return ''.join(str(unicodedata.digit(c)) if c.isdecimal() else c for c in text)


def math_signature(text):
    return re.findall(r'\d+(?:\.\d+)?|[=<>≤≥≈+*/×÷−→]', normalized(text))


class Recovered707Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.articles = {lang: article(lang) for lang in ('zh', 'en', 'ar')}
        cls.receipt = json.loads((ROOT / 'docs/editorial-repairs/00707-2026-09-29.json').read_text())

    def test_actual_pages_bind_honest_manual_provenance(self):
        zh = self.articles['zh']
        self.assertTrue(validate_insight(zh, zh['sources'])['passed'])
        self.assertEqual(self.receipt['original_generated_commit'], 'c4f7a5c4a8300d8ac9221cca4e7947854ceac5a5')
        self.assertEqual(self.receipt['original_review']['scores'],
                         dict(thesis=4, evidence=4, mechanism=5, tradeoffs=4, actionability=4, originality=4))
        for lang, item in self.articles.items():
            with self.subTest(lang=lang):
                quality = item['quality']
                self.assertFalse(quality['automated_semantic_review_reused'])
                self.assertEqual(quality['paid_provider_requests_for_correction'], 0)
                self.assertNotIn('scores', quality)
                self.assertNotIn('publication_fallback', quality)
                digest = hashlib.sha256(item['body_html'].encode()).hexdigest()
                self.assertEqual(digest, quality['body_sha256'])
                self.assertEqual(digest, self.receipt['articles'][lang]['body_sha256'])
                self.assertEqual(item['sources'], zh['sources'])
                if lang != 'zh':
                    structural = validate_translation_publication(item, item['sources'], lang, zh)
                    self.assertTrue(structural['passed'], structural['errors'])
                    self.assertNotRegex(item['body_html'], r'[\u3400-\u9fff]')

    def test_all_24_sensitivity_results_recalculate_from_the_displayed_inputs(self):
        for lang, item in self.articles.items():
            table = _parse(item['body_html']).root.descendants('table')[1]
            rows = table.descendants('tr')[1:]
            self.assertEqual(len(rows), 6)
            for name, row in zip(('qA','pA','pB','hA','hB','S'), rows):
                cells = [normalized(x.text()) for x in row.descendants('td')]
                self.assertTrue(cells[0].startswith(name))
                for cell in cells[1:5]:
                    with self.subTest(lang=lang, variable=name, cell=cell):
                        match = re.match(r'\s*(\d+(?:\.\d+)?(?:/\d+)?)', cell)
                        self.assertIsNotNone(match)
                        value = F(match[1])
                        m, pa, qa, pb, ha, hb, shared = 20, F('.4'), F('.8'), F('.25'), F('1.6'), F(2), F(28)
                        if name in ('pB','hB'):
                            m, qa = 2, F('.6')
                        if name == 'qA': qa = value
                        if name == 'pA': pa = value
                        if name == 'pB': pb = value
                        if name == 'hA': ha = value
                        if name == 'hB': hb = value
                        if name == 'S': shared = value
                        na = min((80-shared)//ha, m, 34)
                        nb = min((80-shared)//hb, 34-m)
                        da, db = na*pa, nb*pb
                        ea, eb = (m-na*qa)/40, F(m,40)
                        ca, cb = shared+ha*na, shared+hb*nb
                        eligible_a = ca<=80 and da>=8 and ea<=F('.1')
                        eligible_b = cb<=80 and db>=8 and eb<=F('.1')
                        self.assertFalse(eligible_a and eligible_b)
                        expected = 'A' if eligible_a else 'B' if eligible_b else 'C'
                        actions = re.findall(r'(?<![A-Za-z_])([ABC])(?![A-Za-z_])', cell)
                        self.assertTrue(actions)
                        self.assertEqual(actions[-1], expected)
                        # Displayed simple final values are checked independently.
                        values = {'nA':na, 'nB':nb, 'H_A':ca, 'H_B':cb,
                                  'ΔQ':db if name in ('pB','hB') else da}
                        for key, expected_value in values.items():
                            for number in re.findall(re.escape(key)+r'\s*=\s*(\d+(?:\.\d+)?)(?![\d./])', cell):
                                self.assertEqual(F(number), expected_value)
                        for expression in re.findall(r'(?<![A-Za-z_])E(?:_[AB])?\s*=\s*([^;；，,、→\n]+)', cell):
                            number = re.match(r'\s*(\d+(?:\.\d+)?)', expression.rsplit('=',1)[-1])
                            self.assertIsNotNone(number)
                            self.assertEqual(F(number[1]), eb if name in ('pB','hB') else ea)

    def test_all_localized_sensitivity_cells_keep_values_and_comparators(self):
        signatures = {}
        for lang, item in self.articles.items():
            table = _parse(item['body_html']).root.descendants('table')[1]
            signatures[lang] = [[math_signature(n.text()) for n in row.descendants('td')][1:5]
                                for row in table.descendants('tr')[1:]]
        self.assertEqual(signatures['zh'], signatures['en'])
        self.assertEqual(signatures['zh'], signatures['ar'])

    def test_reviewed_semantic_blocks_cannot_be_replaced_by_the_old_mistranslation(self):
        # These hashes bind the independently read negative/tie/end-state rules,
        # not an automatic claim that arbitrary natural-language text is correct.
        required = {'qualified_count_not_rate','net_increment','exclude_unqualified',
                    'b_actual_error_count','stop_spending','a_b_failure_diagnosis',
                    'zero_conversion_before_division','endpoints_and_cost_ties'}
        for lang, item in self.articles.items():
            checks = self.receipt['articles'][lang]['semantic_blocks']
            self.assertTrue(required <= set(checks))
            parsed = _parse(item['body_html'])
            for label, check in checks.items():
                with self.subTest(lang=lang, claim=label):
                    text = parsed.root.descendants(check['tag'])[check['index']].text()
                    self.assertEqual(hashlib.sha256(text.encode()).hexdigest(), check['text_sha256'])

    def test_new_errors_and_zero_conversion_do_not_use_false_thresholds(self):
        # Two concrete counterexamples to the prior final text's logic.
        for lang, item in self.articles.items():
            with self.subTest(lang=lang):
                text = re.sub(r'\s+', '', normalized(_parse(item['body_html']).root.text()))
                for expression in ('3/40=0.075', '5/40=0.125', 'pA=0', 'pA>0', 'N≥80/pA'):
                    self.assertIn(expression, text)
        self.assertLessEqual(F(2+1,40), F('.1'))
        self.assertGreater(F(2+3,40), F('.1'))
        self.assertEqual(20*F(0), 0)  # exclude before evaluating80/pA
        self.assertEqual(F(80)/F('.4'), 200)
        self.assertEqual(F(80)/F('.8'), 100)
        self.assertEqual(F(26)*F(4,13), 8)
        self.assertLess(F(26)*F('.30'), 8)
        self.assertEqual(F(26)*F(2,65), F('.8'))


if __name__ == '__main__':
    unittest.main()
