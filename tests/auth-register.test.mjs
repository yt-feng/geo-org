import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

async function moduleAt(relative, mocks, globals={}) {
  const filename=new URL('../'+relative,import.meta.url).pathname, compiled={exports:{}};
  const {outputText}=ts.transpileModule(await readFile(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  vm.runInNewContext(outputText,{module:compiled,exports:compiled.exports,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,AbortSignal,atob,
    require(name){assert.ok(Object.hasOwn(mocks,name),'Unknown dependency: '+name);return mocks[name];},...globals},{filename});
  return compiled.exports;
}
const user={id:'provider-user',email:'qa@example.invalid',displayName:'QA',isAdmin:false};
const pair={access_token:'test-access-token',refresh_token:'test-refresh-token',expires_in:3600,user:{id:user.id}};
async function fixture(options={}) {
  const calls=[];
  const auth={ACCESS_COOKIE:'eco_geo_access',REFRESH_COOKIE:'eco_geo_refresh',createAdminSession:async()=>options.admin?'eco_admin.test':null,
    verifyAccessToken:async()=>options.invalidAccess?null:user,
    authBaseUrl:()=> 'https://project.supabase.co',authRequestHeaders:()=>new Headers({apikey:'private-key','content-type':'application/json'})};
  const local={createLocalSession:async id=>{calls.push(['local-session',id]);return 'tk_session_'+'a'.repeat(64);},
    hasLocalAccount:async()=>options.local===true, authenticateLocalAccount:async()=>options.disabled?null:user,
    revokeLocalSession:async token=>{calls.push(['revoke',token]);}};
  const fetcher=async(url,init)=>{calls.push(['upstream',url,init]);if(options.transport)throw new Error('private upstream failure');
    if(options.nonJSON)return new Response('private non-JSON body',{status:502});
    return Response.json(options.upstream??pair,{status:options.status??200});};
  const http=await moduleAt('lib/auth-http.ts',{'./auth':auth});
  const provider=await moduleAt('lib/auth-provider.ts',{'./auth':auth},{fetch:fetcher});
  const mocks={'@/lib/auth':auth,'@/lib/auth-http':http,'@/lib/auth-provider':provider,'@/lib/local-auth':local,
    '@/lib/config':{publicBaseUrl:()=> 'https://tokvilo.com',getD1:()=>({prepare:()=>({bind:()=>({first:async()=>options.existing?{id:'legacy-user'}:null})})})},
    '@/lib/login-rate-limit':{consumeLoginAttempt:async()=>options.allowed!==false}};
  const register=await moduleAt('app/api/auth/register/route.ts',mocks);
  const login=await moduleAt('app/api/auth/login/route.ts',mocks);
  const logout=await moduleAt('app/api/auth/logout/route.ts',mocks);
  const refresh=await moduleAt('app/api/auth/refresh/route.ts',mocks);
  function req(path,payload,headers={}){return new Request('https://tokvilo.com/api/auth/'+path,{method:'POST',headers:{origin:'https://tokvilo.com','content-type':'application/json',...headers},body:JSON.stringify(payload)});}
  return {calls,signup:(payload={email:user.email,password:'test-password-long',displayName:'QA'},headers)=>register.POST(req('register',payload,headers)),
    login:()=>login.POST(req('login',{email:user.email,password:'test-password-long'})),logout:token=>logout.POST(req('logout',{}, {cookie:'eco_geo_access='+token})),
    refresh:(cookies,headers={})=>refresh.POST(req('refresh',{}, {cookie:cookies,...headers}))};
}
test('Supabase raw and wrapped sessions login automatically using private secure cookies',async()=>{
 for(const upstream of [pair,{session:pair}]) {const f=await fixture({upstream});const r=await f.signup();assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{ok:true,authenticated:true,requiresEmailVerification:false});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][2].redirect,'manual');const url=new URL(f.calls[0][1]);assert.equal(url.pathname,'/auth/v1/signup');assert.equal(url.searchParams.get('redirect_to'),'https://tokvilo.com/login?verified=1');
 assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/Secure/);assert.match(r.headers.get('set-cookie'),/eco_geo_refresh=test-refresh-token/);assert.match(r.headers.get('cache-control'),/no-store/);}
});
test('unconfirmed signup requests preserve email confirmation and do not issue session cookies',async()=>{
 for(const upstream of [{id:user.id,confirmation_sent_at:'2026-10-20T00:00:00Z'},{user:{id:user.id},session:null}]){
 const f=await fixture({upstream}),r=await f.signup();assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,authenticated:false,requiresEmailVerification:true});assert.equal(r.headers.get('set-cookie'),null);}
});
test('empty or partial provider replies cannot claim successful account creation',async()=>{
 for(const upstream of [{},[],null,{id:user.id,access_token:'partial'}]){const f=await fixture({upstream:upstream??'invalid'});const r=await f.signup();assert.equal(r.status,503);assert.equal(r.headers.get('set-cookie'),null);}
});
test('cross-origin, malformed and oversize requests never reach the signup provider',async()=>{
 const f=await fixture();assert.equal((await f.signup(undefined,{origin:'https://elsewhere.invalid'})).status,403);
 for(const value of [null,[],{email:42,password:'test-password-long'},{email:user.email,password:{}},{email:user.email,password:'short'}])assert.equal((await f.signup(value)).status,400);
 assert.equal((await f.signup({email:user.email,password:'test-password-long',displayName:'x'.repeat(18000)})).status,413);assert.equal(f.calls.length,0);
});
test('rate limits and existing legacy identities never create duplicate provider identities',async()=>{
 const limited=await fixture({allowed:false});assert.equal((await limited.signup()).status,429);assert.equal(limited.calls.length,0);
 const existing=await fixture({existing:true});assert.equal((await existing.signup()).status,409);assert.equal(existing.calls.length,0);
});
test('known provider failures provide safe Chinese messages without private upstream text',async()=>{
 for(const [code,status,expected] of [['email_address_not_authorized',400,503],['signup_disabled',422,503],['over_email_send_rate_limit',429,429],['weak_password',422,400],['email_not_confirmed',400,401]]){
 const f=await fixture({upstream:{error_code:code,message:'private upstream detail'},status});const r=await f.signup();assert.equal(r.status,expected);const text=await r.text();assert.match(text,/[\u4e00-\u9fff]/);assert.doesNotMatch(text,/private upstream/);assert.equal(r.headers.get('set-cookie'),null);}
 for(const options of [{transport:true},{nonJSON:true},{upstream:{error_code:'private-unknown',message:'private-detail'},status:500}]){const r=await(await fixture(options)).signup();assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private/);}
});
test('new provider password login, administrator login and existing native login remain separate',async()=>{
 const provider=await fixture();assert.equal((await provider.login()).status,200);assert.match(provider.calls[0][1],/grant_type=password/);
 for(const options of [{local:true},{admin:true}]){const f=await fixture(options);assert.equal((await f.login()).status,200);assert.equal(f.calls.filter(c=>c[0]==='upstream').length,0);}
 const disabled=await fixture({local:true,disabled:true});assert.equal((await disabled.login()).status,401);assert.equal(disabled.calls.length,0);
});
test('refresh exchanges only the private cookie and rotates both cookies; foreign origin never refreshes',async()=>{
 const f=await fixture();const r=await f.refresh('eco_geo_refresh=old-refresh');assert.equal(r.status,200);
 assert.match(f.calls[0][1],/grant_type=refresh_token/);assert.deepEqual(JSON.parse(f.calls[0][2].body),{refresh_token:'old-refresh'});
 assert.match(r.headers.get('set-cookie'),/eco_geo_refresh=test-refresh-token/);assert.doesNotMatch(await r.text(),/test-refresh-token|test-access-token/);
 const foreign=await fixture();assert.equal((await foreign.refresh('eco_geo_refresh=secret',{origin:'https://elsewhere.invalid'})).status,403);assert.equal(foreign.calls.length,0);
});
test('refresh validates healthy sessions, honors revoked provider responses, and never downgrades native identities',async()=>{
 const token='header.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.sig';
 const active=await fixture();assert.equal((await active.refresh('eco_geo_access='+token+'; eco_geo_refresh=refresh')).status,200);assert.equal(active.calls.length,0);
 const local=await fixture({invalidAccess:true});assert.equal((await local.refresh('eco_geo_access=tk_session_bad; eco_geo_refresh=refresh')).status,401);assert.equal(local.calls.length,0);
 const expired=await fixture({upstream:{error_code:'refresh_token_not_found'},status:400});assert.equal((await expired.refresh('eco_geo_refresh=revoked')).status,401);
 const absent=await fixture();assert.equal((await absent.refresh('')).status,401);assert.equal(absent.calls.length,0);
});
test('logout revokes exact native sessions and expires both browser cookies',async()=>{
 const f=await fixture();const token='tk_session_'+'b'.repeat(64);const r=await f.logout(token);assert.equal(r.status,200);assert.deepEqual(f.calls,[['revoke',token]]);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
});
