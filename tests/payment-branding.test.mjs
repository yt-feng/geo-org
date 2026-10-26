import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const visible = html => html.replace(/<[^>]*>/g, "");
const creditsModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL("../lib/credits.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: creditsModule, exports: creditsModule.exports });

async function render(name, locale, props) {
  const source = await readFile(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiledModule = { exports: {} };
  const dependencies = {
    "@/lib/credits": creditsModule.exports,
    "next/link": { default: ({ children, ...attributes }) => React.createElement("a", attributes, children) },
    "./PublicNav": { PublicNav: () => React.createElement("nav", {}, "tokvilo") },
    "./PublicFooter": { PublicFooter: () => React.createElement("footer", { "data-public-footer": "true" }, "tokvilo") },
    "./LocaleProvider": { useSiteLocale: () => ({ locale, t: (zh, en) => locale === "en" ? en : zh, href: path => locale === "en" ? `/en${path}` : path }) },
  };
  vm.runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, require: name => dependencies[name] || require(name) });
  return renderToStaticMarkup(React.createElement(compiledModule.exports[name], props));
}

test("billing pages use tokvilo payment branding in both languages and keep availability honest", async () => {
  for (const locale of ["en", "zh"]) {
    for (const checkoutAvailable of [true, false]) {
      const html = await render("BillingInformation", locale, { checkoutAvailable });
      assert.doesNotMatch(visible(html), /paddle|\bBO\b/i);
      assert.match(visible(html), /tokvilo/);
      assert.match(visible(html), checkoutAvailable ? /Online checkout is available|在线支付已开放/ : /Online checkout is not available yet|在线支付尚未开放/);
      assert.match(html, /<\/main><footer data-public-footer="true">/);
      assert.match(visible(html), /enterprise bank transfer|企业银行转账/i);
    }
  }
});

test("billing packs show a fixed credit conversion alongside unchanged one-time USD prices in both languages", async () => {
  for (const locale of ["en", "zh"]) {
    const html = await render("BillingInformation", locale, { checkoutAvailable: true });
    const packs = html.match(/<article class="billing-pack">[\s\S]*?<\/article>/g);
    assert.equal(packs.length, 3);
    for (const [index, amount] of [20, 50, 100].entries()) {
      const copy = visible(packs[index]);
      assert.match(copy, new RegExp(`\\$${amount}USD`));
      assert.match(copy, new RegExp(`${amount},000 ${locale === "en" ? "credits" : "积分"} \\(\\$${amount}\\)`));
      assert.match(copy, locale === "en" ? /One-time payment · before tax/ : /一次性付款 · 未含税/);
    }
    assert.match(visible(html), locale === "en" ? /taxes do not add credits/ : /税费不增加积分/);
    assert.match(visible(html), locale === "en" ? /Every pack uses the same \$1 = 1,000 credits conversion/ : /所有用量包均按 \$1 = 1,000 积分换算/);
    assert.match(visible(html), locale === "en" ? /They are not model tokens/ : /与模型的 token 数不同/);
    assert.match(visible(html), locale === "en" ? /Digital goods do not use API credits/ : /数字商品不使用 API 积分/);
  }
});

test("legal disclosures retain processor facts in policy paragraphs without processor-branded navigation", async () => {
  for (const locale of ["en", "zh"]) {
    for (const document of ["terms", "refunds", "privacy"]) {
      const html = await render("LegalPage", locale, { document });
      const paragraphs = html.match(/<p\b[^>]*>[\s\S]*?<\/p>/g) || [];
      assert.match(visible(paragraphs.join("")), /Paddle/, `${locale}/${document} must disclose the payment provider`);
      assert.doesNotMatch(visible(html.replace(/<p\b[^>]*>[\s\S]*?<\/p>/g, "")), /paddle/i, `${locale}/${document} headings and navigation`);
      assert.match(html, /<\/main><footer data-public-footer="true">/);
      if (document === "terms") assert.match(visible(paragraphs.join("")), /operated by BO|由 BO 运营/);
      if (document === "refunds") {
        assert.match(html, /href="https:\/\/www.paddle.com\/legal\/refund-policy"/);
        assert.match(html, /href="https:\/\/paddle.net"/);
      }
    }
  }
});
