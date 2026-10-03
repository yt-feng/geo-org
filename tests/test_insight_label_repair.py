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

    def test_repair_rejects_unbalanced_or_unknown_tags_and_full_predicates(self):
        for text in ('<strong>错误率降低了。</strong>下一句。',
                     '<strong>问题集：</em>完整句子。', '<a href="https://example.org">问题集：</a>完整句子。'):
            masked, resources, _ = hymt._mask(text, 'en')
            with self.subTest(text=text):
                self.assertIsNone(hymt.formatted_label_repair_parts(masked, resources))

    def test_all_short_source_label_classes_keep_the_complete_following_claim(self):
        for label in ('抽样单位：', '错误率：', '预算100元：', '严重事实错误（E）：',
                      '机制推断（本文推断，无直接证据）：', '合格正确引用问题数（Q）：'):
            source = '<strong>' + label + '</strong>只有r≤0.10且ΔQ>0时才扩大；否则停止。'
            masked, resources, _ = hymt._mask(source, 'en')
            with self.subTest(label=label):
                parts = hymt.formatted_label_repair_parts(masked, resources)
                self.assertIsNotNone(parts)
                self.assertEqual(''.join(prefix + text + suffix for text, prefix, suffix in parts), masked)
                self.assertIn('只有', parts[1][0])
                self.assertIn('否则停止', parts[1][0])
                self.assertIn('r≤0.10', resources.values())
                self.assertIn('ΔQ>0', resources.values())

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
