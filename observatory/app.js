(() => {
 'use strict';
 const API='https://metrics.eco-geo.org', $=id=>document.getElementById(id);
 const names={page_view:'页面浏览',section_view:'区域曝光',nav_click:'导航点击',link_click:'链接点击',button_click:'按钮点击',consult_click:'咨询入口点击',contact_click:'邮箱/电话点击',outbound_click:'外链点击',download_click:'下载链接点击',language_switch:'切换语言',form_start:'开始填写',form_submit:'尝试提交',contact_success:'服务器确认咨询成功',control_change:'筛选/选项操作',search_use:'站内搜索操作（不含原文）',scroll_depth:'阅读深度里程碑',engagement:'有效停留里程碑',audit_complete:'品牌诊断完成',advisor_success:'AI 套餐建议完成',advisor_fallback:'套餐规则降级结果',proposal_download:'建议文件生成下载',script_error:'脚本错误',resource_error:'资源加载错误',web_vital:'页面体验样本'};
 const channels={direct:'直接 / 未知来源',referral:'其他引荐',chatgpt:'ChatGPT',perplexity:'Perplexity',gemini:'Gemini',copilot:'Copilot',claude:'Claude',deepseek:'DeepSeek',doubao:'豆包',kimi:'Kimi',google:'Google',bing:'Bing',baidu:'百度'};
 const ai=new Set(['chatgpt','perplexity','gemini','copilot','claude','deepseek','doubao','kimi']);
 let snapshot=null,busy=false;
 function text(node,value){node.textContent=String(value??'');return node;}
 function el(tag,value){return text(document.createElement(tag),value);}
 function number(v){return Number(v||0).toLocaleString('zh-CN');}
 function status(message,error=false){text($('status'),message);$('status').className=error?'error':'muted';}
 function reset(){snapshot=null;$('dashboard').hidden=true;$('auth').hidden=false;$('pin').value='';for(const id of ['metrics','trend','daily','pages','sources','events','interactions','devices','languages','vitals'])$(id).replaceChildren();}
 async function api(path,options={}){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),12000);
  try{
   const r=await fetch(API+path,{credentials:'include',cache:'no-store',signal:c.signal,...options});
   let data;try{data=await r.json();}catch{throw new Error('统计服务返回了非预期响应；没有将其当作零访问。');}
   if(!r.ok){const err=new Error(r.status===401?'密钥不正确或登录已过期。':r.status===429?'请求过于频繁，请稍后重试。':r.status===503?'统计服务尚未完成配置，或数据库暂不可用。':r.status===403?'访问来源未被允许，请从正式站点进入。':'统计请求失败。');err.status=r.status;throw err;}
   return data;
  }catch(e){if(e instanceof TypeError||e.name==='AbortError')throw new Error('无法连接统计服务。后端可能尚未部署，或网络暂不可用；当前不显示虚构数据。');throw e;}finally{clearTimeout(timer);}
 }
 function table(id,heads,rows){
  const box=$(id);box.replaceChildren();if(!rows.length){box.append(el('p','暂无记录'));return;}
  const table=document.createElement('table'),thead=document.createElement('thead'),tr=document.createElement('tr'),tbody=document.createElement('tbody');
  heads.forEach(h=>tr.append(el('th',h)));thead.append(tr);table.append(thead,tbody);
  rows.forEach(row=>{const r=document.createElement('tr');row.forEach(value=>r.append(el('td',value)));tbody.append(r);});box.append(table);
 }
 function render(d){
  snapshot=d;$('auth').hidden=true;$('dashboard').hidden=false;$('metrics').replaceChildren();
  const first=d.coverage?.first_event?new Date(d.coverage.first_event*1000).toISOString():'尚未开始';
  text($('coverage'),`数据读取时间 ${d.as_of} · UTC · 当前保留记录最早时间 ${first}`);
  const totals=d.totals||{},aiv=d.sources.filter(r=>ai.has(r.source)).reduce((s,r)=>s+r.views,0);
  [['页面浏览 PV',totals.page_views],['标签页会话',totals.sessions],['停留 ≥30 秒会话',totals.engaged_sessions],['咨询成功事件',totals.contacts],['已识别 AI 引荐 PV',aiv]].forEach(([label,value])=>{const card=document.createElement('div');card.className='metric';card.append(el('span',label),el('strong',number(value)));$('metrics').append(card);});
  $('empty').hidden=!!totals.events;const daily=[];
  for(let i=0;i<d.days;i++){const day=new Date(Date.parse(d.start+'T00:00:00Z')+i*86400000).toISOString().slice(0,10),row=d.daily.find(r=>r.day===day);daily.push([day,row?.views||0,row?.sessions||0]);}
  table('daily',['日期（UTC）','PV','会话'],daily);const max=Math.max(1,...daily.map(r=>r[1]));$('trend').replaceChildren();
  daily.forEach(([day,views])=>{const bar=document.createElement('div');bar.className='bar';bar.style.height=(Math.max(1,views/max*100))+'%';bar.title=`${day} · ${views} PV`;bar.setAttribute('aria-label',bar.title);$('trend').append(bar);});
  table('pages',['页面','PV','会话'],d.pages.map(r=>[r.path,r.views,r.sessions]));
  table('sources',['来源','PV','会话'],d.sources.map(r=>[channels[r.source]||r.source,r.views,r.sessions]));
  table('events',['事件','次数'],d.events.map(r=>[names[r.name]||r.name,r.count]));
  table('interactions',['页面 / 组件','事件','次数'],d.interactions.map(r=>[r.path+' · '+r.target,names[r.name]||r.name,r.count]));
  table('devices',['设备','PV'],d.devices.map(r=>[{desktop:'桌面',tablet:'平板',mobile:'手机'}[r.device]||r.device,r.views]));
  table('languages',['页面语言','PV'],d.languages.map(r=>[{'zh-CN':'中文',en:'English',ar:'العربية'}[r.lang]||r.lang,r.views]));
  table('vitals',['指标','样本均值','样本数'],d.vitals.map(r=>[r.target==='lcp_ms'?'LCP':'CLS',r.target==='lcp_ms'?(r.mean/1000).toFixed(2)+' 秒':(r.mean/1000).toFixed(3),r.samples]));
 }
 async function refresh(silent=false){
  if(busy)return;busy=true;status('正在读取真实统计数据…');$('refresh').disabled=true;
  try{render(await api('/api/summary?days='+$('days').value));status('');}catch(e){if(e.status===401){reset();status(silent?'请输入管理员密钥。':e.message,!silent);}else{reset();status(e.message,true);}}finally{busy=false;$('refresh').disabled=false;}
 }
 $('login').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;const b=e.target.querySelector('button');b.disabled=true;status('正在验证…');try{await api('/api/login',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({pin:$('pin').value})});$('pin').value='';busy=false;await refresh();}catch(error){status(error.message,true);}finally{busy=false;b.disabled=false;}});
 $('refresh').addEventListener('click',()=>refresh());$('days').addEventListener('change',()=>refresh());
 $('logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'});reset();status('已退出登录。');}catch(e){reset();status('本页已清空。服务端退出未确认，Cookie 最长一小时自动过期。'+e.message,true);}});
 $('export').addEventListener('click',()=>{
  if(!snapshot)return;const rows=[['Dataset','Dimension','Metric','Value'],['metadata','as_of','UTC',snapshot.as_of],['metadata','window','days',snapshot.days]];
  for(const [key,value] of Object.entries(snapshot.totals))rows.push(['totals','all',key,value??0]);
  for(const type of ['daily','pages','sources','events','devices','languages','interactions','vitals'])for(const row of snapshot[type]){const dimension=row.day||row.path||row.source||row.name||row.device||row.lang||row.target;for(const [key,value] of Object.entries(row))if(typeof value==='number')rows.push([type,String(dimension)+(row.target&&type==='interactions'?' · '+row.target+' · '+row.name:''),key,value]);}
  const safe=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='eco-geo-analytics-'+snapshot.days+'d.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 refresh(true);
})();
