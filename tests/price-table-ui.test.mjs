import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import { identity } from "./helpers/model-identity.mjs";
import { brandDisplay } from "./helpers/brand-display.mjs";
import { catalog } from "./helpers/model-catalog.mjs";

const filename = new URL("../components/PriceTable.tsx", import.meta.url).pathname;
const code = ts.transpileModule(await readFile(filename, "utf8"), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const priceCopyModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../lib/price-copy.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: priceCopyModule, exports: priceCopyModule.exports });
const creditModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL("../lib/credits.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: creditModule, exports: creditModule.exports });
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
function all(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(item => all(item, predicate));
  if (!node?.props) return [];
  return [...(predicate(node) ? [node] : []), ...all(node.props.children, predicate)];
}
async function fixture(payload, locale = 'zh', props = {}) {
  const hooks = [], effects = [], scrolls = [], focusCalls = []; let cursor = 0, tree;
  const compiled = { exports: {} };
  vm.runInNewContext(code, {
    module: compiled, exports: compiled.exports, AbortController,
    require(name) {
      if (name === "react") return {
        useState(initial) {
          const index = cursor++;
          if (!hooks[index]) hooks[index] = { value: initial };
          return [hooks[index].value, value => { hooks[index].value = value; }];
        },
        useRef(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { current: initial }; return hooks[index]; },
        useEffect(effect) { const index = cursor++; if (!hooks[index]) { hooks[index] = {}; effects.push(effect); } },
      };
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/link") return { default: "a" };
      if (name === "@/lib/model-identity") return identity;
      if (name === "@/lib/model-catalog") return catalog;
      if (name === "./ProviderLogo") return {ProviderLogo:()=>null};
      // This suite exercises the parent table; the real comparison leaf has separate SSR tests.
      if (name === "@/lib/credits") return creditModule.exports;
      if (name === "./CreditBudgetPlanner") return { CreditBudgetPlanner: () => null };
      if (name === "./OfficialPriceComparison") return { OfficialPriceComparison: () => null };
      if (name === "./LocaleProvider") return {useSiteLocale:()=>({isEnglish:locale === 'en',t:(zh,en)=>locale === 'en' ? en : zh,href:p=>p})};
      if (name === "@/lib/price-copy") return priceCopyModule.exports;
      if (name === "@/lib/brand-display") return brandDisplay;
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async url => { assert.equal(url, "/api/pricing"); return Response.json(payload); },
  }, { filename });
  function render() { cursor = 0; tree = compiled.exports.PriceTable(props); for (const node of all(tree, node => node.props.ref)) node.props.ref.current = { scrollIntoView: options => scrolls.push(options), focus: options => focusCalls.push(options) }; for (const effect of effects.splice(0)) effect(); return tree; }
  render();
  const loading = text(tree);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  render();
  return { loading, render, tree: () => tree, scrolls, focusCalls };
}

test("loaded model prices render only retail amounts, with filters preserving the selected rate", async () => {
  const f = await fixture({ observedAt: "2026-10-20T00:00:00Z", models: [
    { provider: "tokenhub", model: "chat-test", name: "Text model", kind: "chat",
      rates: [{ dimension: "input", unit: "1M_tokens", upstreamMicrousd: 98_000_000, retailMicrousd: 7_500_000 }] },
    { provider: "apimart", model: "image-test", name: "Image model", kind: "image",
      rates: [{ dimension: "image", unit: "image", upstreamMicrousd: 81_000_000, retailMicrousd: 25_000 }] },
  ] });
  assert.match(f.loading, /正在读取价格/);
  assert.match(text(f.tree()), /输入百万 tokens7,500 积分 \(\$7\.5\)/);
  assert.match(text(f.tree()), /图像生成张25 积分 \(\$0\.025\)/);
  assert.doesNotMatch(text(f.tree()), /\$98|\$81|源价|源头|加价|20\s*%|×\s*1\.20/);
  assert.deepEqual(all(f.tree(), node => node.type === "th").map(text), ["计费项", "单位", "tokvilo 价格", "计费项", "单位", "tokvilo 价格"]);
  all(f.tree(), node => node.type === "select" && node.props['aria-label'] === '筛选价格服务')[0].props.onChange({ target: { value: "apimart" } });
  f.render();
  assert.equal(all(f.tree(), node => node.type === "table").length, 1);
  assert.match(text(f.tree()), /Image model.*\$0\.025/);
  assert.doesNotMatch(text(f.tree()), /Text model|\$7\.5|\$81/);
});

test("tiered, video, audio and add-on prices keep their units and all adapters link to their own playground", async () => {
  const f = await fixture({ observedAt: "2026-10-20T00:00:00Z", models: [
    { provider: "apimart", model: "video", name: "Video", kind: "video", billingReady: false, rates: [
      { dimension: "720p", label: "720p", unit: "second", retailMicrousd: 12000 },
      { dimension: "input:image", label: "参考图片", unit: "image", retailMicrousd: 2000, condition: "前 5 项免费" },
    ] },
    { provider: "apimart", model: "music", name: "Music", kind: "audio", billingReady: true,
      capabilitiesNotes: ["当前开放基础音乐生成；其他操作价格仅供查阅。"], rates: [
      { dimension: "generate", label: "生成", unit: "call", retailMicrousd: 72000 },
    ] },
    { provider: "apimart", model: "tiered", name: "Tiered", kind: "chat", billingReady: false, rates: [
      { dimension: "tier1:input", label: "输入", unit: "1M_tokens", retailMicrousd: 96000, condition: "输入 ≤ 100,000 tokens" },
      { dimension: "tool:search", label: "搜索", unit: "1000_queries", retailMicrousd: 16800000 },
      { dimension: "storage", label: "缓存存储", unit: "1M_token_hours", retailMicrousd: 1200000 },
    ], notes: ["附加功能仅在使用时计费。"] },
  ] });
  const rendered = text(f.tree());
  assert.match(rendered, /720p秒12 积分 \(\$0\.012\)/);
  assert.match(rendered, /生成次72 积分 \(\$0\.072\)/);
  assert.match(rendered, /搜索千次查询16,800 积分 \(\$16\.8\)/);
  assert.match(rendered, /缓存存储百万 token·小时1,200 积分 \(\$1\.2\)/);
  assert.match(rendered, /输入 ≤ 100,000 tokens/); assert.match(rendered, /前 5 项免费/);
  assert.match(rendered, /价格已列示 · 接口暂未开放/);
  assert.match(rendered, /当前开放基础音乐生成；其他操作价格仅供查阅/);
  const links = all(f.tree(), node => node.type === "a");
  assert.equal(links.length, 3);
  for (const link of links) {
    const url = new URL(link.props.href, "https://tokvilo.com");
    assert.equal(url.pathname, "/playground");
    assert.equal(url.searchParams.get("service"), "gateway");
    assert.equal(url.searchParams.get("category"), url.searchParams.get("model") === "video" ? "video" : url.searchParams.get("model") === "music" ? "audio" : "text");
  }
  assert.doesNotMatch(rendered, /源价|源头|加价|上游价格|20\s*%|×\s*1\.20/);
});

test("selected prices keep same-name models and activation status separate with exact playground links", async () => {
  const f = await fixture({ observedAt: "2026-10-21", models: [
    { provider: "apimart", model: "gpt-image-2", name: "Image", kind: "image", billingReady: true, rates: [{ dimension: "image", unit: "image", retailMicrousd: 12000 }] },
    { provider: "selected", model: "gpt-image-2", name: "Image", kind: "image", billingReady: false, rates: [{ dimension: "request", unit: "call", retailMicrousd: 6000 }] },
    { provider: "selected", model: "text", name: "Text", kind: "chat", billingReady: true, rates: [{ dimension: "input", unit: "1M_tokens", retailMicrousd: 800000 }] },
  ] });
  assert.equal(all(f.tree(), node => node.props.className === "price-model").length, 3);
  assert.equal(new Set(all(f.tree(), node => node.props.className === "price-model").map(node => node.key)).size, 3);
  all(f.tree(), node => node.type === "select" && node.props['aria-label'] === '筛选价格服务')[0].props.onChange({ target: { value: "selected" } }); f.render();
  assert.equal(all(f.tree(), node => node.type === "table").length, 2);
  assert.match(text(f.tree()), /tokvilo 精选/); assert.match(text(f.tree()), /价格已列示 · 服务待开通/);
  const links = all(f.tree(), node => node.type === "a");
  assert.equal(links.length, 2);
  assert.deepEqual(links.map(link => link.props.href).sort(), ["/playground?service=selected&model=gpt-image-2&category=image", "/playground?service=selected&model=text&category=text"]);
  assert.doesNotMatch(text(f.tree()), /rkapi|源价|加价/i);
});

test("token-priced speech and transcription keep audio categories without claiming chat availability", async () => {
  const models = ["tts-1", "whisper-1", "gpt-4o-realtime-preview", "text-embedding-3-small"].map(model => ({
    provider: "apimart", model, name: model, kind: "chat", billingReady: false, rates: [],
  }));
  const f = await fixture({ observedAt: "2026-10-23", models }, "en");
  for (const card of all(f.tree(), node => node.props.className === "price-model")) {
    const link = all(card, node => node.type === "a")[0], url = new URL(link.props.href, "https://tokvilo.com");
    assert.equal(url.searchParams.get("category"), url.searchParams.get("model").startsWith("text-embedding") ? "text" : "audio");
    assert.match(text(card), /Interface unavailable/);
  }
});

test('English family comparisons preserve version order, billing units and independent service prices', async () => {
  const f = await fixture({ observedAt: '2026-10-23', models: [
    { provider: 'apimart', model: 'gpt-4.1', name: 'GPT 4.1', kind: 'chat', billingReady: true,
      rates: [{ dimension: 'input', unit: '1M_tokens', retailMicrousd: 2400000, condition: '输入 ≤ 100,000 tokens' }] },
    { provider: 'apimart', model: 'gpt-5.2', name: 'GPT 5.2', kind: 'chat', billingReady: true,
      rates: [{ dimension: 'input', unit: '1M_tokens', retailMicrousd: 2100000 },
        { dimension: 'cached_input', unit: '1M_tokens', retailMicrousd: 210000 },
        { dimension: 'output', unit: '1M_tokens', retailMicrousd: 12000000 }],
      capabilitiesNotes: ['当前开放纯文本对话；多模态输入、工具调用和显式缓存创建暂未开放。'] },
    { provider: 'selected', model: 'gpt-5.2', name: 'GPT 5.2', kind: 'chat', billingReady: false,
      rates: [{ dimension: 'input', unit: '1M_tokens', retailMicrousd: 800000 }], notes: ['价格已列示，服务待开通。'] },
  ] }, 'en');
  const cards = all(f.tree(), node => node.props.className === 'price-model');
  assert.deepEqual(cards.map(node => node.key), ['apimart:gpt-5.2', 'selected:gpt-5.2', 'apimart:gpt-4.1']);
  assert.match(text(f.tree()), /Input1M tokens2,100 credits \(\$2\.1\)/);
  assert.match(text(f.tree()), /Input1M tokens800 credits \(\$0\.8\)/);
  assert.match(text(f.tree()), /Input ≤ 100,000 tokens/);
  assert.match(text(f.tree()), /Pricing listed · Activation pending/);
  const preview = all(cards[0], node => node.props.className === 'price-preview')[0];
  assert.match(text(preview), /Input.*Output/);
  assert.doesNotMatch(text(preview), /Cached/);
  assert.match(text(cards[0]), /Cached input1M tokens210 credits \(\$0\.21\)/, 'complete rates must retain caching prices');
  assert.doesNotMatch(text(f.tree()), /[\u4e00-\u9fff]|tokenhub|apimart|rkapi/i);
  assert.equal(all(f.tree(), node => node.type === 'a').length, 3);
  assert.equal(all(f.tree(), node => node.type === 'details').every(node => node.props.open === false), true);
});

const catalogPrice = (model, provider = 'apimart') => ({ provider, model, name: model, kind: 'chat', billingReady: true,
  rates: [{ dimension: 'input', unit: '1M_tokens', retailMicrousd: 2400000 }, { dimension: 'output', unit: '1M_tokens', retailMicrousd: 9600000 }] });

test('pricing pages stay bounded while every family version and separate service remains reachable', async () => {
  const models = [...Array.from({ length: 27 }, (_, index) => catalogPrice(`gpt-5.${index}`)),
    ...Array.from({ length: 3 }, (_, index) => catalogPrice(`gpt-5.${index}`, 'selected')),
    catalogPrice('claude-sonnet-4'), catalogPrice('claude-opus-4'), catalogPrice('gpt-image-2')];
  const f = await fixture({ observedAt: '2026-10-23', models }, 'en');
  const seen = new Set();
  for (let page = 1; page <= 3; page++) {
    const cards = all(f.tree(), node => node.props.className === 'price-model');
    assert.equal(cards.length, page === 3 ? 9 : 12);
    for (const card of cards) { assert.equal(seen.has(card.key), false); seen.add(card.key); }
    assert.match(text(f.tree()), new RegExp(`Showing ${(page - 1) * 12 + 1}–${Math.min(page * 12, 33)} of 33 service versions`));
    const next = all(f.tree(), node => node.type === 'button' && text(node) === 'Next')[0];
    assert.equal(next.props.disabled, page === 3);
    if (page < 3) { next.props.onClick(); f.render(); }
  }
  assert.deepEqual(seen, new Set(models.map(item => `${item.provider}:${item.model}`)));
  assert.equal(f.scrolls.length, 2, 'page changes return to the result heading');
  assert.equal(f.scrolls.every(options => options.block === 'start'), true);
  assert.equal(f.focusCalls.length, 2, 'keyboard focus follows page changes back to the results');
  assert.equal(f.focusCalls.every(options => options.preventScroll === true), true);
  assert.equal(all(f.tree(), node => node.props.className === 'price-results')[0].props.tabIndex, -1);
  all(f.tree(), node => node.type === 'button' && text(node) === 'Previous')[0].props.onClick(); f.render();
  assert.match(text(f.tree()), /Showing 13–24 of 33/);
  all(f.tree(), node => node.type === 'select' && node.props['aria-label'] === 'Select price page')[0].props.onChange({ target: { value: '1' } }); f.render();
  assert.equal(all(f.tree(), node => node.type === 'button' && text(node) === 'Previous')[0].props.disabled, true);
});

test('provider and family navigation resets pagination and retains active context in both locales', async () => {
  const models = [...Array.from({ length: 15 }, (_, index) => catalogPrice(`gpt-5.${index}`)),
    catalogPrice('claude-sonnet-4'), catalogPrice('gpt-image-2')];
  for (const locale of ['en', 'zh']) {
    const f = await fixture({ observedAt: '2026-10-23', models }, locale);
    all(f.tree(), node => node.type === 'button' && text(node) === (locale === 'en' ? 'Next' : '下一页'))[0].props.onClick(); f.render();
    const providerNav = all(f.tree(), node => node.type === 'nav' && node.props.className === 'price-provider-list')[0];
    all(providerNav, node => node.type === 'button' && text(node).includes('Anthropic'))[0].props.onClick(); f.render();
    assert.equal(all(f.tree(), node => node.props.className === 'price-model').length, 1);
    assert.match(text(f.tree()), locale === 'en' ? /Showing 1–1 of 1/ : /显示 1–1 \/ 共 1/);
    assert.equal(all(f.tree(), node => node.type === 'nav' && node.props.className === 'price-pagination').length, 0);
    const mobileProvider = all(f.tree(), node => node.type === 'label' && node.props.className === 'price-mobile-provider')[0];
    all(mobileProvider, node => node.type === 'select')[0].props.onChange({ target: { value: 'OPENAI' } }); f.render();
    const filters = all(f.tree(), node => node.props.className === 'price-filters')[0];
    const familySelect = all(filters, node => node.type === 'select').find(node => all(node, option => option.type === 'option' && option.props.value === 'OPENAI:gpt-image').length);
    familySelect.props.onChange({ target: { value: 'OPENAI:gpt-image' } }); f.render();
    assert.match(text(all(f.tree(), node => node.props.className === 'price-results-heading')[0]), /OpenAI \/ GPT Image/);
    assert.equal(all(f.tree(), node => node.props.className === 'price-model')[0].key, 'apimart:gpt-image-2');
    all(f.tree(), node => node.type === 'input')[0].props.onChange({ target: { value: 'gpt-5.14' } }); f.render();
    assert.equal(all(f.tree(), node => node.props.className === 'price-model')[0].key, 'apimart:gpt-5.14');
    assert.doesNotMatch(text(f.tree()), /tokenhub|apimart|rkapi|源价/i);
  }
});

test('model-specific price details preserve the full service-filtered rates without catalogue navigation', async () => {
  const models = [catalogPrice('gpt-5.2'), catalogPrice('gpt-5.2', 'selected'), catalogPrice('claude-sonnet-4')];
  models[0].rates.push({ dimension: 'tool:search', label: '搜索', unit: '1000_queries', retailMicrousd: 16800000, condition: '输入 ≤ 100,000 tokens' });
  const f = await fixture({ observedAt: '2026-10-23', models }, 'en', { provider: 'apimart', model: 'gpt-5.2' });
  assert.equal(all(f.tree(), node => node.props.className === 'price-model').length, 1);
  assert.equal(all(f.tree(), node => node.type === 'aside' || node.type === 'nav').length, 0);
  assert.equal(all(f.tree(), node => node.type === 'details')[0].props.open, true);
  assert.equal(all(f.tree(), node => node.type === 'tbody')[0].props.children.length, 3);
  assert.match(text(f.tree()), /1,000 queries16,800 credits \(\$16\.8\)/);
  assert.match(text(f.tree()), /Input ≤ 100,000 tokens/);
  assert.doesNotMatch(text(f.tree()), /\$0|claude|tokvilo Select/);
});
