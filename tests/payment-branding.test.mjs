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

async function render(name, locale, props) {
  const source = await readFile(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiledModule = { exports: {} };
  const dependencies = {
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
