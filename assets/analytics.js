/* First-party, opt-in telemetry. No form values, query strings or fingerprints. */
(() => {
  'use strict';
  const script = document.currentScript;
  const endpoint = script?.dataset.endpoint;
  const publicHost = /^(www\.)?eco-geo\.org$/.test(location.hostname);
  if (!endpoint || !publicHost || /^\/(observatory|jianong)(\/|$)/.test(location.pathname)) return;
  const consentKey = 'eco.analytics.consent.v1', sessionKey = 'eco.analytics.session.v1';
  const blocked = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  const store = (storage, key, value) => { try { if (value === undefined) return storage.getItem(key); value === null ? storage.removeItem(key) : storage.setItem(key, value); } catch { return null; } };
  const allowed = () => !blocked() && store(localStorage, consentKey) === 'yes';
  const uid = () => crypto.randomUUID();
  const path = location.pathname.replace(/index\.html$/, '').slice(0, 240);
  const lang = document.documentElement.lang.startsWith('ar') ? 'ar' : document.documentElement.lang.startsWith('en') ? 'en' : 'zh-CN';
  const device = innerWidth < 768 ? 'mobile' : innerWidth < 1100 ? 'tablet' : 'desktop';
  const safeID = el => String(el?.dataset?.ecoId || el?.id || el?.tagName?.toLowerCase() || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const domain = value => { try { return new URL(value).hostname.toLowerCase(); } catch { return ''; } };
  const classify = host => {
    const rules = [['chatgpt.com','chatgpt'],['chat.openai.com','chatgpt'],['perplexity.ai','perplexity'],['gemini.google.com','gemini'],['copilot.microsoft.com','copilot'],['claude.ai','claude'],['chat.deepseek.com','deepseek'],['doubao.com','doubao'],['kimi.com','kimi'],['kimi.moonshot.cn','kimi'],['google.com','google'],['bing.com','bing'],['baidu.com','baidu']];
    if (!host || /(^|\.)eco-geo\.org$/.test(host)) return 'direct';
    return rules.find(([suffix]) => host === suffix || host.endsWith('.' + suffix))?.[1] || 'referral';
  };
  let queue = [], failures = 0, started = false, timer, lastActive = Date.now(), activeSeconds = 0;
  let source = 'direct', referrer = '', session;
  const milestones = new Set();
  let forms = new WeakSet(), sections = new WeakSet(), observer;
  function getSession() {
    let saved; try { saved = JSON.parse(store(sessionStorage, sessionKey)); } catch { /* new session */ }
    if (!saved || !/^[a-f0-9-]{36}$/.test(saved.id || '') || Date.now() - saved.last > 1800000) {
      const host = domain(document.referrer);
      saved = { id: uid(), last: Date.now(), source: classify(host), referrer: /(^|\.)eco-geo\.org$/.test(host) ? '' : host };
    }
    saved.last = Date.now(); store(sessionStorage, sessionKey, JSON.stringify(saved));
    source = saved.source; referrer = saved.referrer; session = saved.id; return session;
  }
  function track(name, target = '', value = 0) {
    if (!allowed() || !started) return;
    const previous=session;getSession();
    if(previous&&previous!==session&&name!=='page_view')track('page_view');
    const event = { id: uid(), name, path, session, source, referrer, lang, device, target: String(target).slice(0,64), value: Number.isFinite(value) ? Math.round(value) : 0 };
    queue.push(event); if (queue.length > 100) queue.shift();
    if (queue.length >= 15) flush();
  }
  async function flush(unload = false) {
    if (!allowed()) { queue = []; return; }
    if (!queue.length) return;
    const events = queue.splice(0, 20), body = JSON.stringify({ events });
    if (unload && navigator.sendBeacon) {
      if (navigator.sendBeacon(endpoint + '/api/events', new Blob([body], { type: 'text/plain' }))) return;
    }
    try {
      const response = await fetch(endpoint + '/api/events', { method:'POST', body, headers:{'Content-Type':'text/plain'}, credentials:'omit', keepalive:true });
      if (!response.ok) throw new Error('unavailable'); failures = 0;
    } catch { if (++failures <= 2 && allowed()) queue = [...events,...queue].slice(0,100); }
  }
  function start() {
    if (started || !allowed()) return;
    started = true; getSession(); track('page_view');
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting && !sections.has(e.target)) { sections.add(e.target); track('section_view',safeID(e.target)); } }, { threshold:0.25 });
      document.querySelectorAll('section[data-eco-id]').forEach(el => observer.observe(el));
    }
    clearInterval(timer);
    timer = setInterval(() => {
      if (allowed() && document.visibilityState === 'visible' && Date.now()-lastActive < 60000) {
        activeSeconds += 5;
        for (const n of [15,30,60,120,300]) if (activeSeconds>=n && !milestones.has('t'+n)) { milestones.add('t'+n);track('engagement','active_seconds',n); }
      }
      flush();
    }, 5000);
  }
  function stop() {queue=[];store(sessionStorage,sessionKey,null);started=false;clearInterval(timer);observer?.disconnect();milestones.clear();forms=new WeakSet();sections=new WeakSet();activeSeconds=0;session=undefined;}
  function consent(value) {
    store(localStorage,consentKey,value);document.getElementById('eco-consent')?.remove();
    if (value==='yes') start(); else { stop(); }
  }
  function settings() {
    document.getElementById('eco-consent')?.remove();
    const box=document.createElement('aside');box.id='eco-consent';box.setAttribute('aria-label','Privacy choices');
    const copy={ 'zh-CN':['允许隐私友好的访问统计，帮助改善内容和咨询体验？不采集表单内容。','允许统计','仅必要','查看隐私说明'],en:['Allow privacy-conscious analytics to improve content and inquiries? Form contents are excluded.','Allow analytics','Necessary only','Privacy policy'],ar:['هل تسمح بالتحليلات لتحسين المحتوى والاستفسارات؟ لا نجمع محتوى النماذج.','السماح بالتحليلات','الضروري فقط','سياسة الخصوصية']}[lang];
    const p=document.createElement('p');p.textContent=blocked() ? (lang==='zh-CN'?'浏览器的隐私信号已关闭访问统计。':'Analytics is disabled by your browser privacy signal.') : copy[0];box.append(p);
    for (const [label,value] of [[copy[1],'yes'],[copy[2],'no']]) { const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=value==='yes'&&blocked();button.addEventListener('click',()=>consent(value));box.append(button); }
    const a=document.createElement('a');a.href=(lang==='zh-CN'?'/':'/'+lang+'/')+'privacy/';a.textContent=copy[3];box.append(a);document.body.append(box);
  }
  // Hidden shortcut is navigation only. API authorization is enforced server-side.
  const footer=document.querySelector('footer');
  if (footer) {
    const control=document.createElement('button');control.type='button';control.className='eco-owner-entry';control.textContent='·';control.setAttribute('aria-label','Site management');
    let taps=0,last=0;control.addEventListener('click',()=>{if(Date.now()-last>2000)taps=0;last=Date.now();if(++taps>=5)location.assign('/observatory/');});footer.append(control);
    const privacy=document.createElement('button');privacy.type='button';privacy.className='eco-privacy-settings';privacy.textContent=lang==='zh-CN'?'隐私设置':lang==='ar'?'خيارات الخصوصية':'Privacy settings';privacy.addEventListener('click',settings);footer.append(privacy);
  }
  document.addEventListener('keydown',e=>{if(e.altKey&&e.shiftKey&&e.code==='KeyA')location.assign('/observatory/');});
  document.querySelectorAll('[data-eco-consent-settings]').forEach(el=>el.addEventListener('click',settings));
  document.addEventListener('click',e=>{
    lastActive=Date.now();const el=e.target.closest('a,button');if(!el||el.closest('#eco-consent')||el.classList.contains('eco-owner-entry')||el.classList.contains('eco-privacy-settings'))return;
    let name=el.tagName==='A'?'link_click':'button_click',target=safeID(el);
    if(el.tagName==='A'){
      const href=el.getAttribute('href')||'';
      if(href.startsWith('mailto:')||href.startsWith('tel:')){name='contact_click';target=href.startsWith('mailto:')?'email':'phone';}
      else if(el.closest('.lang-switcher'))name='language_switch';
      else if(/(^|\/)contact\//.test(href)||el.closest('.bottom-cta'))name='consult_click';
      else if(/^https?:/.test(href)&&domain(href)!==location.hostname){name='outbound_click';target=domain(href);}
      else if(el.hasAttribute('download'))name='download_click';
      else if(el.closest('header,nav'))name='nav_click';
    }
    track(name,target);
  },{capture:true,passive:true});
  document.addEventListener('focusin',e=>{lastActive=Date.now();const form=e.target.closest('form');if(allowed()&&form&&!forms.has(form)){forms.add(form);track('form_start',safeID(form));}});
  document.addEventListener('submit',e=>track('form_submit',safeID(e.target)),true);
  document.addEventListener('change',e=>{lastActive=Date.now();const el=e.target;if(el.matches('select,input[type=checkbox],input[type=radio],input[type=range],input[type=number]'))track('control_change',safeID(el));});
  let searchTimer;
  document.addEventListener('input',e=>{lastActive=Date.now();if(e.target.id==='searchInput'){clearTimeout(searchTimer);searchTimer=setTimeout(()=>track('search_use','blog_search'),800);}});
  document.addEventListener('scroll',()=>{
    lastActive=Date.now();const total=document.documentElement.scrollHeight-innerHeight;
    if(total<=0)return;const percent=100*scrollY/total;
    for(const n of [25,50,75,90])if(allowed()&&percent>=n&&!milestones.has('s'+n)){milestones.add('s'+n);track('scroll_depth','percent',n);}
  },{passive:true});
  const conversions=new Set(['contact_success','audit_complete','advisor_success','advisor_fallback','proposal_download']);
  window.addEventListener('eco:conversion',e=>{if(conversions.has(e.detail?.name)){track(e.detail.name);flush();}});
  window.addEventListener('error',e=>track(e.target===window?'script_error':'resource_error','error'),true);
  let lcp=0,cls=0,clsWindow=0,clsStart=0,clsLast=0,vitalsSent=false;
  if('PerformanceObserver' in window) {
    try{new PerformanceObserver(list=>{lcp=list.getEntries().at(-1)?.startTime||lcp;}).observe({type:'largest-contentful-paint',buffered:true});}catch{}
    try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput){if(e.startTime-clsLast>1000||e.startTime-clsStart>5000){clsWindow=0;clsStart=e.startTime;}clsWindow+=e.value;clsLast=e.startTime;cls=Math.max(cls,clsWindow);}}).observe({type:'layout-shift',buffered:true});}catch{}
  }
  function leave(){if(!vitalsSent&&started&&allowed()){vitalsSent=true;if(lcp)track('web_vital','lcp_ms',lcp);track('web_vital','cls_milli',cls*1000);}flush(true);}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')leave();});window.addEventListener('pagehide',leave);
  window.addEventListener('storage',e=>{if(e.key===consentKey){if(allowed())start();else stop();}});
  if(allowed())start();else if(!blocked()&&!store(localStorage,consentKey))settings();
})();
