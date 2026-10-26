import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/official-pricing.ts", import.meta.url), "utf8");
const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: compiled, exports: compiled.exports, Date });
const { OFFICIAL_MODEL_PRICING: entries, matchOfficialModel: match, compareOfficialRate: compare } = compiled.exports;
const now = new Date("2026-10-24T12:00:00Z");
const rate = (retailMicrousd = 1_000_000, dimension = "input", extra = {}) => ({ retailMicrousd, dimension, unit: "1M_tokens", ...extra });
const compareAtReview = (id, retail, options = {}) => compare(id, retail, { now, ...options });

test("manufacturer data has unique exact IDs, finite rates, dates and first-party sources", () => {
  const hosts = new Set(["developers.openai.com", "platform.claude.com", "ai.google.dev", "api-docs.deepseek.com", "help.aliyun.com", "docs.z.ai", "docs.x.ai", "platform.minimax.io", "platform.kimi.ai"]);
  const ids = new Set();
  assert.ok(entries.length >= 60);
  assert.equal(new Set(entries.map(e => e.provider)).size, 9);
  for (const entry of entries) {
    assert.equal(entry.asOf, "2026-10-24");
    assert.equal(new URL(entry.sourceUrl).protocol, "https:");
    assert.ok(hosts.has(new URL(entry.sourceUrl).hostname));
    for (const id of [entry.modelId, ...entry.aliases]) { assert.ok(!ids.has(id)); ids.add(id); assert.equal(match(id), entry); }
    for (const r of entry.rates) {
      assert.equal(r.unit, "1M_tokens");
      assert.ok(r.currency === "USD" || r.currency === "CNY");
      assert.ok(Number.isFinite(r.amount) && r.amount >= 0);
      assert.ok(r.condition);
    }
  }
  // No internal billing/procurement module is loaded into this public reference layer.
  assert.doesNotMatch(source, /(?:import|require\()|upstreamMicrousd|wholesale|api_key/);
});

test("lookup never guesses model generations, snapshots, thinking suffixes or provider prefixes", () => {
  for (const id of ["gpt-6.2-sol", "gpt-4o-2024-05-13", "gpt-4.1-2025-04-14", "claude-opus-4-6-thinking", "gemini-2.5-flash-nothinking", "gemini-3.1-flash-lite-preview", "openai/gpt-5", "gpt-5 ", "GPT-5", "claude-fable-5.1", "deepseek-v4-flash", "deepseek-v4.1-flash", "kimi-k2.5", "minimax-m2.7"]) {
    assert.equal(match(id), null, id);
    assert.equal(compareAtReview(id, rate()).status, "unverified", id);
  }
  assert.equal(match("minimax-m3"), match("MiniMax-M3"));
  assert.equal(match("gpt-5.4-2026-03-05"), match("gpt-5.4"));
});

test("savings and multiples use micro-USD consistently and retain equal/higher prices", () => {
  const cheaper = compareAtReview("gpt-4.1", rate(500_000));
  assert.equal(cheaper.status, "verified");
  assert.equal(cheaper.official.amount, 2);
  assert.equal(cheaper.savingsPercent, 75);
  assert.equal(cheaper.multiple, 4);
  assert.equal(cheaper.pricePosition, "lower");
  const equal = compareAtReview("gpt-4.1", rate(2_000_000));
  assert.equal(equal.savingsPercent, 0); assert.equal(equal.pricePosition, "equal");
  const higher = compareAtReview("gpt-4.1", rate(3_000_000));
  assert.equal(higher.savingsPercent, -50); assert.equal(higher.pricePosition, "higher");
  const zero = compareAtReview("gpt-4.1", rate(0));
  assert.equal(zero.savingsPercent, 100); assert.equal(zero.multiple, null);
  const cache = compareAtReview("gpt-4o-mini", rate(60_000, "cacheRead"));
  assert.equal(cache.official.amount, .075); assert.equal(cache.savingsPercent, 20);
});

test("a missing or spanning context tier cannot claim a default short-context saving", () => {
  assert.equal(compareAtReview("gpt-6.1-sol", rate()).status, "conditions_unknown");
  assert.equal(compareAtReview("gpt-6.1-sol", rate(1e6, "tier1:input", { tierMinInputTokens: 0, tierMaxInputTokens: 300_000 })).status, "conditions_unknown");
  const short = compareAtReview("gpt-6.1-sol", rate(1e6, "tier1:input", { tierMinInputTokens: 0, tierMaxInputTokens: 272_000, condition: "输入 ≤ 272,000 tokens" }));
  assert.equal(short.status, "verified"); assert.equal(short.official.amount, 2);
  const long = compareAtReview("gpt-6.1-sol", rate(1e6, "tier2:input", { tierMinInputTokens: 272_000, tierMaxInputTokens: null, condition: "输入 > 272,000，无更高分档 tokens" }));
  assert.equal(long.status, "verified"); assert.equal(long.official.amount, 4);
  const selectedLong = compareAtReview("gpt-6.1-sol", rate(1e6, "input:long_context", { condition: "输入超过 272,000 token" }));
  assert.equal(selectedLong.status, "verified"); assert.equal(selectedLong.official.amount, 4);
  const conflict = compareAtReview("gpt-6.1-sol", rate(1e6, "tier1:input", { tierMinInputTokens: 0, tierMaxInputTokens: 272_000, condition: "输入 ≤ 300,000 tokens" }));
  assert.equal(conflict.reason, "conflicting_context_conditions");
});

test("point comparisons honor exact inclusive versus exclusive context boundaries", () => {
  assert.equal(compareAtReview("gpt-6.1-sol", rate(), { inputTokens: 272_000 }).official.amount, 2);
  assert.equal(compareAtReview("gpt-6.1-sol", rate(), { inputTokens: 272_001 }).official.amount, 4);
  assert.equal(compareAtReview("grok-4.7", rate(), { inputTokens: 199_999 }).official.amount, 2);
  assert.equal(compareAtReview("grok-4.7", rate(), { inputTokens: 200_000 }).official.amount, 4);
  assert.equal(compareAtReview("claude-haiku-5-5", rate(200_000, "output"), { inputTokens: 100_000 }).official.amount, .5);
  assert.equal(compareAtReview("claude-haiku-5-5", rate(200_000, "output"), { inputTokens: 100_001 }).official.amount, 2.5);
  assert.equal(compareAtReview("MiniMax-M3", rate(), { inputTokens: 512_000 }).official.amount, .3);
  assert.equal(compareAtReview("MiniMax-M3", rate(), { inputTokens: 512_001 }).official.amount, .6);
  assert.equal(compareAtReview("gpt-6.1-sol", rate(1e6, "input:standard", { condition: "输入不超过 272,000 token" }), { inputTokens: 272_001 }).reason, "input_outside_retail_tier");
});

test("cache reads, TTL-specific writes and storage are never conflated", () => {
  assert.equal(compareAtReview("claude-opus-5-5", rate(1e6, "cache_write_5m")).official.amount, 5);
  assert.equal(compareAtReview("claude-opus-5-5", rate(1e6, "cache_write_1h")).official.amount, 8);
  assert.equal(compareAtReview("claude-opus-5-5", rate(1e6, "cached_input")).official.amount, .2);
  for (const dimension of ["cache_write", "cacheWrite", "storage:cache", "audio_input", "image_input", "tool:input", "explicit_cached_input"]) {
    assert.equal(compareAtReview("claude-opus-5-5", rate(1e6, dimension)).status, "dimension_unverified", dimension);
  }
  assert.equal(compareAtReview("gemini-4-argon", rate(1e6, "explicit_cached_input")).status, "dimension_unverified");
});

test("CNY prices remain CNY and never produce USD savings or assumed FX", () => {
  const c = compareAtReview("qwen3.8-max", rate(1e6));
  assert.equal(c.status, "currency_mismatch"); assert.equal(c.official.currency, "CNY"); assert.equal(c.official.amount, 12);
  assert.equal(c.savingsPercent, null); assert.equal(c.multiple, null); assert.equal(c.pricePosition, null);
  const tier = compareAtReview("qwen3.7-flash", rate(1e6), { inputTokens: 32_001 });
  assert.equal(tier.status, "currency_mismatch"); assert.equal(tier.official.amount, .6);
});

test("unknown service conditions and mismatched units cannot advertise savings", () => {
  for (const condition of ["Batch", "Priority", "US only", "Discount for first 30 days", "Input < 200000 tokens", "输入 ≤ 272,000 tokens；priority", "UTC，01:00–04:00"]) {
    const c = compareAtReview("gpt-4.1", rate(1e6, "input", { condition }));
    assert.equal(c.status, "conditions_unknown", condition); assert.equal(c.savingsPercent, null);
  }
  for (const unit of ["call", "image", "1M_token_hours", "token", "1000_tokens"]) assert.equal(compareAtReview("gpt-4.1", { ...rate(), unit }).status, "unit_mismatch");
  for (const value of [-1, NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(compareAtReview("gpt-4.1", rate(value)).reason, "invalid_retail_amount");
  for (const inputTokens of [-1, 0, .5, Infinity]) assert.equal(compareAtReview("gpt-4.1", rate(), { inputTokens }).status, "conditions_unknown");
});

test("promotional official rates stop producing savings after the verified window", () => {
  assert.equal(compareAtReview("gemini-4-argon", rate()).status, "verified");
  const expired = compare("gemini-4-argon", rate(), { now: new Date("2026-12-01T00:00:00Z") });
  assert.equal(expired.reason, "official_price_requires_refresh"); assert.equal(expired.savingsPercent, null);
  assert.equal(compare("gemini-3.8-flash", rate(), { now: new Date("2026-12-31T23:59:59Z") }).status, "verified");
  assert.equal(compare("gemini-3.8-flash", rate(), { now: new Date("2027-01-01T00:00:00Z") }).status, "conditions_unknown");
  assert.equal(compare("gpt-5.6-sol", rate(), { inputTokens: 1000, now: new Date("2026-11-22T00:00:00Z") }).status, "conditions_unknown");
});

test("DeepSeek requires an explicitly verified time band, not the cheaper one by default", () => {
  assert.equal(compareAtReview("deepseek-v4-pro", rate()).status, "conditions_unknown");
  const offpeak = compareAtReview("deepseek-v4-pro", rate(500_000), { timeBand: "off_peak" });
  assert.equal(offpeak.status, "verified"); assert.equal(offpeak.official.amount, .66);
  assert.equal(compareAtReview("deepseek-v4-pro", rate(), { timeBand: "peak" }).official.amount, 1.32);
  assert.equal(compareAtReview("deepseek-v4-pro", rate(1e6, "peak:input"), { timeBand: "off_peak" }).status, "conditions_unknown");
  const actualStyle = compareAtReview("deepseek-v4-pro", rate(1e6, "off_peak:input", { condition: "低峰（UTC，其余时段）" }));
  assert.equal(actualStyle.status, "conditions_unknown"); assert.equal(actualStyle.savingsPercent, null);
});
