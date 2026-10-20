import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
async function load(file, mocks = {}) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const m = { exports: {} };
  vm.runInNewContext(outputText, { module: m, exports: m.exports, require(name) { if (name in mocks) return mocks[name]; throw new Error(name); }, Request, Response, URL, TextDecoder, TextEncoder, Uint8Array });
  return m.exports;
}
const pricing = await load("../lib/pricing.ts");
const rate = n => ({ amount: { currencyCode: "USD", unitsMicros: n, exactUnits: String(n / 1e6) }, display: "USD / 1M tokens" });
const catalog = pricing.normalizeTokenHubPricing({ currencyCode: "USD", data: [{ id: "chat", deployments: [{ enabled: true, pricing: { input: rate(1e6), output: rate(2e6), cacheRead: rate(1e5), cacheWrite: rate(0) } }] }] });
const BODY = { provider: "tokenhub", mode: "chat", body: { model: "chat", messages: [{ role: "user", content: "Hello" }], max_tokens: 10 } };
const request = (body = BODY, headers = {}) => new Request("https://tokvilo.com/api/pricing/quote", { method: "POST", headers: { Origin: "https://tokvilo.com", "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
async function fixture(options = {}) {
  let requests = 0, limits = 0;
  const handler = await load("../app/api/pricing/quote/route.ts", {
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
    "@/lib/apimart-pricing": { getApimartPricing: async () => { throw new pricing.PricingError("Unavailable"); } },
  });
  const response = await route.GET(), payload = await response.json();
  assert.equal(response.status, 200); assert.equal(payload.models.length, 1);
  assert.deepEqual(payload.sources.map(source => source.status), ["available", "unavailable"]);
});
