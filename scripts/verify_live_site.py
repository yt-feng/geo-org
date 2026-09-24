#!/usr/bin/env python3
"""Live checks. No fabricated events, form submissions, secrets or traffic in reports."""
from __future__ import annotations
import argparse
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler
from xml.etree import ElementTree as ET

SITE = 'https://eco-geo.org'
API = 'https://metrics.eco-geo.org'

@dataclass
class Reply:
    status: int
    headers: dict
    text: str
    def data(self):
        try:
            value = json.loads(self.text)
            return value if isinstance(value, dict) else {}
        except (ValueError, TypeError):
            return {}

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # Never forward an owner credential or cookie to a redirect target.

def request(url, method='GET', body=None, headers=None):
    if not (url.startswith(SITE + '/') or url.startswith(API + '/')):
        raise ValueError('Only the configured production hosts can be checked')
    h = {'User-Agent': 'EcoGEO-Readiness/1.0', 'Cache-Control': 'no-cache', **(headers or {})}
    payload = json.dumps(body).encode() if body is not None else None
    if payload is not None:
        h['Content-Type'] = 'text/plain'
    req = Request(url, data=payload, headers=h, method=method)
    opener = build_opener(NoRedirect())
    for attempt in range(2):
        try:
            try:
                res = opener.open(req, timeout=15)
            except HTTPError as error:
                res = error
            with res:
                raw = res.read(2_000_001)
                if len(raw) > 2_000_000:
                    return Reply(0, {}, '')
                return Reply(res.status, {k.lower(): v for k, v in res.headers.items()}, raw.decode('utf-8', errors='replace'))
        except (URLError, TimeoutError, OSError):
            if method != 'GET' or attempt:
                return Reply(0, {}, '')  # Do not report raw errors that could contain credentials.
            time.sleep(1)
    return Reply(0, {}, '')

class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.meta, self.canonical, self.scripts, self.links = {}, [], [], []
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta':
            self.meta[a.get('name', a.get('property', '')).lower()] = a.get('content', '')
        if tag == 'link' and a.get('rel') == 'canonical':
            self.canonical.append(a.get('href'))
        if tag == 'script' and a.get('src'):
            self.scripts.append(a['src'])
        if tag == 'a':
            self.links.append(a.get('href', ''))

PAGES = ['/', '/en/', '/ar/', '/blog/', '/en/blog/', '/ar/blog/', '/contact/', '/observatory/']

def audit(transport=request, pin=None):
    checks = []
    def record(name, passed, scope='static', detail=''):
        checks.append({'check': name, 'scope': scope, 'status': 'pass' if passed else 'fail', 'detail': detail})
    paths = PAGES + ['/sitemap.xml', '/robots.txt', '/llms.txt', '/assets/analytics.js', '/scripts/build_site.py']
    with ThreadPoolExecutor(max_workers=5) as pool:
        fetched = dict(zip(paths, pool.map(lambda p: transport(SITE + p), paths)))
    for path in PAGES:
        r = fetched[path]
        page = Page(r.text)
        record(path + ' HTTP', r.status == 200, detail=f'HTTP {r.status or "unreachable"}')
        record(path + ' canonical', page.canonical == [SITE + path])
        if path == '/observatory/':
            record('Owner page noindex', 'noindex' in page.meta.get('robots', ''))
            record('Owner page excludes tracker', '/assets/analytics.js' not in page.scripts)
        else:
            record(path + ' tracker', page.scripts.count('/assets/analytics.js') == 1)
            record(path + ' description', bool(page.meta.get('description')))
        if path.endswith('/blog/'):
            record(path + ' static discovery', sum('/blog/articles/' in u for u in page.links) >= 12)
    try:
        urls = [x.text or '' for x in ET.fromstring(fetched['/sitemap.xml'].text).iter() if x.tag.endswith('}loc')]
        record('Sitemap unique public URLs', fetched['/sitemap.xml'].status == 200 and bool(urls) and len(urls) == len(set(urls)) and all(u.startswith(SITE + '/') and not any(p in u for p in ['/observatory/', '/jianong/', '/package-advisor/', '/404.html']) for u in urls))
    except ET.ParseError:
        record('Sitemap unique public URLs', False)
    record('Robots advertises sitemap', fetched['/robots.txt'].status == 200 and SITE + '/sitemap.xml' in fetched['/robots.txt'].text)
    record('LLM navigation file', fetched['/llms.txt'].status == 200 and SITE + '/' in fetched['/llms.txt'].text)
    record('Collector script reachable', fetched['/assets/analytics.js'].status == 200 and 'consent' in fetched['/assets/analytics.js'].text)
    record('Internal build script not published', fetched['/scripts/build_site.py'].status == 404)
    record('Contact success hook', 'contact_success' in fetched['/contact/'].text)
    h = {'Origin': SITE}
    health = transport(API + '/health', headers=h)
    healthy = health.status == 200 and health.data().get('ok') is True and health.data().get('service') == 'eco-geo-analytics'
    checks.append({'check': 'Collector health', 'scope': 'backend', 'status': 'pass' if healthy else 'pending', 'detail': f'HTTP {health.status or "unreachable"}; no assumption of zero traffic'})
    auth = 'not_requested'
    if healthy:
        anon = transport(API + '/api/summary', headers=h)
        record('Anonymous statistics denied', anon.status == 401, 'backend', f'HTTP {anon.status}')
        hostile = transport(API + '/api/summary', headers={'Origin': 'https://invalid.example'})
        record('Unapproved origin denied', hostile.status == 403, 'backend', f'HTTP {hostile.status}')
        if pin:
            auth = 'failed'
            login = transport(API + '/api/login', method='POST', body={'pin': pin}, headers=h)
            record('Owner login', login.status == 200 and login.data().get('ok') is True, 'auth', f'HTTP {login.status}')
            cookies = SimpleCookie()
            try:
                cookies.load(login.headers.get('set-cookie', ''))
            except Exception:
                pass
            morsel = cookies.get('__Host-eco-ops')
            secure = bool(morsel and morsel['secure'] and morsel['httponly'] and morsel['samesite'].lower() == 'strict' and morsel['path'] == '/' and not morsel['domain'])
            record('Owner cookie protections', secure, 'auth')
            if morsel:
                private_headers = {**h, 'Cookie': morsel.OutputString(attrs=[])}
                try:
                    data = transport(API + '/api/summary?days=7', headers=private_headers)
                    payload = data.data()
                    shape = isinstance(payload, dict) and payload.get('ok') is True and isinstance(payload.get('totals'), dict) and isinstance(payload.get('pages'), list)
                    record('Authenticated summary shape', data.status == 200 and shape, 'auth')
                    record('Private response not cached', 'no-store' in data.headers.get('cache-control', ''), 'auth')
                finally:
                    logout = transport(API + '/api/logout', method='POST', headers=private_headers)
                    record('Logout acknowledged', logout.status == 200, 'auth')
                    revoked = transport(API + '/api/summary', headers=private_headers)
                    record('Logged-out session revoked', revoked.status == 401, 'auth')
            if all(c['status'] == 'pass' for c in checks if c['scope'] == 'auth'):
                auth = 'passed'
    elif pin:
        auth = 'blocked_by_backend'
    failures = [c for c in checks if c['status'] == 'fail']
    overall = 'failed' if failures else 'backend_pending' if not healthy else 'authenticated_read_ready' if auth == 'passed' else 'public_checks_ready'
    return {'as_of': datetime.now(timezone.utc).isoformat(), 'overall': overall,
            'authentication': auth, 'event_ingestion': 'not_tested_no_events_written',
            'note': 'Readiness checks do not prove event delivery. No artificial traffic or customer form submissions were generated. No statistics, secrets or cookies are included.',
            'checks': checks}, (1 if failures else 2 if not healthy else 0)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--auth', action='store_true', help='Use ANALYTICS_PIN from environment; never a CLI argument')
    parser.add_argument('--report', default='.artifacts/live-readiness.json')
    args = parser.parse_args()
    pin = os.environ.get('ANALYTICS_PIN') if args.auth else None
    if args.auth and not pin:
        parser.error('ANALYTICS_PIN must be supplied privately in the environment')
    result, code = audit(pin=pin)
    target = Path(args.report)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'checks'}, ensure_ascii=False))
    for c in result['checks']:
        print(f"{c['status'].upper()}: {c['check']} {c['detail']}")
    return code

if __name__ == '__main__':
    raise SystemExit(main())
