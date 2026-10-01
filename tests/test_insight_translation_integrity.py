"""Actual translation failures, valid localized prose and bounded block repair."""
import copy
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import hymt_offline_translation as hymt
import insight_offline_translation as offline
from insight_quality import validate_translation_publication
from translation_integrity import integrity_errors, missing_expressions, notation_warnings

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/row709-translation-integrity.json').read_text())


class TranslationIntegrityTests(unittest.TestCase):
    def test_real_source_fallback_and_mixed_chinese_are_incomplete_not_completed(self):
        for block in FIXTURE['resource_blocks'] + [dict(FIXTURE['mixed_source_block'], language='en')]:
            with self.subTest(language=block['language']), self.assertRaisesRegex(hymt.OfflineTranslationError, 'Chinese source text'):
                offline.validate_block(block['source'], block['failed_translation'], block['language'], quality_mode='publish')

    def test_unrestored_placeholder_in_legacy_finished_block_is_not_publishable(self):
        source = '<p>核对原始资料。</p>'
        target = '<p>Check __HYMTPH_0000__ for the source material.</p>'
        with self.assertRaisesRegex(hymt.OfflineTranslationError, 'placeholder'):
            offline.validate_block(source, target, 'en', quality_mode='publish')
        article = {'title': 'An example', 'excerpt': 'A source check', 'tags': 'GEO', 'body_html': source}
        result = validate_translation_publication(dict(article, body_html=target), [], 'en', article)
        self.assertFalse(result['passed'])
        self.assertTrue(any('placeholder' in error for error in result['errors']))

    def test_complete_independently_reviewed_translations_pass_without_erasing_format_warnings(self):
        for language, article in FIXTURE['corrected_articles'].items():
            with self.subTest(language=language):
                result = validate_translation_publication(article, FIXTURE['sources'], language, FIXTURE['source_article'])
                self.assertTrue(result['passed'], result['errors'])
                self.assertTrue(any('numeric' in warning for warning in result['warnings']))

    def test_date_month_names_ranges_negative_words_and_arabic_units_are_not_math_failures(self):
        pairs = [('日期2026-10-01，容量40-47，增量负1。', 'On October 1, 2026, capacity 40 to 47; gain -1.', 'en'),
                 ('日期2026/10/1，工时8小时，两轮复测。', 'في 1 أكتوبر 2026، ثماني ساعات وجولتان لإعادة القياس.', 'ar'),
                 ('共同前置12小时=基线8小时+台账4小时。', 'Shared preparation of 12 hours equals baseline work of 8 hours plus recordkeeping of 4 hours.', 'en'),
                 ('A/B中选一个。', 'اختر A أو B.', 'ar')]
        for source, translated, language in pairs:
            with self.subTest(source=source):
                self.assertEqual(integrity_errors(source, translated, language), [])
        masked, _, _ = hymt._mask('日期2026-10-01，区间40-47。', 'en')
        self.assertIn('2026-10-01', masked)
        self.assertIn('40-47', masked)

    def test_changed_formula_notation_is_diagnostic_and_masked_values_cannot_change(self):
        for source, changed in [('T=6×48/40=7.2', 'T=6×40/48=7.2'), ('E/25≤0.10', 'E/25<0.10')]:
            self.assertTrue(notation_warnings(source, changed))
            masked, _, _ = hymt._mask(source, 'en')
            with self.assertRaisesRegex(hymt.OfflineTranslationError, 'protected placeholder'):
                hymt.validate_result(masked, changed, 'zh', 'en', quality_mode='publish')
        self.assertFalse(missing_expressions('T＝6×48÷40＝7.20', 'T = 6 * 48 / 40 = 7.2'))
        self.assertEqual(integrity_errors('A完整成本=12+20+8=40。', 'The full cost of A = 12 + 20 + 8 = 40.', 'en'), [])

    def test_natural_language_equivalent_notation_is_diagnostic_not_a_false_hard_failure(self):
        pairs = [('N=40，S≤48。', 'A fixed set of 40 questions; S must be ≤48.', 'en'),
                 ('E_A≤0.10，H≤80。', 'E_A المتوقعة≤0.10 وH الفعلية≤80.', 'ar'),
                 ('m≤20时只有20通过；m=20至32可行，m=33、34不通过。', 'Only m=20 passes when m≤20; m=20 through 32 is feasible, while 33 and 34 fail.', 'en'),
                 ('排除门槛e≥3/25。', 'The threshold e=3/25 requires calibration.', 'en'),
                 ('总工时>80时暂停。', 'Pause when total hours exceed 80.', 'en')]
        for source, translated, language in pairs:
            with self.subTest(language=language):
                self.assertEqual(integrity_errors(source, translated, language), [])
                self.assertTrue(notation_warnings(source, translated))

    def test_explicit_source_protected_name_is_preserved_but_not_a_blanket_chinese_exemption(self):
        source = '<p>专家<span lang="zh">王明</span>给出x=5。</p>'
        translated = '<p>Expert <span lang="zh">王明</span> gives x=5.</p>'
        self.assertEqual(offline.validate_block(source, translated, 'en', quality_mode='publish'), [])
        original = {'title': 'Example', 'excerpt': 'An example', 'tags': 'GEO', 'body_html': source}
        target = dict(original, body_html=translated)
        self.assertTrue(validate_translation_publication(target, [], 'en', original)['passed'])
        self.assertTrue(integrity_errors(source, translated.replace('王明', '王敏'), 'en'))
        self.assertTrue(integrity_errors(source, translated.replace(' gives ', '给出 '), 'en'))

    def test_formula_entities_are_protected_atomically_before_inference(self):
        source = '当ΔQ_B&gt;7.2且E/25≤0.10时选B。'
        class Engine:
            inputs = []
            def translate(self, text, *_):
                self.inputs.append(text)
                return text.replace('当', 'When ').replace('且', ' and ').replace('时选B。', ', choose B.')
        engine = Engine()
        with tempfile.TemporaryDirectory() as directory:
            translator = hymt.HyMTOfflineTranslator(directory, engine_factory=lambda *_: engine, quality_mode='publish')
            result = translator.translate(source, 'en', 'zh')
        self.assertEqual(len(engine.inputs), 1)
        self.assertNotIn('7.2', engine.inputs[0])
        self.assertNotIn('0.10', engine.inputs[0])
        self.assertEqual(integrity_errors(source, result, 'en'), [])

    def test_existing_resource_placeholder_is_never_nested_inside_a_formula(self):
        source = 'AI=5，<code>中文</code>≤8，T=6×48/40=7.2。'
        masked, resources, terms = hymt._mask(source, 'en')
        for original in resources.values():
            self.assertNotRegex(original, r'__HYMTPH_\d+__')
        self.assertEqual(len(hymt._PLACEHOLDERS.findall(masked)), len(resources) + len(terms))
        restored = hymt._restore_terms(masked, terms)
        for token, original in resources.items():
            restored = restored.replace(token, original)
        self.assertEqual(restored, source)

    def test_real_google_and_nist_bad_decodes_repair_by_complete_sentences(self):
        for block in FIXTURE['resource_blocks']:
            class Engine:
                inputs = []
                def translate(self, text, _source, target):
                    self.inputs.append(text)
                    if len(self.inputs) == 1:
                        return 'Broken placeholder output'
                    tokens = ' '.join(hymt._PLACEHOLDERS.findall(text))
                    prose = ('The complete source sentence retains its evidence boundaries. ' if target == 'en'
                             else 'تحتفظ الجملة الكاملة بحدود الأدلة الواردة في المصدر. ')
                    return prose * 6 + tokens
            engine = Engine()
            with self.subTest(name=block['name']), tempfile.TemporaryDirectory() as directory:
                translator = hymt.HyMTOfflineTranslator(directory, engine_factory=lambda *_: engine, quality_mode='publish')
                result = translator.translate(block['source'], block['language'], 'zh')
                self.assertEqual(integrity_errors(block['source'], result, block['language']), [])
                self.assertGreater(len(engine.inputs), 2)
                self.assertLessEqual(len(engine.inputs), 9)  # one failed block + at most eight repair units
                for part in engine.inputs[1:]:
                    self.assertLessEqual(part.count('。'), 1)
                self.assertEqual(offline._TAG.findall(block['source']), offline._TAG.findall(result))
                before = len(engine.inputs)
                self.assertEqual(translator.translate(block['source'], block['language'], 'zh'), result)
                self.assertEqual(len(engine.inputs), before)

    def test_sentence_repair_never_splits_decimals_abbreviations_links_or_formula_placeholders(self):
        text = 'Dr. Wang uses v1.2 and 7.2 e.g. today。Next __HYMTPH_0000__。'
        parts = hymt.sentence_repair_parts(text)
        self.assertEqual(parts, ['Dr. Wang uses v1.2 and 7.2 e.g. today。', 'Next __HYMTPH_0000__。'])
        self.assertIsNone(hymt.sentence_repair_parts('Dr. Wang uses 7.2. No safe Chinese boundary.'))
        masked, _, _ = hymt._mask('见<a href="https://example.org/v1.2">[S1]</a>。公式T=6×48/40=7.2。', 'en')
        parts = hymt.sentence_repair_parts(masked)
        self.assertEqual(''.join(parts), masked)
        self.assertEqual(sum(len(hymt._PLACEHOLDERS.findall(x)) for x in parts), len(hymt._PLACEHOLDERS.findall(masked)))

    def test_failed_sentence_repair_is_not_source_fallback_or_cached_completion(self):
        class Engine:
            calls = 0
            def translate(self, text, *_):
                self.calls += 1
                if self.calls != 2:
                    return 'Missing placeholders'
                return 'A complete translated sentence. ' + ' '.join(hymt._PLACEHOLDERS.findall(text))
        engine = Engine()
        with tempfile.TemporaryDirectory() as directory:
            translator = hymt.HyMTOfflineTranslator(directory, engine_factory=lambda *_: engine, quality_mode='publish')
            with self.assertRaises(hymt.OfflineTranslationError):
                translator.translate('第一句AI。第二句GEO。', 'en', 'zh')
            self.assertEqual(list(Path(directory).rglob('*.json')), [])
        self.assertEqual(engine.calls, 3)

    def test_legacy_bad_block_is_evicted_and_only_that_block_is_retranslated(self):
        original = {'title': 'Title', 'excerpt': 'An excerpt', 'tags': 'GEO', 'body_html': '<p>第一段。</p><p>第二段。</p>'}
        class Translator:
            model_id = 'fixture-model'
            def __init__(self, broken=False): self.calls, self.broken = [], broken
            def translate(self, text, *_args, **_kwargs):
                self.calls.append(text)
                return {'第一段。': 'First paragraph.', '第二段。': '第二段。' if self.broken else 'Second paragraph.'}.get(text, text)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'article.json'
            offline.translate_article(original, 'en', checkpoint_path=path, translator=Translator())
            legacy = json.loads(path.read_text())
            key = next(k for k,v in legacy['blocks'].items() if v['translation']=='Second paragraph.')
            legacy['blocks'][key].update(translation='第二段。', translation_sha256=offline.digest('第二段。'))
            path.write_text(json.dumps(legacy))
            bad = Translator(True)
            with self.assertRaises(hymt.OfflineTranslationError):
                offline.translate_article(original, 'en', checkpoint_path=path, translator=bad)
            pending = json.loads(path.read_text())
            self.assertFalse(pending['complete'])
            self.assertIn(key, pending['pending_blocks'])
            self.assertNotIn(key, pending['blocks'])
            self.assertEqual(bad.calls, ['第二段。'])
            repaired = Translator()
            result = offline.translate_article(original, 'en', checkpoint_path=path, translator=repaired)
            self.assertEqual(repaired.calls, ['第二段。'])
            self.assertEqual(result['translation_provenance']['translated_blocks'], 1)
            self.assertEqual(json.loads(path.read_text())['pending_blocks'], {})

    def test_fragment_cache_binds_mapping_not_just_same_placeholder_count(self):
        source = 'AI分析<code>中文</code>'
        old_identity = {'provider': hymt.PROVIDER, 'model': hymt.MODEL_ID, 'source_language':'zh', 'target_language':'en',
                        'source_sha256': hashlib.sha256(source.encode()).hexdigest()}
        old_key = hashlib.sha256(json.dumps(old_identity, sort_keys=True).encode()).hexdigest()
        class Engine:
            calls = 0
            def translate(self, text, *_):
                self.calls += 1
                return text.replace('分析', ' analysis ')
        engine = Engine()
        with tempfile.TemporaryDirectory() as directory:
            old_path=Path(directory)/old_key[:2]/(old_key+'.json')
            hymt.atomic_json(old_path,{**old_identity, 'translation':'__HYMTPH_0000__ analysis __HYMTPH_0001__'})
            translator=hymt.HyMTOfflineTranslator(directory,engine_factory=lambda *_:engine,quality_mode='publish')
            result=translator.translate(source,'en','zh')
            self.assertEqual(result,'AI analysis <code>中文</code>')
            self.assertEqual(engine.calls,1)
            new_records=[json.loads(p.read_text()) for p in Path(directory).rglob('*.json') if p!=old_path]
            self.assertEqual(len(new_records),1)
            self.assertRegex(new_records[0]['mask_sha256'],r'^[0-9a-f]{64}$')
            self.assertEqual(translator.translate(source,'en','zh'),result)
            self.assertEqual(engine.calls,1)


if __name__ == '__main__':
    unittest.main()
