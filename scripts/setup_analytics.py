#!/usr/bin/env python3
"""Local activation helper; only creates missing repository secrets via GitHub CLI."""
from __future__ import annotations
import argparse
import getpass
import json
import os
import secrets
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = 'yt-feng/geo-org'
WORKFLOW = 'analytics-deploy.yml'
REQUIRED = ('CLOUDFLARE_API_TOKEN', 'ANALYTICS_PIN', 'ANALYTICS_SECRET')
ROOT = Path(__file__).resolve().parents[1]

class SetupError(RuntimeError):
    pass

def gh(*args, data=None, timeout=90):
    # Values are stdin-only and are never part of command arguments or captured output.
    try:
        r = subprocess.run(['gh', *args], input=data, text=True, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise SetupError('GitHub CLI could not complete the operation. Check local gh authentication and connectivity.') from None
    if r.returncode:
        raise SetupError(f'GitHub CLI operation {args[0]} failed. Check account permission/authentication locally. Secret values and raw command output are intentionally suppressed.')
    return r.stdout

def gh_json(*args):
    try:
        return json.loads(gh(*args))
    except ValueError:
        raise SetupError('GitHub CLI returned an unexpected response') from None

def private_value(name):
    value = os.environ.get(name)
    if value is None:
        if not sys.stdin.isatty():
            raise SetupError(f'Missing {name}. Supply it privately in the local process environment, or run interactively. No credential has a built-in default.')
        value = getpass.getpass(name + ' (hidden input): ')
    return value.strip()

def missing_values(existing, read=private_value, generate=lambda: secrets.token_hex(32)):
    values = {}
    for name in REQUIRED:
        if name in existing:
            continue
        value = (os.environ.get(name) or generate()) if name == 'ANALYTICS_SECRET' else read(name)
        if not isinstance(value, str) or not value or any(x in value for x in ['\r', '\n', '\x00']):
            raise SetupError(f'Invalid value for {name}')
        if name == 'ANALYTICS_PIN' and not 4 <= len(value) <= 128:
            raise SetupError('ANALYTICS_PIN must contain 4 to 128 characters')
        if name == 'ANALYTICS_SECRET' and len(value) < 32:
            raise SetupError('ANALYTICS_SECRET must contain at least 32 characters')
        if name == 'CLOUDFLARE_API_TOKEN' and (len(value) < 20 or any(c.isspace() for c in value)):
            raise SetupError('Cloudflare API token format is invalid; use a scoped API token, not an account ID')
        values[name] = value
    return values

def configure():
    if shutil.which('gh') is None:
        raise SetupError('Install GitHub CLI locally, then run gh auth login --hostname github.com')
    gh('auth', 'status', '--hostname', 'github.com')
    listed = gh_json('secret', 'list', '--repo', REPO, '--json', 'name')
    if not isinstance(listed, list) or any(not isinstance(x, dict) or 'name' not in x for x in listed):
        raise SetupError('Cannot verify existing secret names; no secrets were changed')
    existing = {s['name'] for s in listed}
    values = missing_values(existing)  # Validate every missing input before making any writes.
    for name, value in values.items():
        gh('secret', 'set', name, '--repo', REPO, data=value)
        print('Configured missing secret: ' + name)
    for name in REQUIRED:
        if name in existing:
            print('Preserved existing secret: ' + name)
    return values.get('ANALYTICS_PIN')

def dispatch_and_watch():
    args = ('run', 'list', '--repo', REPO, '--workflow', WORKFLOW, '--event', 'workflow_dispatch', '--limit', '30', '--json', 'databaseId,headBranch')
    before = {r['databaseId'] for r in gh_json(*args)}
    gh('workflow', 'run', WORKFLOW, '--repo', REPO, '--ref', 'main')
    for _ in range(30):
        candidates = [r['databaseId'] for r in gh_json(*args) if r['databaseId'] not in before and r['headBranch'] == 'main']
        if len(candidates) > 1:
            raise SetupError('Concurrent manual deployments detected. Check the Actions runs; no run was cancelled or guessed.')
        if len(candidates) == 1:
            run_id = str(candidates[0])
            print(f'Deployment run: https://github.com/{REPO}/actions/runs/{run_id}', flush=True)
            gh('run', 'watch', run_id, '--repo', REPO, '--exit-status', timeout=1800)
            return
        time.sleep(2)
    raise SetupError('Deployment was requested but its run ID was not confirmed. Inspect Actions before retrying.')

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--deploy', action='store_true', help='Dispatch main deployment and wait for its actual result')
    p.add_argument('--verify-auth', action='store_true', help='Run live login/summary/logout checks after configuration')
    args = p.parse_args()
    try:
        pin = configure()
        print('Existing secrets were not rotated; no values were written to local files.')
        if args.deploy:
            dispatch_and_watch()
        if args.verify_auth:
            pin = pin or private_value('ANALYTICS_PIN')
            env = {**os.environ, 'ANALYTICS_PIN': pin}
            r = subprocess.run([sys.executable, str(ROOT / 'scripts/verify_live_site.py'), '--auth'], cwd=ROOT, env=env, check=False)
            return r.returncode
        print('Next: run this script with --deploy --verify-auth to deploy and verify the real backend.')
        return 0
    except (SetupError, KeyboardInterrupt, EOFError) as e:
        print('Activation stopped: ' + (str(e) or 'cancelled'), file=sys.stderr)
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
