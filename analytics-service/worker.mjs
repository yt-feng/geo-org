/** Isolated telemetry backend. Deployment without secrets fails closed. */
const ORIGINS=new Set(['https://eco-geo.org','https://www.eco-geo.org']);
export const EVENTS=new Set(['page_view','section_view','link_click','button_click','nav_click','contact_click','consult_click','outbound_click','download_click','language_switch','form_start','form_submit','control_change','search_use','scroll_depth','engagement','contact_success','audit_complete','advisor_success','advisor_fallback','proposal_download','script_error','resource_error','web_vital']);
const SOURCES=new Set(['direct','referral','chatgpt','perplexity','gemini','copilot','claude','deepseek','doubao','kimi','google','bing','baidu']);
const COOKIE='__Host-eco-ops';
const MAX_BODY=24000;
const encoder=new TextEncoder();
function response(data,status=200,origin='',extra={}){
 const h={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer',Vary:'Origin',...extra};
 if(ORIGINS.has(origin)){h['Access-Control-Allow-Origin']=origin;h['Access-Control-Allow-Credentials']='true';}
 return status===204?new Response(null,{status,headers:h}):Response.json(data,{status,headers:h});
}
export async function digest(text,secret){const k=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,encoder.encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
function equal(a,b){let different=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)different|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return different===0;}
async function body(request){
 if(!['application/json','text/plain'].includes((request.headers.get('Content-Type')||'').split(';')[0].toLowerCase()))throw new Error('content_type');
 if(Number(request.headers.get('Content-Length')||0)>MAX_BODY)throw new Error('too_large');
 if(!request.body)throw new Error('invalid');
 const reader=request.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();throw new Error('too_large');}chunks.push(value);}}finally{reader.releaseLock();}
 const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
}
export function validateEvent(e){
 const keys=['id','name','path','session','source','referrer','lang','device','target','value'];
 if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).some(k=>!keys.includes(k))||keys.some(k=>!(k in e)))throw new Error('invalid_event');
 for(const k of ['id','session'])if(typeof e[k]!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(e[k])))throw new Error('invalid_event');
 if(!EVENTS.has(e.name)||!SOURCES.has(e.source)||!['zh-CN','en','ar'].includes(e.lang)||!['mobile','tablet','desktop'].includes(e.device))throw new Error('invalid_event');
 if(typeof e.path!=='string'||e.path.length>240||!/^\/(?:[a-zA-Z0-9_./-]*)$/.test(e.path)||e.path.includes('..')||/^\/(observatory|jianong)(\/|$)/.test(e.path))throw new Error('invalid_event');
 if(typeof e.referrer!=='string'||e.referrer.length>253||!/^[a-zA-Z0-9.-]*$/.test(e.referrer)||typeof e.target!=='string'||e.target.length>64||!/^[a-zA-Z0-9_.-]*$/.test(e.target))throw new Error('invalid_event');
 if(!Number.isInteger(e.value)||e.value<0||e.value>3600000)throw new Error('invalid_event');
 if(e.name==='scroll_depth'&&![25,50,75,90].includes(e.value))throw new Error('invalid_event');
 if(e.name==='engagement'&&![15,30,60,120,300].includes(e.value))throw new Error('invalid_event');
 if(e.name==='web_vital'&&!['lcp_ms','cls_milli'].includes(e.target))throw new Error('invalid_event');
 return e;
}
async function limit(db,key,max,seconds,now){
 const bucket=Math.floor(now/seconds),expiry=(bucket+1)*seconds;
 const row=await db.prepare('INSERT INTO analytics_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key+':'+bucket,expiry).first();
 return row.count<=max;
}
async function authorized(request,env,now){
 const token=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const hash=await digest(token,env.ANALYTICS_SECRET);
 const found=await env.DB.prepare('SELECT token_hash FROM analytics_sessions WHERE token_hash=? AND expires>?').bind(hash,now).first();
 return found?.token_hash||null;
}
export async function summary(db,days,now){
 const start=new Date((now-(days-1)*86400)*1000).toISOString().slice(0,10);
 const queries=[
  [`SELECT COUNT(*) AS events, SUM(CASE WHEN name='page_view' THEN 1 ELSE 0 END) AS page_views, COUNT(DISTINCT CASE WHEN name='page_view' THEN session END) AS sessions, COUNT(DISTINCT CASE WHEN name='engagement' AND value>=30 THEN session END) AS engaged_sessions, SUM(CASE WHEN name='contact_success' THEN 1 ELSE 0 END) AS contacts FROM analytics_events WHERE day>=?`,[start]],
  [`SELECT day,COUNT(*) AS views,COUNT(DISTINCT session) AS sessions FROM analytics_events WHERE day>=? AND name='page_view' GROUP BY day ORDER BY day`,[start]],
  [`SELECT path,COUNT(*) AS views,COUNT(DISTINCT session) AS sessions FROM analytics_events WHERE day>=? AND name='page_view' GROUP BY path ORDER BY views DESC LIMIT 100`,[start]],
  [`SELECT source,COUNT(*) AS views,COUNT(DISTINCT session) AS sessions FROM analytics_events WHERE day>=? AND name='page_view' GROUP BY source ORDER BY views DESC`,[start]],
  [`SELECT name,COUNT(*) AS count FROM analytics_events WHERE day>=? GROUP BY name ORDER BY count DESC`,[start]],
  [`SELECT path,target,name,COUNT(*) AS count FROM analytics_events WHERE day>=? AND name IN ('section_view','button_click','nav_click','consult_click','control_change') GROUP BY path,target,name ORDER BY count DESC LIMIT 100`,[start]],
  [`SELECT device,COUNT(*) AS views FROM analytics_events WHERE day>=? AND name='page_view' GROUP BY device`,[start]],
  [`SELECT lang,COUNT(*) AS views FROM analytics_events WHERE day>=? AND name='page_view' GROUP BY lang`,[start]],
  [`SELECT target,COUNT(*) AS samples,ROUND(AVG(value),1) AS mean FROM analytics_events WHERE day>=? AND name='web_vital' GROUP BY target`,[start]],
  [`SELECT MIN(timestamp) AS first_event,MAX(timestamp) AS last_event FROM analytics_events`,[]],
 ];
 const rows=await db.batch(queries.map(([q,args])=>db.prepare(q).bind(...args)));
 const [totals,daily,pages,sources,events,interactions,devices,languages,vitals,coverage]=rows.map(r=>r.results||[]);
 return {ok:true,days,start,timezone:'UTC',as_of:new Date(now*1000).toISOString(),totals:totals[0],daily,pages,sources,events,interactions,devices,languages,vitals,coverage:coverage[0]};
}
export default {
 async fetch(request,env={}){
  const u=new URL(request.url),origin=request.headers.get('Origin')||'',now=Math.floor(Date.now()/1000);
  const ready=!!(env.DB?.prepare&&typeof env.ANALYTICS_PIN==='string'&&env.ANALYTICS_PIN.length>=4&&typeof env.ANALYTICS_SECRET==='string'&&env.ANALYTICS_SECRET.length>=32);
  if(u.pathname==='/health'&&request.method==='GET'){
   if(!ready)return response({ok:false,service:'eco-geo-analytics',error:'not_configured'},503,origin);
   try{await env.DB.prepare('SELECT id FROM analytics_events LIMIT 1').first();return response({ok:true,service:'eco-geo-analytics'},200,origin);}catch{return response({ok:false,error:'storage_unavailable'},503,origin);}
  }
  if(!ORIGINS.has(origin))return response({error:'origin_not_allowed'},403);
  if(request.method==='OPTIONS')return response(null,204,origin,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'});
  if(!ready)return response({error:'not_configured'},503,origin);
  try{
   const ip=request.headers.get('CF-Connecting-IP');
   if(!ip||ip.length>64||!/^[0-9a-f:.]+$/i.test(ip))return response({error:'service_unavailable'},503,origin);
   const ipHash=await digest('rate:'+Math.floor(now/86400)+':'+ip,env.ANALYTICS_SECRET);
   if(u.pathname==='/api/events'&&request.method==='POST'){
    if(request.headers.get('Sec-GPC')==='1'||request.headers.get('DNT')==='1')return response(null,204,origin);
    if(!await limit(env.DB,'events:'+ipHash,30,60,now))return response({error:'rate_limited'},429,origin,{'Retry-After':'60'});
    const data=await body(request);
    if(!data||Object.keys(data).length!==1||!Array.isArray(data.events)||data.events.length<1||data.events.length>20)return response({error:'invalid_batch'},400,origin);
    const events=data.events.map(validateEvent),day=new Date(now*1000).toISOString().slice(0,10);
    await env.DB.batch(events.map(e=>env.DB.prepare('INSERT OR IGNORE INTO analytics_events(id,timestamp,day,name,path,session,source,referrer,lang,device,target,value) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(e.id,now,day,e.name,e.path,e.session,e.source,e.referrer,e.lang,e.device,e.target,e.value)));
    return response({ok:true,received:events.length},200,origin);
   }
   if(u.pathname==='/api/login'&&request.method==='POST'){
    const okIP=await limit(env.DB,'login:'+ipHash,5,900,now),okGlobal=await limit(env.DB,'login:global',30,3600,now);
    if(!okIP||!okGlobal)return response({error:'rate_limited'},429,origin,{'Retry-After':'3600'});
    const data=await body(request);
    if(!data||Object.keys(data).length!==1||typeof data.pin!=='string'||data.pin.length>128)return response({error:'invalid_credentials'},401,origin);
    if(!equal(await digest('pin:'+data.pin,env.ANALYTICS_SECRET),await digest('pin:'+env.ANALYTICS_PIN,env.ANALYTICS_SECRET)))return response({error:'invalid_credentials'},401,origin);
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    await env.DB.prepare('INSERT INTO analytics_sessions(token_hash,expires) VALUES(?,?)').bind(await digest(token,env.ANALYTICS_SECRET),now+3600).run();
    return response({ok:true},200,origin,{'Set-Cookie':`${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600`});
   }
   if(['/api/summary','/api/logout'].includes(u.pathname)){
    const auth=await authorized(request,env,now);if(!auth)return response({error:'unauthorized'},401,origin);
    if(u.pathname==='/api/logout'&&request.method==='POST'){
     await env.DB.prepare('DELETE FROM analytics_sessions WHERE token_hash=?').bind(auth).run();
     return response({ok:true},200,origin,{'Set-Cookie':`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`});
    }
    if(u.pathname==='/api/summary'&&request.method==='GET'){
     if(!await limit(env.DB,'read:'+ipHash,20,60,now))return response({error:'rate_limited'},429,origin,{'Retry-After':'60'});
     const days=Number(u.searchParams.get('days')||7);if(![1,7,30,90].includes(days))return response({error:'invalid_range'},400,origin);
     return response(await summary(env.DB,days,now),200,origin);
    }
   }
   return response({error:'not_found'},404,origin);
  }catch(error){
   const invalid=['invalid_event','invalid','content_type','too_large'].includes(error.message)||error instanceof SyntaxError;
   return response({error:invalid?'invalid_request':'service_unavailable'},invalid?(error.message==='too_large'?413:400):503,origin);
  }
 },
 async scheduled(_event,env){const now=Math.floor(Date.now()/1000);await env.DB.batch([env.DB.prepare('DELETE FROM analytics_events WHERE timestamp<?').bind(now-90*86400),env.DB.prepare('DELETE FROM analytics_sessions WHERE expires<?').bind(now),env.DB.prepare('DELETE FROM analytics_limits WHERE expires<?').bind(now)]);}
};
