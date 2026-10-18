import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const ID='11111111-2222-4333-8444-555555555555';
const SOURCE='https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com/generated.mp4?X-Tos-Date=20261018T000000Z&X-Tos-Expires=86400';
const NOW=new Date('2026-10-18T01:00:00Z');
async function load(path,mocks={},globals={}) {
 const filename=new URL(path,import.meta.url).pathname;
 const {outputText}=ts.transpileModule(await readFile(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const compiled={exports:{}};
 vm.runInNewContext(outputText,{module:compiled,exports:compiled.exports,require(name){assert.ok(Object.hasOwn(mocks,name),name);return mocks[name];},crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,URLSearchParams,Request,Response,Headers,AbortSignal,ReadableStream,Date,Error,...globals},{filename});return compiled.exports;
}
async function fixture(t,options={}) {
 const sqlite=new DatabaseSync(':memory:');
 for(const file of ['0005_tokenhub_audit.sql','0007_tokenhub_audit_media.sql']) sqlite.exec(await readFile(new URL(`../drizzle/${file}`,import.meta.url),'utf8'));
 t.after(()=>sqlite.close());
 sqlite.prepare("INSERT INTO tokenhub_audit_campaigns(id,state,started_at,ends_at,budget_micros,encrypted_key,key_hint,catalog_json,catalog_hash,plan_version) VALUES(?,'active','2026-10-18','2026-10-25',5000000,'secret','hint','{}','hash','v3')").run(ID);
 const DB={prepare(sql){const st=sqlite.prepare(sql);const exec=(args=[])=>({bind(...next){return exec(next);},async first(){return st.get(...args)||null;},async all(){return {results:st.all(...args)};},async run(){return {success:true,meta:{changes:st.run(...args).changes}};}});return exec();}};
 const requests=[],objects=new Map(),gets=[];
 const env={DB,AUDIT_MEDIA:{async put(key,value,opts){if(options.putError)throw new Error('private-storage-failure');objects.set(key,{bytes:new Uint8Array(value),opts});},async get(key,opts){gets.push({key,opts});const found=objects.get(key);if(!found)return null;const bytes=opts?.range?found.bytes.slice(opts.range.offset,opts.range.offset+opts.range.length):found.bytes;return {body:new Response(bytes).body};}}};
 const api=await load('../lib/tokenhub-audit-media.ts',{}, {async fetch(url,init){requests.push({url,init});return options.fetcher?options.fetcher(url,init):new Response(new Uint8Array([1,2,3,4,5]),{headers:{'content-type':'video/mp4','content-length':'5'}});}});
 function insert(overrides={}){const d={campaign_id:ID,slot:0,case_id:'video:test',kind:'video',model:'video-test',state:'succeeded',reserved_micros:600000,request_json:'{"prompt":"original"}',request_hash:'original-request-hash',expected_json:'{}',price_json:'{}',price_hash:'price',response_json:JSON.stringify({status:'succeeded',content:{video_url:SOURCE}}),response_hash:'original-response-hash',submitted_at:NOW.toISOString(),updated_at:NOW.toISOString(),...overrides};const cols=Object.keys(d);sqlite.prepare(`INSERT INTO tokenhub_audit_cases(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(d));return {campaign:d.campaign_id,slot:d.slot,caseId:d.case_id};}
 return {...api,env,sqlite,objects,requests,gets,insert};
}
test('strict remote source allowlist rejects SSRF, credentials, redirects and malformed locations',async t=>{
 const f=await fixture(t);
 for(const value of ['http://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com/a','https://127.0.0.1/a','https://evil.example/a','https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com.evil.example/a','https://a:b@ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com/a','https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com:8443/a',SOURCE+'#fragment',SOURCE+'\n','data:image/png;base64,AA=='])assert.equal(f.auditMediaSource(value),null);
 assert.equal(f.auditMediaSource(SOURCE).expiresAt,'2026-10-19T00:00:00.000Z');
});
test('successful artifact archive preserves original request/response hashes and is idempotent',async t=>{
 const f=await fixture(t),query=f.insert(),before=f.sqlite.prepare('SELECT * FROM tokenhub_audit_cases').get();
 const first=await f.archiveAuditCaseMedia(f.env,query,NOW);assert.equal(first.attempted,1);assert.equal(first.archives[0].state,'archived');assert.equal(first.archives[0].sizeBytes,5);assert.equal(first.archives[0].sha256,createHash('sha256').update(new Uint8Array([1,2,3,4,5])).digest('hex'));assert.match(first.archives[0].url,/^\/api\/admin\/tokenhub-audit\/media\?asset=[0-9a-f]{64}$/);
 assert.equal((await f.archiveAuditCaseMedia(f.env,query,NOW)).attempted,0);assert.equal(f.requests.length,1);assert.equal(f.requests[0].init.redirect,'manual');assert.equal(f.requests[0].init.method,'GET');assert.equal(f.requests[0].init.headers.Authorization,undefined);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM tokenhub_audit_cases').get(),before);assert.equal(f.sqlite.prepare('SELECT reserved_bytes FROM tokenhub_audit_media').get().reserved_bytes,5);
});
test('failed, pending and text cases never fetch an artifact or perform inference',async t=>{
 const f=await fixture(t);for(const [i,state]of ['provider_error','pending_video','outcome_unknown'].entries()){const query=f.insert({slot:i,state});assert.equal((await f.archiveAuditCaseMedia(f.env,query,NOW)).attempted,0);}const query=f.insert({slot:4,kind:'chat'});await f.archiveAuditCaseMedia(f.env,query,NOW);assert.equal(f.requests.length,0);
});
test('expired, unsafe, redirecting, excessive and nonmedia sources are recorded without public fetching or unbounded storage',async t=>{
 const unsafe=await fixture(t),q=unsafe.insert({response_json:JSON.stringify({content:{video_url:'https://evil.example/a'}})});assert.equal((await unsafe.archiveAuditCaseMedia(unsafe.env,q,NOW)).archives[0].state,'unsupported');assert.equal(unsafe.requests.length,0);
 const expired=await fixture(t),qe=expired.insert();assert.equal((await expired.archiveAuditCaseMedia(expired.env,qe,new Date('2026-10-20'))).archives[0].state,'expired');assert.equal(expired.requests.length,0);
 for(const [response,code]of [[new Response(null,{status:302,headers:{location:'http://localhost'}}),'redirect_blocked'],[new Response('x',{headers:{'content-type':'video/mp4','content-length':String(21*1024*1024)}}),'too_large'],[new Response('<svg>',{headers:{'content-type':'image/svg+xml'}}),'unsupported_mime'],[new Response(new Uint8Array(21*1024*1024),{headers:{'content-type':'video/mp4'}}),'too_large']]){const f=await fixture(t,{fetcher:()=>response}),query=f.insert();const r=await f.archiveAuditCaseMedia(f.env,query,NOW);assert.equal(r.archives[0].error,code);assert.equal(f.objects.size,0);assert.equal(f.sqlite.prepare('SELECT state FROM tokenhub_audit_cases').get().state,'succeeded');}
});
test('read-only retries are leased, limited to three and never corrupt original case',async t=>{
 const f=await fixture(t,{putError:true}),query=f.insert();for(let i=0;i<6;i++){await f.archiveAuditCaseMedia(f.env,query,new Date(NOW.getTime()+i*11*60000));}const row=f.sqlite.prepare('SELECT * FROM tokenhub_audit_media').get();assert.equal(row.attempt_count,3);assert.equal(row.error_code,'archive_unavailable');assert.equal(f.requests.length,3);assert.equal(f.sqlite.prepare('SELECT state FROM tokenhub_audit_cases').get().state,'succeeded');
});
test('atomic capacity reservations cap a campaign at 100 MiB and individual cases at four artifacts',async t=>{
 const f=await fixture(t,{putError:true});for(let i=0;i<7;i++){const query=f.insert({slot:i,case_id:'video:'+i});await f.archiveAuditCaseMedia(f.env,query,NOW);}assert.equal(f.requests.length,5);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM tokenhub_audit_media WHERE error_code='capacity_limit'").get().n,2);assert.equal(f.sqlite.prepare('SELECT SUM(reserved_bytes) AS bytes FROM tokenhub_audit_media').get().bytes,100*1024*1024);
 const g=await fixture(t,{fetcher:()=>new Response('img',{headers:{'content-type':'image/png'}})}),q=g.insert({kind:'image',response_json:JSON.stringify({data:Array.from({length:20},(_,i)=>({url:SOURCE+'&image='+i}))})});await g.archiveAuditCaseMedia(g.env,q,NOW);assert.equal(g.requests.length,4);
});
test('private serving supports exact, open-ended and suffix ranges and rejects multipart/out-of-bounds',async t=>{
 const f=await fixture(t),q=f.insert(),r=await f.archiveAuditCaseMedia(f.env,q,NOW),id=r.archives[0].assetId;
 for(const [range,status,bytes,contentRange]of [[null,200,[1,2,3,4,5],null],['bytes=1-3',206,[2,3,4],'bytes 1-3/5'],['bytes=3-',206,[4,5],'bytes 3-4/5'],['bytes=-2',206,[4,5],'bytes 3-4/5']]){const response=await f.serveAuditMedia(f.env,id,range);assert.equal(response.status,status);assert.equal(response.headers.get('content-range'),contentRange);assert.equal(response.headers.get('content-type'),'video/mp4');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],bytes);}
 for(const range of ['bytes=1-2,3-4','bytes=9-','bytes=-0','bytes=4-2','nonsense'])assert.equal((await f.serveAuditMedia(f.env,id,range)).status,416);
 assert.equal(f.gets.length,4);await assert.rejects(f.serveAuditMedia(f.env,'../x',null),e=>e.status===400);
});
test('media route requires admin before runtime and rejects cross-origin archive mutation',async t=>{
 const f=await fixture(t);const ev=await load('../lib/tokenhub-audit-evidence.ts',{'./tokenhub-audit-media':f});
 for(const [user,status]of [[null,401],[{id:'member',isAdmin:false},403]]){let called=false;const route=await load('../app/api/admin/tokenhub-audit/media/route.ts',{'@/lib/auth':{getPortalUser:async()=>user},'@/lib/config':{runtimeEnv(){called=true;return f.env;}},'@/lib/tokenhub-audit-evidence':ev,'@/lib/tokenhub-audit-media':f});for(const method of ['GET','POST'])assert.equal((await route[method](new Request('https://api.eco-geo.org/api/admin/tokenhub-audit/media',{method}))).status,status);assert.equal(called,false);}
 const route=await load('../app/api/admin/tokenhub-audit/media/route.ts',{'@/lib/auth':{getPortalUser:async()=>({id:'admin',isAdmin:true})},'@/lib/config':{runtimeEnv:()=>f.env},'@/lib/tokenhub-audit-evidence':ev,'@/lib/tokenhub-audit-media':f});
 assert.equal((await route.POST(new Request('https://api.eco-geo.org/api/admin/tokenhub-audit/media',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'}))).status,403);assert.equal(f.requests.length,0);
});

test('concurrent archive actions claim each artifact once and bounded backfill only downloads existing results',async t=>{
 const f=await fixture(t),q=f.insert();const results=await Promise.all([f.archiveAuditCaseMedia(f.env,q,NOW),f.archiveAuditCaseMedia(f.env,q,NOW)]);assert.equal(results.reduce((n,x)=>n+x.attempted,0),1);assert.equal(f.requests.length,1);
 const g=await fixture(t);for(let i=0;i<5;i++)g.insert({slot:i,case_id:'backfill:'+i});const backfill=await g.archiveAuditMediaBackfill(g.env,NOW);assert.equal(backfill.attempted,2);assert.equal(g.requests.length,2);assert.ok(g.requests.every(x=>x.init.method==='GET'&&!x.init.headers.Authorization));
});
