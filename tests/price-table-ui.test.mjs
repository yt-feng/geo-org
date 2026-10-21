import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import { brandDisplay } from "./helpers/brand-display.mjs";

const filename = new URL("../components/PriceTable.tsx", import.meta.url).pathname;
const code = ts.transpileModule(await readFile(filename, "utf8"), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
function all(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(item => all(item, predicate));
  if (!node?.props) return [];
  return [...(predicate(node) ? [node] : []), ...all(node.props.children, predicate)];
}
async function fixture(payload) {
  const hooks = [], effects = []; let cursor = 0, tree;
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
        useEffect(effect) { const index = cursor++; if (!hooks[index]) { hooks[index] = {}; effects.push(effect); } },
      };
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/link") return { default: "a" };
      if (name === "@/lib/brand-display") return brandDisplay;
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async url => { assert.equal(url, "/api/pricing"); return Response.json(payload); },
  }, { filename });
  function render() { cursor = 0; tree = compiled.exports.PriceTable({}); for (const effect of effects.splice(0)) effect(); return tree; }
  render();
  const loading = text(tree);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  render();
  return { loading, render, tree: () => tree };
}

test("loaded model prices render only retail amounts, with filters preserving the selected rate", async () => {
  const f = await fixture({ observedAt: "2026-10-20T00:00:00Z", models: [
    { provider: "tokenhub", model: "chat-test", name: "Text model", kind: "chat",
      rates: [{ dimension: "input", unit: "1M_tokens", upstreamMicrousd: 98_000_000, retailMicrousd: 7_500_000 }] },
    { provider: "apimart", model: "image-test", name: "Image model", kind: "image",
      rates: [{ dimension: "image", unit: "image", upstreamMicrousd: 81_000_000, retailMicrousd: 25_000 }] },
  ] });
  assert.match(f.loading, /正在读取价格/);
  assert.match(text(f.tree()), /输入百万 tokens\$7\.5/);
  assert.match(text(f.tree()), /图像生成张\$0\.025/);
  assert.doesNotMatch(text(f.tree()), /\$98|\$81|源价|源头|加价|20\s*%|×\s*1\.20/);
  assert.deepEqual(all(f.tree(), node => node.type === "th").map(text), ["计费项", "单位", "tokvilo 价格", "计费项", "单位", "tokvilo 价格"]);
  all(f.tree(), node => node.type === "select")[0].props.onChange({ target: { value: "apimart" } });
  f.render();
  assert.equal(all(f.tree(), node => node.type === "table").length, 1);
  assert.match(text(f.tree()), /Image model.*\$0\.025/);
  assert.doesNotMatch(text(f.tree()), /Text model|\$7\.5|\$81/);
});

test("tiered, video, audio and add-on prices show their units and disabled adapters never link to generation", async () => {
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
  assert.match(rendered, /720p秒\$0\.012/);
  assert.match(rendered, /生成次\$0\.072/);
  assert.match(rendered, /搜索千次查询\$16\.8/);
  assert.match(rendered, /缓存存储百万 token·小时\$1\.2/);
  assert.match(rendered, /输入 ≤ 100,000 tokens/); assert.match(rendered, /前 5 项免费/);
  assert.match(rendered, /价格已列示 · 接口暂未开放/);
  assert.match(rendered, /当前开放基础音乐生成；其他操作价格仅供查阅/);
  const links = all(f.tree(), node => node.type === "a");
  assert.equal(links.length, 1); assert.match(links[0].props.href, /model=music/);
  assert.doesNotMatch(rendered, /源价|源头|加价|上游价格|20\s*%|×\s*1\.20/);
});

test("selected prices keep same-name models separate and never link unverified service rows to generation", async () => {
  const f = await fixture({ observedAt: "2026-10-21", models: [
    { provider: "apimart", model: "gpt-image-2", name: "Image", kind: "image", billingReady: true, rates: [{ dimension: "image", unit: "image", retailMicrousd: 12000 }] },
    { provider: "selected", model: "gpt-image-2", name: "Image", kind: "image", billingReady: false, rates: [{ dimension: "request", unit: "call", retailMicrousd: 6000 }] },
    { provider: "selected", model: "text", name: "Text", kind: "chat", billingReady: true, rates: [{ dimension: "input", unit: "1M_tokens", retailMicrousd: 800000 }] },
  ] });
  assert.equal(all(f.tree(), node => node.props.className === "price-model").length, 3);
  assert.equal(new Set(all(f.tree(), node => node.props.className === "price-model").map(node => node.key)).size, 3);
  all(f.tree(), node => node.type === "select")[0].props.onChange({ target: { value: "selected" } }); f.render();
  assert.equal(all(f.tree(), node => node.type === "table").length, 2);
  assert.match(text(f.tree()), /tokvilo 精选/); assert.match(text(f.tree()), /价格已列示 · 服务待开通/);
  const links = all(f.tree(), node => node.type === "a");
  assert.equal(links.length, 1); assert.equal(links[0].props.href, "/selected?model=text");
  assert.doesNotMatch(text(f.tree()), /rkapi|源价|加价/i);
});
