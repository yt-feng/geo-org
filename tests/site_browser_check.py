"""Network-mocked CI browser checks. Fixtures never reach production analytics."""
import json,mimetypes
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]/'_site';checks=[];events=[];mode={'value':'unauthorized'}
def mark(n):checks.append(n);print('PASS',n,flush=True)
sample={'ok':True,'days':7,'start':'2026-09-17','timezone':'UTC','as_of':'2026-09-23T14:00:00.000Z','totals':{'events':4,'page_views':1,'sessions':1,'engaged_sessions':1,'contacts':1},'daily':[{'day':'2026-09-23','views':1,'sessions':1}],'pages':[{'path':'/','views':1,'sessions':1}],'sources':[{'source':'chatgpt','views':1,'sessions':1}],'events':[{'name':'contact_success','count':1}],'interactions':[{'path':'/','target':'a-4','name':'nav_click','count':1}],'devices':[{'device':'desktop','views':1}],'languages':[{'lang':'zh-CN','views':1}],'vitals':[],'coverage':{'first_event':1790168400,'last_event':1790168400}}
def route(r):
 u=urlsplit(r.request.url)
 if u.hostname=='eco-geo.org':
  path=ROOT/unquote(u.path).lstrip('/')
  if path.is_dir():path=path/'index.html'
  if not path.is_file():r.fulfill(status=404,body='not found');return
  mime='text/javascript' if path.suffix=='.mjs' else mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
  r.fulfill(status=200,body=path.read_bytes(),content_type=mime);return
 if u.hostname=='metrics.eco-geo.org':
  headers={'Access-Control-Allow-Origin':'https://eco-geo.org','Access-Control-Allow-Credentials':'true'}
  if r.request.method=='OPTIONS':r.fulfill(status=204,headers={**headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return
  if u.path=='/api/events':events.extend(json.loads(r.request.post_data)['events']);r.fulfill(status=200,headers=headers,json={'ok':True});return
  if mode['value']=='unavailable':r.fulfill(status=503,headers=headers,json={'error':'not_configured'});return
  if u.path=='/api/login':
   good=json.loads(r.request.post_data)['pin']=='local-test-only'
   if good:mode['value']='authenticated'
   r.fulfill(status=200 if good else 401,headers=headers,json={'ok':good});return
  if u.path=='/api/logout':mode['value']='unauthorized';r.fulfill(status=200,headers=headers,json={'ok':True});return
  r.fulfill(status=200 if mode['value']=='authenticated' else 401,headers=headers,json=sample if mode['value']=='authenticated' else {'error':'unauthorized'});return
 if u.hostname=='forms.eco-geo.org':r.fulfill(status=200,headers={'Access-Control-Allow-Origin':'https://eco-geo.org','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'},json={'ok':True,'requestId':'browser-test'});return
 r.fulfill(status=200,content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#20352a"/></svg>')
Path('browser-artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox']);c=b.new_context(viewport={'width':1365,'height':900});c.route('**/*',route);page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('https://eco-geo.org/?email=must-not-collect@example.com',wait_until='networkidle');assert not events;assert page.locator('#eco-consent').is_visible();mark('No events before consent')
 page.get_by_role('button',name='允许统计',exact=True).click();page.wait_for_timeout(5200);assert any(e['name']=='page_view' for e in events);assert 'must-not-collect' not in json.dumps(events);mark('Consent collection excludes query parameters')
 page.evaluate('window.scrollTo(0,document.body.scrollHeight)');page.wait_for_timeout(5200);assert any(e['name']=='scroll_depth' and e['value']==90 for e in events);mark('Reading depth tracked')
 page.locator('.eco-owner-entry').click(click_count=5);page.wait_for_url('**/observatory/');page.wait_for_timeout(300);assert page.locator('#auth').is_visible();assert not page.locator('#dashboard').is_visible();mark('Hidden entry and unauthenticated access')
 page.locator('#pin').fill('wrong');page.locator('#login button').click();page.wait_for_timeout(400);assert '不正确' in page.locator('#status').inner_text();mark('Wrong PIN rejected')
 page.locator('#pin').fill('local-test-only');page.locator('#login button').click();page.wait_for_timeout(500);assert page.locator('#dashboard').is_visible();assert page.locator('#metrics .metric').count()==5;mark('Authenticated aggregate dashboard (mock data only)')
 with page.expect_download() as dl:page.locator('#export').click()
 content=Path(dl.value.path()).read_text(encoding='utf-8-sig');assert 'page_views' in content;assert 'local-test-only' not in content;mark('CSV export excludes credential')
 page.screenshot(path='browser-artifacts/dashboard-test-fixture.png',full_page=True)
 page.locator('#logout').click();page.wait_for_timeout(300);assert not page.locator('#dashboard').is_visible();mark('Logout clears statistics')
 mode['value']='unavailable';page.reload(wait_until='networkidle');assert not page.locator('#dashboard').is_visible();assert '配置' in page.locator('#status').inner_text();mark('Unavailable backend is never fake zeros')
 mode['value']='unauthorized';page.goto('https://eco-geo.org/blog/',wait_until='networkidle');assert page.locator('#postGrid .card').count()==24;page.locator('#searchInput').fill('PRIVATE-SEARCH-DO-NOT-COLLECT');page.wait_for_timeout(5800);assert any(e['name']=='search_use' for e in events);assert 'PRIVATE-SEARCH' not in json.dumps(events);mark('Dynamic blog search works without collecting search text')
 page.goto('https://eco-geo.org/contact/',wait_until='networkidle')
 page.locator('input[name=name]').fill('PRIVATE-NAME-DO-NOT-COLLECT');page.locator('input[name=email]').fill('private-browser-test@example.com');page.locator('textarea[name=message]').fill('This private form message is not analytics data.')
 page.locator('form button[type=submit]').click();page.wait_for_timeout(1000)
 assert any(e['name']=='contact_success' for e in events);assert 'PRIVATE-NAME' not in json.dumps(events);assert 'private-browser-test' not in json.dumps(events);mark('Confirmed contact success without personal form data')
 page.goto('https://eco-geo.org/',wait_until='networkidle');page.locator('.eco-privacy-settings').click();page.get_by_role('button',name='仅必要',exact=True).click();page.wait_for_timeout(300);n=len(events);page.evaluate('window.scrollTo(0,document.body.scrollHeight)');page.wait_for_timeout(5200);assert len(events)==n;mark('Consent withdrawal stops transmission')
 page.keyboard.press('Alt+Shift+A');page.wait_for_url('**/observatory/');mark('Keyboard hidden entrance')
 mc=b.new_context(viewport={'width':390,'height':844},is_mobile=True);mc.route('**/*',route);m=mc.new_page();m.goto('https://eco-geo.org/observatory/',wait_until='networkidle');assert m.evaluate('document.documentElement.scrollWidth<=innerWidth');m.screenshot(path='browser-artifacts/login-mobile.png',full_page=True);mark('Mobile login without horizontal overflow')
 dc=b.new_context();dc.route('**/*',route);dc.add_init_script("Object.defineProperty(navigator,'globalPrivacyControl',{get:()=>true});localStorage.setItem('eco.analytics.consent.v1','yes')");n=len(events);d=dc.new_page();d.goto('https://eco-geo.org/',wait_until='networkidle');d.wait_for_timeout(5200);assert len(events)==n;mark('GPC overrides prior consent')
 assert not errors,errors;mark('No uncaught browser script errors');b.close()
Path('browser-artifacts/results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'events_observed':len(events),'note':'Network-mocked tests, not real site traffic or proof of backend deployment.'},ensure_ascii=False,indent=2))
