"""No network, no real credentials, no production writes."""
import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
v = load('verify_live_site')
s = load('setup_analytics')

class Fake:
    def __init__(self, backend=True, leak=False, bad_cookie=False, bad_logout=False, broken_page=False):
        self.backend, self.leak, self.bad_cookie, self.bad_logout, self.broken_page = backend, leak, bad_cookie, bad_logout, broken_page
        self.calls, self.logged = [], False
    def __call__(self, url, method='GET', body=None, headers=None):
        self.calls.append((url, method, body, headers))
        if url.startswith(v.SITE):
            path = url[len(v.SITE):]
            if path == '/scripts/build_site.py':
                return v.Reply(404, {}, '')
            if path == '/sitemap.xml':
                return v.Reply(200, {}, '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://eco-geo.org/</loc></url></urlset>')
            if path == '/robots.txt':
                return v.Reply(200, {}, 'Sitemap: ' + v.SITE + '/sitemap.xml')
            if path == '/llms.txt':
                return v.Reply(200, {}, v.SITE + '/')
            if path == '/assets/analytics.js':
                return v.Reply(200, {}, 'consent')
            text = f'<link rel="canonical" href="{url}"><meta name="description" content="Test">'
            if path == '/observatory/':
                text += '<meta name="robots" content="noindex">'
            elif not self.broken_page:
                text += '<script src="/assets/analytics.js"></script>'
            text += '<a href="/blog/articles/test/">Test</a>' * 12 + 'contact_success'
            return v.Reply(200, {}, text)
        path = url[len(v.API):].split('?')[0]
        h = {'cache-control': 'no-store'}
        if path == '/health':
            return v.Reply(200 if self.backend else 503, h, json.dumps({'ok': self.backend, 'service': 'eco-geo-analytics'}))
        if headers.get('Origin') != v.SITE:
            return v.Reply(403, h, '{}')
        if path == '/api/login':
            self.logged = True
            h['set-cookie'] = '__Host-eco-ops=opaque-test-token; Path=/; Secure; HttpOnly; SameSite=Strict'
            if self.bad_cookie:
                h['set-cookie'] = h['set-cookie'].replace('HttpOnly;', '')
            return v.Reply(200, h, '{"ok":true}')
        if path == '/api/logout':
            self.logged = self.bad_logout
            return v.Reply(200, h, '{"ok":true}')
        if self.leak or (self.logged and headers.get('Cookie')):
            return v.Reply(200, h, '{"ok":true,"totals":{"page_views":12345},"pages":[]}')
        return v.Reply(401, h, '{}')

class LiveTests(unittest.TestCase):
    def test_public_does_not_claim_private_or_event_success(self):
        report, code = v.audit(Fake())
        self.assertEqual(code, 0)
        self.assertEqual(report['authentication'], 'not_requested')
        self.assertEqual(report['event_ingestion'], 'not_tested_no_events_written')
    def test_missing_backend_is_pending_not_zero(self):
        report, code = v.audit(Fake(backend=False))
        self.assertEqual(code, 2)
        self.assertEqual(report['overall'], 'backend_pending')
    def test_broken_static_pages_fail_even_when_backend_pending(self):
        report, code = v.audit(Fake(backend=False, broken_page=True))
        self.assertEqual(code, 1)
    def test_anonymous_leak_is_failure(self):
        report, code = v.audit(Fake(leak=True))
        self.assertEqual(code, 1)
    def test_auth_cookie_logout_and_report_redaction(self):
        fake = Fake()
        report, code = v.audit(fake, pin='test-private-value')
        self.assertEqual(code, 0)
        self.assertEqual(report['authentication'], 'passed')
        for sensitive in ['test-private-value', 'opaque-test-token', '12345']:
            self.assertNotIn(sensitive, json.dumps(report))
        self.assertFalse(fake.logged)
        self.assertFalse(any('/api/events' in c[0] for c in fake.calls))
    def test_insecure_cookie_fails(self):
        self.assertEqual(v.audit(Fake(bad_cookie=True), pin='test-only')[1], 1)
    def test_failed_revocation_fails(self):
        self.assertEqual(v.audit(Fake(bad_logout=True), pin='test-only')[1], 1)
    def test_untrusted_json_types_and_hosts(self):
        self.assertEqual(v.Reply(200, {}, '[]').data(), {})
        self.assertEqual(v.Reply(200, {}, 'invalid').data(), {})
        with self.assertRaises(ValueError):
            v.request('https://evil.example/api/login', method='POST', body={'pin':'test'})

class SetupTests(unittest.TestCase):
    def test_existing_secrets_never_read_or_rotated(self):
        def forbidden(*args):
            self.fail('Existing credential must not be re-read or generated')
        self.assertEqual(s.missing_values(set(s.REQUIRED), forbidden, forbidden), {})
    @patch.dict(os.environ, {}, clear=True)
    def test_only_missing_signature_generated(self):
        self.assertEqual(s.missing_values({'CLOUDFLARE_API_TOKEN','ANALYTICS_PIN'}, generate=lambda:'a'*64), {'ANALYTICS_SECRET':'a'*64})
    @patch.dict(os.environ, {}, clear=True)
    def test_invalid_pin_stops_before_upload(self):
        with self.assertRaises(s.SetupError):
            s.missing_values({'CLOUDFLARE_API_TOKEN','ANALYTICS_SECRET'}, read=lambda n:'12')
    @patch.dict(os.environ, {}, clear=True)
    def test_valid_inputs_not_turned_into_defaults(self):
        data = {'CLOUDFLARE_API_TOKEN':'test-token-'+'x'*30, 'ANALYTICS_PIN':'test-only'}
        result = s.missing_values(set(), read=data.get, generate=lambda:'z'*64)
        self.assertEqual(result['ANALYTICS_PIN'], 'test-only')
        self.assertEqual(len(result['ANALYTICS_SECRET']), 64)
    def test_secret_passed_to_cli_through_stdin_only(self):
        with patch.object(s.subprocess, 'run') as run:
            run.return_value.returncode=0
            run.return_value.stdout=''
            s.gh('secret','set','TEST','--repo',s.REPO,data='sensitive-test-input')
            args, kwargs=run.call_args
            self.assertNotIn('sensitive-test-input', ' '.join(args[0]))
            self.assertEqual(kwargs['input'], 'sensitive-test-input')
    def test_external_command_failure_output_is_redacted(self):
        with patch.object(s.subprocess,'run') as run:
            run.return_value.returncode=1
            run.return_value.stderr='LEAKED-SHOULD-NOT-APPEAR'
            with self.assertRaises(s.SetupError) as caught:
                s.gh('secret','set','TEST',data='secret')
            self.assertNotIn('LEAKED',str(caught.exception))

if __name__ == '__main__':
    unittest.main()
