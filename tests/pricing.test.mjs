import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const filename = new URL("../lib/pricing.ts", import.meta.url).pathname;
const idsCode = ts.transpileModule(await readFile(new URL("../lib/model-id.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ids = { exports: {} };
vm.runInNewContext(idsCode, { module: ids, exports: ids.exports });
const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiled = { exports: {} };
vm.runInNewContext(outputText, { module: compiled, exports: compiled.exports, require(name) {
  if (name === "./model-id") return ids.exports;
  if (name === "./value-pricing") return { valueRetailMicrousd: (_model, rate) => rate.retailMicrousd, VALUE_PRICING_VERSION: "test-floor-only" };
  throw Error(name);
}, TextEncoder, TextDecoder, Uint8Array, AbortSignal, Response, structuredClone });
const { markupMicrousd, tokenCostMicrousd, normalizeTokenHubPricing, quoteTokenHubRequest, tokenHubActualCost, getTokenHubPricing } = compiled.exports;
const amount = (micros, unit = "1M tokens") => ({ amount: { currencyCode: "USD", unitsMicros: micros, exactUnits: String(micros / 1e6) }, display: `USD ${micros / 1e6} / ${unit}` });
function source() { return { currencyCode: "USD", data: [
  { id: "chat", deployments: [{ enabled: true, pricing: { input: amount(1e6), output: amount(2e6), cacheRead: amount(100000), cacheWrite: amount(0) } }] },
  { id: "image", deployments: [{ enabled: true, pricing: { fixed: { ...amount(90000, "image"), priceUnit: "image" } } }] },
  { id: "video", deployments: [{ enabled: true, pricing: { video: { withoutVideo480p: amount(7e6), withoutVideo720p: amount(7e6), withoutVideo1080p: amount(0), withVideo480p: amount(4.3e6) } } }] },
] }; }
const chat = { model: "chat", messages: [{ role: "user", content: "Hello" }], max_tokens: 100 };

test("public labels and diagnostics use tokvilo while model IDs, vendors and generated content remain exact", () => {
  const snapshot = source(); snapshot.data[0].label = "TokenHub DeepSeek";
  const model = normalizeTokenHubPricing(snapshot).models.find(model => model.model === "chat");
  assert.equal(model.name, "tokvilo 多模态 DeepSeek");
  assert.equal(model.provider, "tokenhub");
  assert.equal(model.model, "chat");
  const input = { error: { code: "apimart_error", message: "API Mart service unavailable" },
    model: "tokenhub-exact-model", choices: [{ message: { content: "Compare TokenHub and APIMart" } }] };
  const output = compiled.exports.publicServiceErrors(input);
  assert.equal(output.error.message, "tokvilo 模型服务 service unavailable");
  assert.equal(output.error.code, input.error.code);
  assert.equal(output.model, input.model);
  assert.equal(output.choices, input.choices);
  assert.equal(compiled.exports.publicServiceText("OpenAI · DeepSeek · ByteDance"), "OpenAI · DeepSeek · ByteDance");
});

test("retail rate is upstream plus exactly 20 percent and request totals use integer arithmetic", () => {
  assert.equal(markupMicrousd(90000), 108000);
  assert.equal(markupMicrousd(150000), 180000);
  assert.equal(markupMicrousd(1), 2);
  assert.equal(tokenCostMicrousd(1, 180000), 1);
  assert.throws(() => markupMicrousd(-1));
  const quote = quoteTokenHubRequest(normalizeTokenHubPricing(source()), "chat", chat);
  assert.equal(tokenHubActualCost(quote, { model: "chat", usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 500 }, total_tokens: 1100 } }), 900);
});
test("invalid currencies, ambiguous deployments and unit mismatches never become payable prices", () => {
  const s = source(); s.currencyCode = "CNY"; assert.throws(() => normalizeTokenHubPricing(s));
  const ambiguous = source(); ambiguous.data[0].deployments.push({ enabled: true, pricing: { ...ambiguous.data[0].deployments[0].pricing, input: amount(2e6) } });
  const catalog = normalizeTokenHubPricing(ambiguous);
  assert.equal(catalog.models.some(m => m.model === "chat"), false);
  assert.throws(() => quoteTokenHubRequest(catalog, "chat", chat));
  const wrongUnit = source(); wrongUnit.data[0].deployments[0].pricing.input.display = "USD 1 / token";
  assert.equal(normalizeTokenHubPricing(wrongUnit).models.some(m => m.model === "chat"), false);
  const precision = source(); precision.data[0].deployments[0].pricing.output.amount.exactUnits = "200";
  assert.equal(normalizeTokenHubPricing(precision).models.some(m => m.model === "chat"), false);
});
test("image billing counts returned successful images and never assumes requested images were produced", () => {
  const q = quoteTokenHubRequest(normalizeTokenHubPricing(source()), "image", { model: "image", prompt: "test", n: 2 });
  assert.equal(q.reservedMicrousd, 216000);
  assert.equal(tokenHubActualCost(q, { data: [{ url: "https://example.com/a.png" }, { error: { message: "blocked" } }] }), 108000);
  assert.equal(tokenHubActualCost(q, { data: [] }), null);
  assert.throws(() => quoteTokenHubRequest(normalizeTokenHubPricing(source()), "image", { model: "image", sequential_image_generation: "auto" }));
});
test("video billing uses the selected resolution rate only after final success with usage", () => {
  const c = normalizeTokenHubPricing(source());
  assert.equal(c.models.find(m => m.model === "video").rates.some(r => r.dimension === "withoutVideo1080p"), false);
  const q = quoteTokenHubRequest(c, "video", { model: "video", content: [{ type: "text", text: "test" }], resolution: "480p", duration: 5 });
  assert.equal(tokenHubActualCost(q, { status: "queued" }), null);
  assert.equal(tokenHubActualCost(q, { status: "failed", usage: { completion_tokens: 1e5 } }), null);
  assert.equal(tokenHubActualCost(q, { status: "succeeded", usage: { completion_tokens: 1e5 } }), 840000);
  assert.throws(() => quoteTokenHubRequest(c, "video", { model: "video", content: [{ type: "video_url", video_url: { url: "https://example.com/a.mp4" } }] }));
  assert.throws(() => quoteTokenHubRequest(c, "video", { model: "video", content: [{ type: "text", text: "A forest --rs 1080p" }], resolution: "480p" }));
});
test("missing or inconsistent usage never becomes an invented customer charge", () => {
  const q = quoteTokenHubRequest(normalizeTokenHubPricing(source()), "chat", chat);
  for (const payload of [
    {}, { usage: { prompt_tokens: 10 } }, { usage: { prompt_tokens: 10, completion_tokens: -1 } },
    { usage: { prompt_tokens: 10, completion_tokens: 1, prompt_cache_hit_tokens: 11 } },
    { model: "different-model", usage: { prompt_tokens: 10, completion_tokens: 1 } },
    { usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 999 } },
  ]) assert.equal(tokenHubActualCost(q, payload), null);
  assert.throws(() => quoteTokenHubRequest(normalizeTokenHubPricing(source()), "chat", { ...chat, max_tokens: undefined }));
});
test("fresh-price fetch fails closed and never returns an older catalog", async () => {
  const c = await getTokenHubPricing(async () => Response.json(source()));
  assert.equal(c.models.length, 3);
  await assert.rejects(getTokenHubPricing(async () => new Response("unavailable", { status: 503 })), /实时价格/);
  await assert.rejects(getTokenHubPricing(async () => { throw new Error("network"); }), /实时价格/);
});
