import sys
from pathlib import Path
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import hymt_offline_translation as hymt
from insight_offline_translation import validate_block

SOURCE = '<strong>问题集：</strong>与云产品决策直接相关的目标问题，示意m=25个，覆盖区域可用性、SLA赔偿口径、计费单位、认证状态、版本与配额五类。'


class LabelRepairTests(unittest.TestCase):
    def test_failed_formatted_label_decode_keeps_sentence_math_and_format(self):
        for target, label, sentence in (
                ('en', 'Question set:', 'Target questions related to cloud product decisions; illustrative '),
                ('ar', 'مجموعة الأسئلة:', 'أسئلة تتعلق بقرارات المنتجات السحابية، مثال ')):
            calls = []
            class Engine:
                def translate(self, text, source, language):
                    calls.append(text)
                    if '__HYMTPH_0000__' in text:
                        return text.replace('__HYMTPH_0000__', '')
                    if text == '问题集：':
                        return label
                    return sentence + '__HYMTPH_0002__' + (' questions about availability, SLA, billing, certifications, versions and quotas.' if language == 'en' else ' سؤالاً عن التوفر والاتفاقيات والفواتير والشهادات والإصدارات والحصص.')
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                translator = hymt.HyMTOfflineTranslator(cache_dir=directory, quality_mode='publish', engine_factory=lambda *_: Engine())
                result = translator.translate(SOURCE, target, 'zh')
                self.assertEqual(len(calls), 3)
                self.assertIn('<strong>' + label + '</strong>', result)
                self.assertIn('m=25', result)
                self.assertIn('与云产品决策直接相关的目标问题，示意__HYMTPH_0002__个', calls[-1])
                validate_block(SOURCE, result, target, quality_mode='publish')
                replay = translator.translate(SOURCE, target, 'zh')
                self.assertEqual(replay, result)
                self.assertEqual(len(calls), 3)

    def test_repair_rejects_quantity_labels_and_unbalanced_or_unknown_tags(self):
        for text in ('<strong>错误率：</strong>从10%降至5%。', '<strong>预算100元：</strong>试验。',
                     '<strong>问题集：</em>完整句子。', '<a href="https://example.org">问题集：</a>完整句子。'):
            masked, resources, _ = hymt._mask(text, 'en')
            with self.subTest(text=text):
                self.assertIsNone(hymt.formatted_label_repair_parts(masked, resources))

    def test_second_decode_missing_formula_still_fails_and_is_not_cached(self):
        class Engine:
            def translate(self, text, source, target):
                if text == '问题集：':
                    return 'Question set:'
                return 'A complete translated sentence with its protected variable omitted.'
        with tempfile.TemporaryDirectory() as directory:
            translator = hymt.HyMTOfflineTranslator(cache_dir=directory, quality_mode='publish', engine_factory=lambda *_: Engine())
            with self.assertRaisesRegex(hymt.OfflineTranslationError, 'protected placeholder'):
                translator.translate(SOURCE, 'en', 'zh')
            self.assertEqual(list(Path(directory).rglob('*.json')), [])


if __name__ == '__main__':
    unittest.main()
