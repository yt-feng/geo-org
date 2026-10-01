"""RTL math presentation preserves audited source text and arithmetic order."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_site import build, isolate_arabic_inline_math


class ArabicMathDisplayTests(unittest.TestCase):
    def test_actual_709_arithmetic_and_variables_are_complete_ltr_isolates(self):
        path = ROOT / 'ar/blog/articles/00709-seo-ai-geo-7961d3a6/index.html'
        source_bytes = path.read_bytes()
        soup = BeautifulSoup(source_bytes, 'html.parser')
        original_text = soup.select_one('.content').get_text()
        original_links = [dict(link.attrs) for link in soup.select('.content a')]
        isolate_arabic_inline_math(soup)
        formulas = [node.get_text() for node in soup.select('.content bdi.eco-math[dir=ltr]')]
        for expression in ('12+20+8=40', '12+28+8=48', '40+48−12=76', '40+48−12',
                           '48−40=8', '48−48=0', '48−12=36', '75−40=35',
                           'ΔQ_A=16−10=6', 'u_A=40/ΔQ_A', 'T=6×48/40=7.2',
                           'm=25', 'r_max=0.10', 'E/25', 'records_ready=stable=comparable=1',
                           '48/60/75', '4/9', '−1'):
            self.assertIn(expression, formulas)
        self.assertEqual(soup.select_one('.content').get_text(), original_text)
        self.assertEqual([dict(link.attrs) for link in soup.select('.content a')], original_links)
        self.assertEqual(path.read_bytes(), source_bytes)
        once = str(soup)
        isolate_arabic_inline_math(soup)
        self.assertEqual(str(soup), once)

    def test_entities_mixed_cells_dates_links_and_existing_ltr_boundaries(self):
        soup = BeautifulSoup('''<html dir="rtl"><body><div class="content">
          <p>القيمة E/25&lt;0.10 وΔQ_B&gt;7.2، والتكلفة 40+48−12=76.</p>
          <p id="dates">2026-10-01 و2026/10/1، 2026-10، 40-47، A/B، SEO/GEO.</p>
          <p>زيادة A تساوي −1 وزيادة B تساوي -1 والتعديل +2.</p>
          <p>الباقي 48−12 ساعة، والنطاق 40-47 ساعة.</p>
          <p id="url">https://example.org/2026/10/1?x=5</p>
          <a href="https://example.org/?x=5" data-example="40+48−12=76">x=5</a>
          <p dir="ltr">40+48−12=76</p><code>40+48−12=76</code><pre>m=25</pre>
          <bdi dir="ltr">12+20+8=40</bdi><script>let x=5;</script>
          <table><tr><td>الباقي 48−40=8 ساعة</td></tr></table>
          </div><footer>40+48−12=76</footer></body></html>''', 'html.parser')
        before_text = soup.get_text()
        before_link = str(soup.a)
        isolate_arabic_inline_math(soup)
        self.assertEqual([node.get_text() for node in soup.select('bdi.eco-math')],
                         ['E/25<0.10', 'ΔQ_B>7.2', '40+48−12=76', '−1', '-1', '+2', '48−12', '48−40=8'])
        self.assertEqual(soup.get_text(), before_text)
        self.assertEqual(str(soup.a), before_link)
        self.assertFalse(soup.select('#dates bdi, #url bdi, footer bdi, bdi bdi, code bdi, pre bdi'))
        self.assertFalse(soup.td.has_attr('dir'))
        serialized = str(soup)
        self.assertIn('E/25&lt;0.10', serialized)
        self.assertIn('ΔQ_B&gt;7.2', serialized)

    def test_build_only_changes_arabic_article_display_and_is_repeatable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'source'
            output = Path(temporary) / 'site'
            template = '<html lang="{lang}" dir="{direction}"><head><title>{lang} Article</title></head><body><article><h1>Title</h1><div class="content"><p>40+48−12=76</p></div></article><footer>48−40=8</footer></body></html>'
            for language, prefix in (('zh-CN', ''), ('en', 'en'), ('ar', 'ar')):
                blog = root / prefix / 'blog'
                article = blog / 'articles/example/index.html'
                article.parent.mkdir(parents=True)
                article.write_text(template.format(lang=language, direction='rtl' if language=='ar' else 'ltr'))
                (blog / 'posts.json').write_text(json.dumps([{'slug': 'example', 'title': language + ' article', 'excerpt': 'Example', 'date': '2026-10-01'}]))
            source_hashes = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in root.rglob('*') if path.is_file()}
            build(root, output)
            first = {str(path.relative_to(output)): path.read_bytes() for path in output.rglob('*') if path.is_file()}
            for prefix in ('', 'en', 'ar'):
                soup = BeautifulSoup((output / prefix / 'blog/articles/example/index.html').read_text(), 'html.parser')
                self.assertEqual(len(soup.select('.content bdi.eco-math')), 1 if prefix == 'ar' else 0)
                self.assertFalse(soup.select('footer bdi'))
                self.assertEqual(soup.select_one('.content').get_text(), '40+48−12=76')
            build(root, output)
            self.assertEqual(first, {str(path.relative_to(output)): path.read_bytes() for path in output.rglob('*') if path.is_file()})
            for name, digest in source_hashes.items():
                self.assertEqual(hashlib.sha256((root / name).read_bytes()).hexdigest(), digest)


if __name__ == '__main__':
    unittest.main()
