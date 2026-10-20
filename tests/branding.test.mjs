import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { brandDisplay } from "./helpers/brand-display.mjs";

const root = new URL("../", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const upstreamBrand = /(?:tianshu\s*)?token[\s-]*hub|api[\s-]*mart|tik[\s-]*hub|eco[\s-]*geo/i;
async function paths(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? paths(path) : path;
  }))).flat();
}

test("website presentation copy uses tokvilo", async () => {
  const files = [...await paths(resolve(root, "app")), ...await paths(resolve(root, "components"))].filter(file => file.endsWith(".tsx"));
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || [ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail].includes(node.kind)) {
        const text = node.text;
        const attribute = ts.isJsxAttribute(node.parent) ? node.parent.name.getText(ast) : "";
        const implementationValue = text === "upload.apimart.ai" || /^(?:@\/|\.\.?\/|\/)/.test(text) || ["className", "id", "htmlFor", "name", "value", "aria-describedby"].includes(attribute) || /^(?:tokenhub|apimart|tikhub)(?:[-:]|$)/.test(text) || /^(?:provider|status)-/.test(text);
        // A sample URL may retain an existing API route, but service websites are not promoted.
        const compatibleExample = false;
        if (!implementationValue && !compatibleExample && upstreamBrand.test(text)) violations.push(`${file.slice(root.length)}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1} ${text.slice(0, 90)}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  assert.deepEqual(violations, []);
});

test("service labels and operational notices hide upstream branding without changing model identity", () => {
  for (const text of ["APIMART", "ApiMart", "api-mart.ai", "Tianshu TokenHub", "TOKENHUB", "ai-tokenhub.ai", "TikHub"]) {
    assert.doesNotMatch(brandDisplay.displayServiceText(text), upstreamBrand);
    assert.match(brandDisplay.displayServiceText(text), /tokvilo/);
  }
  for (const model of ["GPT Image 2", "Claude Sonnet 4.5", "dreamina-seedance-2-0-260128", "GLM-5", "DEEPSEEK"]) {
    assert.equal(brandDisplay.displayServiceText(model), model);
  }
  assert.equal(brandDisplay.serviceLabel("tokenhub"), "tokvilo 多模态");
  assert.equal(brandDisplay.serviceLabel("apimart"), "tokvilo 文本与图像");
});

test("public and member page components render tokvilo branding", async () => {
  const cache = new Map();
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const source = await readFile(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const dependencies = {};
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
      const specifier = node.moduleSpecifier.text;
      if (specifier === "next/link") dependencies[specifier] = { default: ({ children, ...props }) => React.createElement("a", props, children) };
      else if (specifier === "next/image") dependencies[specifier] = { default: props => {
        const imageProps = { ...props }; delete imageProps.unoptimized;
        return React.createElement("img", imageProps);
      } };
      else if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const base = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(dirname(file), specifier);
        let target;
        for (const extension of [".tsx", ".ts"]) { try { await readFile(base + extension); target = base + extension; break; } catch {} }
        assert.ok(target, `Cannot resolve ${specifier}`);
        dependencies[specifier] = await load(target);
      }
    }
    const compiledModule = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, URL, URLSearchParams, TextEncoder, require: name => dependencies[name] || require(name) }, { filename: file });
    cache.set(file, compiledModule.exports);
    return compiledModule.exports;
  }
  for (const name of ["PublicLanding", "ModelMarket", "ProviderSettingsPanel", "TokenHubSettingsCard", "TokenHubPlayground", "Playground", "ProductMarket"]) {
    const component = (await load(resolve(root, `components/${name}.tsx`)))[name];
    const html = renderToStaticMarkup(React.createElement(component, { isAdmin: false }));
    const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "");
    const text = visible;
    assert.doesNotMatch(text, upstreamBrand, name);
    assert.match(text, /tokvilo/i, name);
  }
});
