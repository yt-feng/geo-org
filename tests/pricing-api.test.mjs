import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
async function load(file, mocks = {}) {
  mocks = { "@/lib/rkapi-pricing": { getRkapiDisplayPricing: async () => { throw Error("Unavailable"); }, quoteRkapiRequest: async () => { throw Error("Unexpected quote"); } }, ...mocks };
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const m = { exports: {} };
  vm.runInNewContext(outputText, { module: m, exports: m.exports, require(name) { if (name in mocks) return mocks[name]; throw new Error(name); }, Request, Response, URL, TextDecoder, TextEncoder, Uint8Array, structuredClone });
  return m.exports;
}
const ids = await load("../lib/model-id.ts");
const pricing = await load("../lib/pricing.ts", { "./model-id": ids });
const imageOptions = await load("../lib/apimart-image-options.ts");
const midjourney = await load("../lib/apimart-midjourney.ts", { "./pricing": pricing });
const videoOptions = await load("../lib/apimart-video-options.ts");
const videoRequest = await load("../lib/apimart-video-request.ts", { "./pricing": pricing, "./apimart-video-options": videoOptions });
const requestTools = await load("../lib/apimart-request.ts", { "./pricing": pricing, "./model-id": ids, "./model-request-kind": await load("../lib/model-request-kind.ts"), "./apimart-video-options": videoOptions, "./apimart-video-request": videoRequest, "./apimart-midjourney": midjourney, "./apimart-image-options": imageOptions });
const rate = n => ({ amount: { currencyCode: "USD", unitsMicros: n, exactUnits: String(n / 1e6) }, display: "USD / 1M tokens" });
const catalog = pricing.normalizeTokenHubPricing({ currencyCode: "USD", data: [{ id: "chat", deployments: [{ enabled: true, pricing: { input: rate(1e6), output: rate(2e6), cacheRead: rate(1e5), cacheWrite: rate(0) } }] }] });
const BODY = { provider: "tokenhub", mode: "chat", body: { model: "chat", messages: [{ role: "user", content: "Hello" }], max_tokens: 10 } };
const request = (body = BODY, headers = {}) => new Request("https://tokvilo.com/api/pricing/quote", { method: "POST", headers: { Origin: "https://tokvilo.com", "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
async function fixture(options = {}) {
  let requests = 0, limits = 0;
  const handler = await load("../app/api/pricing/quote/route.ts", {
    "@/lib/model-id": ids, "@/lib/apimart-request": requestTools,
    "@/lib/auth": { getPortalUser: async () => options.anonymous ? null : { id: "member" } },
    "@/lib/config": { getD1: () => ({ prepare: () => ({ bind: () => ({ first: async () => ++limits <= 10 ? {} : null }) }) }) },
    "@/lib/pricing": { ...pricing, getTokenHubPricing: async () => { requests++; if (options.unavailable) throw new pricing.PricingError("Source unavailable"); return catalog; } },
    "@/lib/apimart-pricing": { getApimartPricing: async () => { throw new Error("Unexpected source"); }, quoteApimartRequest: () => { throw new Error("Unexpected quote"); } },
  });
  return { module: handler, requests: () => requests };
}
test("quote endpoint returns the same reservation and rates as generation pricing without a wallet mutation", async () => {
  const f = await fixture();
  const response = await f.module.POST(request()), quote = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(quote.reservedMicrousd, pricing.quoteTokenHubRequest(catalog, "chat", BODY.body).reservedMicrousd);
  assert.equal(quote.rates[0].retailMicrousd, 1200000);
  assert.doesNotMatch(JSON.stringify(quote), /upstreamMicrousd|markupPercent|sourceUrl|upstreamRates/);
  assert.equal(f.requests(), 1);
});
test("quote endpoint bounds authentication, origin, JSON structure and size before source reads", async () => {
  for (const [options, req, status] of [
    [{ anonymous: true }, request(), 401], [{}, request(BODY, { Origin: "https://elsewhere.example" }), 403],
    [{}, request(BODY, { "Content-Type": "text/plain" }), 415], [{}, request("{"), 400],
    [{}, request({ ...BODY, body: { ...BODY.body, padding: "x".repeat(128001) } }), 413],
    [{}, request({ ...BODY, provider: "unknown" }), 400], [{}, request({ ...BODY, body: { model: "chat", messages: [] } }), 400],
  ]) {
    const f = await fixture(options);
    assert.equal((await f.module.POST(req)).status, status);
    assert.equal(f.requests(), 0);
  }
});
test("quote endpoint throttles source discovery and propagates unavailable pricing", async () => {
  const f = await fixture();
  for (let n = 0; n < 10; n++) assert.equal((await f.module.POST(request())).status, 200);
  assert.equal((await f.module.POST(request())).status, 429); assert.equal(f.requests(), 10);
  assert.equal((await (await fixture({ unavailable: true })).module.POST(request())).status, 503);
});
test("public catalog keeps an available source and reports the other source failure without invented prices", async () => {
  const route = await load("../app/api/pricing/route.ts", {
    "@/lib/pricing": { ...pricing, getTokenHubPricing: async () => catalog },
    "@/lib/apimart-display-pricing": { getApimartDisplayPricing: async () => { throw new pricing.PricingError("Unavailable"); } },
  });
  const response = await route.GET(), payload = await response.json();
  assert.equal(response.status, 200); assert.equal(payload.models.length, 1);
  assert.deepEqual(payload.sources.map(source => source.status), ["available", "unavailable", "unavailable"]);
  assert.doesNotMatch(JSON.stringify(payload), /upstreamMicrousd|markupPercent|sourceUrl|upstreamRates/);
});

test("catalog and both quote APIs expose explicit retail fields even if internal snapshots gain fields", async () => {
  const apimartCatalog = { source: "https://private-price.example", observedAt: "2026-10-20", models: [{
    provider: "apimart", model: "image", name: "Image", kind: "image", available: true, sourceUrl: "https://private.example",
    rates: [{ dimension: "2k", unit: "image", upstreamMicrousd: 15000, retailMicrousd: 18000, supplierDiscount: 50 }],
  }], unavailable: [] };
  const apimartMock = { getApimartPricing: async () => apimartCatalog,
    quoteApimartRequest: () => ({ model: "image", amountMicrousd: 18000, observedAt: "2026-10-20", upstreamRates: { "2k": 15000 } }) };
  const route = await load("../app/api/pricing/route.ts", {
    "@/lib/pricing": { ...pricing, getTokenHubPricing: async () => catalog },
    "@/lib/apimart-display-pricing": { getApimartDisplayPricing: async () => ({
      observedAt: apimartCatalog.observedAt, unavailable: [],
      models: apimartCatalog.models.map(model => ({ ...pricing.publicModelPrice(model), billingReady: true })),
    }) },
  });
  const publicCatalog = await (await route.GET()).json();
  assert.equal(publicCatalog.models[1].rates[0].retailMicrousd, 18000);
  assert.doesNotMatch(JSON.stringify(publicCatalog), /upstream|markup|supplierDiscount|private-price|private\.example|sourceUrl/i);
  const quoteRoute = await load("../app/api/pricing/quote/route.ts", {
    "@/lib/model-id": ids, "@/lib/apimart-request": requestTools,
    "@/lib/auth": { getPortalUser: async () => ({ id: "member" }) },
    "@/lib/config": { getD1: () => ({ prepare: () => ({ bind: () => ({ first: async () => ({}) }) }) }) },
    "@/lib/pricing": pricing, "@/lib/apimart-pricing": apimartMock,
  });
  const result = await (await quoteRoute.POST(request({ provider: "apimart", mode: "image", body: { model: "image", prompt: "A tree" } }))).json();
  assert.equal(result.reservedMicrousd, 18000);
  assert.deepEqual(result.rates, [{ dimension: "2k", unit: "image", retailMicrousd: 18000 }]);
  assert.doesNotMatch(JSON.stringify(result), /upstream|markup|supplierDiscount|sourceUrl/i);
});


test("gateway quote accepts video and music contracts and returns public model aliases without charging", async () => {
  const textPricing = await load("../lib/apimart-text-pricing.ts", { "./pricing": pricing, "./model-request-kind": await load("../lib/model-request-kind.ts") });
  const apimart = await load("../lib/apimart-pricing.ts", { "./pricing": pricing, "./apimart-request": requestTools, "./apimart-text-pricing": textPricing, "./apimart-midjourney": midjourney });
  const raw = JSON.parse(await readFile(new URL("./fixtures/apimart-pricing-20261020.json", import.meta.url), "utf8"));
  const catalog = apimart.parseApimartPricing(raw);
  let reads = 0;
  const route = await load("../app/api/pricing/quote/route.ts", {
    "@/lib/model-id": ids, "@/lib/apimart-request": requestTools,
    "@/lib/auth": { getPortalUser: async () => ({ id: "member" }) },
    "@/lib/config": { getD1: () => ({ prepare(query) { assert.match(query, /login_rate_limits/); return { bind: () => ({ first: async () => ({}) }) }; } }) },
    "@/lib/pricing": pricing,
    "@/lib/apimart-pricing": { ...apimart, getApimartPricing: async () => { reads++; return catalog; } },
  });
  for (const [mode, body, expected] of [
    ["video", { model: "veo3.1-fast", prompt: "Ocean", duration: 8, resolution: "720p" }, 168000],
    ["audio", { model: "flowmusic", sound_prompt: "Piano" }, 72000],
    ["image", { model: "grok-imagine-1.5-tokvilo", prompt: "Tree" }, 18000],
  ]) {
    const res = await route.POST(request({ provider: "apimart", mode, body })), quote = await res.json();
    assert.equal(res.status, 200, JSON.stringify(quote));
    assert.equal(quote.model, body.model); assert.equal(quote.mode, mode);
    assert.equal(quote.reservedMicrousd, expected);
    assert.ok(quote.rates.length);
    assert.doesNotMatch(JSON.stringify(quote), /upstreamRates|upstreamMicrousd|textPrice|textQuote|after_discount|cost/);
  }
  assert.equal(reads, 3);
  const malformed = await route.POST(request({ provider: "apimart", mode: "video", body: { model: "veo3.1-fast", prompt: "Ocean", duration: 10, resolution: "720p" } }));
  assert.equal(malformed.status, 400, "quote uses the same parameter constraints as paid generation");
});

test("selected public prices allowlist retail fields and keep unavailable calls distinct from unavailable prices", async () => {
  const selected = { observedAt: "2026-10-21", models: [{ provider: "selected", model: "gpt-image-2", name: "GPT Image 2", kind: "image", available: false, billingReady: false,
    group: "private", purchasePrice: 100, ratesCnyPerMillion: { request: 100 }, sourceUrl: "https://private.example", notes: ["价格已列示，服务待开通。"],
    rates: [{ dimension: "request", label: "每次请求", condition: "每次 1 张", unit: "call", retailMicrousd: 6000, rateCny: 100, upstreamMicrousd: 5000 }] }], unavailable: [{ model: "gpt-image-2", reason: "private detail" }] };
  const route = await load("../app/api/pricing/route.ts", {
    "@/lib/pricing": { ...pricing, getTokenHubPricing: async () => catalog },
    "@/lib/apimart-display-pricing": { getApimartDisplayPricing: async () => ({ observedAt: "2026-10-21", models: [{ provider: "apimart", model: "gpt-image-2", name: "Image", kind: "image", billingReady: true, rates: [] }], unavailable: [] }) },
    "@/lib/rkapi-pricing": { getRkapiDisplayPricing: async () => selected },
  });
  const res = await route.GET(), body = await res.json();
  assert.equal(res.status, 200);
  const duplicates = body.models.filter(model => model.model === "gpt-image-2");
  assert.equal(duplicates.length, 2);
  assert.equal(duplicates.find(model => model.provider === "selected").billingReady, false);
  assert.equal(duplicates.find(model => model.provider === "selected").rates[0].label, "每次请求");
  assert.equal(duplicates.find(model => model.provider === "selected").rates[0].condition, "每次 1 张");
  assert.deepEqual(body.unavailable, []);
  assert.doesNotMatch(JSON.stringify(body), /rkapi|rateCny|ratesCny|upstream|purchasePrice|group|private|sourceUrl|markup/i);
});

test("selected quote routes separately, returns retail fields only and refuses interface mismatch", async () => {
  let calls = 0;
  const route = await load("../app/api/pricing/quote/route.ts", {
    "@/lib/model-id": ids, "@/lib/apimart-request": requestTools,
    "@/lib/auth": { getPortalUser: async () => ({ id: "member" }) },
    "@/lib/config": { getD1: () => ({ prepare: () => ({ bind: () => ({ first: async () => ({}) }) }) }) },
    "@/lib/pricing": pricing, "@/lib/apimart-pricing": {},
    "@/lib/rkapi-pricing": { quoteRkapiRequest: async body => { calls++; return { provider: "selected", model: body.model, kind: "chat", currency: "USD", observedAt: "2026-10-21", reservedMicrousd: 2000, privateCost: 1000, rates: [{ dimension: "input", unit: "1M_tokens", retailMicrousd: 600000, upstreamMicrousd: 500000 }] }; } },
  });
  const response = await route.POST(request({ ...BODY, provider: "selected" })), value = await response.json();
  assert.equal(response.status, 200); assert.equal(value.provider, "selected"); assert.equal(value.reservedMicrousd, 2000);
  assert.doesNotMatch(JSON.stringify(value), /private|upstream|rkapi|markup/i);
  assert.equal((await route.POST(request({ provider: "selected", mode: "video", body: { model: "chat" } }))).status, 422);
  assert.equal(calls, 1);
  assert.equal((await route.POST(request({ provider: "selected", mode: "image", body: { model: "chat", prompt: "Tree" } }))).status, 400);
});
