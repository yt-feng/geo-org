import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

class PricingError extends Error { constructor(message, status = 503) { super(message); this.status = status; } }
async function load(path, mocks = {}, globals = {}) {
  const file = new URL("../" + path, import.meta.url).pathname, mod = { exports: {} };
  const code = ts.transpileModule(await readFile(file, "utf8"), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, TextEncoder, structuredClone,
    require(name) { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; }, ...globals }, { filename: file });
  return mod.exports;
}
const kinds = await load("lib/model-request-kind.ts");
let timestamp = Date.parse("2026-10-20T13:00:00Z");
class FixedDate extends Date { static now() { return timestamp; } }
const text = await load("lib/apimart-text-pricing.ts", { "./pricing": { PricingError }, "./model-request-kind": kinds,
  "./value-pricing": { valueRetailMicrousd: (_model, rate) => rate.retailMicrousd, VALUE_PRICING_VERSION: "test-floor-only" } }, { Date: FixedDate });
const fixtures = JSON.parse(await readFile(new URL("./fixtures/apimart-text-prices.json", import.meta.url), "utf8")).models;
const item = id => structuredClone(fixtures.find(m => m.id === id));
const price = id => { const parsed = text.parseTextPrice(item(id)); assert.ok(parsed, id); return parsed; };
function quote(id, extra = {}) { return text.quoteText({ model: id, messages: [{ role: "user", content: "hello" }], max_tokens: 100, ...extra }, price(id)); }
function reply(model, prompt = 100, completion = 10, details = {}, extra = {}) {
  return { model, created: Math.floor(timestamp / 1000), usage: { prompt_tokens: prompt, completion_tokens: completion,
    total_tokens: prompt + completion, prompt_tokens_details: details, ...extra } };
}
const rejects = fn => assert.throws(fn, error => error instanceof PricingError);

test("real public fixtures support standard, cache-write, tiers, time and optional-extra text models", () => {
  for (const fixture of fixtures) {
    const p = text.parseTextPrice(fixture);
    assert.ok(p, fixture.id);
    assert.ok(p.rates.every(r => Number.isSafeInteger(r.retailMicrousd) && r.unit === "1M_tokens"));
  }
  assert.equal(price("gpt-5.4").tiers.length, 2);
  assert.equal(price("claude-haiku-5-5").tiers.length, 2);
  assert.ok(price("deepseek-v4-flash").time);
});

test("fractional micro source rates are preserved until the single final marked total rounding", () => {
  const model = price("qwen3.8-max");
  const q = text.quoteText({ model: model.model, messages: [{ role: "user", content: "x".repeat(10000) }], max_tokens: 4096 }, model);
  // Source input $1.3714288/M, cached $0.1714288/M, write $1.7142856/M, output $4.1142856/M.
  const r = reply(model.model, 10000, 2000, { cached_tokens: 3000, cache_write_tokens: 1000 });
  const exact = Math.ceil((6000 * 1.3714288 + 3000 * 0.1714288 + 1000 * 1.7142856 + 2000 * 4.1142856) * 1.2);
  assert.equal(text.settleText(q, r), exact);
  assert.equal(model.rates.find(r => r.dimension === "input").retailMicrousd, 1645715);
  const small = { id: "test-chat", pricing: { unit: "usd_per_million_tokens", pricing_mode: "standard", tier_count: 1,
    effective_rates: { input: 0.00000011, output: 0.00000011 } } };
  const parsed = text.parseTextPrice(small);
  const tinyQuote = text.quoteText({ model: small.id, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }, parsed);
  assert.equal(parsed.rates[0].retailMicrousd, 1, "direct rounding must not turn a source micro-ceiling of 1 into 2");
  assert.equal(text.settleText(tinyQuote, reply(small.id, 1, 1)), 1, "all token dimensions are combined before final rounding");
});

test("full-request tier selection includes cache tokens and observes exact threshold boundaries", () => {
  const parsed = price("gpt-5.4");
  const q = text.quoteText({ model: parsed.model, messages: [{ role: "user", content: "x".repeat(140000) }], max_tokens: 100 }, parsed);
  assert.equal(text.settleText(q, reply(parsed.model, 272000, 10, { cached_tokens: 200000 })),
    Math.ceil((72000 * 2 + 200000 * 0.2 + 10 * 12) * 1.2));
  assert.equal(text.settleText(q, reply(parsed.model, 272001, 10, { cached_tokens: 200000 })),
    Math.ceil((72001 * 4 + 200000 * 0.4 + 10 * 18) * 1.2));
  assert.ok(q.amountMicrousd >= text.settleText(q, reply(parsed.model, q.inputTokenLimit, 100)));
  assert.ok(parsed.rates.some(r => r.dimension.includes("272001")));
});

test("Claude TTL cache writes are mutually exclusive token buckets and cannot silently use a cheaper rate", () => {
  const q = quote("claude-fable-5");
  const r = reply(q.model, 100, 10, { cached_tokens: 20, cache_write_tokens: 0 },
    { claude_cache_creation_5_m_tokens: 30, claude_cache_creation_1_h_tokens: 10 });
  const p = item(q.model).pricing.effective_rates;
  assert.equal(text.settleText(q, r), Math.ceil((40 * p.input + 20 * p.cached_input + 30 * p.cache_write_5m + 10 * p.cache_write_1h + 10 * p.output) * 1.2));
  assert.equal(text.settleText(q, reply(q.model)), Math.ceil((100 * p.input + 10 * p.output) * 1.2),
    "documented Claude string-only content without cache markers is regular input");
  const oldQuote = { ...q }; delete oldQuote.omittedWriteIsZero;
  rejects(() => text.settleText(oldQuote, reply(q.model)));
  rejects(() => text.settleText(q, reply(q.model, 100, 10, { cache_write_tokens: 10 })));
  rejects(() => text.settleText(q, reply(q.model, 100, 10, { cache_write_tokens: 10 }, { claude_cache_creation_5_m_tokens: 10 })));
  rejects(() => text.settleText(q, reply(q.model, 100, 10, { cached_tokens: 90, cache_write_tokens: 0 }, { claude_cache_creation_1_h_tokens: 20 })));
  const one = quote("claude-opus-4-6");
  assert.ok(text.settleText(one, reply(one.model, 100, 10, { cache_write_tokens: 20 })) > 0, "a sole documented write rate is unambiguous");
});

test("generic cache-write prices settle from explicit usage and missing write usage stays reserved", () => {
  const q = quote("gpt-5.6-sol");
  assert.ok(text.settleText(q, reply(q.model, 100, 10, { cached_tokens: 20, cache_write_tokens: 30 })) > 0);
  rejects(() => text.settleText(q, reply(q.model, 100, 10, { cached_tokens: 20 })));
  rejects(() => text.settleText(q, reply(q.model, 100, 10, { cache_write_tokens: -1 })));
  rejects(() => text.settleText(q, reply(q.model, 100, 10, { cache_write_tokens: 0.5 })));
});

test("models with optional extras remain usable for plain text but paid tools and explicit storage are blocked before dispatch", () => {
  for (const id of ["qwen3.8-max", "gemini-3.6-flash", "claude-opus-4-6"]) {
    const q = quote(id);
    assert.ok(q.amountMicrousd > 0);
    for (const extra of [{ tools: [{ type: "web_search" }] }, { enable_search: true }, { cache_control: { type: "ephemeral" } },
      { messages: [{ role: "user", content: [{ type: "text", text: "prefix", cache_control: { type: "ephemeral" } }] }] }]) {
      rejects(() => quote(id, extra));
    }
    rejects(() => text.settleText(q, reply(id, 100, 10, { cache_write_tokens: 0 }, { server_tool_use: { web_search_requests: 1 } })));
    rejects(() => text.settleText(q, reply(id, 100, 10, { cache_write_tokens: 0, explicit_cached_tokens: 1 })));
  }
});

test("time-based models reserve the highest window and settle only with a same-window timestamp", () => {
  timestamp = Date.parse("2026-10-20T13:00:00Z");
  const q = quote("deepseek-v4-flash");
  assert.ok(text.settleText(q, reply(q.model)) > 0);
  const missing = reply(q.model); delete missing.created;
  rejects(() => text.settleText(q, missing));
  timestamp = Date.parse("2026-10-20T14:00:00Z");
  rejects(() => text.settleText(q, reply(q.model)));
  rejects(() => quote(q.model));
  timestamp = Date.parse("2026-10-20T13:00:00Z");
  const offPeak = item(q.model);
  offPeak.pricing.time_pricing.current_window = "off_peak";
  offPeak.pricing.time_pricing.current_rate = 0.5;
  offPeak.pricing.time_rate = 0.5;
  for (const key of Object.keys(offPeak.pricing.effective_rates)) offPeak.pricing.effective_rates[key] /= 2;
  const off = text.quoteText({ model: q.model, messages: [{ role: "user", content: "hello" }], max_tokens: 100 }, text.parseTextPrice(offPeak));
  assert.equal(off.amountMicrousd, q.amountMicrousd);
  assert.ok(text.settleText(off, reply(q.model)) <= text.settleText(q, reply(q.model)));
});

test("non-chat models and unproven pricing shapes are never activated by token rates", () => {
  for (const id of ["text-embedding-3-small", "omni-moderation-latest", "gpt-4o-transcribe", "gpt-4o-realtime-preview", "babbage-002", "gpt-3.5-turbo-instruct"]) {
    const fixture = item("gpt-4o"); fixture.id = id;
    assert.equal(text.parseTextPrice(fixture), null);
  }
  for (const mutate of [
    p => { p.pricing.effective_rates.surprise_fee = 1; },
    p => { p.pricing.pricing_mode = "priority"; },
    p => { p.pricing.effective_rates.input = -1; },
    p => { p.pricing.extras = { unknown_recurring_fee: { price: 1 } }; },
    p => { p.token_pricing.model.tier_mode = "progressive"; },
    p => { p.pricing.tiers[0].up_to_input_tokens = 0; },
    p => { p.pricing.tiers[0].input = 99; },
    p => { p.pricing.tier_count = 3; },
  ]) {
    const fixture = item("gpt-5.4"); mutate(fixture); assert.equal(text.parseTextPrice(fixture), null);
  }
});

test("settlement rejects mismatched identity, bad sums, missing usage and amounts beyond the confirmed reservation", () => {
  const q = quote("gpt-4o");
  for (const r of [{}, reply("wrong-model"), reply(q.model, -1), reply(q.model, 100, 10, {}, { total_tokens: 999 }),
    reply(q.model, q.inputTokenLimit + 1), reply(q.model, 100, q.outputTokenLimit + 1), reply(q.model, 100, 10, { cached_tokens: 101 })]) {
    rejects(() => text.settleText(q, r));
  }
  rejects(() => text.settleText({ ...q, amountMicrousd: 0 }, reply(q.model)));
  assert.ok(text.settleText(q, { data: reply(q.model) }) > 0);
  const copied = structuredClone(q);
  copied.price.tiers[0].usdRates.input.n = "999999999";
  assert.notEqual(copied.price.tiers[0].usdRates.input.n, q.price.tiers[0].usdRates.input.n);
});
