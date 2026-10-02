"""Small, attempt-bound checkpoints for bounded continuation of a pending topic.

Only this manifest format is discovered automatically. Legacy review artifacts
remain available through the explicit manual resume path, never as implicit passes.
"""
from __future__ import annotations

import argparse
import ast
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
from urllib.parse import urlencode
import zipfile

WORKFLOW = '.github/workflows/generate-daily-blog.yml'
SCHEMA = 'daily-resume-v1'
MAX_FILE = 10_000_000
MAX_BUNDLE = 30_100_000
MAX_ZIP = 10_000_000
MAX_AUTO_RESUMES = 2
MAX_RUNS = 30
MAX_ARTIFACT_LOOKUPS = 10
# Preserve the previous worst-case transfer allowance (three 10 MB ZIPs),
# rather than rejecting the fourth tiny checkpoint for an unrelated topic.
MAX_DOWNLOAD_BYTES = 3 * MAX_ZIP
CONTEXT = Path('.artifacts/resume-context.json')
DECISION = Path('.artifacts/resume-selection.json')
PRODUCTION_STEP = 'Generate one researched insight (production)'
PREVIEW_STEP = 'Generate one researched insight (preview)'
PRODUCER_JOB = 'name: Generate one new article'
PRODUCER_CONTRACT = (
    '# daily-resume-schema: daily-resume-v1',
    'run: python scripts/daily_resume_checkpoint.py --package "$RUNNER_TEMP/daily-checkpoint"',
    'name: daily-insight-checkpoint-${{ github.run_id }}-${{ github.run_attempt }}',
    'path: ${{ runner.temp }}/daily-checkpoint/',
    "- name: ${{ inputs.preview == true && 'Generate one researched insight (preview)' || 'Generate one researched insight (production)' }}",
)
# The legacy producer wrote selection_failed only around select(), before
# record_context/research/model calls. Pin that reviewed control flow; an
# arbitrary missing audit or error string is never proof of no new work.
LEGACY_SELECTION_PRODUCER_SHA256 = '19540a0f505493caa7c6c37cfa8578ff5f84fb344472dfcacbc20a4772126ad0'
# Pin the full module, including helpers, imports, defaults and globals. Only
# the part of generate_daily_article after its selection boundary may vary.
SELECTION_FAILURE_BOUNDARY_SHA256 = 'ef6dc4955b71cfb8d353304e2370cbf853882cdd37b74614c188daee59dbb1ab'
SELECTION_CHECKPOINT_SHA256 = '527feaf657da33cdf81077acc7c245c79c3fd85da127fdf5d68027f418cb722b'
SELECTION_HELPERS_SHA256 = '80712176a5993ca4e44d73a10e52f8ea6d1ae87976999745aa1b9428832ed4c7'
LEGACY_SELECTION_CHECKPOINT_SHA256 = 'c828ba3183ad46f0fb1a5af15edb9d48cbe5baf038c1551c1e91ce5f39db0ad0'


def assert_no_authored_work(audit_root):
    """Negative attestation must not coexist with any saved work or paid usage."""
    audit_roots = {Path(audit_root), Path('.artifacts/insights')}
    if os.environ.get('INSIGHT_AUDIT_DIR'):
        audit_roots.add(Path(os.environ['INSIGHT_AUDIT_DIR']))
    artifact_roots = {Path(audit_root).parent, CONTEXT.parent, Path('.artifacts')}
    for root in artifact_roots:
        audit_roots.add(root/'preview')
    for path in audit_roots:
        if path.is_symlink() or (path.exists() and (not path.is_dir() or any(path.iterdir()))):
            raise ValueError('Selection failure contains unexpected authored history')
    usage_paths = {Path('.artifacts/usage/deepseek.jsonl')}
    if os.environ.get('DEEPSEEK_USAGE_LOG'):
        usage_paths.add(Path(os.environ['DEEPSEEK_USAGE_LOG']))
    for root in artifact_roots:
        usage = root/'usage'
        if usage.is_symlink() or (usage.exists() and not usage.is_dir()):
            raise ValueError('Selection failure usage evidence is not a regular directory')
        if usage.exists():
            usage_paths.update(usage.iterdir())
    for path in usage_paths:
        if path.is_symlink() or (path.exists() and (not path.is_file() or path.stat().st_size)):
            raise ValueError('Selection failure contains paid usage or unknown usage evidence')


class FailedProductionWithoutCheckpoint(ValueError):
    """Exact terminal production attempt; requires separate no-work evidence."""


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


def record_context(topic, *, preview=False, selected=None, phase='generation'):
    """Write the actual checkout's selected topic before any paid work starts."""
    context = {'schema': SCHEMA, 'topic': topic_identity(topic), 'preview': bool(preview),
               'producer': {key: os.environ.get(env, '') for key, env in (
                   ('repository', 'GITHUB_REPOSITORY'), ('run_id', 'GITHUB_RUN_ID'),
                   ('run_attempt', 'GITHUB_RUN_ATTEMPT'), ('head_sha', 'GITHUB_SHA'),
                   ('ref', 'GITHUB_REF'), ('event', 'GITHUB_EVENT_NAME'))},
               'automatic_resumes': (selected or {}).get('automatic_resumes', 0),
               'selected_from': selected, 'phase': phase}
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
    if context.get('schema') != SCHEMA or context.get('topic') != topic_identity(topic):
        raise ValueError('Checkpoint context does not match the selected topic')
    if context.get('phase') == 'selection_failed':
        # This state is written only by the selector exception boundary, before
        # research/drafting starts. Do not hide any unexpectedly written audit.
        if (context.get('preview') is not False or context.get('selected_from') is not None
                or type(context.get('automatic_resumes')) is not int or context['automatic_resumes'] != 0
                or (Path(audit_root)/context['topic']['slug']).exists()):
            raise ValueError('Selection failure contains unexpected authored history')
        assert_no_authored_work(audit_root)
        decision = read_json(DECISION.read_bytes())
        if decision.get('topic') != topic_identity(topic):
            raise ValueError('Selection failure topic mismatch')
        destination = Path(destination)
        if destination.exists():
            shutil.rmtree(destination)
        destination.mkdir(parents=True)
        manifest = {**context, 'state': 'no_new_work', 'files': [],
                    'selection_failure': decision}
        save_json(destination/'manifest.json', manifest)
        return manifest
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
        if any(present) and (not all(present) or PRODUCER_JOB not in lines):
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
    if step.get('status') == 'completed' and step.get('conclusion') == 'failure':
        raise FailedProductionWithoutCheckpoint('Production generation step failed; saved findings may be missing')
    raise ValueError('Production generation started or its start state is unknown; saved findings may be missing')


def valid_topic_identity(value):
    return (isinstance(value, dict) and set(value) == {'row', 'slug', 'sha256'}
            and type(value['row']) is int and value['row'] >= 2
            and isinstance(value['slug'], str) and re.fullmatch(r'[a-z0-9-]+', value['slug'])
            and isinstance(value['sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', value['sha256']))


def syntax_fingerprint(node):
    # ast.dump changed its empty-list formatting in Python 3.13. Use a stable
    # structural encoding across the local and Actions Python versions.
    def encode(value):
        if isinstance(value, ast.AST):
            return [type(value).__name__, [[key, encode(item)] for key, item in ast.iter_fields(value)
                                           if item is not None and item != []]]
        if isinstance(value, list):
            return [encode(item) for item in value]
        return value
    return sha(json.dumps(encode(node), ensure_ascii=False, separators=(',', ':')).encode())


def selection_source_fingerprint(data, *, checkpoint=False):
    module = ast.parse(data)
    if checkpoint:
        # Only proof literals are excluded to avoid a self-referential hash.
        # The complete executable checkpoint module, imports and defaults stay.
        proof_names = {'SELECTION_FAILURE_BOUNDARY_SHA256', 'SELECTION_CHECKPOINT_SHA256',
                       'SELECTION_HELPERS_SHA256', 'LEGACY_SELECTION_CHECKPOINT_SHA256',
                       'LEGACY_SELECTION_PRODUCER_SHA256'}
        for node in module.body:
            if (isinstance(node, ast.Assign) and len(node.targets) == 1
                    and isinstance(node.targets[0], ast.Name) and node.targets[0].id in proof_names):
                if not isinstance(node.value, ast.Constant) or not isinstance(node.value.value, str):
                    raise ValueError('Executable checkpoint proof constant')
                node.value = ast.Constant(value='reviewed-proof-literal')
    else:
        functions = [node for node in module.body if isinstance(node, ast.FunctionDef)
                     and node.name == 'generate_daily_article']
        if len(functions) != 1:
            raise ValueError('Unrecognized pre-generation function')
        function = functions[0]
        boundaries = [index for index, node in enumerate(function.body) if isinstance(node, ast.If)
                      and isinstance(node.test, ast.Name) and node.test.id == 'auto_resume']
        if len(boundaries) != 1:
            raise ValueError('Unrecognized pre-generation exception boundary')
        # Preserve the full module, all helper definitions, imports, globals,
        # decorators and function defaults. Only the later body may vary.
        function.body = function.body[:boundaries[0]+1]
    return syntax_fingerprint(module)


def selection_producer(api, repo, run, cache, *, legacy=False):
    """Pin the complete pre-work producer and its repository import surface."""
    head = run['head_sha']
    def source(name):
        key = ('selection-source', head, name)
        if key not in cache:
            value = api.json(f'repos/{repo}/contents/scripts/{name}?ref={head}')
            if (value.get('type') != 'file' or value.get('encoding') != 'base64'
                    or type(value.get('size')) is not int or not 0 < value['size'] <= 100_000):
                raise ValueError('Cannot establish pre-generation selection producer')
            data = base64.b64decode(''.join(value['content'].split()), validate=True)
            if len(data) != value['size']:
                raise ValueError('Selection producer size mismatch')
            cache[key] = data
        return cache[key]
    generator = source('generate_daily_blog.py')
    expected = LEGACY_SELECTION_PRODUCER_SHA256 if legacy else SELECTION_FAILURE_BOUNDARY_SHA256
    actual = sha(generator) if legacy else selection_source_fingerprint(generator)
    if actual != expected:
        raise ValueError('Unrecognized pre-generation selection producer')
    checkpoint = source('daily_resume_checkpoint.py')
    expected = LEGACY_SELECTION_CHECKPOINT_SHA256 if legacy else SELECTION_CHECKPOINT_SHA256
    actual = sha(checkpoint) if legacy else selection_source_fingerprint(checkpoint, checkpoint=True)
    if actual != expected:
        raise ValueError('Unrecognized pre-generation checkpoint producer')
    key = ('selection-imports', head)
    if key not in cache:
        entries = api.json(f'repos/{repo}/contents/scripts?ref={head}')
        if (not isinstance(entries, list) or not 0 < len(entries) < 1000
                or any(not isinstance(item, dict) or not isinstance(item.get('name'), str)
                       or item.get('path') != 'scripts/'+item['name']
                       or '/' in item['name'] or item['name'] in ('.', '..') for item in entries)
                or len({item['name'] for item in entries}) != len(entries)):
            raise ValueError('Incomplete pre-generation helper inventory')
        helpers = []
        for item in entries:
            # New packages/native modules could shadow an otherwise pinned
            # import. This reviewed directory contains only flat Python files
            # and these two non-executable JSON resources.
            if (item.get('type') != 'file' or not (item['name'].endswith('.py')
                    or item['name'] in ('hymt_translation_model_manifest.json', 'research_source_catalog_seed.json'))):
                raise ValueError('Unrecognized pre-generation import surface')
            if not item['name'].endswith('.py') or item['name'] in ('generate_daily_blog.py', 'daily_resume_checkpoint.py'):
                continue
            if (item.get('type') != 'file' or not isinstance(item.get('sha'), str)
                    or not re.fullmatch(r'[0-9a-f]{40}', item['sha'])):
                raise ValueError('Invalid pre-generation helper identity')
            helpers.append([item['path'], item['sha']])
        cache[key] = sha(json.dumps(sorted(helpers), separators=(',', ':')).encode())
    if cache[key] != SELECTION_HELPERS_SHA256:
        raise ValueError('Unrecognized pre-generation imported helpers')


def legacy_no_work(blob, api, repo, run, definitions):
    """Attest old selector-only failures, never missing drafts after model work.

    Old review artifacts lack an attempt suffix. Only attempt 1 is admissible;
    later attempts require a new attempt-bound checkpoint receipt.
    """
    if run['run_attempt'] != 1:
        raise ValueError('Legacy review artifact is not attempt-bound after rerun')
    selection_producer(api, repo, run, definitions, legacy=True)
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        allowed = {'resume-selection.json', 'research-catalog-generator.json', 'research-catalog-preflight.json'}
        if (len(names) != len(set(names)) or 'resume-selection.json' not in names
                or not set(names) <= allowed or sum(e.file_size for e in entries) > MAX_BUNDLE
                or any(e.is_dir() or e.file_size > MAX_FILE
                       or (e.external_attr >> 16) & 0o170000 == 0o120000 for e in entries)):
            raise ValueError('Legacy selection artifact contains unknown or authored work')
        decision = read_json(archive.read('resume-selection.json'))
        if (set(decision) != {'action', 'topic', 'reason'} or decision['action'] != 'selection_failed'
                or not valid_topic_identity(decision['topic'])
                or not isinstance(decision['reason'], str) or not decision['reason']):
            raise ValueError('Legacy selection artifact does not prove a before-work failure')
        return decision['topic']


def artifact_inventory(api, repo, run):
    response = api.json(f'repos/{repo}/actions/runs/{run["id"]}/artifacts?per_page=100')
    artifacts = response.get('artifacts')
    if (not isinstance(artifacts, list) or type(response.get('total_count')) is not int
            or response['total_count'] != len(artifacts) or len(artifacts) > 100
            or any(not isinstance(item, dict) or type(item.get('id')) is not int
                   or not isinstance(item.get('name'), str) or type(item.get('expired')) is not bool
                   for item in artifacts)
            or len({item['id'] for item in artifacts}) != len(artifacts)):
        raise ValueError('Incomplete or invalid checkpoint artifact inventory')
    return artifacts


def validate_artifact(artifact, run):
    if (type(artifact.get('size_in_bytes')) is not int or not 0 < artifact['size_in_bytes'] <= MAX_ZIP
            or not isinstance(artifact.get('digest'), str)
            or not re.fullmatch(r'sha256:[0-9a-f]{64}', artifact['digest'])
            or not isinstance(artifact.get('workflow_run'), dict)
            or any(artifact['workflow_run'].get(key) != run[key] for key in ('id', 'head_sha', 'head_branch'))):
        raise ValueError('Invalid checkpoint artifact size, digest or producer identity')


def select(topic, *, repo, current_run_id, destination, api=None, now=None):
    """Select the newest coherent main failure; discovery errors never start fresh work."""
    import generate_daily_blog as daily
    api = api or GitHub(repo)
    now = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    cutoff = now-timedelta(days=14)
    expected = topic_identity(topic)
    Path(destination).mkdir(parents=True, exist_ok=True)
    # Match the API's creation-time search, including its total_count. Looking
    # at the last returned updated_at cannot prove coverage: old runs can rerun.
    query = urlencode({'branch': 'main', 'status': 'completed', 'per_page': MAX_RUNS,
                       'created': f'{cutoff.isoformat()}..{now.isoformat()}'})
    inventory = api.json(f'repos/{repo}/actions/workflows/generate-daily-blog.yml/runs?{query}')
    runs, total = inventory.get('workflow_runs'), inventory.get('total_count')
    if (not isinstance(runs, list) or type(total) is not int or total < len(runs)
            or len(runs) > MAX_RUNS or len({run['id'] for run in runs}) != len(runs)):
        raise ValueError('Incomplete or invalid workflow run inventory')
    if total != len(runs):
        # Even a matching candidate is unsafe: an omitted older-created run
        # could have rerun later and contain newer findings or an exhausted count.
        message = 'Automatic resume search budget exhausted before covering the 14-day creation window; no paid fresh run was started'
        save_json(DECISION, {'action': 'search_budget_exhausted', 'topic': expected,
                            'returned_runs': len(runs), 'total_runs': total, 'reason': message})
        raise RuntimeError(message)
    trusted = []
    for run in runs[:MAX_RUNS]:
        if (str(run['id']) == str(current_run_id) or run.get('status') != 'completed'
                or run.get('conclusion') not in ('failure', 'cancelled')
                or run.get('head_branch') != 'main' or run.get('path', '').split('@')[0] != WORKFLOW
                or run.get('repository', {}).get('full_name') != repo
                or run.get('event') not in ('schedule', 'workflow_dispatch')):
            continue
        created = datetime.fromisoformat(run['created_at'].replace('Z', '+00:00'))
        if cutoff <= created <= now:
            trusted.append(run)
    trusted.sort(key=lambda row: (row['updated_at'], row['id']), reverse=True)
    downloads, downloaded_bytes = 0, 0
    skipped = []
    def download(artifact, run):
        nonlocal downloads, downloaded_bytes
        validate_artifact(artifact, run)
        receipt = {'action': 'discovering', 'topic': expected, 'run_id': run['id'],
                   'run_attempt': run['run_attempt'], 'downloads': downloads,
                   'downloaded_bytes': downloaded_bytes, 'max_download_bytes': MAX_DOWNLOAD_BYTES,
                   'skipped': skipped}
        if downloaded_bytes + artifact['size_in_bytes'] > MAX_DOWNLOAD_BYTES:
            save_json(DECISION, {**receipt, 'action': 'download_budget_exhausted'})
            raise RuntimeError('Automatic resume compressed-byte budget exhausted; inspect saved selection')
        save_json(DECISION, receipt)
        # Stream cap counts actual bytes too; dishonest metadata cannot increase
        # the aggregate budget or turn a partial archive into a valid checkpoint.
        blob = api.read(f'repos/{repo}/actions/artifacts/{artifact["id"]}/zip',
                        min(MAX_ZIP, MAX_DOWNLOAD_BYTES-downloaded_bytes))
        downloaded_bytes += len(blob)
        downloads += 1
        if (len(blob) != artifact['size_in_bytes'] or downloaded_bytes > MAX_DOWNLOAD_BYTES
                or artifact['digest'] != 'sha256:' + sha(blob)):
            raise ValueError('GitHub checkpoint archive digest mismatch or size mismatch')
        return blob
    capable, definitions = [], {}
    for run in trusted:
        if has_producer(api, repo, run, definitions):
            capable.append(run)
        else:
            skipped.append({'run_id': run['id'], 'reason': 'verified_legacy_workflow'})
    for run in capable[:MAX_ARTIFACT_LOOKUPS]:
        expected_name = f'daily-insight-checkpoint-{run["id"]}-{run["run_attempt"]}'
        artifacts = artifact_inventory(api, repo, run)
        matches = [item for item in artifacts if item['name'] == expected_name and not item.get('expired')]
        if not matches:
            try:
                reason = absent_checkpoint_reason(api, repo, run)
            except Exception as exc:
                # The original selector could fail before it wrote a context.
                # A strictly authenticated negative artifact can prove this
                # attempt added no findings, but must not skip older history.
                legacy = [item for item in artifacts if item['name'] == f'daily-insight-review-{run["id"]}'
                          and not item['expired']]
                if isinstance(exc, FailedProductionWithoutCheckpoint) and len(legacy) == 1 and run['run_attempt'] == 1:
                    no_work_topic = legacy_no_work(download(legacy[0], run), api, repo, run, definitions)
                    skipped.append({'run_id': run['id'], 'run_attempt': run['run_attempt'],
                                    'artifact_id': legacy[0]['id'], 'artifact_digest': legacy[0]['digest'],
                                    'topic': no_work_topic, 'reason': 'verified_legacy_selection_failure'})
                    continue
                message = f'Run {run["id"]} attempt {run["run_attempt"]} has no usable checkpoint: {exc}'
                save_json(DECISION, {'action': 'checkpoint_missing', 'topic': expected,
                                    'run_id': run['id'], 'run_attempt': run['run_attempt'], 'reason': message})
                raise ValueError(message) from exc
            skipped.append({'run_id': run['id'], 'reason': reason})
            continue
        if len(matches) != 1:
            raise ValueError('Ambiguous or oversized automatic checkpoint')
        artifact = matches[0]
        blob = download(artifact, run)
        with tempfile.TemporaryDirectory(prefix='candidate-', dir=destination) as folder:
            manifest = unpack(blob, folder)
            producer = manifest['producer']
            if (manifest.get('schema') != SCHEMA or type(manifest.get('preview')) is not bool
                    or producer != {'repository': repo, 'run_id': str(run['id']),
                        'run_attempt': str(run['run_attempt']), 'head_sha': run['head_sha'],
                        'ref': 'refs/heads/main', 'event': run['event']}):
                raise ValueError('Checkpoint producer identity or attempt mismatch')
            if not valid_topic_identity(manifest.get('topic')):
                raise ValueError('Invalid checkpoint topic identity')
            if manifest.get('state') == 'no_new_work':
                selection_producer(api, repo, run, definitions)
                failure = manifest.get('selection_failure')
                if (manifest.get('phase') != 'selection_failed' or manifest['preview']
                        or manifest.get('selected_from') is not None
                        or type(manifest.get('automatic_resumes')) is not int or manifest['automatic_resumes'] != 0
                        or manifest.get('files') != [] or not isinstance(failure, dict)
                        or failure.get('topic') != manifest['topic']
                        or failure.get('action') not in ('selection_failed', 'search_budget_exhausted',
                                                       'checkpoint_missing', 'download_budget_exhausted', 'discovering')):
                    raise ValueError('Invalid no-new-work checkpoint')
                skipped.append({'run_id': run['id'], 'run_attempt': run['run_attempt'],
                                'artifact_id': artifact['id'], 'topic': manifest['topic'],
                                'reason': 'verified_selection_failure'})
                continue
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
                      'automatic_resumes': count+1, 'resume_dir': str(target), 'skipped': skipped,
                      'downloads': downloads, 'downloaded_bytes': downloaded_bytes}
            save_json(DECISION, result)
            return result
    if len(capable) > MAX_ARTIFACT_LOOKUPS:
        raise RuntimeError('Automatic resume search budget exhausted; no paid fresh run was started')
    result = {'action': 'fresh_no_checkpoint', 'topic': expected, 'automatic_resumes': 0, 'skipped': skipped,
              'downloads': downloads, 'downloaded_bytes': downloaded_bytes}
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
