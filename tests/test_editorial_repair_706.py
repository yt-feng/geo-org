"""Protect the recovered publication's independently recalculated examples."""
import hashlib
import json
import re
import sys
import unittest
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from insight_quality import _parse, validate_insight, validate_translation_publication

SLUG = '00706-ai-geo-ai-231b90c4'


def published_article(language):
    blog = ROOT / ('' if language == 'zh' else language) / 'blog'
    post = next(post for post in json.loads((blog / 'posts.json').read_text()) if post['slug'] == SLUG)
    page = (blog / 'articles' / SLUG / 'index.html').read_text()
    body = page.split('<div class="content">', 1)[1].split('<section class="source-list">', 1)[0]
    return {**post, 'body_html': body}


def numeric_text(value):
    return re.sub(r'\s+', '', value).translate(str.maketrans({'＝': '=', '＋': '+', '−': '-'}))


class RecoveredArticleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.articles = {lang: published_article(lang) for lang in ('zh', 'en', 'ar')}
        cls.receipt = json.loads((ROOT / 'docs/editorial-repairs/00706-2026-09-28.json').read_text())

    def test_actual_pages_preserve_localized_structure_and_honest_provenance(self):
        chinese = self.articles['zh']
        self.assertTrue(validate_insight(chinese, chinese['sources'])['passed'])
        for language, article in self.articles.items():
            with self.subTest(language=language):
                quality = article['quality']
                self.assertFalse(quality['automated_semantic_review_reused'])
                self.assertNotIn('scores', quality)
                self.assertNotIn('publication_fallback', quality)
                self.assertEqual(quality['paid_provider_requests_for_correction'], 0)
                digest = hashlib.sha256(article['body_html'].encode()).hexdigest()
                self.assertEqual(digest, self.receipt['articles'][language]['body_sha256'])
                self.assertEqual(digest, quality['body_sha256'])
                if language != 'zh':
                    result = validate_translation_publication(article, article['sources'], language, chinese)
                    self.assertTrue(result['passed'], result['errors'])
                    self.assertNotRegex(article['body_html'], r'[\u3400-\u9fff]')

    def test_published_sensitivity_table_recalculates_from_its_inputs(self):
        for language, article in self.articles.items():
            with self.subTest(language=language):
                table = next(n for n in _parse(article['body_html']).root.descendants('table')
                             if n.attrs.get('data-role') == 'economics')
                rows = table.descendants('tr')
                headers = [n.text() for n in rows[0].descendants('th')]
                xs = [Decimal(re.search(r'x\s*[＝=]\s*(\d+)', s).group(1)) for s in headers[3:6]]
                self.assertEqual(xs, [Decimal(0), Decimal(8), Decimal(20)])
                cells = [[n.text() for n in row.descendants('td')] for row in rows[1:]]
                a_hours, a_increment = map(Decimal, re.findall(r'\d+', cells[0][2]))
                b_hours, b_increment = map(Decimal, re.findall(r'\d+', cells[1][2]))
                self.assertEqual((a_hours, a_increment, b_hours, b_increment),
                                 (Decimal(30), Decimal(5), Decimal(20), Decimal(7)))
                for column, x in enumerate(xs, 3):
                    displayed_a = Decimal(re.findall(r'\d+(?:\.\d+)?', cells[0][column])[-1])
                    displayed_b = Decimal(re.findall(r'\d+(?:\.\d+)?', cells[1][column])[-1])
                    self.assertEqual(displayed_a, (a_hours / a_increment).quantize(Decimal('.01')))
                    self.assertEqual(displayed_b, ((b_hours + x) / b_increment).quantize(Decimal('.01'), rounding=ROUND_HALF_UP))
                    self.assertEqual(numeric_text(cells[2][column]), '2/25=0.08')
                    self.assertEqual(numeric_text(cells[3][column]), '8')
                    self.assertEqual(numeric_text(cells[4][column]), 'A=5，B=7' if language == 'zh' else 'A=5,B=7')
                    self.assertLess(displayed_b, displayed_a)
                    self.assertLessEqual(b_hours + x, 40)
                # Reproduce the historic false equality decision: the algebraic
                # intersection exists, but the constrained choice cannot use it.
                intersection = b_increment * a_hours / a_increment - b_hours
                self.assertEqual(intersection, 22)
                self.assertGreater(b_hours + intersection, 40)
                self.assertLessEqual(a_hours, 40)
                self.assertEqual(10 + (a_hours - 10) + (b_hours - 10), 40)

    def test_three_languages_preserve_every_numeric_sensitivity_cell(self):
        tables = {}
        for language, article in self.articles.items():
            table = next(n for n in _parse(article['body_html']).root.descendants('table')
                         if n.attrs.get('data-role') == 'economics')
            tables[language] = [[numeric_text(n.text()).replace('，', ',') for n in row.descendants('td')][3:6]
                                for row in table.descendants('tr')[1:]]
        self.assertEqual(tables['zh'], tables['en'])
        self.assertEqual(tables['zh'], tables['ar'])


if __name__ == '__main__':
    unittest.main()
