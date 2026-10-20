import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
const source=await readFile(new URL('../components/AuthForm.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const text=n=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):'';
async function render(href){let cursor=0;const hooks=[],effects=[],cleared=[],mod={exports:{}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,URL,URLSearchParams,queueMicrotask,window:{location:{href},history:{replaceState:(s,t,path)=>cleared.push(path)}},fetch:()=>{throw Error('Confirmation must not log in with a browser token');},require:n=>n==='react'?{useState(v){const i=cursor++;if(!(i in hooks))hooks[i]=v;return[hooks[i],x=>{hooks[i]=x;}];},useEffect(f){effects.push(f);}}:n==='react/jsx-runtime'?jsx:n==='next/link'?{default:'a'}:{Icon:()=>null}});
 mod.exports.AuthForm({mode:'login'});for(const f of effects.splice(0))f();await Promise.resolve();cursor=0;return{text:text(mod.exports.AuthForm({mode:'login'})),cleared};
}
test('confirmation callback clears URL bearer material without accepting it as a session',async()=>{
 const r=await render('https://tokvilo.com/login?verified=1#access_token=private-token&refresh_token=private-refresh');
 assert.deepEqual(r.cleared,['/login']);assert.match(r.text,/请使用邮箱和密码登录/);assert.doesNotMatch(r.text,/private-token|private-refresh/);
});
test('expired confirmation does not show successful verification',async()=>{
 const r=await render('https://tokvilo.com/login?verified=1#error=access_denied&error_description=private-detail');
 assert.match(r.text,/已失效或未完成/);assert.doesNotMatch(r.text,/private-detail|链接已处理/);
});
test('isolated refresh tokens and query errors are removed from callback URLs',async()=>{
 const refresh=await render('https://tokvilo.com/login#refresh_token=private-refresh');
 assert.deepEqual(refresh.cleared,['/login']);assert.doesNotMatch(refresh.text,/private-refresh/);
 const error=await render('https://tokvilo.com/login?error_code=otp_expired&error_description=private-detail');
 assert.deepEqual(error.cleared,['/login']);assert.match(error.text,/已失效或未完成/);
 assert.doesNotMatch(error.text,/private-detail|链接已处理/);
});
