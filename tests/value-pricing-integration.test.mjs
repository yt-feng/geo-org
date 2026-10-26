import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const NOW = Date.parse("2026-10-26T12:00:00Z");
class FixedDate extends Date { constructor(value = NOW) { super(value); } static now() { return NOW; } }
const cache = new Map();
async function load(path) {
  const url = new URL(`../lib/${path}`, import.meta.url);
  if (cache.has(path)) return cache.get(path);
  if (path.endsWith(".json")) return JSON.parse(await readFile(url, "utf8"));
  if (path === "config.ts") return { runtimeEnv: () => ({}) };
  if (path === "rkapi-settings.ts") return {
    getRkapiConversion() { throw Error("Unexpected pricing network access"); },
    verifiedRkapiRoutes() { throw Error("Unexpected route network access"); },
  };
  const { outputText } = ts.transpileModule(await readFile(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const dependencies = {};
  for (const [, name] of outputText.matchAll(/require\(["']([^"']+)["']\)/g)) {
    assert.ok(name.startsWith("./"), name);
    dependencies[name] = await load(name.slice(2) + (name.endsWith(".json") ? "" : ".ts"));
  }
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    module: mod, exports: mod.exports, require: name => dependencies[name], Date: FixedDate,
    TextEncoder, TextDecoder, Uint8Array, AbortSignal, Response, structuredClone,
    fetch() { throw Error("Pricing integration tests must not use the network"); },
  });
  cache.set(path, mod.exports); return mod.exports;
}
const policy = await load("value-pricing.ts");
const common = await load("pricing.ts");
const text = await load("apimart-text-pricing.ts");
const display = await load("apimart-display-pricing.ts");
const selected = await load("rkapi-pricing.ts");
const selectedSource = await load("rkapi-catalog-snapshot.json");
const request = (model, length = 1) => ({ model, messages: [{ role: "user", content: "x".repeat(length) }], max_tokens: 100 });
const reply = (model, prompt = 100, completion = 10, cached = 20) => ({ model,
  choices: [{ message: { content: "Answer" } }],
  usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: cached, cache_write_tokens: 0 } },
});
const source = (id = "gpt-4.1") => ({ id, pricing: { unit: "usd_per_million_tokens", pricing_mode: "standard", tier_count: 1,
  effective_rates: { input: .1, output: .2, cached_input: .01 } } });
const publicCatalog = item => display.parseApimartDisplayPricing({ success: true, data: { models: { llm: [item] } } }).models[0];
const values = rates => Object.fromEntries(rates.map(rate => [rate.dimension, rate.retailMicrousd]));

test("APIMart public price, quote snapshot and settlement use the same 70% reference rates", () => {
  const item = source(), parsed = text.parseTextPrice(item), quote = text.quoteText(request(item.id), parsed);
  assert.equal(policy.OFFICIAL_TARGET_PERCENT, 70);
  assert.deepEqual(values(parsed.rates), { input: 1_400_000, output: 5_600_000, cached_input: 350_000 });
  assert.deepEqual(values(publicCatalog(item).rates), values(parsed.rates));
  assert.equal(quote.price.retailPolicyVersion, policy.VALUE_PRICING_VERSION);
  assert.equal(text.settleText(quote, reply(item.id)), 175);
  const saved = JSON.parse(JSON.stringify(quote));
  parsed.tiers[0].retailUsdRates.input.n = "99999999";
  assert.equal(text.settleText(saved, reply(item.id)), 175, "later catalogue changes cannot reprice an accepted snapshot");
  delete saved.price.tiers[0].retailUsdRates;
  assert.throws(() => text.settleText(saved, reply(item.id)), common.PricingError, "incomplete new snapshots never silently fall back to a different tariff");
});

test("legacy APIMart persisted quotes retain the precise original 6/5 tariff", () => {
  const parsed = text.parseTextPrice(source());
  delete parsed.retailPolicyVersion;
  for (const tier of parsed.tiers) delete tier.retailUsdRates;
  const quote = text.quoteText(request(parsed.model), parsed);
  assert.equal(text.settleText(quote, reply(parsed.model)), 13);
  assert.equal(text.settleText(JSON.parse(JSON.stringify(quote)), reply(parsed.model)), 13);
});

test("APIMart full-request context tiers preserve public/quote equality at both boundaries", () => {
  const item = source("gpt-5.4");
  item.pricing.tier_count = 2;
  item.pricing.price_factor = 1;
  item.pricing.tiers = [{ ...item.pricing.effective_rates, up_to_input_tokens: 272000 }, { input: .2, output: .3, cached_input: .02 }];
  item.token_pricing = { model: { tier_metric: "input_tokens", tier_mode: "full_request" } };
  const parsed = text.parseTextPrice(item), publicRates = publicCatalog(item).rates;
  assert.deepEqual(Array.from(parsed.rates, rate => rate.retailMicrousd), Array.from(publicRates, rate => rate.retailMicrousd));
  const quote = text.quoteText(request(item.id, 140000), parsed);
  assert.equal(text.settleText(quote, reply(item.id, 272000, 10, 0)), 476105);
  assert.equal(text.settleText(quote, reply(item.id, 272001, 10, 0)), 952161);
  assert.ok(quote.amountMicrousd >= text.settleText(quote, reply(item.id, quote.inputTokenLimit, 100, 0)));
});

test("unknown, CNY references, zero rates, time windows and media retain the previous tariff", async () => {
  for (const id of ["unknown-chat", "qwen3.8-max"]) {
    const parsed = text.parseTextPrice(source(id));
    assert.equal(parsed.rates[0].retailMicrousd, 120000);
  }
  const zero = source(); zero.pricing.effective_rates.cached_input = 0;
  assert.equal(text.parseTextPrice(zero).rates.find(rate => rate.dimension === "cached_input").retailMicrousd, 0);
  const timed = source(); timed.pricing.price_factor = 1;
  timed.pricing.time_pricing = { timezone: "UTC", current_window: "peak", current_rate: 1,
    next_switch_at: Math.floor(NOW / 1000) + 3600, windows: [{ name: "peak", rate: 1 }, { name: "off_peak", rate: .5 }] };
  assert.equal(text.parseTextPrice(timed).rates[0].retailMicrousd, 120000);
  assert.equal(publicCatalog(timed).rates.find(rate => rate.dimension === "peak:input").retailMicrousd, 120000);
  const fixtures = JSON.parse(await readFile(new URL("./fixtures/apimart-pricing-20261020.json", import.meta.url), "utf8"));
  const media = display.parseApimartDisplayPricing(fixtures).models.find(model => model.model === "qwen-image-3.0");
  assert.ok(media.rates.some(rate => rate.retailMicrousd === 24686));
  assert.equal(common.markupMicrousd(100), 120, "the shared data/media cost-plus helper is unchanged");
});

test("studio prices and reservations save immutable retail rates and old snapshots still settle", () => {
  const amount = usd => ({ amount: { currencyCode: "USD", unitsMicros: Math.round(usd * 1e6), exactUnits: String(usd) }, display: `USD ${usd} / 1M tokens` });
  const catalog = common.normalizeTokenHubPricing({ currencyCode: "USD", data: [{ id: "gpt-4.1", deployments: [{ enabled: true,
    pricing: { input: amount(.1), output: amount(.2), cacheRead: amount(.01), cacheWrite: amount(0) } }] }] });
  const quote = common.quoteTokenHubRequest(catalog, "chat", request("gpt-4.1"));
  assert.deepEqual(values(quote.rates), { input: 1_400_000, output: 5_600_000, cacheRead: 350_000, cacheWrite: 0 });
  assert.equal(common.tokenHubActualCost(quote, reply(quote.model)), 175);
  catalog.models[0].rates[0].retailMicrousd = 99999999;
  assert.equal(common.tokenHubActualCost(quote, reply(quote.model)), 175);
  const legacy = structuredClone(quote); delete legacy.retailPolicyVersion;
  for (const rate of legacy.rates) rate.retailMicrousd = common.markupMicrousd(rate.upstreamMicrousd);
  assert.equal(common.tokenHubActualCost(legacy, reply(quote.model)), 13);
});

test("selected cash conversion remains internal while customer tier snapshots settle at published rates", () => {
  const model = structuredClone(selectedSource.models.find(model => model.id === "gpt-6.1-sol"));
  const conversion = { cnyPerQuota: .2, cnyPerUsd: 7.3, observedAt: selectedSource.observedAt };
  const { quote, basis } = selected.createRkapiQuote(request(model.id), model, "codex", conversion);
  const rates = values(quote.rates);
  assert.equal(rates["input:standard"], 1_400_000);
  assert.equal(rates["output:standard"], 7_000_000);
  assert.equal(rates["cached_input:standard"], 70_000);
  assert.deepEqual(values(selected.rkapiPublicRates(model, "codex", conversion)), rates);
  assert.equal(selected.settleRkapiResponse(basis, reply(model.id)), 184);
  const saved = JSON.parse(JSON.stringify(basis));
  basis.model.tiers[0].ratesCnyPerMillion.input = "99999";
  conversion.cnyPerUsd = .01;
  assert.equal(selected.settleRkapiResponse(saved, reply(model.id)), 184);
  assert.equal(selected.settleRkapiResponse(basis, reply(model.id)), 184, "settlement uses saved customer rates, not mutable source cash prices");
  delete saved.retail;
  const expectedLegacy = Math.ceil((80 * .4 + 20 * .02 + 10 * 2) * 2 / 7.3 * 1.2);
  assert.equal(selected.settleRkapiResponse(saved, reply(model.id)), expectedLegacy);
  const bad = JSON.parse(JSON.stringify(basis)); delete bad.retail.tiers[0].ratesUsdPerMillion.input;
  assert.throws(() => selected.settleRkapiResponse(bad, reply(model.id)), common.PricingError);
});
