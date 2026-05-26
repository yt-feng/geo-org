#!/usr/bin/env python3
"""Write an enhanced client-side Blog index.

The page reads blog/posts.json at runtime and provides category filters,
search, stable image rendering, pagination, and jump-to-page controls.
"""
from pathlib import Path

import i18n_site

HTML = r'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Eco GEO 前沿观点｜品牌化 GEO 与 AI 搜索洞察</title>
  <meta name="description" content="Eco GEO 前沿观点：品牌化 GEO、白帽 GEO、AIBE、KNIT 与 AI 搜索优化文章库。" />
  <link rel="icon" href="../logo.svg" type="image/svg+xml" />
  <link rel="canonical" href="https://eco-geo.org/blog/" />
  <script id="schema-page" type="application/ld+json">{"@context":"https://schema.org","@type":"Blog","name":"Eco GEO 前沿观点","url":"https://eco-geo.org/blog/","description":"Eco GEO 前沿观点：品牌化 GEO、白帽 GEO、AIBE、KNIT 与 AI 搜索优化文章库。","publisher":{"@type":"Organization","name":"Eco GEO","url":"https://eco-geo.org/","logo":"https://eco-geo.org/logo.svg"}}</script>
  <style>
    :root{--bg:#07110d;--panel:rgba(255,255,255,.075);--panel2:rgba(255,255,255,.12);--text:#f5f8f4;--muted:#b8c7bc;--line:rgba(255,255,255,.15);--green:#8ce99a;--blue:#80c7ff;--gold:#ffd166;--shadow:0 26px 80px rgba(0,0,0,.32)}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;padding-bottom:78px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Arial,sans-serif;color:var(--text);background:radial-gradient(circle at 10% 0%,rgba(34,150,123,.30),transparent 34rem),radial-gradient(circle at 90% 10%,rgba(128,199,255,.12),transparent 28rem),linear-gradient(135deg,#050806,var(--bg),#101a13);line-height:1.72}a{color:inherit}.wrap{width:min(1180px,calc(100% - 42px));margin:auto}.site-header{position:sticky;top:0;z-index:40;background:rgba(7,17,13,.86);backdrop-filter:blur(18px);border-bottom:1px solid var(--line)}.site-nav{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 0}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;font-weight:900;letter-spacing:.08em}.brand img{width:46px;height:34px;object-fit:contain;border-radius:10px;background:rgba(255,255,255,.94);padding:3px}.brand small{display:block;letter-spacing:.02em;color:var(--muted);font-weight:700;font-size:11px;margin-top:-4px}.site-links{display:flex;align-items:center;gap:16px;color:var(--muted);font-size:14px}.site-links a{text-decoration:none;white-space:nowrap}.site-links a:hover{color:var(--text)}.site-links .nav-cta{border:1px solid var(--line);border-radius:999px;padding:8px 12px;color:var(--text);background:rgba(255,255,255,.08);font-weight:900}/* I18N_CSS */.hero{padding:70px 0 26px}.eyebrow{color:var(--green);font-weight:900;font-size:13px;letter-spacing:.18em;text-transform:uppercase}.hero h1{font-size:clamp(42px,7vw,84px);line-height:1;letter-spacing:-.065em;margin:16px 0 18px}.lead{font-size:clamp(18px,2vw,23px);color:var(--muted);max-width:860px;margin:0}.tools{display:grid;grid-template-columns:1.25fr .8fr;gap:14px;margin:34px 0 18px}.searchbox,.selectbox{border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.08);display:flex;align-items:center;gap:10px;padding:12px 14px}.searchbox input,.selectbox select{width:100%;border:0;background:transparent;color:var(--text);outline:none;font-size:16px}.selectbox select option{background:#07110d;color:var(--text)}.summary{display:flex;flex-wrap:wrap;align-items:center;gap:10px;color:var(--muted);font-size:14px;margin:0 0 18px}.pill{border:1px solid var(--line);border-radius:999px;padding:7px 10px;background:rgba(255,255,255,.055)}.categories{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 22px}.cat{border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.06);color:var(--muted);padding:8px 12px;cursor:pointer;font-weight:800}.cat.active{background:var(--text);color:#07110d;border-color:var(--text)}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:14px 0 40px}.card{border:1px solid var(--line);border-radius:28px;background:var(--panel);box-shadow:var(--shadow);overflow:hidden;text-decoration:none;display:flex;flex-direction:column;min-width:0}.thumb{position:relative;aspect-ratio:16/9;background:linear-gradient(135deg,rgba(140,233,154,.22),rgba(128,199,255,.10));overflow:hidden}.thumb img{width:100%;height:100%;object-fit:cover;display:block;filter:saturate(.9) contrast(.95)}.thumb:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent,rgba(0,0,0,.25))}.card-body{padding:20px}.meta{display:flex;gap:10px;flex-wrap:wrap;color:var(--green);font-size:13px;font-weight:900;margin-bottom:12px}.card h2{font-size:22px;line-height:1.28;margin:0 0 10px;letter-spacing:-.02em}.card p{color:var(--muted);margin:0;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.empty{display:none;border:1px solid var(--line);border-radius:28px;background:var(--panel);padding:28px;color:var(--muted);margin:24px 0}.pager{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:12px 0 70px}.pager button,.pager input{border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--text);padding:10px 14px;font-weight:900}.pager button{cursor:pointer}.pager button:disabled{opacity:.4;cursor:not-allowed}.pager input{width:92px;text-align:center}.page-info{color:var(--muted);font-weight:800}.loading{padding:60px 0 100px;color:var(--muted);font-size:18px}.site-footer{border-top:1px solid var(--line);padding:28px 0 42px;color:var(--muted)}.bottom-cta{position:fixed;left:0;right:0;bottom:0;z-index:45;background:rgba(7,17,13,.91);backdrop-filter:blur(18px);border-top:1px solid var(--line)}.bottom-cta-inner{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0}.bottom-cta-text{display:flex;align-items:baseline;gap:10px;color:var(--muted);min-width:0}.bottom-cta-text strong{color:var(--text)}.bottom-cta-text span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bottom-cta a{flex:0 0 auto;text-decoration:none;border-radius:999px;padding:9px 13px;background:var(--text);color:#07110d;font-weight:900}@media(max-width:980px){.grid{grid-template-columns:repeat(2,1fr)}.tools{grid-template-columns:1fr}}@media(max-width:680px){.grid{grid-template-columns:1fr}.site-links{display:flex}.site-links a:not(.nav-cta){display:none}.hero{padding-top:46px}.wrap{width:min(100% - 28px,1180px)}.bottom-cta-text span{display:none}}
  </style>
</head>
<body>
  <header class="top site-header"><nav class="wrap site-nav"><a class="brand site-brand" href="../index.html#top"><img src="../logo.svg" alt="Eco GEO logo"/><span>ECO GEO<small>Brand-first GEO</small></span></a><div class="links navlinks site-links"><a href="../index.html#why">为什么</a><a href="../index.html#method">方法</a><a href="../brand-audit/">品牌评测</a><a href="../index.html#credentials">服务品牌</a><a class="nav-cta nav-insights" href="./">前沿观点</a><a class="nav-cta" href="../contact/">联系</a></div><!-- I18N_SWITCHER --></nav></header>
  <main class="wrap">
    <section class="hero">
      <div class="eyebrow">Insights Library</div>
      <h1>Eco GEO 前沿观点</h1>
      <p class="lead">围绕品牌化 GEO、白帽 GEO、AIBE、KNIT 与 AI 搜索的文章库。支持分类筛选、关键词搜索和页码跳转。</p>
      <div class="tools">
        <label class="searchbox" aria-label="搜索文章"><span>🔎</span><input id="searchInput" type="search" placeholder="搜索标题、摘要、作者、标签..." autocomplete="off" /></label>
        <label class="selectbox" aria-label="选择分类"><span>📂</span><select id="categorySelect"><option value="">全部分类</option></select></label>
      </div>
      <div class="summary"><span class="pill" id="countText">加载中...</span><span class="pill" id="activeText">全部文章</span></div>
      <div class="categories" id="categoryChips"></div>
    </section>
    <div class="loading" id="loading">正在加载前沿观点文章...</div>
    <section class="grid" id="postGrid" aria-live="polite"></section>
    <div class="empty" id="emptyState">没有找到匹配文章。试试清空搜索词或切换分类。</div>
    <div class="pager" id="pager" style="display:none"><button id="prevBtn">上一页</button><span class="page-info" id="pageInfo"></span><button id="nextBtn">下一页</button><input id="pageInput" type="number" min="1" value="1"/><button id="jumpBtn">跳转</button></div>
  </main>
  <div class="bottom-cta" role="region" aria-label="Eco GEO contact"><div class="wrap bottom-cta-inner"><div class="bottom-cta-text"><strong>AIBE 初诊</strong><span>检查你的品牌在 AI 答案里的可见度与引用风险</span></div><a href="mailto:yt.feng@foxmail.com?subject=Eco%20GEO%20AIBE%20诊断咨询">邮件咨询</a></div></div>
  <footer class="footer site-footer"><div class="wrap">© 2026 Eco GEO · Brand-first GEO · <a href="../index.html">首页</a> · <a href="./">前沿观点</a> · <a href="../about/">关于</a> · <a href="../editorial-policy/">编辑政策</a> · <a href="../privacy/">隐私</a> · <a href="../terms/">条款</a> · <a href="../contact/">联系</a></div></footer>
  <script>
    const PAGE_SIZE = 24;
    const IMAGE_POOL = [
      'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=1200&q=80'
    ];
    const state = { posts: [], filtered: [], page: 1, category: '', query: '' };
    const el = id => document.getElementById(id);
    const params = new URLSearchParams(location.search);
    state.category = params.get('category') || '';
    state.query = params.get('q') || '';
    state.page = Math.max(1, parseInt(params.get('page') || '1', 10));

    function safeText(v){ return (v || '').toString(); }
    function hashText(s){ let h = 0; for(const ch of safeText(s)) h = ((h << 5) - h + ch.charCodeAt(0)) | 0; return Math.abs(h); }
    function imageFor(post, index){ return IMAGE_POOL[hashText(post.slug || post.title || index) % IMAGE_POOL.length]; }
    function normalizePost(post, index){ return {...post, _index:index, category:safeText(post.category)||'未分类', title:safeText(post.title), excerpt:safeText(post.excerpt), author:safeText(post.author)||'Eco GEO Editorial Team', tags:safeText(post.tags), slug:safeText(post.slug)}; }
    function updateUrl(){ const p = new URLSearchParams(); if(state.query) p.set('q', state.query); if(state.category) p.set('category', state.category); if(state.page > 1) p.set('page', state.page); history.replaceState(null, '', p.toString() ? '?' + p.toString() : location.pathname); }
    function buildCategories(){ const counts = new Map(); state.posts.forEach(p => counts.set(p.category, (counts.get(p.category)||0)+1)); const sorted = [...counts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0], 'zh-CN')); el('categorySelect').innerHTML = '<option value="">全部分类</option>' + sorted.map(([c,n]) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}（${n}）</option>`).join(''); el('categorySelect').value = state.category; el('categoryChips').innerHTML = `<button class="cat ${state.category?'':'active'}" data-cat="">全部</button>` + sorted.slice(0,18).map(([c,n]) => `<button class="cat ${state.category===c?'active':''}" data-cat="${escapeAttr(c)}">${escapeHtml(c)} ${n}</button>`).join(''); }
    function applyFilters(resetPage=false){ if(resetPage) state.page = 1; const q = state.query.trim().toLowerCase(); state.filtered = state.posts.filter(p => { const catOk = !state.category || p.category === state.category; const hay = `${p.title} ${p.excerpt} ${p.author} ${p.tags} ${p.category} ${p.date}`.toLowerCase(); return catOk && (!q || hay.includes(q)); }); const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE)); state.page = Math.min(Math.max(1,state.page), totalPages); render(); updateUrl(); }
    function render(){ const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE)); const start = (state.page - 1) * PAGE_SIZE; const subset = state.filtered.slice(start, start + PAGE_SIZE); el('loading').style.display='none'; el('countText').textContent = `${state.filtered.length} / ${state.posts.length} 篇`; el('activeText').textContent = state.category ? `当前分类：${state.category}` : '全部文章'; el('emptyState').style.display = subset.length ? 'none' : 'block'; el('postGrid').innerHTML = subset.map((p, i) => cardHtml(p, start+i)).join(''); el('pager').style.display = state.filtered.length > PAGE_SIZE ? 'flex' : 'none'; el('pageInfo').textContent = `第 ${state.page} / ${totalPages} 页`; el('pageInput').value = state.page; el('pageInput').max = totalPages; el('prevBtn').disabled = state.page <= 1; el('nextBtn').disabled = state.page >= totalPages; document.querySelectorAll('.cat').forEach(btn => btn.classList.toggle('active', btn.dataset.cat === state.category)); el('categorySelect').value = state.category; }
    function cardHtml(p, imageIndex){ const url = `articles/${encodeURIComponent(p.slug)}/`; const img = imageFor(p, imageIndex); const date = p.date ? `<span>${escapeHtml(p.date)}</span>` : ''; return `<a class="card" href="${url}"><div class="thumb"><img src="${img}" alt="${escapeAttr(p.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'"></div><div class="card-body"><div class="meta"><span>${escapeHtml(p.category)}</span>${date}<span>${escapeHtml(p.author)}</span></div><h2>${escapeHtml(p.title)}</h2><p>${escapeHtml(p.excerpt)}</p></div></a>`; }
    function escapeHtml(s){ return safeText(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
    function escapeAttr(s){ return escapeHtml(s); }
    function setCategory(cat){ state.category = cat || ''; applyFilters(true); }
    el('searchInput').value = state.query;
    el('searchInput').addEventListener('input', e => { state.query = e.target.value; applyFilters(true); });
    el('categorySelect').addEventListener('change', e => setCategory(e.target.value));
    el('categoryChips').addEventListener('click', e => { const btn = e.target.closest('.cat'); if(btn) setCategory(btn.dataset.cat || ''); });
    el('prevBtn').addEventListener('click', () => { state.page--; applyFilters(false); scrollTo({top:0,behavior:'smooth'}); });
    el('nextBtn').addEventListener('click', () => { state.page++; applyFilters(false); scrollTo({top:0,behavior:'smooth'}); });
    el('jumpBtn').addEventListener('click', () => { state.page = parseInt(el('pageInput').value || '1', 10); applyFilters(false); scrollTo({top:0,behavior:'smooth'}); });
    el('pageInput').addEventListener('keydown', e => { if(e.key === 'Enter') el('jumpBtn').click(); });
    fetch('posts.json', {cache:'no-store'}).then(r => { if(!r.ok) throw new Error('posts.json not found'); return r.json(); }).then(data => { state.posts = data.map(normalizePost); buildCategories(); applyFilters(false); }).catch(err => { el('loading').textContent = '文章数据加载失败：' + err.message; });
  </script>
</body>
</html>
'''


def main() -> None:
    out = Path('blog/index.html')
    out.parent.mkdir(parents=True, exist_ok=True)
    html = HTML.replace('/* I18N_CSS */', i18n_site.LANG_SWITCHER_CSS)
    html = html.replace('<!-- I18N_SWITCHER -->', i18n_site.language_switcher('../', 'zh', 'blog'))
    out.write_text(html, encoding='utf-8')
    print(f'Enhanced blog index written to {out}')


if __name__ == '__main__':
    main()
