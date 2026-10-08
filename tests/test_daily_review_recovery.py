"""Recover finished generation when only the small-checkpoint seal failed."""
import copy
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import unittest
from unittest import mock
import zipfile

import test_daily_resume_passed as fixtures
from test_daily_auto_resume import API
import daily_resume_checkpoint as cp


class ReviewRecoveryTests(unittest.TestCase):
    good_review = fixtures.PassedChineseResumeTests.good_review

    def setUp(self):
        fixtures.PassedChineseResumeTests.setUp(self)
        self.now = datetime(2026, 10, 8, tzinfo=timezone.utc)
        self.run = {'id': 200, 'run_attempt': 1, 'updated_at': (self.now-timedelta(days=1)).isoformat(),
                    'created_at': (self.now-timedelta(days=1)).isoformat(), 'head_sha': 'a'*40,
                    'status': 'completed', 'conclusion': 'failure', 'event': 'workflow_dispatch',
                    'head_branch': 'main', 'path': cp.WORKFLOW, 'repository': {'full_name': 'owner/repo'}}
        self.context = {'schema': cp.SCHEMA, 'topic': cp.topic_identity(self.topic), 'preview': False,
                        'producer': {'repository': 'owner/repo', 'run_id': '200', 'run_attempt': '1',
                                     'head_sha': 'a'*40, 'ref': 'refs/heads/main', 'event': 'workflow_dispatch'},
                        'automatic_resumes': 0, 'selected_from': None, 'phase': 'generation'}
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(cp, 'DECISION', self.root/'decision.json').start()

    def files(self):
        return {'resume-context.json': copy.deepcopy(self.context),
                'insights/'+self.context['topic']['slug']+'/zh.json': copy.deepcopy(self.audit),
                'usage/deepseek.jsonl': {'request_count': 3}}

    def archive(self, files=None):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, value in (self.files() if files is None else files).items():
                archive.writestr(name, json.dumps(value).encode())
        return output.getvalue()

    def api(self, files=None, conclusion='success'):
        blob = self.archive(files)
        artifact = {'id': 2000, 'name': 'daily-insight-review-200', 'expired': False,
                    'size_in_bytes': len(blob), 'digest': 'sha256:'+cp.sha(blob),
                    'workflow_run': {key: self.run[key] for key in ('id', 'head_sha', 'head_branch')}}
        api = API([self.run], {200: (artifact, blob)})
        original = api.json
        def response(path):
            value = original(path)
            if '/jobs?' in path:
                value['jobs'][0]['steps'][0]['conclusion'] = conclusion
            return value
        api.json = response
        return api

    def select(self, api, topic=None):
        return cp.select(topic or self.topic, repo='owner/repo', current_run_id='300',
                         destination=self.root/'selection', api=api, now=self.now)

    def test_finished_generation_recovers_exact_review_without_model_calls(self):
        api = self.api()
        with mock.patch.object(fixtures.ip, 'request_json') as model:
            result = self.select(api)
        model.assert_not_called()
        self.assertEqual((result['action'], result['run_id'], result['automatic_resumes']), ('resume', 200, 1))
        self.assertEqual(result['recovered_review']['artifact_id'], 2000)
        self.assertEqual(result['downloads'], 1)
        audit = json.loads((Path(result['resume_dir'])/self.context['topic']['slug']/'zh.json').read_text())
        self.assertEqual(audit, self.audit)
        self.assertFalse((Path(result['resume_dir'])/'usage').exists())

    def test_existing_retry_budget_is_never_reset(self):
        self.context['automatic_resumes'] = cp.MAX_AUTO_RESUMES
        for conclusion in ('success', 'failure'):
            with self.subTest(conclusion=conclusion), self.assertRaisesRegex(RuntimeError, 'budget exhausted'):
                self.select(self.api(conclusion=conclusion))

    def test_foreign_topic_is_skipped_only_after_validating_its_saved_audit(self):
        other = fixtures.ip.gb.TopicRow(695, 'Next topic', {}, 'Brand', 'GEO')
        with mock.patch.object(fixtures.ip.gb, 'read_topics', return_value=[self.topic]):
            result = self.select(self.api(), other)
        self.assertEqual(result['action'], 'fresh_no_checkpoint')
        self.assertTrue(result['skipped'][0]['recovered_review'])
        with mock.patch.object(fixtures.ip.gb, 'read_topics', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'absent or changed'):
                self.select(self.api(), other)

    def test_tampered_saved_pass_cannot_be_recovered_or_ignored(self):
        files = self.files()
        files['insights/'+self.context['topic']['slug']+'/zh.json']['attempts'][-1]['article']['title'] += 'changed'
        with self.assertRaisesRegex(ValueError, 'SHA256'):
            self.select(self.api(files))

    def test_context_provenance_preview_and_attempt_are_checked(self):
        variants = [lambda c:c['producer'].update(head_sha='b'*40), lambda c:c.update(preview=True),
                    lambda c:c.update(phase='selection_failed'), lambda c:c.update(automatic_resumes=True)]
        for mutate in variants:
            files = self.files(); mutate(files['resume-context.json'])
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                cp.recover_review_checkpoint(self.archive(files), self.topic, 'owner/repo', self.run)
        with self.assertRaisesRegex(ValueError, 'original bounded attempt'):
            cp.recover_review_checkpoint(self.archive(), self.topic, 'owner/repo', {**self.run,'run_attempt':2})

    def test_unsafe_or_foreign_authored_paths_are_not_extracted(self):
        for path in ('../escape.json', '/absolute.json', 'insights/foreign/zh.json'):
            files = self.files(); files[path] = {}
            with self.subTest(path=path), self.assertRaises(ValueError):
                cp.recover_review_checkpoint(self.archive(files), self.topic, 'owner/repo', self.run)
        self.assertFalse((self.root.parent/'escape.json').exists())

    def test_failed_generation_retains_complete_failed_findings(self):
        self.audit['passed'] = False
        self.audit['attempts'][-1]['review']['blockers'] = ['A factual finding remains unresolved.']
        self.audit['attempts'][-1]['errors'] = ['A factual finding remains unresolved.']
        with mock.patch.object(fixtures.ip, 'request_json') as model:
            result = self.select(self.api(conclusion='failure'))
        model.assert_not_called()
        audit = json.loads((Path(result['resume_dir'])/self.context['topic']['slug']/'zh.json').read_text())
        self.assertEqual(audit, self.audit)
        self.assertFalse(audit['passed'])
        self.assertEqual(result['automatic_resumes'], 1)

    def test_unknown_or_interrupted_generation_is_not_promoted(self):
        with self.assertRaises(ValueError):
            self.select(self.api(conclusion='cancelled'))

    def test_artifact_digest_is_still_verified_before_recovery(self):
        api = self.api(); api.bundles[200][0]['digest'] = 'sha256:'+'0'*64
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            self.select(api)


if __name__ == '__main__':
    unittest.main()
