import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { catalog } from "./helpers/model-catalog.mjs";
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL("../lib/model-selection-ui.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: mod, exports: mod.exports, require: name => { assert.equal(name, "./model-catalog"); return catalog; } });
const { selectionModels, selectionPrices, modelSelectionKey } = mod.exports;
const rate = (dimension, retailMicrousd, extra = {}) => ({ dimension, retailMicrousd, unit: "1M_tokens", ...extra });
const price = (model, rates, extra = {}) => ({ model, provider: "apimart", kind: "chat", rates, billingReady: true, ...extra });

test("recommendation availability is scoped to both exact model and service, excluding unsupported request types", () => {
  const base = { id: "gpt-4.1", name: "GPT", provider: "OPENAI", category: "text", available: true };
  const models = [{ ...base, upstream: "apimart" }, { ...base, upstream: "selected" }, { ...base, id: "text-embedding-3-small", upstream: "apimart" }];
  const result = selectionModels(models, [price(base.id, []), price(base.id, [], { provider: "selected", billingReady: false })]);
  assert.equal(result.length, 2);
  assert.equal(result[0].available, true);
  assert.equal(result[1].available, false);
  assert.equal(result[0].inputModalities.join(","), "text", "vendor vision support does not imply platform vision support");
  assert.notEqual(modelSelectionKey(models[0]), modelSelectionKey(models[1]));
  assert.equal(selectionModels([models[0]], [price(base.id, [], { provider: "selected" })])[0].available, false);
});

test("short and long input prices select one explicit tier and never mix output tiers", () => {
  const rates = [rate("tier1:input", 100000, { condition: "Input <= 100k", tierMinInputTokens: 0, tierMaxInputTokens: 100000 }), rate("tier1:output", 500000, { condition: "Input <= 100k", tierMinInputTokens: 0, tierMaxInputTokens: 100000 }), rate("tier2:input", 200000, { condition: "Input > 100k", tierMinInputTokens: 100000, tierMaxInputTokens: null }), rate("tier2:output", 700000, { condition: "Input > 100k", tierMinInputTokens: 100000, tierMaxInputTokens: null })];
  assert.equal(selectionPrices([price("gpt-6-luna", rates)], 2000)[0].inputUsdPerMillion, 0.1);
  assert.equal(selectionPrices([price("gpt-6-luna", rates)], 128000)[0].outputUsdPerMillion, 0.7);
  assert.equal(selectionPrices([price("gpt-6-luna", [rates[0], rates[3]])], 2000).length, 0);
});

test("unknown conditional, negative and incomplete prices cannot drive a cheapest recommendation", () => {
  for (const rates of [
    [rate("peak:input", 10, { condition: "peak time" }), rate("peak:output", 30, { condition: "peak time" })],
    [rate("input", -1), rate("output", 100)],
    [rate("input", 100)],
    [rate("input", Infinity), rate("output", 100)],
    [rate("tier1:input", 10, { condition: "unknown tier" }), rate("tier1:output", 30, { condition: "unknown tier" })],
  ]) assert.equal(selectionPrices([price("test", rates)]).length, 0);
  assert.equal(selectionPrices([price("test", [rate("input", 100000), rate("output", 200000)])])[0].outputUsdPerMillion, 0.2);
});
