import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
async function fixture(options={}){
 const filename=new URL('../app/api/auth/status/route.ts',import.meta.url).pathname,compiled={exports:{}},calls=[];
 const {outputText}=ts.transpileModule(await readFile(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 vm.runInNewContext(outputText,{module:compiled,exports:compiled.exports,Response,Headers,URL,AbortSignal,
 require(name){assert.equal(name,'@/lib/auth');return{authBaseUrl(){if(options.missing)throw Error('private config');return options.base??'https://project.supabase.co';},authRequestHeaders:()=>new Headers({apikey:'private-key'})};},
 async fetch(url,init){calls.push({url,init});if(options.transport)throw Error('private transport');return Response.json(options.settings??{disable_signup:false,mailer_autoconfirm:false,external:{email:true}},{status:options.status??200});}});
 return{get:compiled.exports.GET,calls};
}
test('status reports the real provider verification policy and caches concurrent health requests',async()=>{
 const f=await fixture();const responses=await Promise.all([f.get(),f.get(),f.get()]);const d=await responses[0].json();assert.equal(d.available,true);assert.equal(d.signupEnabled,true);assert.equal(d.emailAutoConfirm,false);assert.equal(d.registrationSendsEmail,true);assert.equal(d.providerFamily,'supabase');
 await f.get();assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.redirect,'manual');assert.match(f.calls[0].url,/auth\/v1\/settings$/);assert.ok(f.calls[0].init.signal instanceof AbortSignal);assert.match(responses[0].headers.get('cache-control'),/max-age=60/);assert.doesNotMatch(JSON.stringify(d),/private|project|https/);
});
test('status distinguishes disabled registration, auto-confirm, and unknown legacy flags',async()=>{
 for(const [settings,enabled,mail] of [[{disable_signup:true,mailer_autoconfirm:false,external:{email:true}},false,true],[{disable_signup:false,mailer_autoconfirm:true,external:{email:true}},true,false],[{mailer_autoconfirm:false,external:{email:true}},null,true]]){
 const f=await fixture({settings});const d=await(await f.get()).json();assert.equal(d.available,true);assert.equal(d.signupEnabled,enabled);assert.equal(d.registrationSendsEmail,mail);}
});
test('invalid configuration and upstream failures expose only safe diagnostics',async()=>{
 for(const [options,code] of [[{missing:true},'auth_not_configured'],[{base:'https://localhost'},'auth_config_invalid'],[{base:'https://your-project.supabase.co'},'auth_config_invalid'],[{status:401},'auth_credentials_rejected'],[{status:500,settings:{error:'private details'}},'auth_upstream_unavailable'],[{transport:true},'auth_upstream_unavailable'],[{settings:{}},'auth_invalid_response']]){
 const f=await fixture(options),r=await f.get(),d=await r.json();assert.equal(r.status,503);assert.equal(d.available,false);assert.equal(d.errorCode,code);assert.doesNotMatch(JSON.stringify(d),/private|project|https/);if(!d.configured)assert.equal(f.calls.length,0);
 if(options.transport){assert.equal(d.fetchErrorName,'Error');assert.equal(d.failureStage,'fetch');}}
});
