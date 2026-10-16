"""An optional failed locale can show the exact reviewed source honestly."""
import copy
import json
import os
import unittest
from unittest import mock

import test_daily_resume_passed as fixtures

daily, ip = fixtures.daily, fixtures.ip


class TranslationFallbackTests(unittest.TestCase):
    setUp = fixtures.PassedChineseResumeTests.setUp
    good_review = fixtures.PassedChineseResumeTests.good_review

    def prepare(self):
        self.audit_dir = self.root / 'audit'
        ip.write_audit(self.audit_dir / 'zh.json', self.audit)
        self.env = {'INSIGHT_QUALITY_PROFILE': 'seo-practical', 'INSIGHT_TRANSLATION_FALLBACK': 'source'}

    def test_failed_arabic_keeps_complete_original_and_successful_english(self):
        self.prepare()
        english = {'title': 'Complete English', 'body_html': '<p>English evidence</p>'}
        def translate(*args, lang, **kwargs):
            if lang == 'en':
                return english
            raise ip.OfflineTranslationError('protected placeholder changed')
        with mock.patch.dict(os.environ, self.env), mock.patch.object(ip, 'produce_article', side_effect=translate):
            result = daily.localize_reviewed_article(self.topic, self.sources, 'unused', self.article, self.audit_dir)
        self.assertIs(result['en'], english)
        self.assertIn(self.article['body_html'], result['ar']['body_html'])
        self.assertIn('lang="zh-CN" dir="ltr"', result['ar']['body_html'])
        self.assertIn('الترجمة العربية غير متاحة', result['ar']['body_html'])
        self.assertEqual(result['ar']['quality']['translation_status'], 'source_original')
        audit = json.loads((self.audit_dir / 'ar.json').read_text())
        self.assertFalse(audit['passed'])
        self.assertEqual(audit['publication_fallback']['failure_type'], 'OfflineTranslationError')

    def test_programming_errors_are_not_translation_fallbacks(self):
        self.prepare()
        with mock.patch.dict(os.environ, self.env), mock.patch.object(ip, 'produce_article', side_effect=RuntimeError('unexpected code failure')):
            with self.assertRaisesRegex(RuntimeError, 'unexpected code failure'):
                daily.localize_reviewed_article(self.topic, self.sources, 'unused', self.article, self.audit_dir)

    def test_changed_original_cannot_borrow_a_saved_review(self):
        self.prepare()
        changed = {**self.article, 'title': 'Unreviewed replacement'}
        with self.assertRaisesRegex(ValueError, 'exact reviewed'):
            ip.publish_source_original(self.topic, self.sources, changed, 'ar', self.audit_dir, ip.OfflineTranslationError('failed'))

    def test_failed_chinese_review_cannot_be_used_as_source(self):
        self.prepare()
        invalid = copy.deepcopy(self.audit)
        invalid['passed'] = False
        ip.write_audit(self.audit_dir / 'zh.json', invalid)
        with self.assertRaises(ValueError):
            ip.publish_source_original(self.topic, self.sources, self.article, 'ar', self.audit_dir, ip.OfflineTranslationError('failed'))


if __name__ == '__main__':
    unittest.main()
