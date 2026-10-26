import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const file = new URL(path, import.meta.url), compiledModule = { exports: {} };
  const source = ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module: compiledModule, exports: compiledModule.exports, require: name => { if (name in dependencies) return dependencies[name]; throw Error(name); } });
  return compiledModule.exports;
}
const official = await load("../lib/official-pricing.ts");
const { valueRetailMicrousd } = await load("../lib/value-pricing.ts", { "./official-pricing": official });
const now = new Date("2026-10-26T08:00:00Z");
const rate = (amount, dimension = "input", extras = {}) => ({ dimension, unit: "1M_tokens", retailMicrousd: amount, ...extras });

test("reference pricing raises deep discounts to 70 percent of the exact official rate without cutting the cost floor", () => {
  assert.equal(valueRetailMicrousd("gpt-4.1", rate(600_000), now), 1_400_000);
  assert.equal(valueRetailMicrousd("gpt-4.1", rate(2_000_000, "output"), now), 5_600_000);
  assert.equal(valueRetailMicrousd("gpt-4.1", rate(1_500_000), now), 1_500_000);
  assert.equal(valueRetailMicrousd("gpt-4.1", rate(3_000_000), now), 3_000_000);
});

test("tiered, cached and date-limited rates require the exact matching reference", () => {
  assert.equal(valueRetailMicrousd("gpt-6.1-sol", rate(100_000, "tier1:input", { tierMinInputTokens: 0, tierMaxInputTokens: 272_000 }), now), 1_400_000);
  assert.equal(valueRetailMicrousd("gpt-6.1-sol", rate(100_000, "output:long_context", { condition: "输入超过 272,000 token" }), now), 10_500_000);
  assert.equal(valueRetailMicrousd("gpt-4.1", rate(50_000, "cached_input"), now), 350_000);
  assert.equal(valueRetailMicrousd("gpt-6.1-sol", rate(100_000), now), 100_000);
  assert.equal(valueRetailMicrousd("gpt-6.1-sol", rate(100_000, "tier1:input", { tierMinInputTokens: 0, tierMaxInputTokens: 300_000 }), now), 100_000);
});

test("missing, stale, cross-currency, media and unverified time references preserve original pricing", () => {
  const examples = [
    ["unknown-model", rate(123)], ["gpt-4.1-near-match", rate(123)],
    ["qwen3.8-max", rate(123)], ["gpt-4.1", rate(123, "input", { unit: "image" })],
    ["gpt-4.1", rate(123, "input", { condition: "priority routing" })],
    ["deepseek-flash", rate(123, "peak:input")], ["gpt-4.1", rate(123, "unknown_dimension")],
  ];
  for (const [model, input] of examples) assert.equal(valueRetailMicrousd(model, input, now), 123);
  assert.equal(valueRetailMicrousd("gpt-4.1", rate(123), new Date("2026-11-10")), 123);
  assert.equal(valueRetailMicrousd("gpt-4.1", rate(123), new Date("2026-10-23")), 123);
  assert.equal(valueRetailMicrousd("gpt-4.1", rate(123), new Date("invalid")), 123);
});

test("zero fees stay free and malformed monetary inputs are never silently repriced", () => {
  assert.equal(valueRetailMicrousd("gpt-4.1", rate(0), now), 0);
  for (const invalid of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => valueRetailMicrousd("gpt-4.1", rate(invalid), now));
});
