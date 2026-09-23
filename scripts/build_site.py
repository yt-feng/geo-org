#!/usr/bin/env python3
"""Deterministic, publish-only SEO/GEO pass. Never mutates editorial sources."""
from __future__ import annotations
import hashlib, html, json, re, shutil, struct
from collections import Counter
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from xml.etree import ElementTree as ET
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
SITE = 'https://eco-geo.org'
API = 'https://metrics.eco-geo.org'
LOCALES = {'zh-CN': '', 'en': 'en/', 'ar': 'ar/'}
DIRS = {'assets','blog','en','ar','about','editorial-policy','privacy','terms','contact','resources','brand-audit','package-advisor','jianong','observatory'}
EXTS = {'.html','.css','.js','.mjs','.json','.png','.svg','.jpg','.jpeg','.webp','.ico','.pdf','.woff','.woff2','.txt','.xml'}
HIDDEN = {'jianong','package-advisor','observatory'}
POST_FIELDS = {'order','row','slug','title','excerpt','category','tags','author','date','dateModified','image','url','reviewed_by'}
LABELS = {
 'zh-CN': {'home':'首页','blog':'前沿观点','page':'第 {n} 页','summary':'本文摘要','related':'继续阅读','toc':'文章目录','topics':'相关主题','all':'浏览全部文章','privacy':'访问统计与隐私选择'},
 'en': {'home':'Home','blog':'Insights','page':'Page {n}','summary':'Article summary','related':'Related reading','toc':'On this page','topics':'Related topics','all':'Browse all articles','privacy':'Analytics and privacy choices'},
 'ar': {'home':'الرئيسية','blog':'المقالات','page':'الصفحة {n}','summary':'ملخص المقال','related':'قراءة ذات صلة','toc':'في هذه الصفحة','topics':'مواضيع ذات صلة','all':'جميع المقالات','privacy':'التحليلات وخيارات الخصوصية'},
}
PRIVACY = {
 'zh-CN': '经你允许后，本站记录页面访问、来源站点、阅读深度、停留时长分档、按钮点击和表单成功状态。统计不记录姓名、邮箱、品牌输入、搜索原文、表单正文、完整来源网址或原始 IP。随机会话编号仅保存在当前标签页，闲置 30 分钟后更新；统计明细保留 90 天。Cloudflare 处理这些统计；后台仅授权管理员可读。你可随时在页脚撤回选择；开启 GPC 或 Do Not Track 时不采集。会话数不是跨设备独立人数，AI 来源仅代表可识别的引荐访问，不代表全部 AI 引用。',
 'en': 'With your permission, this site records page visits, referring domains, reading depth, active-time milestones, interaction IDs and confirmed form status. Analytics excludes names, emails, brand inputs, search terms, form text, full referrer URLs and raw IP addresses. A random per-tab session ID rotates after 30 minutes of inactivity; event records are retained for 90 days in Cloudflare. Only authorized administrators can read the dashboard. Withdraw permission using the footer control. GPC and Do Not Track disable collection. Sessions are not cross-device unique people; identified AI referrals are not total AI citations.',
 'ar': 'بعد موافقتك نسجل زيارات الصفحات ونطاقات الإحالة وعمق القراءة ومراحل الوقت النشط ومعرفات التفاعل وحالة إرسال النموذج المؤكدة. لا تسجل التحليلات الأسماء أو البريد أو مدخلات العلامة أو نصوص البحث والنماذج أو عناوين الإحالة الكاملة أو عنوان IP الخام. يتغير معرف الجلسة العشوائي الخاص بعلامة التبويب بعد 30 دقيقة من الخمول، وتُحفظ الأحداث لدى Cloudflare لمدة 90 يوماً. لوحة البيانات متاحة للمسؤول المخول فقط. يمكنك سحب الموافقة من تذييل الصفحة. يمنع GPC وDo Not Track الجمع. الجلسات ليست أشخاصاً فريدين عبر الأجهزة، والإحالات المعروفة من الذكاء الاصطناعي لا تمثل جميع الاقتباسات.'
}

def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')

def canonical(rel):
    p = '/' + rel.as_posix()
    return SITE + (p[:-10] if p.endswith('index.html') else p)

def language(rel):
    return 'en' if rel.parts[0] == 'en' else 'ar' if rel.parts[0] == 'ar' else 'zh-CN'

def unlisted(rel, soup):
    parts = rel.parts[1:] if rel.parts[0] in {'en','ar'} else rel.parts
    return parts[0] in HIDDEN or rel.name == '404.html' or any(re.search(r'\b(noindex|none)\b', x.get('content',''),re.I) for x in soup.select('meta[name=robots],meta[name=googlebot],meta[name=bingbot]'))

def meta(soup, name, value, prop=False):
    key = 'property' if prop else 'name'
    for t in soup.head.find_all('meta', attrs={key:name}): t.decompose()
    tag = soup.new_tag('meta', attrs={key:name,'content':str(value)}); soup.head.append(tag)

def add_json(soup, value, ident):
    tag = soup.new_tag('script',attrs={'type':'application/ld+json','id':ident});tag.string=dumps(value);soup.head.append(tag)

def append_fragment(parent, fragment):
    for el in list(BeautifulSoup(fragment,'html.parser').contents): parent.append(el)

def normalized_posts(root):
    out = {}
    for lang,prefix in LOCALES.items():
        path = root / prefix / 'blog/posts.json'
        ps = json.loads(path.read_text()) if path.exists() else []
        out[lang] = [p for p in ps if re.fullmatch(r'[a-zA-Z0-9_-]+',str(p.get('slug',''))) and (root/prefix/'blog/articles'/p['slug']/'index.html').is_file()]
    return out

def cards(posts, prefix, heading):
    parts=[f'<section class="eco-discovery"><h2>{html.escape(heading)}</h2><div class="eco-cards">']
    for p in posts:
        href=f"/{prefix}blog/articles/{p['slug']}/"
        parts.append(f'<article><small>{html.escape(str(p.get("date","")))}</small><h3><a href="{href}">{html.escape(p["title"])}</a></h3><p>{html.escape(p.get("excerpt", "")[:180])}</p></article>')
    return ''.join(parts)+'</div></section>'

def optimize(root, rel, posts, title_counts, paths):
    path=root/rel; raw=path.read_text(encoding='utf-8');s=BeautifulSoup(raw,'html.parser')
    if not s.head or not s.body: return None
    lang=language(rel);prefix=LOCALES[lang];labels=LABELS[lang];hidden=unlisted(rel,s);url=canonical(rel)
    if rel.parts[0] == 'jianong': return None  # Separate checkout domain and security boundary.
    is_article='articles' in rel.parts
    post=next((p for p in posts[lang] if p['slug']==rel.parent.name),None) if is_article else None
    title=s.title.get_text(' ',strip=True) if s.title else (s.h1.get_text(' ',strip=True) if s.h1 else 'Eco GEO')
    desc_tag=s.find('meta',attrs={'name':'description'});desc=desc_tag.get('content','') if desc_tag else ''
    if rel.as_posix()==prefix+'privacy/index.html':desc=PRIVACY[lang]
    if not desc: desc=post.get('excerpt','') if post else (s.select_one('.lead').get_text(' ',strip=True) if s.select_one('.lead') else title)
    listing=rel.as_posix()==f'{prefix}blog/index.html' or bool(re.fullmatch(re.escape(prefix)+r'blog/page/\d+/index.html',rel.as_posix()))
    page=int(rel.parts[-2]) if listing and 'page' in rel.parts else 1
    if rel.as_posix()==prefix+'index.html':
        title={'zh-CN':'Eco GEO｜品牌认知与生成式搜索优化咨询','en':'Eco GEO | Brand-first GEO Consulting','ar':'Eco GEO | استشارات تحسين الظهور في محركات الذكاء الاصطناعي'}[lang]
    if listing:
        title=f'Eco GEO {labels["blog"]} · {labels["page"].format(n=page)}'
        desc=f'{title} — '+ '; '.join(p['title'] for p in posts[lang][(page-1)*24:page*24][:3])
    elif title_counts[title]>1 and post:
        suffix=post.get('category') or post.get('date') or post['slug']
        title=f'{title} · {suffix} · {post["slug"].split("-")[0]}'
    if s.title: s.title.string=title
    else:
        t=s.new_tag('title');t.string=title;s.head.append(t)
    meta(s,'description',desc[:190] if lang!='zh-CN' else desc[:155])
    for t in s.select('link[rel=canonical],link[hreflang],meta[property^="og:"],meta[name^="twitter:"]'):t.decompose()
    s.head.append(s.new_tag('link',rel='canonical',href=url))
    meta(s,'robots','noindex, nofollow, noarchive' if hidden else 'index, follow, max-image-preview:large')
    if not hidden:
        base=rel.as_posix()[len(prefix):];variants=[]
        for code,pre in LOCALES.items():
            other=Path(pre+base)
            if other in paths:
                variants.append((code,canonical(other)));s.head.append(s.new_tag('link',rel='alternate',hreflang=code,href=canonical(other)))
        default=next((u for code,u in variants if code=='zh-CN'),url)
        s.head.append(s.new_tag('link',rel='alternate',hreflang='x-default',href=default))
    image=post.get('image') if post else SITE+'/assets/social-card.png'
    if not image or not urlsplit(image).scheme in {'https','http'}:image=SITE+'/assets/social-card.png'
    for key,value in {'og:type':'article' if is_article else 'website','og:title':title,'og:description':desc[:220],'og:url':url,'og:site_name':'Eco GEO','og:locale':{'zh-CN':'zh_CN','en':'en_US','ar':'ar_AR'}[lang],'og:image':image,'og:image:alt':title}.items():meta(s,key,value,True)
    for key,value in {'twitter:card':'summary_large_image','twitter:title':title,'twitter:description':desc[:200],'twitter:image':image}.items():meta(s,key,value)
    if not post:
        meta(s,'og:image:width','1200',True);meta(s,'og:image:height','630',True)
    # Existing Article/FAQ data is retained; extend rather than overwrite source claims.
    for tag in s.select('script[type="application/ld+json"]'):
        try: data=json.loads(tag.string or tag.get_text())
        except (ValueError,TypeError):continue
        nodes=data.get('@graph',[data]) if isinstance(data,dict) else data if isinstance(data,list) else []
        for n in nodes:
            if not isinstance(n,dict):continue
            if n.get('@type') in {'Article','BlogPosting','NewsArticle'}:
                n['@id']=url+'#article';n['mainEntityOfPage']={'@id':url+'#webpage'};n['inLanguage']=lang
                if not n.get('image'):n['image']=image
                if post:
                    citations=[]
                    for source in post.get('sources',[]):
                        u=source.get('url','')
                        if urlsplit(u).scheme=='https' and any(a.get('href')==u for a in s.select('a[href]')):citations.append(u)
                    if citations:n['citation']=list(dict.fromkeys(citations))
        tag.string=dumps(data)
    if not hidden:
        crumbs=[{'@type':'ListItem','position':1,'name':labels['home'],'item':SITE+'/'+prefix}]
        if rel.as_posix()!=prefix+'index.html':
            if is_article:crumbs.append({'@type':'ListItem','position':2,'name':labels['blog'],'item':SITE+'/'+prefix+'blog/'})
            crumbs.append({'@type':'ListItem','position':len(crumbs)+1,'name':s.h1.get_text(' ',strip=True) if s.h1 else title,'item':url})
        graph=[{'@type':'WebSite','@id':SITE+'/#website','url':SITE+'/','name':'Eco GEO','publisher':{'@id':SITE+'/#organization'}}, {'@type':'BreadcrumbList','@id':url+'#breadcrumb','itemListElement':crumbs}]
        if is_article:graph.append({'@type':'WebPage','@id':url+'#webpage','url':url,'name':title,'inLanguage':lang,'isPartOf':{'@id':SITE+'/#website'},'breadcrumb':{'@id':url+'#breadcrumb'}})
        add_json(s,{'@context':'https://schema.org','@graph':graph},'eco-discovery-schema')
        if listing:
            items=posts[lang][(page-1)*24:page*24]
            add_json(s,{'@context':'https://schema.org','@type':'CollectionPage','url':url,'mainEntity':{'@type':'ItemList','itemListElement':[{'@type':'ListItem','position':(page-1)*24+i+1,'url':SITE+'/'+prefix+'blog/articles/'+p['slug']+'/','name':p['title']} for i,p in enumerate(items)]}},'eco-list-schema')
            grid=s.select_one('#postGrid') or s.select_one('section.grid')
            if grid:
                grid.clear()
                for p in items:
                    picture=f'<img src="{html.escape(p.get("image", ""), quote=True)}" alt="{html.escape(p["title"], quote=True)}" loading="lazy" decoding="async"/>' if p.get('image') else ''
                    append_fragment(grid,f'<a class="card" href="/{prefix}blog/articles/{p["slug"]}/">{picture}<div class="card-body"><div class="meta"><span>{html.escape(p.get("category", ""))}</span><time>{html.escape(p.get("date", ""))}</time></div><h2>{html.escape(p["title"])}</h2><p>{html.escape(p.get("excerpt", "")[:180])}</p></div></a>')
                grid.attrs.pop('hidden',None)
                if s.select_one('#loading'):s.select_one('#loading')['hidden']=''
            for old in s.select('.pager:not([id])'):old.decompose()
            pager=s.new_tag('nav',attrs={'class':'eco-pagination','aria-label':labels['blog']})
            for n in range(1,(len(posts[lang])+23)//24+1):
                href=f'/{prefix}blog/' if n==1 else f'/{prefix}blog/page/{n}/'
                a=s.new_tag('a',href=href);a.string=str(n)
                if n==page:a['aria-current']='page'
                pager.append(a)
            (s.main or s.body).append(pager)
        if rel.as_posix()==prefix+'index.html':
            append_fragment(s.main or s.body,cards(posts[lang][:6],prefix,labels['related']))
        if is_article and post:
            article=s.article or s.main
            if article:
                h1=article.h1 or s.h1
                if h1 and not s.select_one('[data-role="executive-summary"],.executive-summary'):
                    summary=s.new_tag('aside',attrs={'class':'eco-summary'});append_fragment(summary,f'<strong>{labels["summary"]}</strong><p>{html.escape(post.get("excerpt", ""))}</p>');h1.insert_after(summary)
                headings=article.find_all('h2')
                if len(headings)>=3:
                    toc=s.new_tag('nav',attrs={'class':'eco-toc','aria-label':labels['toc']});strong=s.new_tag('strong');strong.string=labels['toc'];toc.append(strong)
                    for i,h in enumerate(headings):
                        if not h.get('id'):h['id']='section-'+str(i+1)
                        a=s.new_tag('a',href='#'+h['id']);a.string=h.get_text(' ',strip=True);toc.append(a)
                    if h1:h1.insert_after(toc)
                pool=[p for p in posts[lang] if p['slug']!=post['slug']]
                tags=set(re.split(r'[,，]',post.get('tags','')))
                pool.sort(key=lambda p:(p.get('category')==post.get('category'),len(tags&set(re.split(r'[,，]',p.get('tags','')))),p.get('date','')),reverse=True)
                append_fragment(article,cards(pool[:4],prefix,labels['related']))
                append_fragment(article,f'<p class="eco-topic-links">{labels["topics"]}: <a href="/{prefix}resources/brand-geo/">Brand GEO</a> · <a href="/{prefix}resources/aibe/">AIBE</a> · <a href="/{prefix}resources/ai-search-visibility/">AI Search</a></p>')
    for img in s.find_all('img'):
        img['decoding']='async';src=img.get('src','');dims=None
        local=root/urlsplit(urljoin(url,src)).path.lstrip('/')
        if local.is_file() and local.suffix=='.svg':
            try:
                svg=ET.fromstring(local.read_text());v=[float(x) for x in svg.get('viewBox','').split()];dims=(round(v[2]),round(v[3])) if len(v)==4 else None
            except (ValueError,ET.ParseError):pass
        elif local.is_file() and local.suffix=='.png':
            try:dims=struct.unpack('>II',local.read_bytes()[16:24])
            except struct.error:pass
        if dims:
            img['width']=img.get('width') or str(dims[0]);img['height']=img.get('height') or str(dims[1])
        if 'cover' in img.get('class',[]):
            img['loading']='eager';img['fetchpriority']='high'
        elif img.find_parent(['article','main']) and 'logo' not in src:img['loading']=img.get('loading') or 'lazy'
    if is_article and s.select_one('img.cover'):
        src=s.select_one('img.cover').get('src','')
        s.head.append(s.new_tag('link',rel='preconnect',href='https://images.unsplash.com'))
    # Normalize existing internal links to actual canonical files, preserving query/fragment.
    for a in s.select('a[href]'):
        href=a.get('href','')
        if not href or href.startswith('#'):continue
        target=urlsplit(urljoin(url,href))
        if target.netloc not in {'eco-geo.org','www.eco-geo.org'} or target.scheme not in {'http','https'}:continue
        target_path=target.path
        resolved=Path(target_path.lstrip('/')+('index.html' if target_path.endswith('/') else ''))
        if resolved in paths:
            target_path='/'+resolved.as_posix().removesuffix('index.html')
            a['href']=target_path+('?' + target.query if target.query else '')+('#'+target.fragment if target.fragment else '')
    # Stable IDs are assigned from source elements; never from entered text.
    for i,el in enumerate(s.select('a,button,form,select,section')):el['data-eco-id']=el.get('id') or f'{el.name}-{i}'
    if 'observatory' not in rel.parts:
        for t in s.select('script[src="/assets/analytics.js"],link[href="/assets/analytics.css"]'):t.decompose()
        s.head.append(s.new_tag('link',rel='stylesheet',href='/assets/analytics.css'))
        s.head.append(s.new_tag('script',src='/assets/analytics.js',defer='',attrs={'data-endpoint':API}))
    if rel.as_posix()==prefix+'privacy/index.html':
        lead=s.select_one('.lead')
        if lead:lead.string={'zh-CN':'本页说明主动提交的信息、可选访问统计，以及你的隐私选择。','en':'How we handle submitted information, optional analytics and your privacy choices.','ar':'كيفية معالجة المعلومات المقدمة والتحليلات الاختيارية وخيارات الخصوصية.'}[lang]
        append_fragment(s.main or s.body,f'<section><h2>{labels["privacy"]}</h2><p>{PRIVACY[lang]}</p><button type="button" data-eco-consent-settings>Privacy settings / 隐私设置</button></section>')
    result=str(s)
    if 'contact' in rel.parts:
        result=result.replace("show(messages.success, 'success');", "show(messages.success, 'success'); window.dispatchEvent(new CustomEvent('eco:conversion', {detail:{name:'contact_success'}}));")
    if 'brand-audit' in rel.parts:
        result=result.replace('result.hidden = false;', "result.hidden = false; window.dispatchEvent(new CustomEvent('eco:conversion', {detail:{name:'audit_complete'}}));")
    path.write_text(result,encoding='utf-8')
    return {'path':rel.as_posix(),'url':url,'indexable':not hidden,'lang':lang,'article':is_article,'title':title,'date':post.get('dateModified') or post.get('date') if post else None}

def build(root=ROOT, output=None):
    root=Path(root);output=Path(output or root/'_site')
    if output.exists():shutil.rmtree(output)
    output.mkdir(parents=True)
    for p in sorted(root.rglob('*')):
        if not p.is_file():continue
        rel=p.relative_to(root)
        if any(part.startswith('.') for part in rel.parts) and rel.as_posix()!='.nojekyll':continue
        if (len(rel.parts)==1 and (p.suffix in {'.html','.svg'} or p.name in {'CNAME','.nojekyll'})) or (rel.parts[0] in DIRS and p.suffix.lower() in EXTS):
            target=output/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    posts=normalized_posts(root)
    # Complete multilingual static pagination, without translating or inventing content.
    for lang,prefix in LOCALES.items():
        template=output/prefix/'blog/index.html'
        if not template.is_file():continue
        for n in range(2,(len(posts[lang])+23)//24+1):
            page=output/prefix/f'blog/page/{n}/index.html'
            if page.is_file():continue
            s=BeautifulSoup(template.read_text(),'html.parser')
            for t in s.select('[href],[src]'):
                for attr in ['href','src']:
                    u=t.get(attr,'')
                    if u and not u.startswith(('#','/','http:','https:','data:','mailto:','tel:')):t[attr]=urlsplit(urljoin(SITE+'/'+prefix+'blog/',u)).path
            # New pagination is static; do not fetch a relative posts.json and reset to page 1.
            for script in s.find_all('script'):
                if script.get('type')!='application/ld+json':script.decompose()
            page.parent.mkdir(parents=True,exist_ok=True);page.write_text(str(s))
    paths={p.relative_to(output) for p in output.rglob('*.html')}
    counts=Counter()
    for rel in paths:
        s=BeautifulSoup((output/rel).read_text(),'html.parser')
        if s.title:counts[s.title.get_text(' ',strip=True)]+=1
    report=[r for rel in sorted(paths) if (r:=optimize(output,rel,posts,counts,paths))]
    # Strip internal editorial diagnostics from the publicly delivered list data.
    for lang,prefix in LOCALES.items():
        (output/prefix/'blog/posts.json').write_text(dumps([{k:v for k,v in p.items() if k in POST_FIELDS} for p in posts[lang]]))
    advisor=output/'package-advisor/app.mjs'
    if advisor.is_file():
        text=advisor.read_text().replace("renderRecommendation(result, 'result');", "renderRecommendation(result, 'result'); window.dispatchEvent(new CustomEvent('eco:conversion',{detail:{name:result.source==='deepseek'?'advisor_success':'advisor_fallback'}}));")
        text=text.replace('anchor.click(); anchor.remove();',"anchor.click(); anchor.remove(); window.dispatchEvent(new CustomEvent('eco:conversion',{detail:{name:'proposal_download'}}));")
        advisor.write_text(text)
    indexable=[r for r in report if r['indexable']]
    ns='http://www.sitemaps.org/schemas/sitemap/0.9';ET.register_namespace('',ns);tree=ET.Element('{'+ns+'}urlset')
    for r in indexable:
        e=ET.SubElement(tree,'{'+ns+'}url');ET.SubElement(e,'{'+ns+'}loc').text=r['url']
        if r['date'] and re.fullmatch(r'\d{4}-\d{2}-\d{2}',r['date']):ET.SubElement(e,'{'+ns+'}lastmod').text=r['date']
    ET.ElementTree(tree).write(output/'sitemap.xml',encoding='utf-8',xml_declaration=True)
    (output/'robots.txt').write_text('User-agent: *\nAllow: /\nDisallow: /jianong/\nDisallow: /package-advisor/\n\nSitemap: '+SITE+'/sitemap.xml\n# Admin pages use noindex and authenticated APIs, not robots.txt secrecy.\n')
    # Navigation aids, not a promise of AI ranking or model ingestion.
    links=['# Eco GEO','', '> Brand-first GEO consulting and research. AIBE and KNIT are Eco GEO frameworks, not platform ranking standards.','', '## Identity and standards']
    for slug in ['about','editorial-policy','contact']:
        links.append(f'- [{slug}]({SITE}/{slug}/)')
    links+=['','## Topic guides']+[f'- [{slug}]({SITE}/resources/{slug}/)' for slug in ['brand-geo','aibe','ai-search-visibility']]
    links+=['','## Languages']+[f'- [{lang}]({SITE}/{prefix}blog/)' for lang,prefix in LOCALES.items()]
    links+=['','## Latest research']+[f'- [{p["title"]}]({SITE}/blog/articles/{p["slug"]}/): {p.get("excerpt", "")[:180]}' for p in posts['zh-CN'][:15]]
    (output/'llms.txt').write_text('\n'.join(links)+'\n')
    # Private machine-readable audit is kept outside deployment output.
    summary={'html_pages':len(report),'indexable_pages':len(indexable),'articles':sum(r['article'] for r in report),'languages':{k:len(v) for k,v in posts.items()},'duplicate_titles':[t for t,n in Counter(r['title'] for r in indexable).items() if n>1]}
    (root/'site-build-report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False))
    return summary

if __name__=='__main__':build()
