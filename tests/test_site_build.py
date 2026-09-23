"""Deployment quality gates: validate generated HTML, not source-only assumptions."""
import json,re,unittest
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET
from urllib.parse import urlsplit
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'_site'
class BuildTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  if not OUT.exists():raise RuntimeError('Run python scripts/build_site.py first')
  cls.pages={str(p.relative_to(OUT)):BeautifulSoup(p.read_text(),'html.parser') for p in OUT.rglob('*.html') if 'jianong' not in p.relative_to(OUT).parts}
  cls.report=json.loads((ROOT/'site-build-report.json').read_text())
 def test_all_page_metadata(self):
  for path,s in self.pages.items():
   with self.subTest(page=path):
    self.assertEqual(len(s.select('title')),1)
    self.assertEqual(len(s.select('link[rel=canonical]')),1)
    self.assertEqual(len(s.select('meta[name=description]')),1)
    self.assertTrue(s.select_one('meta[name=description]')['content'])
    self.assertEqual(s.select_one('link[rel=canonical]')['href'],'https://eco-geo.org/'+path.removesuffix('index.html'))
    for tag in s.select('script[type="application/ld+json"]'):json.loads(tag.string or tag.get_text())
 def test_unique_indexable_titles_and_complete_articles(self):
  self.assertEqual(self.report['duplicate_titles'],[])
  self.assertEqual(self.report['articles'],sum(len(json.loads((ROOT/p/'blog/posts.json').read_text())) for p in ['', 'en','ar']))
 def test_hreflang_targets_exist_and_reciprocate(self):
  for path,s in self.pages.items():
   me=s.select_one('link[rel=canonical]')['href']
   for link in s.select('link[hreflang]'):
    target=urlsplit(link['href']).path.lstrip('/')+'index.html'
    self.assertIn(target,self.pages,(path,target))
    self.assertIn(me,[x['href'] for x in self.pages[target].select('link[hreflang]')],(path,target))
 def test_sitemap_excludes_private_pages_and_has_no_missing_urls(self):
  urls=[e.text for e in ET.parse(OUT/'sitemap.xml').findall('.//{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
  self.assertEqual(len(urls),len(set(urls)))
  self.assertEqual(len(urls),self.report['indexable_pages'])
  for url in urls:
   self.assertNotRegex(url,r'/(observatory|jianong|package-advisor)/|404\.html')
   rel=urlsplit(url).path.lstrip('/')+'index.html'
   self.assertTrue((OUT/rel).is_file(),url)
   self.assertNotIn('noindex',self.pages[rel].select_one('meta[name=robots]')['content'])
 def test_static_lists_without_javascript(self):
  for prefix,count in self.report['languages'].items():
   p='' if prefix=='zh-CN' else prefix+'/'
   s=self.pages[p+'blog/index.html'];self.assertGreaterEqual(len(s.select('#postGrid a[href]')),24)
   for a in s.select('.eco-pagination a'):self.assertTrue((OUT/a['href'].lstrip('/')/'index.html').exists())
   for n in range(2,(count+23)//24+1):
    page=self.pages[p+f'blog/page/{n}/index.html'];self.assertTrue(page.select('.eco-pagination a[aria-current=page]'))
    self.assertGreater(len(page.select('a[href*="/blog/articles/"]')),0)
 def test_tracker_coverage_and_source_exclusion(self):
  for path,s in self.pages.items():
   expected=0 if path.startswith('observatory/') else 1
   self.assertEqual(len(s.select('script[src="/assets/analytics.js"]')),expected,path)
  for name in ['scripts','tests','analytics-service','advisor-service','contact-service','.github','ARCHITECTURE.md','requirements.txt','vercel.json','site-build-report.json']:
   self.assertFalse((OUT/name).exists(),name)
  for prefix in ['', 'en/','ar/']:
   for p in json.loads((OUT/prefix/'blog/posts.json').read_text()):
    self.assertNotIn('quality',p);self.assertNotIn('sources',p)
 def test_hidden_dashboard_contains_no_password_or_client_auth(self):
  s=self.pages['observatory/index.html'];self.assertIn('noindex',s.select_one('meta[name=robots]')['content'])
  self.assertTrue(s.select_one('#dashboard').has_attr('hidden'))
  self.assertEqual(s.select_one('#pin')['type'],'password')
  js=(OUT/'observatory/app.js').read_text();self.assertNotIn('localStorage',js)
  self.assertNotRegex(js,r'pin\s*={2,3}')
  for path in ['assets/analytics.js','observatory/app.js','observatory/index.html']:
   self.assertNotIn('ANALYTICS_PIN',(OUT/path).read_text())
 def test_real_success_hooks_and_privacy(self):
  for prefix in ['', 'en/','ar/']:
   contact=(OUT/prefix/'contact/index.html').read_text()
   self.assertIn("name:'contact_success'",contact)
   self.assertIn('result.requestId',contact)
   privacy=self.pages[prefix+'privacy/index.html']
   self.assertIn('90',privacy.get_text())
  self.assertIn("name:result.source==='deepseek'",(OUT/'package-advisor/app.mjs').read_text())
  self.assertIn("name:'proposal_download'",(OUT/'package-advisor/app.mjs').read_text())
 def test_article_discovery_and_schema(self):
  for path,s in self.pages.items():
   if '/articles/' not in path:continue
   self.assertEqual(s.select_one('meta[property="og:type"]')['content'],'article')
   self.assertTrue(s.select_one('.eco-discovery'),path)
   self.assertTrue(s.select_one('#eco-discovery-schema'),path)
   for a in s.select('.eco-topic-links a'):self.assertTrue((OUT/a['href'].lstrip('/')/'index.html').exists(),a['href'])
if __name__=='__main__':unittest.main()
