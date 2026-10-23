import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { brandDisplay } from './helpers/brand-display.mjs';
async function load(path,mocks={}) {
 const f=new URL(path,import.meta.url), mod={exports:{}};
 const code=ts.transpileModule(await readFile(f,'utf8'),{fileName:f.pathname,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{module:mod,exports:mod.exports,require:n=>{if(n in mocks)return mocks[n];throw Error(n);},URL,URLSearchParams,Event,window:{dispatchEvent(){},location:{pathname:'/models',search:'',hash:''},history:{state:null,pushState(){},replaceState(){}}}});return mod.exports;
}
const snapshot=JSON.parse(await readFile(new URL('../lib/model-directory-snapshot.json',import.meta.url),'utf8'));
const refs=await load('../lib/tokenhub-model-reference.ts');
const modelIds=await load('../lib/model-id.ts');
const requestKinds=await load('../lib/model-request-kind.ts');
const modelIdentity=await load('../lib/model-identity.ts');
const catalog=await load('../lib/model-catalog.ts',{'./tokenhub-model-reference':refs,'./model-directory-snapshot.json':{default:snapshot},'./model-id':modelIds,'./model-request-kind':requestKinds,'./model-identity':modelIdentity});
const input={success:true,data:{models:{llm:[{id:'glm-5',name:'GLM-5'}],image:[{id:'gpt-image-2',name:'GPT Image 2'},{id:'grok-imagine-1.5-apimart',name:'Grok APIMart'}],video:[{id:'veo3.1-fast',name:'Veo'}],audio:[{id:'suno',name:'Suno'}]}}};
const selectedObservedAt='2026-10-01T08:00:00.000Z';
async function directoryWith(pricing, selected = [], fetch = async()=>input) {
 return load('../lib/model-directory.ts',{'./rkapi-catalog':{rkapiModelCatalog:async()=>selected,rkapiCatalogObservedAt:selectedObservedAt},'./model-catalog':catalog,'./model-directory-snapshot.json':{default:snapshot},'./apimart-pricing':{parseApimartPricing:pricing,fetchApimartPricingPayload:fetch}});
}
const parser=await directoryWith(()=>({models:[{model:'gpt-image-2',kind:'image'}]}));

test('complete snapshot includes every category, no cost metadata, and no intermediary display names',()=>{
 assert.equal(snapshot.models.length,295);
 assert.equal(new Set(snapshot.models.map(m=>m.id)).size,295);
 for(const [category,count] of [['image',49],['video',54],['audio',9],['text',183]])assert.equal(catalog.modelCatalog.filter(m=>m.category===category).length,count);
 assert.equal(catalog.modelCatalog.length,295);
 assert.equal(new Set(catalog.modelCatalog.map(m=>m.id)).size,295);
 assert.doesNotMatch(JSON.stringify(catalog.modelCatalog.map(({name,description})=>({name,description}))),/apimart|tokenhub/i);
 assert.doesNotMatch(JSON.stringify(snapshot),/upstream|original_price|after_discount|retail|markup|sourceUrl/i);
});

test('known public aliases are exact and executable status is matched using source identifiers',async()=>{
 const parser=await directoryWith(()=>({models:[{model:'grok-imagine-1.5-apimart',kind:'image'}]}));
 const entry=parser.parseModelDirectory(input).find(m=>m.id==='grok-imagine-1.5-tokvilo');
 assert.equal(entry.available,true);
 assert.equal(new URL(catalog.modelWorkbenchUrl(entry),'https://tokvilo.com').searchParams.get('model'),entry.id);
 assert.equal(catalog.catalogEntry('unknown-apimart','Unknown','text').id,'unknown-apimart','Unknown identities are never blindly rewritten');
});

test('token-priced non-chat capabilities are classified accurately and never advertised as chat calls',async()=>{
 const ids=['text-embedding-3-small','omni-moderation-latest','gpt-4o-transcribe','gpt-4o-realtime-preview','tts-1','whisper-1','babbage-002','davinci-002','gpt-3.5-turbo-instruct'];
 const parser=await directoryWith(()=>({models:ids.map(model=>({model,kind:'chat'}))}));
 const entries=parser.parseModelDirectory({success:true,data:{models:{llm:ids.map(id=>({id,name:id}))}}});
 assert.ok(entries.every(model=>model.available===false));
 assert.equal(entries.find(m=>m.id==='text-embedding-3-small').capabilities[0],'向量嵌入');
 assert.equal(entries.find(m=>m.id==='omni-moderation-latest').capabilities[0],'内容审核');
 assert.equal(entries.find(m=>m.id==='gpt-4o-transcribe').category,'audio');
 assert.equal(entries.find(m=>m.id==='gpt-4o-realtime-preview').capabilities[0],'实时音频');
 assert.equal(entries.find(m=>m.id==='babbage-002').capabilities[0],'文本补全');
 assert.equal(catalog.catalogEntry('unknown-audio','Audio','audio',true).capabilities[0],'音频处理');
 assert.equal(catalog.catalogEntry('gpt-4o-transcribe','Transcribe','text',true).available,false);
 assert.equal(requestKinds.modelRequestKind('gpt-4o','llm'),'chat');
});

test('pricing by one interface cannot activate another and pricing failures preserve the whole live catalogue',async()=>{
 const mismatched=await directoryWith(()=>({models:[{model:'glm-5',kind:'image'},{model:'gpt-image-2',kind:'chat'}]}));
 assert.ok(mismatched.parseModelDirectory(input).every(model=>model.available===false));
 const withoutPrices=await directoryWith(()=>{throw Error('no_supported_prices');});
 const rows=withoutPrices.parseModelDirectory(input);
 assert.equal(rows.length,5);
 assert.equal(rows.find(m=>m.id==='glm-5').available,undefined);
 assert.equal(rows.find(m=>m.id==='suno').available,undefined);
 const live=await withoutPrices.getModelDirectory();
 assert.equal(live.live,true);assert.equal(live.models.length,14);
});

test('new video and music adapters activate only their matching live priced interface',async()=>{
 const media=await directoryWith(()=>({models:[{model:'veo3.1-fast',kind:'video'},{model:'suno',kind:'audio'}]}));
 const rows=media.parseModelDirectory(input);
 assert.equal(rows.find(m=>m.id==='veo3.1-fast').available,true);
 assert.equal(rows.find(m=>m.id==='suno').available,true);
 const noAudio=await directoryWith(()=>({models:[{model:'suno',kind:'chat'}]}));
 assert.equal(noAudio.parseModelDirectory(input).find(m=>m.id==='suno').available,false);
 assert.equal(catalog.catalogEntry('gpt-4o-transcribe','Transcribe','text',true).available,false);
});

test('selected service preserves duplicate model IDs without borrowing another service availability',async()=>{
 const selected={id:'gpt-image-2',name:'GPT Image 2',provider:'OPENAI',category:'image',capabilities:['文生图'],description:'tokvilo 精选',docs:'/dashboard/docs?provider=selected',upstream:'selected',available:false};
 const directory=await directoryWith(()=>({models:[{model:'gpt-image-2',kind:'image'}]}),[selected]);
 const result=await directory.getModelDirectory();
 const duplicates=result.models.filter(item=>item.id==='gpt-image-2');
 assert.equal(duplicates.length,2);
 assert.equal(duplicates.find(item=>item.upstream==='apimart').available,true);
 assert.equal(duplicates.find(item=>item.upstream==='selected').available,false);
 assert.equal(new URL(catalog.modelWorkbenchUrl(selected),'https://tokvilo.com').pathname,'/playground');
 assert.equal(new URL(catalog.modelWorkbenchUrl(selected),'https://tokvilo.com').searchParams.get('service'),'selected');
 assert.equal(new URL(catalog.modelWorkbenchUrl(duplicates[0]),'https://tokvilo.com').pathname,'/playground');
});

test('directory freshness remains scoped to each service on live and fallback paths',async()=>{
 const live=await parser.getModelDirectory();
 const selected=live.sources.find(source=>source.service==='selected');
 assert.equal(selected.live,false);
 assert.equal(selected.observedAt,selectedObservedAt);
 assert.equal(live.sources.find(source=>source.service==='gateway').live,true);
 assert.equal(live.sources.find(source=>source.service==='gateway').observedAt,live.observedAt);
 assert.deepEqual(JSON.parse(JSON.stringify(live.sources.find(source=>source.service==='studio'))),{service:'studio',observedAt:null,live:false});
 assert.ok(live.sources.every(source=>Object.keys(source).sort().join(',')==='live,observedAt,service'));
 const failing=await directoryWith(()=>({models:[]}),[],async()=>{throw Error('unavailable');});
 const fallback=await failing.getModelDirectory();
 assert.equal(fallback.sources.find(source=>source.service==='gateway').live,false);
 assert.equal(fallback.sources.find(source=>source.service==='gateway').observedAt,snapshot.observedAt);
 assert.equal(fallback.sources.find(source=>source.service==='selected').observedAt,selectedObservedAt);
 assert.equal(fallback.sources.find(source=>source.service==='selected').live,false);
});

test('live directory keeps every row regardless of billing status and sees newly added models',async()=>{
 const models=parser.parseModelDirectory(input);
 assert.equal(models.length,5);
 assert.equal(models.find(m=>m.id==='gpt-image-2').available,true);
 assert.equal(models.find(m=>m.id==='suno').available,false);
 assert.equal(models.find(m=>m.id==='glm-5').provider,'ZHIPU');
 const updated=structuredClone(input);updated.data.models.image.push({id:'future-image',name:'Future Image'});
 assert.equal(parser.parseModelDirectory(updated).length,6);
 const live=await parser.getModelDirectory();assert.equal(live.live,true);assert.equal(live.models.length,14);
 const invalid=structuredClone(input);invalid.data.models.image.push(invalid.data.models.image[0]);assert.throws(()=>parser.parseModelDirectory(invalid));
});
const text=n=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):'';
const all=(n,p)=>Array.isArray(n)?n.flatMap(x=>all(x,p)):!n?.props?[]:[...(p(n)?[n]:[]),...all(n.props.children,p)];
test('switching categories clears incompatible manufacturer filters and shows scoped options',async()=>{
 const hooks=[];let index=0,tree;
 const ui=await load('../components/ModelMarket.tsx',{
  '@/lib/model-catalog':catalog,'@/lib/brand-display':brandDisplay,'@/lib/model-identity':modelIdentity,'react/jsx-runtime':jsx,'next/link':{default:'a'},'./Icon':{Icon:()=>null},'./PriceTable':{PriceTable:()=>null},'./ProviderLogo':{ProviderLogo:()=>null},'./LocaleProvider':{useSiteLocale:()=>({isEnglish:false,t:zh=>zh,href:path=>path})},
  react:{useState(initial){const i=index++;if(!(i in hooks))hooks[i]=initial;return [hooks[i],v=>{hooks[i]=v;}];},useEffect(){},useRef:()=>({current:null}),useMemo:f=>f()}
 });
 const render=()=>{index=0;tree=ui.ModelMarket({catalog:parser.parseModelDirectory(input),live:true,observedAt:'2026-10-21T00:00:00.000Z',sources:[{service:'selected',observedAt:selectedObservedAt,live:false}]});};render();
 assert.match(text(tree),/tokvilo 模型服务目录已实时同步。 模型服务目录更新于 2026-10-21/);
 assert.match(text(tree),/tokvilo 精选为 2026-10-01 目录与价格快照/);
 assert.doesNotMatch(text(tree),/tokvilo 精选为 2026-10-21/);
 const providerGroup=all(tree,n=>n.props['aria-label']==='模型厂商')[0];
 const provider=all(providerGroup,n=>n.type==='button').find(n=>all(n,child=>child.type==='span').some(child=>text(child)==='智谱'));assert.ok(provider);assert.match(text(provider),/智谱1$/);provider.props.onClick();render();assert.match(text(tree),/1 个模型/);
 const categoryGroup=all(tree,n=>n.props['aria-label']==='模型类型')[0];
 all(categoryGroup,n=>n.type==='button').find(n=>text(n).startsWith('图像')).props.onClick();render();
 assert.match(text(tree),/2 个模型/);assert.equal(all(tree,n=>n.props['aria-label']==='模型厂商').some(n=>text(n).includes('智谱')),false);
 assert.doesNotMatch(text(tree),/未找到匹配模型|APIMart|源价|加价/);
});
