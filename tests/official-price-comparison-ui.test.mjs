import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { catalog } from "./helpers/model-catalog.mjs";

class ReviewDate extends Date {
  constructor(value = "2026-10-24T12:00:00Z") { super(value); }
}
async function load(path, dependencies = {}) {
  const file = new URL(path, import.meta.url), compiledModule = { exports: {} };
  const code = ts.transpileModule(await readFile(file, "utf8"), { fileName: file.pathname, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, Date: ReviewDate, require(name) {
    if (name in dependencies) return dependencies[name];
    throw Error(`Unexpected comparison dependency: ${name}`);
  } });
  return compiledModule.exports;
}
const credits = await load("../lib/credits.ts");
const official = await load("../lib/official-pricing.ts");
const selection = await load("../lib/model-selection-ui.ts", { "./model-catalog": catalog });
const priceCopy = await load("../lib/price-copy.ts");
const components = {};
for (const locale of ["zh", "en"]) {
  components[locale] = (await load("../components/OfficialPriceComparison.tsx", {
    "react/jsx-runtime": jsx,
    "@/lib/official-pricing": official,
    "@/lib/credits": credits,
    "@/lib/model-selection-ui": selection,
    "@/lib/price-copy": priceCopy,
    "./LocaleProvider": { useSiteLocale: () => ({ isEnglish: locale === "en", t: (zh, en) => locale === "en" ? en : zh }) },
  })).OfficialPriceComparison;
}
const rate = (retailMicrousd, dimension = "input", extra = {}) => ({ dimension, unit: "1M_tokens", retailMicrousd, ...extra });
const price = (model, rates, extra = {}) => ({ model, provider: "apimart", kind: "chat", billingReady: true, rates, ...extra });
const render = (value, locale = "en") => renderToStaticMarkup(createElement(components[locale], { price: value }));
const content = html => html.replace(/<[^>]*>/g, "");

test("real official comparisons render lower, equal and higher retail prices in both languages", () => {
  for (const locale of ["zh", "en"]) {
    const cheaper = render(price("gpt-4.1", [rate(500_000)]), locale);
    assert.match(content(cheaper), locale === "en" ? /Save 75\.0%.*Official is 4\.0× tokvilo/ : /省 75\.0%.*官方为 tokvilo 的 4\.0 倍/);
    assert.match(cheaper, /class="price-saving"/);
    assert.match(cheaper, /href="https:\/\/developers\.openai\.com\/api\/docs\/models\/gpt-4\.1"/);
    assert.match(cheaper, /2026-10-24/);
    assert.match(cheaper, /<details class="official-price-details">/);
    assert.match(cheaper, /Standard on-demand text tokens/);
    const equal = render(price("gpt-4.1", [rate(2_000_000)]), locale);
    assert.match(content(equal), locale === "en" ? /Same price/ : /价格相同/);
    assert.doesNotMatch(equal, /price-saving|Save \d|省 \d/);
    const higher = render(price("gpt-4.1", [rate(3_000_000)]), locale);
    assert.match(content(higher), locale === "en" ? /50\.0% higher/ : /高 50\.0%/);
    assert.doesNotMatch(higher, /price-saving|Save \d|省 \d/);
  }
});

test("unknown exact models show an unverified message and never reuse nearby model prices", () => {
  for (const locale of ["zh", "en"]) {
    const html = render(price("gpt-4.1-unverified-version", [rate(1)]), locale);
    assert.match(html, /official-price-unverified/);
    assert.match(content(html), locale === "en" ? /exact model is not yet verified; no savings claim/ : /官方同型号价格待核实，暂不计算优惠/);
    assert.doesNotMatch(html, /price-saving|<table|Save \d|省 \d/);
  }
});

test("CNY reference prices retain their currency and do not claim USD savings", () => {
  for (const locale of ["zh", "en"]) {
    const html = render(price("qwen3.8-max", [rate(1_000_000)]), locale);
    assert.match(html, /<td>¥12<\/td><td>\$1<\/td>/);
    assert.match(content(html), locale === "en" ? /Currencies as shown.*Not comparable/ : /按标示币种.*暂不可比/);
    assert.match(content(html), locale === "en" ? /currencies, context tiers or billing conditions do not match/ : /币种、上下文档位或计费条件未对齐/);
    assert.match(html, /help\.aliyun\.com\/en\/model-studio\/model-pricing/);
    assert.doesNotMatch(html, /price-saving|Save \d|省 \d/);
  }
});

test("unclear and conflicting context conditions stay visible without an invented comparison", () => {
  const value = price("gpt-6.1-sol", [rate(1_000_000, "tier1:input", { condition: "输入 ≤ 300,000 tokens", tierMinInputTokens: 0, tierMaxInputTokens: 300_000 })]);
  const english = render(value);
  assert.match(content(english), /Input ≤ 300,000 tokens/);
  assert.match(content(english), /Not comparable/);
  assert.match(content(english), /No matching official rate verified/);
  assert.match(content(english), /tokvilo: Input ≤ 300,000 tokens/);
  assert.doesNotMatch(english, /price-saving|Save \d|[\u4e00-\u9fff]/);
  const chinese = render(value, "zh");
  assert.match(content(chinese), /输入 ≤ 300,000 tokens/);
  assert.match(content(chinese), /暂不可比/);
  assert.doesNotMatch(chinese, /price-saving|省 \d/);
});

test("both adapter tier shapes render all input/output tiers with translated conditions", () => {
  const shapes = [
    [rate(1_000_000, "tier1:input", { tierMinInputTokens: 0, tierMaxInputTokens: 272_000, condition: "输入 ≤ 272,000 tokens" }), rate(2_000_000, "tier2:input", { tierMinInputTokens: 272_000, tierMaxInputTokens: null, condition: "输入 > 272,000，无更高分档 tokens" })],
    [rate(1_000_000, "input:standard", { condition: "输入不超过 272,000 token" }), rate(2_000_000, "input:long_context", { condition: "输入超过 272,000 token" })],
  ];
  for (const shape of shapes) {
    const withOutput = [...shape, ...shape.map((input, index) => ({ ...input, dimension: input.dimension.replace("input", "output"), retailMicrousd: index ? 7_500_000 : 5_000_000 }))];
    const html = render(price("gpt-6.1-sol", withOutput));
    assert.equal((html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g) || []).length, 4, "both declared tiers of input and output must remain visible");
    assert.equal((html.match(/Save 50\.0%/g) || []).length, 4);
    assert.match(html.split('<details')[0], /at least 50\.0% below official rates/);
    assert.match(html, /<td>\$2<\/td><td>\$1<\/td>/);
    assert.match(html, /<td>\$4<\/td><td>\$2<\/td>/);
    assert.match(html, /<td>\$10<\/td><td>\$5<\/td>/);
    assert.match(html, /<td>\$15<\/td><td>\$7\.5<\/td>/);
    assert.doesNotMatch(html, /[\u4e00-\u9fff]/);
  }
});

test("a comparable price never implies that an unconfigured service can be purchased or called", () => {
  for (const locale of ["zh", "en"]) {
    const value = price("gpt-4.1", [rate(500_000)], { billingReady: false });
    const html = render(value, locale);
    assert.match(content(html), locale === "en" ? /This service is not yet enabled; listed rates do not imply current purchasing or execution availability/ : /此服务尚未开通；列示报价不代表当前可购买或调用/);
    assert.doesNotMatch(html, /<button|href="\/playground/);
  }
});


test("all price positions use the same disclosure while compact cards show the real retail amount outside it", () => {
  for (const retail of [500_000, 2_000_000, 3_000_000]) {
    const html = renderToStaticMarkup(createElement(components.en, { price: price("gpt-4.1", [rate(retail)]), compact: true }));
    const primary = html.split('<details class="official-price-details">')[0];
    assert.ok(primary.includes(credits.formatCreditsWithUsd(retail, "en")));
    assert.match(primary, /Per 1M tokens/);
    assert.equal((html.match(/<details /g) || []).length, 1);
    assert.doesNotMatch(html, /<details[^>]*open/);
    assert.match(html, /Price comparison &amp; billing details/);
  }
});

test("mixed tiers and missing evidence cannot earn an overall savings headline", () => {
  for (const value of [
    price("gpt-4.1", [rate(1_000_000), rate(10_000_000, "output")]),
    price("gpt-4.1", [rate(1_000_000), rate(1_000_000, "output", { condition: "unverified condition" })]),
    price("gpt-4.1", [rate(1_000_000)], { billingReady: false }),
  ]) {
    const html = render(value);
    assert.doesNotMatch(html.split('<details')[0], /official-savings-summary/);
  }
  const html = render(price("gpt-4.1", [rate(1_000_000), rate(7_500_000, "output")]));
  assert.match(html.split('<details')[0], /at least 6\.2% below official rates/);
});

test("missing input or output in any declared tier prevents an overall savings headline", () => {
  const shortInput = rate(1_000_000, "tier1:input", { tierMinInputTokens: 0, tierMaxInputTokens: 272_000 });
  const shortOutput = rate(5_000_000, "tier1:output", { tierMinInputTokens: 0, tierMaxInputTokens: 272_000 });
  const longOutput = rate(7_500_000, "tier2:output", { tierMinInputTokens: 272_000, tierMaxInputTokens: null });
  for (const locale of ["zh", "en"]) {
    for (const value of [
      price("gpt-4.1", [rate(500_000)]),
      price("gpt-4.1", [rate(1_000_000, "output")]),
      price("gpt-6.1-sol", [shortInput, shortOutput, longOutput]),
      price("gpt-6.1-sol", [shortInput, longOutput]),
      price("gpt-6.1-sol", [shortInput, { ...longOutput, dimension: "tier1:output" }]),
    ]) {
      const html = render(value, locale);
      assert.doesNotMatch(html.split('<details')[0], /official-savings-summary/);
      assert.match(html, /class="price-saving"/, "verified individual comparisons remain available in details");
    }
  }
});
