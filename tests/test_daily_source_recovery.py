"""Source feedback recovery is bounded and never masks provider failures."""
import json
import os
import threading
import unittest
from unittest import mock

import test_daily_cross_language_resume as fixtures

daily, ip = fixtures.daily, fixtures.ip


class SourceRecoveryTests(unittest.TestCase):
    setUp = fixtures.CrossLanguageResumeTests.setUp
    good_review = fixtures.CrossLanguageResumeTests.good_review
    translation = fixtures.CrossLanguageResumeTests.translation

    def stage(self, *, blocker=True):
        folder = self.root / ip.gb.slugify(self.topic.title, self.topic.idx)
        folder.mkdir()
        (folder / 'zh.json').write_text(json.dumps(self.audit))
        translation = self.translation('ar')
        if not blocker:
            translation['attempts'][0]['review']['blockers'] = []
        (folder / 'ar.json').write_text(json.dumps(translation))
        return folder

    def test_source_correction_retranslates_both_languages_and_archives_originals(self):
        folder = self.stage()
        original_audit = (folder / 'zh.json').read_bytes()
        corrected = {**self.article, 'excerpt': 'Corrected source'}

        def correct(*args, **kwargs):
            self.assertFalse((folder / 'ar.json').exists())
            self.assertTrue(ip.has_pending_cross_language_feedback(kwargs['resume_audit']))
            return corrected

        with mock.patch.object(daily, 'localize_reviewed_article', side_effect=[
                ip.InsightQualityError('source threshold conflict'), {'en': {}, 'ar': {}}]) as localize, \
                mock.patch.object(ip, 'produce_article', side_effect=correct) as produce:
            result = daily.localize_with_source_recovery(self.topic, self.sources, 'test', self.article, folder)
        self.assertIs(result['zh'], corrected)
        self.assertIs(localize.call_args_list[1].args[3], corrected)
        self.assertEqual(produce.call_count, 1)
        self.assertEqual((folder / 'localization-history/round-0/zh.json').read_bytes(), original_audit)
        self.assertTrue((folder / 'localization-history/round-0/ar.json').exists())

    def test_second_quality_failure_stops_after_one_source_repair(self):
        folder = self.stage()
        with mock.patch.object(daily, 'localize_reviewed_article', side_effect=ip.InsightQualityError('rejected')) as localize, \
                mock.patch.object(ip, 'produce_article', return_value=self.article) as produce:
            with self.assertRaises(ip.InsightQualityError):
                daily.localize_with_source_recovery(self.topic, self.sources, 'test', self.article, folder)
        self.assertEqual(localize.call_count, 2)
        self.assertEqual(produce.call_count, 1)

    def test_numeric_only_or_provider_failure_never_rewrites_source(self):
        folder = self.stage(blocker=False)
        for error in (ip.InsightQualityError('numeric mismatch'), RuntimeError('provider failure'), ValueError('invalid response')):
            with self.subTest(error=error), \
                    mock.patch.object(daily, 'localize_reviewed_article', side_effect=error), \
                    mock.patch.object(ip, 'produce_article') as produce:
                with self.assertRaises(type(error)):
                    daily.localize_with_source_recovery(self.topic, self.sources, 'test', self.article, folder)
                produce.assert_not_called()
        self.assertFalse((folder / 'localization-history').exists())

    def test_failed_source_revision_keeps_resumable_history_without_stale_sibling(self):
        folder = self.stage()
        with mock.patch.object(daily, 'localize_reviewed_article', side_effect=ip.InsightQualityError('rejected')), \
                mock.patch.object(ip, 'produce_article', side_effect=ip.InsightQualityError('source still rejected')):
            with self.assertRaisesRegex(ip.InsightQualityError, 'source still rejected'):
                daily.localize_with_source_recovery(self.topic, self.sources, 'test', self.article, folder)
        self.assertFalse((folder / 'ar.json').exists())
        self.assertTrue((folder / 'localization-history/round-0/ar.json').is_file())

    def test_provider_failure_in_sibling_is_not_hidden_by_content_rejection(self):
        both_started = threading.Barrier(2)
        def produce(*args, lang, **kwargs):
            both_started.wait(timeout=2)
            if lang == 'en':
                raise ip.InsightQualityError('content rejected')
            raise RuntimeError('provider interrupted')
        with mock.patch.object(ip, 'produce_article', side_effect=produce):
            with self.assertRaisesRegex(RuntimeError, 'provider interrupted'):
                daily.localize_reviewed_article(self.topic, self.sources, 'test', self.article, self.root)

    def test_disabled_or_invalid_recovery_budget(self):
        folder = self.stage()
        with mock.patch.dict(os.environ, {'INSIGHT_CROSS_LANGUAGE_RECOVERY_ROUNDS': '0'}), \
                mock.patch.object(daily, 'localize_reviewed_article', side_effect=ip.InsightQualityError('stop')), \
                mock.patch.object(ip, 'produce_article') as produce:
            with self.assertRaises(ip.InsightQualityError):
                daily.localize_with_source_recovery(self.topic, self.sources, 'test', self.article, folder)
            produce.assert_not_called()
        with mock.patch.dict(os.environ, {'INSIGHT_CROSS_LANGUAGE_RECOVERY_ROUNDS': '2'}):
            with self.assertRaisesRegex(ValueError, 'must be 0 or 1'):
                daily.localize_with_source_recovery(self.topic, self.sources, 'test', self.article, folder)


if __name__ == '__main__':
    unittest.main()
