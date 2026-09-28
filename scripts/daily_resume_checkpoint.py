"""Small, attempt-bound checkpoints for bounded continuation of a pending topic.

Only this manifest format is discovered automatically. Legacy review artifacts
remain available through the explicit manual resume path, never as implicit passes.
"""
from __future__ import annotations

import argparse
import base64
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
import re
from pathlib import Path
import selectors
import shutil
import subprocess
import tempfile
import time
import zipfile

WORKFLOW = '.github/workflows/generate-daily-blog.yml'
SCHEMA = 'daily-resume-v1'
MAX_FILE = 10_000_000
MAX_BUNDLE = 30_100_000
MAX_ZIP = 10_000_000
MAX_AUTO_RESUMES = 2
MAX_RUNS = 30
MAX_ARTIFACT_LOOKUPS = 10
MAX_DOWNLOADS = 3
CONTEXT = Path('.artifacts/resume-context.json')
DECISION = Path('.artifacts/resume-selection.json')
PRODUCTION_STEP = 'Generate one researched insight (production)'
PREVIEW_STEP = 'Generate one researched insight (preview)'
PRODUCER_CONTRACT = (
    '# daily-resume-schema: daily-resume-v1',
    'name: Generate one new article',
    'run: python scripts/daily_resume_checkpoint.py --package "$RUNNER_TEMP/daily-checkpoint"',
    'name: daily-insight-checkpoint-${{ github.run_id }}-${{ github.run_attempt }}',
    'path: ${{ runner.temp }}/daily-checkpoint/',
    "- name: ${{ inputs.preview == true && 'Generate one researched insight (preview)' || 'Generate one researched insight (production)' }}",
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def topic_identity(topic):
    value = asdict(topic)
    return {'row': topic.idx, 'slug': __import__('generate_blog').slugify(topic.title, topic.idx),
            'sha256': sha(json.dumps(value, ensure_ascii=False, sort_keys=True).encode())}


def read_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate checkpoint JSON field: ' + key)
            result[key] = value
        return result
    def invalid(value):
        raise ValueError('Invalid checkpoint JSON constant: ' + value)
    return json.loads(data, object_pairs_hook=unique, parse_constant=invalid)


def save_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def record_context(topic, *, preview=False, selected=None):
    """Write the actual checkout's selected topic before any paid work starts."""
    context = {'schema': SCHEMA, 'topic': topic_identity(topic), 'preview': bool(preview),
               'producer': {key: os.environ.get(env, '') for key, env in (
                   ('repository', 'GITHUB_REPOSITORY'), ('run_id', 'GITHUB_RUN_ID'),
                   ('run_attempt', 'GITHUB_RUN_ATTEMPT'), ('head_sha', 'GITHUB_SHA'),
                   ('ref', 'GITHUB_REF'), ('event', 'GITHUB_EVENT_NAME'))},
               'automatic_resumes': (selected or {}).get('automatic_resumes', 0),
               'selected_from': selected}
    save_json(CONTEXT, context)
    return context


def validate_draft(audit, topic):
    """Validate checkpoint completeness, preserving failed factual findings."""
    import insight_pipeline as ip
    if audit.get('passed') is True:
        # load_resume_audit validated the original saved pass before attaching
        # newly discovered translation obligations, which still require repair.
        return
    if (audit.get('version') != 'insights-v3' or type(audit.get('row')) is not int
            or audit['row'] != topic.idx or audit.get('language') != 'zh'
            or audit.get('passed') is not False or not isinstance(audit.get('brief'), dict)
            or not audit['brief']):
        raise ValueError('Incomplete failed Chinese checkpoint')
    ip._source_fingerprints(audit.get('sources'))
    attempts = audit.get('attempts')
    if not isinstance(attempts, list) or not attempts:
        raise ValueError('Checkpoint has no authored draft')
    previous = -1
    for attempt in attempts:
        if (not isinstance(attempt, dict) or type(attempt.get('revision')) is not int
                or attempt['revision'] <= previous or not isinstance(attempt.get('structure'), dict)
                or not isinstance(attempt.get('review', {}), dict)):
            raise ValueError('Checkpoint draft history is incomplete')
        previous = attempt['revision']
    last = attempts[-1]
    article = ip.normalize_article(last['article'], 'zh')
    if ip._article_sha256(article) != last.get('article_sha256'):
        raise ValueError('Checkpoint last article hash mismatch')
    ip.cross_language_required_fixes(audit)
    ip._revision_feedback(audit)


def package(topic, context, audit_root, destination):
    """Seal only coherent current-topic audits; translations are optional until begun."""
    import generate_daily_blog as daily
    if context['schema'] != SCHEMA or context['topic'] != topic_identity(topic):
        raise ValueError('Checkpoint context does not match the selected topic')
    audit = daily.load_resume_audit(audit_root, topic)
    validate_draft(audit, topic)
    destination = Path(destination)
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    files = []
    for lang in ('zh', 'en', 'ar'):
        relative = f'insights/{context["topic"]["slug"]}/{lang}.json'
        source = Path(audit_root) / context['topic']['slug'] / f'{lang}.json'
        if not source.exists():
            continue
        if source.is_symlink() or source.stat().st_size > MAX_FILE:
            raise ValueError('Checkpoint audit is a symlink or exceeds 10 MB')
        data = source.read_bytes()
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        files.append({'path': relative, 'bytes': len(data), 'sha256': sha(data)})
    manifest = {**context, 'state': 'ready', 'files': files}
    save_json(destination / 'manifest.json', manifest)
    return manifest


def seal(topic, context, audit_root, destination):
    """Do not reset a cross-day budget when an interrupted retry saved no draft."""
    try:
        return package(topic, context, audit_root, destination)
    except (ValueError, KeyError, TypeError, FileNotFoundError) as exc:
        selected = context.get('selected_from') or {}
        if (selected.get('action') == 'resume'
                and not (Path(audit_root)/context['topic']['slug']/'zh.json').exists()):
            # No new author/reviewer work exists to lose: carry the unchanged
            # selected history, under this run's incremented continuation count.
            return package(topic, context, Path(selected['resume_dir']), destination)
        if selected.get('automatic_resumes', 0):
            # A later partial audit or invalidated sources must not silently
            # roll back to an older pass or reset the automatic retry budget.
            destination = Path(destination)
            if destination.exists():
                shutil.rmtree(destination)
            destination.mkdir(parents=True)
            manifest = {**context, 'state': 'incomplete', 'reason': str(exc)[:500], 'files': []}
            save_json(destination/'manifest.json', manifest)
            return manifest
        print('No complete resumable checkpoint: ' + str(exc))
        return None


class GitHub:
    """A fixed total deadline and streamed byte caps apply to every API response."""
    def __init__(self, repo, seconds=120):
        self.repo, self.deadline = repo, time.monotonic() + seconds

    def read(self, path, limit):
        deadline = min(self.deadline, time.monotonic() + 30)
        if deadline <= time.monotonic():
            raise TimeoutError('Automatic resume discovery deadline exhausted')
        process = subprocess.Popen(['gh', 'api', path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        data = bytearray()
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not selector.select(remaining):
                        raise TimeoutError('GitHub checkpoint request timed out')
                    chunk = os.read(process.stdout.fileno(), 65536)
                    if not chunk:
                        break
                    data.extend(chunk)
                    if len(data) > limit:
                        raise ValueError('GitHub checkpoint response exceeds byte limit')
            if process.wait(timeout=max(.01, deadline-time.monotonic())):
                raise RuntimeError('GitHub checkpoint request failed; no fresh paid run was started')
            return bytes(data)
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()

    def json(self, path):
        return read_json(self.read(path, 2_000_000))


def unpack(blob, destination):
    """Never extract ZIP paths, links, duplicate entries or an unbounded archive."""
    if len(blob) > MAX_ZIP:
        raise ValueError('Checkpoint archive exceeds compressed byte limit')
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > 4 or len(names) != len(set(names)) or 'manifest.json' not in names:
            raise ValueError('Checkpoint archive must contain one manifest and at most three audits')
        if sum(entry.file_size for entry in entries) > MAX_BUNDLE:
            raise ValueError('Checkpoint archive exceeds expanded byte limit')
        for entry in entries:
            if entry.is_dir() or entry.file_size > MAX_FILE or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Invalid checkpoint archive entry')
        manifest = read_json(archive.read('manifest.json'))
        slug = manifest['topic']['slug']
        allowed = {f'insights/{slug}/{lang}.json' for lang in ('zh', 'en', 'ar')}
        if any(name not in allowed | {'manifest.json'} for name in names):
            raise ValueError('Unexpected checkpoint archive path')
        records = manifest['files']
        if (not isinstance(records, list) or len(records) != len(names)-1
                or {entry['path'] for entry in records} != set(names)-{'manifest.json'}):
            raise ValueError('Checkpoint file manifest is incomplete')
        # Do not use the manifest's slug as a filesystem path until shape checked.
        if '/' in slug or '\\' in slug or slug in ('.', '..'):
            raise ValueError('Invalid checkpoint topic slug')
        for record in records:
            data = archive.read(record['path'])
            if len(data) != record['bytes'] or sha(data) != record['sha256']:
                raise ValueError('Checkpoint file checksum mismatch')
            path = Path(destination) / record['path']
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    return manifest


def has_producer(api, repo, run, cache):
    """Prove legacy absence from the event's workflow, not today's checkout.

    A scheduled job may check out a newer main, but GitHub still executes the
    workflow definition at its event head. A missing/unreadable definition is
    not proof of legacy; neither is a partial or unknown checkpoint contract.
    """
    head = run['head_sha']
    if not re.fullmatch(r'[0-9a-f]{40,64}', head):
        raise ValueError('Invalid workflow event head')
    if head not in cache:
        value = api.json(f'repos/{repo}/contents/{WORKFLOW}?ref={head}')
        if (value.get('type') != 'file' or value.get('encoding') != 'base64'
                or type(value.get('size')) is not int or not 0 < value['size'] <= 100_000
                or not isinstance(value.get('content'), str)):
            raise ValueError('Cannot establish checkpoint producer from workflow definition')
        data = base64.b64decode(''.join(value['content'].split()), validate=True)
        if len(data) != value['size']:
            raise ValueError('Workflow definition size mismatch')
        lines = {line.strip() for line in data.decode('utf-8').splitlines()}
        present = [line in lines for line in PRODUCER_CONTRACT]
        if any(present) and not all(present):
            raise ValueError('Unknown or partial checkpoint producer contract')
        cache[head] = all(present)
    return cache[head]


def absent_checkpoint_reason(api, repo, run):
    """Absence is safe only when this exact attempt proves no production work."""
    response = api.json(f'repos/{repo}/actions/runs/{run["id"]}/attempts/{run["run_attempt"]}/jobs?per_page=100')
    jobs = response.get('jobs')
    if not isinstance(jobs, list) or type(response.get('total_count')) is not int or response['total_count'] != len(jobs):
        raise ValueError('Incomplete attempt jobs inventory')
    workers = [job for job in jobs if job.get('name') == 'Generate one new article']
    if len(workers) != 1:
        raise ValueError('Cannot prove whether the generation job started')
    job = workers[0]
    if (job.get('run_id') != run['id'] or job.get('run_attempt') != run['run_attempt']
            or job.get('status') != 'completed' or not isinstance(job.get('steps'), list)):
        raise ValueError('Generation job identity or terminal state is unknown')
    steps = [step for step in job['steps'] if step.get('name') in (PRODUCTION_STEP, PREVIEW_STEP)]
    if len(steps) != 1:
        raise ValueError('Generation scope or start state is unknown')
    step = steps[0]
    if step['name'] == PREVIEW_STEP:
        return 'preview_only_no_checkpoint'
    if step.get('status') == 'completed' and step.get('conclusion') == 'skipped':
        return 'verified_setup_only'
    raise ValueError('Production generation started or its start state is unknown; saved findings may be missing')


def select(topic, *, repo, current_run_id, destination, api=None, now=None):
    """Select the newest coherent main failure; discovery errors never start fresh work."""
    import generate_daily_blog as daily
    api = api or GitHub(repo)
    now = now or datetime.now(timezone.utc)
    expected = topic_identity(topic)
    Path(destination).mkdir(parents=True, exist_ok=True)
    runs = api.json(f'repos/{repo}/actions/workflows/generate-daily-blog.yml/runs?branch=main&status=completed&per_page={MAX_RUNS}')['workflow_runs']
    trusted = []
    for run in runs[:MAX_RUNS]:
        if (str(run['id']) == str(current_run_id) or run.get('status') != 'completed'
                or run.get('conclusion') not in ('failure', 'cancelled')
                or run.get('head_branch') != 'main' or run.get('path', '').split('@')[0] != WORKFLOW
                or run.get('repository', {}).get('full_name') != repo
                or run.get('event') not in ('schedule', 'workflow_dispatch')):
            continue
        updated = datetime.fromisoformat(run['updated_at'].replace('Z', '+00:00'))
        if now-timedelta(days=14) <= updated <= now:
            trusted.append(run)
    trusted.sort(key=lambda row: (row['updated_at'], row['id']), reverse=True)
    downloads = 0
    skipped = []
    capable, definitions = [], {}
    for run in trusted:
        if has_producer(api, repo, run, definitions):
            capable.append(run)
        else:
            skipped.append({'run_id': run['id'], 'reason': 'verified_legacy_workflow'})
    for run in capable[:MAX_ARTIFACT_LOOKUPS]:
        expected_name = f'daily-insight-checkpoint-{run["id"]}-{run["run_attempt"]}'
        artifacts = api.json(f'repos/{repo}/actions/runs/{run["id"]}/artifacts?per_page=100')['artifacts']
        matches = [item for item in artifacts if item['name'] == expected_name and not item.get('expired')]
        if not matches:
            try:
                reason = absent_checkpoint_reason(api, repo, run)
            except Exception as exc:
                message = f'Run {run["id"]} attempt {run["run_attempt"]} has no usable checkpoint: {exc}'
                save_json(DECISION, {'action': 'checkpoint_missing', 'topic': expected,
                                    'run_id': run['id'], 'run_attempt': run['run_attempt'], 'reason': message})
                raise ValueError(message) from exc
            skipped.append({'run_id': run['id'], 'reason': reason})
            continue
        if len(matches) != 1 or not 0 < matches[0]['size_in_bytes'] <= MAX_ZIP:
            raise ValueError('Ambiguous or oversized automatic checkpoint')
        if downloads >= MAX_DOWNLOADS:
            raise RuntimeError('Automatic resume download budget exhausted; inspect saved selection')
        downloads += 1
        artifact = matches[0]
        blob = api.read(f'repos/{repo}/actions/artifacts/{artifact["id"]}/zip', MAX_ZIP)
        if artifact.get('digest') != 'sha256:' + sha(blob):
            raise ValueError('GitHub checkpoint archive digest mismatch')
        with tempfile.TemporaryDirectory(prefix='candidate-', dir=destination) as folder:
            manifest = unpack(blob, folder)
            producer = manifest['producer']
            if (manifest.get('schema') != SCHEMA or type(manifest.get('preview')) is not bool
                    or producer != {'repository': repo, 'run_id': str(run['id']),
                        'run_attempt': str(run['run_attempt']), 'head_sha': run['head_sha'],
                        'ref': 'refs/heads/main', 'event': run['event']}):
                raise ValueError('Checkpoint producer identity or attempt mismatch')
            if manifest['preview']:
                skipped.append({'run_id': run['id'], 'reason': 'preview_only'})
                continue
            if manifest['topic'] != expected:
                skipped.append({'run_id': run['id'], 'reason': 'different_topic_fingerprint'})
                continue
            if manifest.get('state') != 'ready':
                raise ValueError('Newest topic checkpoint is incomplete; refusing to restart paid drafting or reuse an older pass')
            audit = daily.load_resume_audit(Path(folder)/'insights', topic)
            validate_draft(audit, topic)
            count = manifest.get('automatic_resumes')
            if type(count) is not int or not 0 <= count < MAX_AUTO_RESUMES:
                raise RuntimeError('Automatic continuation budget exhausted; saved history requires editorial repair')
            target = Path(destination)/'selected'
            shutil.copytree(Path(folder)/'insights', target)
            result = {'action': 'resume', 'run_id': run['id'], 'run_attempt': run['run_attempt'],
                      'artifact_id': artifact['id'], 'topic': expected,
                      'automatic_resumes': count+1, 'resume_dir': str(target), 'skipped': skipped}
            save_json(DECISION, result)
            return result
    if len(capable) > MAX_ARTIFACT_LOOKUPS:
        raise RuntimeError('Automatic resume search budget exhausted; no paid fresh run was started')
    result = {'action': 'fresh_no_checkpoint', 'topic': expected, 'automatic_resumes': 0, 'skipped': skipped}
    save_json(DECISION, result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package', type=Path, required=True)
    args = parser.parse_args()
    if not CONTEXT.exists():
        print('No selected-topic context; no resumable work was started.')
        return
    import generate_blog as gb
    context = read_json(CONTEXT.read_bytes())
    if context.get('preview'):
        print('Preview work remains in the full review artifact; no production checkpoint is published.')
        return
    topics = gb.read_topics(Path('assets/blog_articles.xlsx'), start_row=2, limit=0)
    topic = next((item for item in topics if topic_identity(item) == context['topic']), None)
    if topic is None:
        raise ValueError('Selected topic changed before checkpoint sealing')
    if seal(topic, context, Path('.artifacts/insights'), args.package) is None:
        return
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('ready=true\n')


if __name__ == '__main__':
    main()
