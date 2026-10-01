"""Long translation blocks split outside opaque resources without losing text."""
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import hymt_offline_translation as hymt
from insight_offline_translation import _TAG, validate_block


class SafeLongBlockTests(unittest.TestCase):
    def assert_intact(self, source, parts, limit=1800, resources=()):
        self.assertEqual(''.join(parts), source)
        self.assertTrue(all(0 < len(part) <= limit for part in parts))
        self.assertEqual([tag for part in parts for tag in _TAG.findall(part)], _TAG.findall(source))
        boundaries, position = [], 0
        for part in parts[:-1]:
            position += len(part)
            boundaries.append(position)
        for resource in resources:
            start = source.index(resource)
            self.assertFalse(any(start < boundary < start + len(resource) for boundary in boundaries), resource)

    def test_actual_1806_character_title_attribute_is_never_split(self):
        resource = '<a href="https://example.org" title="Dr. Wang">'
        source = '解释背景。' + '内容' * 872 + resource + '来源</a>。结束。'
        self.assertEqual(len(source), 1806)
        try:
            parts = hymt.split_sentences(source)
        except hymt.OfflineTranslationError as error:
            self.assertIn('context limit', str(error))  # No safe bound is a valid stop, never an arbitrary cut.
        else:
            self.assert_intact(source, parts, resources=[resource])

    def test_resource_sentence_marks_and_quoted_angles_are_not_cut_points(self):
        resources = ['<a href="https://example.org/path" title="A > B. Dr. Wang">',
                     '<!-- a sentence。 remains a comment. -->',
                     '<code>价格7.2。公式 x=3.4+3.8。</code>',
                     '<pre>first line。\nnext line。</pre>',
                     '<span lang="zh-CN">王明。另一个名字。</span>',
                     'https://example.org/版本。v1.2?date=2026-10-01',
                     '`literal。 x=7.2`', '&CounterClockwiseContourIntegral;',
                     'T=6×48/40=7.2', '2026-10-01', '2026/10/1']
        for resource in resources:
            with self.subTest(resource=resource):
                source = '背景。' * 30 + resource + ' 外部正文。' * 12
                parts = hymt.split_sentences(source, limit=120)
                self.assert_intact(source, parts, limit=120, resources=[resource])

    def test_abbreviations_decimals_and_real_following_characters_are_not_slice_ends(self):
        source = '开头。' + '正文' * 870 + ' Dr. Wang uses v1.2, e.g. on 2026-10-01. Another sentence.'
        parts = hymt.split_sentences(source)
        self.assert_intact(source, parts, resources=['Dr. Wang', 'v1.2', 'e.g.', '2026-10-01'])
        self.assertFalse(any(part.rstrip().endswith(('Dr.', 'e.g.')) for part in parts[:-1]))
        # The period is at the old sliced window's end, but is followed by a
        # digit in the real input. It is not a sentence end.
        with self.assertRaises(hymt.OfflineTranslationError):
            hymt.split_sentences('正文' * 898 + '值T=7.20继续正文', limit=1800)

    def test_limit_is_exact_and_unsplittable_content_stays_rejected(self):
        source = 'a' * 1799 + '. Next sentence.'
        self.assert_intact(source, hymt.split_sentences(source))
        for source in ('内容' * 901, '<code>' + '正文。' * 650 + '</code>'):
            with self.subTest(prefix=source[:10]), self.assertRaises(hymt.OfflineTranslationError):
                hymt.split_sentences(source)

    def test_translate_uses_safe_fragments_and_reuses_source_bound_masked_cache(self):
        opening = '<a href="https://example.org/v1.2?date=2026-10-01" title="Dr. Wang > Dr. Lin">'
        source = ('正文内容。' * 190 + opening + '来源</a>。' + '更多正文。' * 230 +
                  '<code>代码原文。T=6×48/40=7.2</code>结束。')
        class Engine:
            inputs = []
            def translate(self, text, *_):
                self.inputs.append(text)
                return re.sub(r'[\u3400-\u9fff]', 'word ', text)
        engine = Engine()
        with tempfile.TemporaryDirectory() as directory:
            translator = hymt.HyMTOfflineTranslator(directory, engine_factory=lambda *_: engine, quality_mode='publish')
            result = translator.translate(source, 'en', 'zh')
            self.assertGreater(len(engine.inputs), 1)
            self.assertEqual(_TAG.findall(result), _TAG.findall(source))
            self.assertIn(opening, result)
            self.assertIn('<code>代码原文。T=6×48/40=7.2</code>', result)
            validate_block(source, result, 'en', quality_mode='publish')
            count = len(engine.inputs)
            self.assertEqual(translator.translate(source, 'en', 'zh'), result)
            self.assertEqual(len(engine.inputs), count)
            for path in Path(directory).rglob('*.json'):
                cached = json.loads(path.read_text())
                self.assertEqual(cached['model'], hymt.MODEL_ID)
                self.assertRegex(cached['mask_sha256'], r'^[a-f0-9]{64}$')


if __name__ == '__main__':
    unittest.main()
