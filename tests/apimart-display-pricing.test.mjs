import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const cache = new Map();
async function load(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  if (url.pathname.endsWith(".json")) return JSON.parse(await readFile(url, "utf8"));
  const { outputText } = ts.transpileModule(await readFile(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const dependencies = {};
  for (const [, name] of outputText.matchAll(/require\(["']([^"']+)["']\)/g)) {
    assert.ok(name.startsWith("."), `Unexpected dependency ${name}`);
    dependencies[name] = await load(new URL(name.endsWith(".json") ? name : `${name}.ts`, url));
  }
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    module: mod, exports: mod.exports, require: name => dependencies[name], TextEncoder, TextDecoder,
    Uint8Array, AbortSignal, Response, structuredClone,
    fetch() { throw Error("Display pricing tests must not use the network"); },
  });
  cache.set(url.href, mod.exports); return mod.exports;
}
const pricing = await load(new URL("../lib/pricing.ts", import.meta.url));
const execution = await load(new URL("../lib/apimart-pricing.ts", import.meta.url));
const display = await load(new URL("../lib/apimart-display-pricing.ts", import.meta.url));
// Official public JSON snapshot, reduced to fields used by price parsing; no accounts or credentials.
const snapshot = JSON.parse(await readFile(new URL("./fixtures/apimart-pricing-20261020.json", import.meta.url), "utf8"));
const catalog = display.parseApimartDisplayPricing(snapshot, "2026-10-20T00:00:00Z");
const model = id => catalog.models.find(item => item.model === id);

test("all 293 dated official models have retail prices, independently of executable adapters", () => {
  assert.equal(catalog.models.length, 293);
  assert.equal(catalog.models.filter(item => item.kind === "image").length, 47);
  assert.equal(catalog.models.filter(item => item.kind === "video").length, 54);
  assert.equal(catalog.models.filter(item => item.kind === "audio").length, 2);
  assert.equal(catalog.models.filter(item => item.kind === "chat").length, 190);
  assert.equal(catalog.unavailable.length, 0);
  assert.ok(catalog.models.every(item => item.rates.length > 0 && item.available));
  assert.ok(catalog.models.every(item => item.notes.length === 0), JSON.stringify(catalog.models.filter(item => item.notes.length).map(item => ({ id: item.model, notes: item.notes }))));
  const executable = new Set(execution.parseApimartPricing(snapshot).models.map(item => item.model));
  for (const item of catalog.models) {
    const { upstreamModelId } = cache.get(new URL("../lib/model-id.ts", import.meta.url).href);
    assert.equal(item.billingReady, executable.has(upstreamModelId(item.model)));
    assert.equal(new Set(item.rates.map(rate => rate.dimension)).size, item.rates.length);
  }
  assert.equal(model("gpt-5.4").billingReady, true, "multi-tier activation must use preserved pricing metadata");
  assert.doesNotMatch(JSON.stringify(catalog), /upstreamMicrousd|upstreamRates|markupPercent|sourceUrl|original_price|after_discount|price_factor|group_ratio|member_prices|apimart\.ai|加价|源价|源头/);
});

test("fractional micro prices round only after the complete retail conversion", () => {
  assert.equal(pricing.retailUsdMicrousd(0.0205712), 24686);
  assert.equal(pricing.retailUsdMicrousd(0.0000001), 1);
  assert.equal(pricing.retailUsdMicrousd(0), 0);
  assert.equal(pricing.retailUsdMicrousd(0.025, 0.8), 24000);
  assert.equal(pricing.retailUsdMicrousd(0.625, 0.8), 600000);
  assert.throws(() => pricing.retailUsdMicrousd(-1));
  assert.throws(() => pricing.retailUsdMicrousd(Number.NaN));
  const qwen = model("qwen-image-3.0");
  assert.ok(qwen.rates.some(rate => rate.retailMicrousd === 24686));
});

test("tier ranges, time windows, image token modalities and additional fees remain separately described", () => {
  const haiku = model("claude-haiku-5-5");
  assert.equal(haiku.rates.find(rate => rate.dimension === "tier1:input").retailMicrousd, 96000);
  assert.equal(haiku.rates.find(rate => rate.dimension === "tier2:input").retailMicrousd, 480000);
  assert.equal(haiku.rates.find(rate => rate.dimension === "tier1:input").tierMaxInputTokens, 100000);
  assert.equal(haiku.rates.find(rate => rate.dimension === "tier2:input").tierMinInputTokens, 100000);
  assert.match(haiku.rates.find(rate => rate.dimension === "tier2:input").condition, /> 100,000/);
  const time = model("deepseek-v4-flash");
  assert.ok(time.rates.some(rate => rate.dimension === "peak:input" && /UTC/.test(rate.condition)));
  assert.ok(time.rates.some(rate => rate.dimension === "off_peak:input" && /其余时段/.test(rate.condition)));
  assert.ok(model("gemini-nano-banana-2.1").rates.some(rate => rate.dimension === "image_output" && rate.unit === "1M_tokens"));
  const gemini = model("gemini-3.6-flash");
  assert.equal(gemini.rates.find(rate => rate.dimension === "tool:google_web_search").retailMicrousd, 16800000);
  assert.equal(gemini.rates.find(rate => rate.dimension === "storage:hour").unit, "1M_token_hours");
});

test("video second prices, per-call audio, input materials and final token settlement keep explicit units", () => {
  assert.ok(model("MiniMax-Hailuo-02").rates.every(rate => rate.unit === "second"));
  assert.ok(model("suno").rates.every(rate => rate.unit === "call"));
  assert.ok(model("flowmusic").rates.some(rate => rate.dimension === "generate"));
  assert.match(model("MiniMax-H3").rates.find(rate => rate.scope === "input" && rate.unit === "image").condition, /前 5 项免费/);
  const seedance = model("seedance-2.5");
  assert.ok(seedance.rates.some(rate => rate.scope === "reservation" && rate.unit === "second"));
  assert.ok(seedance.rates.some(rate => rate.scope === "settlement" && rate.unit === "1M_tokens"));
  assert.equal(model("grok-imagine-1.5-tokvilo").model, "grok-imagine-1.5-tokvilo");
  assert.equal(model("grok-imagine-1.5-apimart"), undefined);
});

test("unknown pricing units stay visible as unavailable and cannot become invented display prices", () => {
  const altered = structuredClone(snapshot);
  altered.data.models.image[0].fixed_prices.unit = "unknown_unit";
  const result = display.parseApimartDisplayPricing(altered);
  const invalid = result.models.find(item => item.model === altered.data.models.image[0].id);
  assert.equal(invalid.available, false); assert.equal(invalid.rates.length, 0);
  assert.ok(invalid.notes.length); assert.ok(result.unavailable.some(item => item.model === invalid.model));
  assert.equal(result.models.length, 293);
});

test("listed operation prices are distinguished from enabled generation capabilities", () => {
  assert.match(model("suno").capabilitiesNotes.join(" "), /v6、v6-wild、v6-mini.*基础音乐生成.*旧版本.*暂未开放/);
  assert.match(model("flowmusic").capabilitiesNotes.join(" "), /generate 基础音乐生成.*暂未开放/);
  assert.match(model("gpt-5.4").capabilitiesNotes.join(" "), /纯文本对话.*工具调用和显式缓存创建暂未开放/);
  assert.match(model("gemini-3.6-flash").capabilitiesNotes.join(" "), /工具与缓存存储价格供查阅/);
  assert.match(model("gpt-image-2").capabilitiesNotes.join(" "), /新生成请求.*专用编辑和扩展接口.*暂未开放/);
  assert.equal(model("suno").notes.length, 0, "capability limits are not missing prices");
  assert.ok(model("suno").rates.some(rate => rate.dimension === "music-v5"));
});
