import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { catalog } from "./helpers/model-catalog.mjs";

async function load(path, deps = {}) {
  const compiledModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module: compiledModule, exports: compiledModule.exports, require: name => { if (name in deps) return deps[name]; throw Error(name); },
  });
  return compiledModule.exports;
}
const credits = await load("../lib/credits.ts");
const scenarios = await load("../lib/credit-budget-scenarios.ts", { "./credits": credits });
const selection = await load("../lib/model-selection-ui.ts", { "./model-catalog": catalog });
const tier = (number, min, max, input, output) => [
  { dimension: `tier${number}:input`, unit: "1M_tokens", retailMicrousd: input, tierMinInputTokens: min, tierMaxInputTokens: max },
  { dimension: `tier${number}:output`, unit: "1M_tokens", retailMicrousd: output, tierMinInputTokens: min, tierMaxInputTokens: max },
];
const tiered = { model: "tiered-model", provider: "apimart", kind: "chat", billingReady: true, rates: [...tier(1, 0, 8_000, 1_000_000, 2_000_000), ...tier(2, 8_000, null, 3_000_000, 6_000_000)] };
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
function find(node, predicate) {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, predicate); if (result) return result; } }
  else if (node?.props) { if (predicate(node)) return node; return find(node.props.children, predicate); }
  return null;
}
async function component(react, locale = "en") {
  return (await load("../components/CreditBudgetPlanner.tsx", {
    react, "react/jsx-runtime": jsx, "@/lib/credits": credits, "@/lib/credit-budget-scenarios": scenarios,
    "@/lib/model-selection-ui": selection,
    "./LocaleProvider": { useSiteLocale: () => ({ isEnglish: locale === "en", t: (zh, en) => locale === "en" ? en : zh }) },
  })).CreditBudgetPlanner;
}
async function fixture(prices = [tiered], locale = "en") {
  let cursor = 0, tree;
  const state = [];
  const Planner = await component({ useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = next; }]; } }, locale);
  const render = () => { cursor = 0; tree = Planner({ prices }); };
  render();
  return {
    tree: () => tree,
    scenario: id => { const input = find(tree, node => node.props.type === "radio" && node.props.value === id); assert.ok(input); input.props.onChange(); render(); },
    change: (id, value) => { const input = find(tree, node => node.props.id === id); assert.ok(input); input.props.onChange({ target: { value } }); render(); },
  };
}
const result = tree => find(tree, node => node.props.className === "credit-budget-result credit-budget-scenario-result");

test("public scenarios declare exact sample token counts and retain daily as the default", () => {
  assert.deepEqual(Array.from(scenarios.TEXT_BUDGET_SCENARIOS, sample => [sample.id, sample.inputTokens, sample.outputTokens]), [
    ["daily", 2_000, 1_000], ["coding", 8_000, 2_000], ["analysis", 32_000, 2_000],
  ]);
  assert.equal(scenarios.getBudgetScenario("unknown").id, "daily");
});

test("scenario estimates select the matching tier at its inclusive upper bound and floor affordable counts", () => {
  const original = JSON.stringify(tiered);
  for (const [id, cost, count] of [["daily", 4_000, 5_000], ["coding", 12_000, 1_666], ["analysis", 108_000, 185]]) {
    const sample = scenarios.getBudgetScenario(id);
    const [price] = selection.selectionPrices([tiered], sample.inputTokens);
    const estimate = scenarios.estimateScenarioBudget(20_000_000, sample, price.inputUsdPerMillion * 1_000_000, price.outputUsdPerMillion * 1_000_000);
    assert.equal(estimate.exampleMicrousd, cost, id);
    assert.equal(estimate.hundredExamplesMicrousd, cost * 100, id);
    assert.equal(estimate.examples, count, id);
    assert.ok(estimate.examples * cost <= 20_000_000);
    assert.ok((estimate.examples + 1) * cost > 20_000_000);
  }
  assert.equal(JSON.stringify(tiered), original);
});

test("100-example totals sum independent rounded requests without a fictional bulk discount", () => {
  const estimate = scenarios.estimateScenarioBudget(1_000, { inputTokens: 1, outputTokens: 1 }, 1, 1);
  assert.equal(estimate.exampleMicrousd, 1);
  assert.equal(estimate.hundredExamplesMicrousd, 100);
  assert.equal(estimate.examples, 1_000);
  assert.equal(scenarios.estimateScenarioBudget(-1, scenarios.getBudgetScenario("daily"), 1, 1), null);
  assert.equal(scenarios.estimateScenarioBudget(Number.MAX_SAFE_INTEGER, { inputTokens: 1_000_000, outputTokens: 1 }, Number.MAX_SAFE_INTEGER, 0), null);
});

test("bilingual SSR shows all scenarios, visible token assumptions, 35-credit USD equivalents and no promise of success", async () => {
  for (const locale of ["zh", "en"]) {
    const Planner = await component(React, locale);
    const html = renderToStaticMarkup(React.createElement(Planner, { prices: [tiered] }));
    const copy = html.replace(/<[^>]*>/g, "").replaceAll("&amp;", "&");
    for (const sample of scenarios.TEXT_BUDGET_SCENARIOS) assert.ok(copy.includes(sample.title[locale]));
    assert.match(html, /type="radio"[^>]*checked=""[^>]*value="daily"|type="radio"[^>]*value="daily"[^>]*checked=""/);
    assert.match(copy, locale === "en" ? /2,000 input \+ 1,000 output tokens/ : /2,000 输入 \+ 1,000 输出 tokens/);
    assert.match(copy, locale === "en" ? /700 credits \(\$20\)/ : /700 积分 \(\$20\)/);
    assert.match(copy, locale === "en" ? /0\.14 credits \(\$0\.004\)/ : /0\.14 积分 \(\$0\.004\)/);
    assert.match(copy, locale === "en" ? /14 credits \(\$0\.4\)/ : /14 积分 \(\$0\.4\)/);
    assert.match(copy, locale === "en" ? /task success is not guaranteed/ : /不保证任务成功率/);
    assert.match(copy, locale === "en" ? /without a batch discount/ : /不是批量折扣/);
    assert.doesNotMatch(copy, /apimart|tokenhub|rkapi|upstream|供应成本/i);
  }
});

test("changing scenarios updates costs and counts using the same selected model and real input tier", async () => {
  const f = await fixture();
  f.change("credit-budget-model", "gateway:tiered-model");
  f.scenario("coding");
  assert.match(text(f.tree()), /8,000 input \+ 2,000 output tokens/);
  assert.match(text(result(f.tree())), /0\.42 credits \(\$0\.012\)/);
  assert.match(text(result(f.tree())), /42 credits \(\$1\.2\)/);
  assert.match(text(result(f.tree())), /1,666 example tasks/);
  f.scenario("analysis");
  assert.equal(find(f.tree(), node => node.props.id === "credit-budget-model").props.value, "gateway:tiered-model");
  assert.match(text(f.tree()), /32,000 input \+ 2,000 output tokens/);
  assert.match(text(result(f.tree())), /3\.78 credits \(\$0\.108\)/);
  assert.match(text(result(f.tree())), /378 credits \(\$10\.8\)/);
  assert.match(text(result(f.tree())), /185 example tasks/);
  f.change("credit-budget-amount", "0.01");
  assert.match(text(result(f.tree())), /0 example tasks/);
  f.change("credit-budget-amount", "-1");
  assert.equal(result(f.tree()), null);
  assert.match(text(find(f.tree(), node => node.props.role === "status")), /positive USD budget/);
});

test("a missing long-context quote keeps the selected model instead of silently switching to another price", async () => {
  const limited = { ...tiered, model: "limited-model", rates: tier(1, 0, 8_000, 1_000_000, 2_000_000) };
  const f = await fixture([limited, tiered]);
  f.change("credit-budget-model", "gateway:limited-model");
  f.scenario("analysis");
  assert.equal(find(f.tree(), node => node.props.id === "credit-budget-model").props.value, "gateway:limited-model");
  assert.equal(result(f.tree()), null);
  assert.match(text(find(f.tree(), node => node.props.role === "status")), /selected model has no matching input\/output rates/);
  f.scenario("daily");
  assert.match(text(result(f.tree())), /0\.14 credits \(\$0\.004\)/);
});

test("same-named model services retain separate prices while disabled and mismatched-tier models stay excluded", async () => {
  const alternate = { ...tiered, provider: "tokenhub", rates: tier(1, 0, null, 10_000_000, 20_000_000) };
  const disabled = { ...tiered, model: "disabled", billingReady: false };
  const mismatch = { ...tiered, model: "mismatched", rates: [tier(1, 0, null, 1, 2)[0], tier(2, 0, null, 1, 2)[1]] };
  const f = await fixture([tiered, alternate, disabled, mismatch]);
  assert.doesNotMatch(text(f.tree()), /disabled|mismatched/);
  f.change("credit-budget-model", "studio:tiered-model");
  assert.match(text(result(f.tree())), /1\.4 credits \(\$0\.04\)/);
  assert.match(text(result(f.tree())), /500 example tasks/);
  f.change("credit-budget-model", "gateway:tiered-model");
  assert.match(text(result(f.tree())), /0\.14 credits \(\$0\.004\)/);
});
