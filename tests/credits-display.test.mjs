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
  const m = { exports: {} };
  vm.runInNewContext(ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { module: m, exports: m.exports, require: key => { if (key in deps) return deps[key]; throw new Error(key); } });
  return m.exports;
}
const credits = await load("../lib/credits.ts");
const selection = await load("../lib/model-selection-ui.ts", { "./model-catalog": catalog });

test("one balance has exact USD and credit equivalents including micro-USD, reversals and maximum integers", () => {
  assert.equal(credits.CREDITS_PER_USD, 1000);
  assert.equal(credits.formatCreditsWithUsd(20_000_000, "en"), "20,000 credits ($20)");
  assert.equal(credits.formatCreditsWithUsd(1, "zh"), "0.001 积分 ($0.000001)");
  assert.equal(credits.formatCreditsWithUsd(-1_000_001, "en"), "-1,000.001 credits (-$1.000001)");
  assert.equal(credits.formatCreditsWithUsd(Number.MAX_SAFE_INTEGER, "en"), "9,007,199,254,740.991 credits ($9,007,199,254.740991)");
  for (const invalid of [NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1]) assert.equal(credits.formatCreditsWithUsd(invalid, "en"), "—");
});

test("budget examples use real rates with one rounding and never round up an affordable count", () => {
  const result = credits.estimateTextBudget(20_000_000, 2000, 1000, 720_000, 3_600_000);
  assert.equal(result.exampleMicrousd, 5040);
  assert.equal(result.examples, 3968);
  assert.ok(result.examples * result.exampleMicrousd <= 20_000_000);
  assert.ok((result.examples + 1) * result.exampleMicrousd > 20_000_000);
  assert.equal(credits.estimateTextBudget(0, 1, 1, 1, 1).examples, 0);
  assert.equal(credits.estimateTextBudget(10, 1, 1, 1, 1).exampleMicrousd, 1);
  assert.equal(credits.estimateTextBudget(10, 1, 1, 0, 0), null);
  assert.equal(credits.estimateTextBudget(-1, 2000, 1000, 1, 1), null);
});

test("bilingual planner shows USD equivalence and fixed example assumptions without guaranteed calls or auto top-up", async () => {
  const prices = [
    { model: "gemini-3.8-flash", provider: "apimart", kind: "chat", billingReady: true, rates: [{ dimension: "input", unit: "1M_tokens", retailMicrousd: 720_000 }, { dimension: "output", unit: "1M_tokens", retailMicrousd: 3_600_000 }] },
    { model: "not-enabled", provider: "selected", kind: "chat", billingReady: false, rates: [{ dimension: "input", unit: "1M_tokens", retailMicrousd: 1 }, { dimension: "output", unit: "1M_tokens", retailMicrousd: 1 }] },
  ];
  for (const locale of ["zh", "en"]) {
    const { CreditBudgetPlanner } = await load("../components/CreditBudgetPlanner.tsx", { react: React, "react/jsx-runtime": jsx, "@/lib/credits": credits, "@/lib/model-selection-ui": selection, "./LocaleProvider": { useSiteLocale: () => ({ isEnglish: locale === "en", t: (zh, en) => locale === "en" ? en : zh }) } });
    const html = renderToStaticMarkup(React.createElement(CreditBudgetPlanner, { prices }));
    assert.match(html, /20,000.*\(\$20\)/);
    assert.match(html, /5\.04.*\(\$0\.00504\)/);
    assert.match(html, /3,968/);
    assert.match(html, /2,000.*1,000/);
    assert.match(html, locale === "zh" ? /不是调用次数承诺.*不会设置扣费上限或自动充值/ : /not a request guarantee, spending limit or automatic top-up/);
    assert.doesNotMatch(html, /not-enabled/);
  }
});
