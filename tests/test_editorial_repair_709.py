"""Protect the exact independently reviewed 709 translations and their decisions."""
import hashlib
import json
import re
import sys
import unittest
from fractions import Fraction as F
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from insight_quality import _parse, validate_translation_publication

SLUG = '00709-seo-ai-geo-7961d3a6'
RECEIPT = 'docs/editorial-repairs/00709-2026-10-01.json'


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def load_article(language):
    blog = ROOT / ('' if language == 'zh' else language) / 'blog'
    posts = json.loads((blog / 'posts.json').read_text())
    matches = [post for post in posts if post['slug'] == SLUG]
    assert len(matches) == 1 and str(matches[0]['row']) == '709'
    html = (blog / 'articles' / SLUG / 'index.html').read_text()
    body = html.split('<div class="content">', 1)[1].split('<section class="source-list">', 1)[0]
    return {**matches[0], 'body_html': body}, html


def signed_numbers(text):
    # These cases use Arabic digits in every locale. Chinese negative wording
    # and the typographic minus are equivalent; their sign must not disappear.
    return re.findall(r'-?\d+(?:\.\d+)?', text.replace('负', '-').replace('−', '-'))


def oracle(values):
    """Independent procedural reading, using eligible sets and cost division."""
    v = {key: F(value) for key, value in values.items()}
    if any(v[key] != 1 for key in ('records_ready', 'stable', 'comparable')):
        return 'INPUT', 'R1'
    if v['errors'] > v['sample'] * v['limit']:
        return ('CORRECT_A', 'R2a') if v['capacity'] >= v['a_cost'] else ('ERROR_CAPACITY', 'R2b')
    eligible = {name for name in ('a', 'b')
                if v['capacity'] >= v[name + '_cost'] and v[name + '_gain'] > 0}
    if not eligible:
        return 'NO_GAIN', 'R3'
    if v['capacity'] >= v['a_cost'] + v['b_cost'] - v['shared']:
        return 'JOINT_REVIEW', 'R4'
    if eligible == {'a'}:
        return 'A', 'R5a'
    if eligible == {'b'}:
        return 'B', 'R5b'
    a_unit, b_unit = v['a_cost'] / v['a_gain'], v['b_cost'] / v['b_gain']
    if a_unit == b_unit:
        return 'TIE_REVIEW', 'R6'
    return ('A', 'R6a') if a_unit < b_unit else ('B', 'R6b')


class Recovered709TranslationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pages = {lang: load_article(lang) for lang in ('zh', 'en', 'ar')}
        cls.receipt = json.loads((ROOT / RECEIPT).read_text())

    def test_manual_provenance_binds_actual_reviewed_bodies_without_reusing_scores(self):
        review = self.receipt['independent_review']
        self.assertEqual(review['status'], 'passed')
        self.assertRegex(review['evidence_sha256'], r'^[a-f0-9]{64}$')
        self.assertEqual(review['paid_provider_requests'], 0)
        self.assertEqual(self.receipt['corrected_languages'], ['en', 'ar'])
        self.assertEqual(digest(self.pages['zh'][0]['body_html']),
                         self.receipt['source_chinese']['body_sha256'])
        for lang in ('en', 'ar'):
            item, _ = self.pages[lang]
            quality = item['quality']
            with self.subTest(lang=lang):
                self.assertFalse(quality['automated_semantic_review_reused'])
                self.assertEqual(quality['paid_provider_requests_for_correction'], 0)
                self.assertNotIn('scores', quality)
                self.assertNotIn('publication_fallback', quality)
                self.assertEqual(quality['repair_record'], RECEIPT)
                self.assertIn('independent agent review', quality['review_type'])
                for recorded in (quality['body_sha256'], review['reviewed_bodies'][lang],
                                 self.receipt['articles'][lang]['body_sha256']):
                    self.assertEqual(digest(item['body_html']), recorded)

    def test_post_listing_and_page_metadata_describe_the_same_correction(self):
        for lang in ('en', 'ar'):
            item, html = self.pages[lang]
            schema = json.loads(re.search(
                r'<script id="schema-article" type="application/ld\+json">(.*?)</script>',
                html, re.S)[1])
            with self.subTest(lang=lang):
                self.assertEqual(item['title'], unescape(re.search(r'<h1>(.*?)</h1>', html, re.S)[1]))
                self.assertEqual(item['excerpt'], unescape(re.search(r'<p class="lead">(.*?)</p>', html, re.S)[1]))
                self.assertEqual(item['title'], schema['headline'])
                self.assertEqual(item['excerpt'], schema['description'])
                self.assertEqual(item['tags'], schema['keywords'])
                visible_tags = [unescape(text) for text in re.findall(r"<span class='tag'>(.*?)</span>", html)]
                self.assertEqual(visible_tags, item['tags'].split(', ')[:len(visible_tags)])
                self.assertNotRegex(item['title'] + item['excerpt'] + item['tags'], r'[\u3400-\u9fff]')
                self.assertEqual(schema['datePublished'], item['date'])
                self.assertEqual(item['date'], '2026-10-01')

    def test_current_publication_gate_structure_and_citations(self):
        source, _ = self.pages['zh']
        source_tags = re.findall(r'<[^>]+>', source['body_html'])
        for lang in ('en', 'ar'):
            item, _ = self.pages[lang]
            with self.subTest(lang=lang):
                validation = validate_translation_publication(item, item['sources'], lang, source)
                self.assertTrue(validation['passed'], validation['errors'])
                self.assertEqual(item['sources'], source['sources'])
                self.assertEqual(re.findall(r'<[^>]+>', item['body_html']), source_tags)
                self.assertEqual(re.findall(r'\[S\d+\]', item['body_html']),
                                 re.findall(r'\[S\d+\]', source['body_html']))
                self.assertNotRegex(item['body_html'], r'[\u3400-\u9fff]')
                self.assertEqual(validation['metrics']['h2_count'], 8)
                self.assertEqual(validation['metrics']['table_count'], 2)

    def test_all_32_localized_cases_preserve_signed_inputs_and_first_matching_rules(self):
        cases = self.receipt['decision_cases']['cases']
        defaults = self.receipt['decision_cases']['defaults']
        self.assertEqual(len(cases), 32)
        self.assertEqual(len({case['id'] for case in cases}), 32)
        self.assertTrue({'error76', 'error39', 'joint_only_a', 'joint_only_b', 'joint_neither',
                         'expected_tie', 'cost_joint_below', 'cost_joint_equal', 'negative_a60',
                         'missing_records', 'unstable', 'incomparable'} <= {case['id'] for case in cases})
        source_rows = _parse(self.pages['zh'][0]['body_html']).root.descendants('table')[1].descendants('tr')[1:]
        for lang, (item, _) in self.pages.items():
            rows = _parse(item['body_html']).root.descendants('table')[1].descendants('tr')[1:]
            self.assertEqual(len(rows), 32)
            for case, row, source_row in zip(cases, rows, source_rows):
                cells, originals = row.descendants('td'), source_row.descendants('td')
                with self.subTest(lang=lang, case=case['id']):
                    displayed_values = {F(value) for value in signed_numbers(originals[0].text())}
                    for name, value in case['inputs'].items():
                        if name not in ('records_ready', 'stable', 'comparable'):
                            self.assertIn(F(value), displayed_values,
                                          f'{name} override is absent from the displayed row')
                    self.assertEqual(oracle(defaults | case['inputs']),
                                     (case['expected_choice'], case['first_rule']))
                    self.assertEqual(signed_numbers(cells[0].text()), signed_numbers(originals[0].text()))
                    self.assertEqual(re.findall(r'R\d+[ab]?', cells[1].text()), [case['first_rule']])

    def test_reviewed_semantic_blocks_cannot_silently_regress_to_old_mistranslations(self):
        # Numeric agreement alone missed “within limit” becoming “failed” and
        # “shared preparation” becoming “both tasks completed”. These hashes
        # bind the separately read wording, not a generic automatic semantic pass.
        required = {'error_priority_summary', 'measurement_precondition', 'strict_error_threshold',
                    'full_cost_ledger', 'shared_preparation_remaining_effort',
                    'thresholds_and_expected_counts', 'two_round_retest_handoff', 'ordered_rule_table'}
        for lang in ('en', 'ar'):
            parsed = _parse(self.pages[lang][0]['body_html'])
            blocks = self.receipt['articles'][lang]['semantic_blocks']
            self.assertEqual(set(blocks), required)
            for name, block in blocks.items():
                with self.subTest(lang=lang, block=name):
                    text = parsed.root.descendants(block['tag'])[block['index']].text()
                    self.assertEqual(digest(text), block['text_sha256'])


if __name__ == '__main__':
    unittest.main()
