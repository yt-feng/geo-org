"""Cross-day checkpoint selection uses real audit validators and bounded I/O."""
import copy
import base64
from datetime import datetime, timedelta, timezone
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path
import unittest
from unittest import mock
import zipfile

import test_daily_resume_passed as fixtures
import daily_resume_checkpoint as cp

daily, ip = fixtures.daily, fixtures.ip


class API:
    def __init__(self, runs, bundles, *, legacy_heads=()):
        self.runs, self.bundles = runs, bundles
        self.legacy_heads = set(legacy_heads)
        self.calls = []

    def json(self, path):
        self.calls.append(path)
        if '/contents/' in path:
            head = path.split('?ref=')[1]
            body = b'name: Legacy daily generation\n' if head in self.legacy_heads else '\n'.join(cp.PRODUCER_CONTRACT).encode()
            return {'type': 'file', 'encoding': 'base64', 'size': len(body), 'content': base64.b64encode(body).decode()}
        if '/workflows/' in path:
            return {'workflow_runs': self.runs}
        run_id = int(path.split('/runs/')[1].split('/')[0])
        if '/jobs?' in path:
            run = next(run for run in self.runs if run['id'] == run_id)
            return {'total_count': 1, 'jobs': [{'name': 'Generate one new article', 'run_id': run_id,
                    'run_attempt': run['run_attempt'], 'status': 'completed',
                    'steps': [{'name': cp.PRODUCTION_STEP, 'status': 'completed', 'conclusion': 'skipped'}]}]}
        return {'artifacts': [self.bundles[run_id][0]] if run_id in self.bundles else []}

    def read(self, path, limit):
        self.calls.append(path)
        artifact_id = int(path.split('/artifacts/')[1].split('/')[0])
        return next(blob for artifact, blob in self.bundles.values() if artifact['id'] == artifact_id)


class AutoResumeTests(unittest.TestCase):
    good_review = fixtures.PassedChineseResumeTests.good_review

    def setUp(self):
        fixtures.PassedChineseResumeTests.setUp(self)
        self.now = datetime(2026, 9, 29, 0, tzinfo=timezone.utc)
        self.audit['passed'] = False
        self.audit['attempts'][-1]['review']['blockers'] = ['The cost comparison still uses an infeasible option.']
        self.audit['attempts'][-1]['errors'] = ['The cost comparison still uses an infeasible option.']
        self.env = {'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_RUN_ID': '300', 'GITHUB_RUN_ATTEMPT': '1',
                    'GITHUB_SHA': 'f'*40, 'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'schedule',
                    'RUNNER_TEMP': str(self.root)}
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(cp, 'CONTEXT', self.root/'context.json').start()
        mock.patch.object(cp, 'DECISION', self.root/'decision.json').start()

    def run_record(self, run_id, *, attempt=1, age=1):
        return {'id': run_id, 'run_attempt': attempt, 'updated_at': (self.now-timedelta(days=age)).isoformat(),
                'head_sha': f'{run_id:040x}', 'status': 'completed', 'conclusion': 'failure', 'event': 'schedule',
                'head_branch': 'main', 'path': cp.WORKFLOW, 'repository': {'full_name': 'owner/repo'}}

    def bundle(self, run, *, audit=None, topic=None, count=0, mutate=None):
        topic = topic or self.topic
        folder = self.root/f'input-{run["id"]}'
        source = folder/cp.topic_identity(topic)['slug']/'zh.json'
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text(json.dumps(audit or self.audit))
        context = {'schema': cp.SCHEMA, 'topic': cp.topic_identity(topic), 'preview': False,
                   'producer': {'repository': 'owner/repo', 'run_id': str(run['id']),
                       'run_attempt': str(run['run_attempt']), 'head_sha': run['head_sha'],
                       'ref': 'refs/heads/main', 'event': run['event']},
                   'automatic_resumes': count, 'selected_from': None}
        destination = self.root/f'bundle-{run["id"]}'
        cp.package(topic, context, folder, destination)
        if mutate:
            mutate(destination)
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in destination.rglob('*.json'):
                archive.write(path, str(path.relative_to(destination)))
        blob = data.getvalue()
        return ({'id': run['id']*10, 'name': f'daily-insight-checkpoint-{run["id"]}-{run["run_attempt"]}',
                 'expired': False, 'size_in_bytes': len(blob), 'digest': 'sha256:'+cp.sha(blob)}, blob)

    def choose(self, runs, bundles):
        api = API(runs, bundles)
        result = cp.select(self.topic, repo='owner/repo', current_run_id='300',
                           destination=self.root/'selection', api=api, now=self.now)
        return result, api

    def test_two_failures_on_different_days_resume_latest_history_without_a_new_brief(self):
        first, second = self.run_record(100, age=2), self.run_record(200)
        later = copy.deepcopy(self.audit)
        last = copy.deepcopy(later['attempts'][-1]); last['revision'] = 5
        last['review']['blockers'] = ['Newest blocker must not be rolled back to yesterday.']
        later['attempts'].append(last)
        result, api = self.choose([first, second], {100: self.bundle(first), 200: self.bundle(second, audit=later, count=1)})
        self.assertEqual(result['run_id'], 200)
        self.assertEqual(result['automatic_resumes'], 2)
        saved = daily.load_resume_audit(Path(result['resume_dir']), self.topic)
        self.assertEqual(saved['attempts'], later['attempts'])
        self.assertIn('Newest blocker', str(ip._revision_feedback(saved)))
        self.assertFalse(any('/runs/100/' in path for path in api.calls))
        with mock.patch.object(ip, 'request_json', side_effect=RuntimeError('before paid request')) as request:
            with self.assertRaisesRegex(RuntimeError, 'before paid request'):
                ip.produce_article(self.topic, self.sources, 'test', audit_path=self.root/'continued.json', resume_audit=saved)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.kwargs['stage'], 'zh-draft-6')

    def test_complete_strict_pass_can_continue_after_a_later_stage_failed(self):
        audit = copy.deepcopy(self.audit)
        audit['passed'] = True
        audit['attempts'][-1].update(review=self.good_review(), errors=[])
        run = self.run_record(100)
        result, _ = self.choose([run], {100: self.bundle(run, audit=audit)})
        self.assertTrue(daily.load_resume_audit(Path(result['resume_dir']), self.topic)['passed'])

    def test_real_historic_false_pass_cannot_be_packaged_or_selected(self):
        fixture = json.loads((Path(__file__).parent/'fixtures/row706-publication-fallback-reviews.json').read_text())
        for case in fixture['cases']:
            audit = copy.deepcopy(self.audit)
            audit['passed'] = True
            audit['attempts'][-1].update(review=case['attempts'][-1]['review'], errors=[], review_state='completed_with_warnings')
            with self.subTest(run=case['run_url']), self.assertRaises(ValueError):
                self.bundle(self.run_record(100), audit=audit)
        # A forged manifest checksum is not authority to reinterpret passed=true.
        run = self.run_record(100)
        def forge(folder):
            p = next((folder/'insights').rglob('zh.json'))
            audit = json.loads(p.read_text()); audit['passed'] = True
            audit['attempts'][-1]['errors'] = []
            audit['attempts'][-1]['review_state'] = 'completed_with_warnings'
            audit['attempts'][-1]['review']['publication_fallback'] = True
            p.write_text(json.dumps(audit))
            manifest = json.loads((folder/'manifest.json').read_text())
            manifest['files'][0].update(bytes=p.stat().st_size, sha256=cp.sha(p.read_bytes()))
            (folder/'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'independent review rejected'):
            self.choose([run], {100: self.bundle(run, mutate=forge)})

    def test_missing_file_incomplete_audit_and_wrong_attempt_never_fall_back_silently(self):
        run = self.run_record(100, attempt=2)
        def missing(folder):
            next((folder/'insights').rglob('zh.json')).unlink()
        def wrong_attempt(folder):
            p=folder/'manifest.json'; data=json.loads(p.read_text()); data['producer']['run_attempt']='1'; p.write_text(json.dumps(data))
        for mutation in (missing, wrong_attempt):
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                self.choose([run], {100: self.bundle(run, mutate=mutation)})
        incomplete = copy.deepcopy(self.audit); incomplete.pop('brief')
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            self.bundle(run, audit=incomplete)

    def test_expired_other_topic_and_old_attempt_are_not_selected(self):
        run = self.run_record(100)
        for kind in ('expired', 'other_topic', 'attempt', 'age', 'branch', 'repository', 'workflow', 'preview'):
            r = copy.deepcopy(run)
            topic = copy.deepcopy(self.topic)
            if kind == 'other_topic': topic.context['new decision constraint'] = 'different input, same title and row'
            def preview(folder):
                p=folder/'manifest.json'; data=json.loads(p.read_text()); data['preview']=True; p.write_text(json.dumps(data))
            artifact, blob = self.bundle(r, topic=topic, mutate=preview if kind=='preview' else None)
            if kind == 'expired': artifact['expired'] = True
            if kind == 'attempt': artifact['name'] = 'daily-insight-checkpoint-100-0'
            if kind == 'age': r['updated_at'] = (self.now-timedelta(days=15)).isoformat()
            if kind == 'branch': r['head_branch'] = 'untrusted'
            if kind == 'repository': r['repository']['full_name'] = 'other/repo'
            if kind == 'workflow': r['path'] = '.github/workflows/other.yml'
            with self.subTest(kind=kind):
                result, _ = self.choose([r], {100: (artifact, blob)})
                self.assertEqual(result['action'], 'fresh_no_checkpoint')

    def test_automatic_continuation_is_bounded_across_days(self):
        run = self.run_record(100)
        with self.assertRaisesRegex(RuntimeError, 'continuation budget exhausted'):
            self.choose([run], {100: self.bundle(run, count=cp.MAX_AUTO_RESUMES)})
        runs = [self.run_record(n) for n in range(100, 111)]
        with self.assertRaisesRegex(RuntimeError, 'search budget exhausted'):
            self.choose(runs, {})

    def test_eighteen_verified_legacy_failures_allow_first_checkpoint_bootstrap(self):
        runs = [self.run_record(n) for n in range(100, 118)]
        # Old reruns often share an event head; one definition read proves all.
        for run in runs: run['head_sha'] = 'a'*40
        api = API(runs, {}, legacy_heads=['a'*40])
        result = cp.select(self.topic, repo='owner/repo', current_run_id='300',
                           destination=self.root/'bootstrap', api=api, now=self.now)
        self.assertEqual(result['action'], 'fresh_no_checkpoint')
        self.assertEqual(len(result['skipped']), 18)
        self.assertEqual(sum('/contents/' in path for path in api.calls), 1)
        self.assertFalse(any('/artifacts?' in path for path in api.calls))

    def test_unreadable_or_partial_producer_contract_never_means_legacy(self):
        run = self.run_record(100)
        for response in ({'type': 'directory'}, {'type': 'file', 'encoding': 'base64', 'size': 10, 'content': '!'},
                         {'type': 'file', 'encoding': 'base64', 'size': len(cp.PRODUCER_CONTRACT[0]),
                          'content': base64.b64encode(cp.PRODUCER_CONTRACT[0].encode()).decode()}):
            api = API([run], {})
            original = api.json
            with mock.patch.object(api, 'json', side_effect=lambda path: response if '/contents/' in path else original(path)), \
                    self.assertRaises(ValueError):
                cp.select(self.topic, repo='owner/repo', current_run_id='300', destination=self.root/'bad-contract', api=api, now=self.now)

    def test_actual_production_workflow_declares_the_discovered_contract(self):
        body = (Path(__file__).resolve().parents[1]/cp.WORKFLOW).read_bytes()
        api = mock.Mock()
        api.json.return_value = {'type': 'file', 'encoding': 'base64', 'size': len(body),
                                 'content': base64.b64encode(body).decode()}
        self.assertTrue(cp.has_producer(api, 'owner/repo', self.run_record(100), {}))

    def test_newer_missing_checkpoint_cannot_erase_findings_or_reset_an_older_count(self):
        old, new = self.run_record(100, age=2), self.run_record(200)
        for step in ({'name': cp.PRODUCTION_STEP, 'status': 'completed', 'conclusion': 'failure'},
                     {'name': cp.PRODUCTION_STEP, 'status': 'queued'}, {}):
            api = API([new, old], {100: self.bundle(old)})
            original = api.json
            def response(path):
                result = original(path)
                if '/jobs?' in path: result['jobs'][0]['steps'] = [step]
                return result
            with mock.patch.object(api, 'json', side_effect=response), self.assertRaisesRegex(ValueError, 'Run 200 attempt 1'):
                cp.select(self.topic, repo='owner/repo', current_run_id='300', destination=self.root/'missing-newer', api=api, now=self.now)
            self.assertFalse(any('/runs/100/artifacts' in path for path in api.calls))
            receipt = json.loads(cp.DECISION.read_text())
            self.assertEqual(receipt['action'], 'checkpoint_missing')
            self.assertEqual(receipt['run_id'], 200)

    def test_proven_setup_failure_or_preview_does_not_hide_an_older_checkpoint(self):
        old, new = self.run_record(100, age=2), self.run_record(200)
        for preview in (False, True):
            api = API([new, old], {100: self.bundle(old, count=1)})
            original = api.json
            def response(path):
                result = original(path)
                if preview and '/jobs?' in path:
                    result['jobs'][0]['steps'] = [{'name': cp.PREVIEW_STEP, 'status': 'completed', 'conclusion': 'failure'}]
                return result
            with mock.patch.object(api, 'json', side_effect=response):
                selected = cp.select(self.topic, repo='owner/repo', current_run_id='300',
                                     destination=self.root/f'setup-{preview}', api=api, now=self.now)
            self.assertEqual(selected['run_id'], 100)
            self.assertEqual(selected['automatic_resumes'], 2)
            self.assertEqual(selected['skipped'][0]['reason'], 'preview_only_no_checkpoint' if preview else 'verified_setup_only')

    def test_archive_hash_and_expanded_size_are_checked(self):
        run = self.run_record(100)
        artifact, blob = self.bundle(run)
        artifact['digest'] = 'sha256:'+'0'*64
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            self.choose([run], {100: (artifact, blob)})
        with mock.patch.object(cp, 'MAX_BUNDLE', 10), self.assertRaisesRegex(ValueError, 'expanded'):
            cp.unpack(blob, self.root/'expanded')

    def test_interrupted_audit_write_preserves_previous_complete_checkpoint(self):
        path = self.root/'atomic.json'; ip.write_audit(path, self.audit)
        original = path.read_bytes()
        with mock.patch.object(Path, 'replace', side_effect=OSError('interrupted')):
            with self.assertRaises(OSError): ip.write_audit(path, {'partial': True})
        self.assertEqual(path.read_bytes(), original)

    def test_interruptions_preserve_continuation_count_without_losing_newer_findings(self):
        run = self.run_record(100)
        selected, _ = self.choose([run], {100: self.bundle(run)})
        with mock.patch.dict(os.environ, self.env):
            context = cp.record_context(self.topic, selected=selected)
        current, destination = self.root/'current', self.root/'sealed'
        carried = cp.seal(self.topic, context, current, destination)
        self.assertEqual(carried['state'], 'ready')
        self.assertEqual(carried['automatic_resumes'], 1)
        self.assertEqual(daily.load_resume_audit(destination/'insights', self.topic)['attempts'], self.audit['attempts'])
        partial = current/cp.topic_identity(self.topic)['slug']/'zh.json'
        partial.parent.mkdir(parents=True); partial.write_text('{partial')
        blocked = cp.seal(self.topic, context, current, destination)
        self.assertEqual(blocked['state'], 'incomplete')
        self.assertEqual(blocked['automatic_resumes'], 1)
        self.assertEqual(blocked['files'], [])
        self.assertFalse((destination/'insights').exists())

    def test_github_stream_byte_and_time_bounds_stop_the_actual_subprocess(self):
        real_popen = subprocess.Popen
        for program, limit, seconds, exception in (
                ('import sys; sys.stdout.write("x"*100000)', 100, 3, ValueError),
                ('import time; time.sleep(10)', 100, .05, TimeoutError)):
            children = []
            def start(*args, **kwargs):
                child = real_popen([sys.executable, '-c', program], **kwargs)
                children.append(child)
                return child
            began = time.monotonic()
            with mock.patch.object(cp.subprocess, 'Popen', side_effect=start), self.assertRaises(exception):
                cp.GitHub('owner/repo', seconds=seconds).read('fixture', limit)
            self.assertLess(time.monotonic()-began, 2)
            self.assertTrue(all(child.poll() is not None for child in children))

    def test_no_pending_topic_clears_context_instead_of_sealing_old_work(self):
        cp.save_json(cp.CONTEXT, {'old': 'context'})
        with mock.patch.object(daily.gb, 'read_topics', return_value=[]), \
                mock.patch.object(daily, 'load_posts', return_value=[]):
            self.assertFalse(daily.generate_daily_article(Path('unused'), self.root/'blog', 2, False, save_checkpoint=True))
        self.assertFalse(cp.CONTEXT.exists())

    def test_auto_source_drift_uses_fresh_research_but_fetch_failure_does_not(self):
        from insight_research import ResearchError, ResearchSourceDrift
        run = self.run_record(100)
        selected, _ = self.choose([run], {100: self.bundle(run)})
        for error, fresh in ((ResearchSourceDrift('source SHA-256 mismatch'), True), (ResearchError('source fetch failed'), False)):
            with self.subTest(error=error), mock.patch.dict(os.environ, {**self.env, 'DEEPSEEK_API_KEY': 'test'}), \
                    mock.patch.object(cp, 'select', return_value=selected), \
                    mock.patch.object(daily.gb, 'read_topics', return_value=[self.topic]), \
                    mock.patch.object(daily, 'load_posts', return_value=[]), \
                    mock.patch.object(daily, 'select_next_topic', return_value=self.topic), \
                    mock.patch.object(daily, 'reread_research_pack', side_effect=error), \
                    mock.patch.object(daily, 'fetch_news_items', return_value=[]) as news, \
                    mock.patch.object(daily, 'fetch_tavily_market_items', return_value=[]), \
                    mock.patch.object(daily, 'build_research_pack', return_value=self.sources) as build, \
                    mock.patch.object(ip, 'produce_article', side_effect=RuntimeError('stopped before paid work')) as produce:
                with self.assertRaises(RuntimeError):
                    daily.generate_daily_article(Path('unused'), self.root/'blog', 2, False, auto_resume=True)
                if fresh:
                    build.assert_called_once(); news.assert_called_once()
                    self.assertIsNone(produce.call_args.kwargs['resume_audit'])
                    self.assertEqual(json.loads(cp.DECISION.read_text())['action'], 'fresh_source_drift')
                else:
                    build.assert_not_called(); news.assert_not_called(); produce.assert_not_called()


if __name__ == '__main__':
    unittest.main()
