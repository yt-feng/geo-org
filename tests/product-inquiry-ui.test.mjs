import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

const filename = new URL("../components/ProductMarket.tsx", import.meta.url).pathname;
const code = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const copyModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL("../lib/product-copy.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: copyModule, exports: copyModule.exports });
const product = { id: "plus-test", name: "ChatGPT Plus", variant: "Test region", retailCents: 12000, delivery: "code", soldOut: false, description: "Subscription inquiry" };
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
function find(node, predicate) {
  if (Array.isArray(node)) { for (const item of node) { const result = find(item, predicate); if (result) return result; } }
  else if (node?.props) { if (predicate(node)) return node; return find(node.props.children, predicate); }
  return null;
}
function fixture(fetcher = async () => Response.json({ ok: true, inquiryId: "inq-1", emailStatus: "sent" }), locale = "zh") {
  const hooks = [], calls = []; let cursor = 0, tree;
  const react = {
    useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: initial }; return [hooks[index].value, value => { hooks[index].value = typeof value === "function" ? value(hooks[index].value) : value; }]; },
    useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial }; },
    useEffect() {},
  };
  const compiled = { exports: {} };
  vm.runInNewContext(code, {
    module: compiled, exports: compiled.exports, crypto: webcrypto,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return jsx;
      if (name === "./ProviderLogo") return { ProviderLogo: () => null };
      if (name === "./LocaleProvider") return { useSiteLocale: () => ({ locale, isEnglish: locale === "en", t: (zh, en) => locale === "en" ? en : zh }) };
      if (name === "@/lib/product-copy") return copyModule.exports;
      if (name === "@/lib/public-products") return { digitalProducts: [product], cny: cents => `¥${(cents / 100).toFixed(2)}` };
      throw Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url, init) => { calls.push({ url, init }); return fetcher(url, init); },
  }, { filename });
  function render() { cursor = 0; tree = compiled.exports.ProductMarket(); return tree; }
  function fill(name, value) { find(tree, node => node.props.name === name).props.onChange({ target: { value } }); render(); }
  const submit = () => find(tree, node => node.type === "form").props.onSubmit({ preventDefault() {} });
  render();
  find(tree, node => node.type === "button" && text(node) === (locale === "en" ? "Send an inquiry" : "提交购买需求")).props.onClick(); render();
  return { calls, fill, submit, render, tree: () => tree };
}

test("a public product inquiry sends contact requirements without login or wallet requests", async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  assert.match(text(f.tree()), /¥120\.00/);
  assert.doesNotMatch(text(f.tree()), /¥100\.00|源价|源头|加价|20\s*%|×\s*1\.20/);
  assert.equal(text(find(f.tree(), node => node.props.className === "product-price")), "¥120.00参考售价");
  assert.equal(text(find(f.tree(), node => node.props.className === "product-inquiry-price")), "参考售价¥120.00");
  assert.match(text(f.tree()), /24 小时/);
  assert.equal(find(f.tree(), node => node.type === "input" && node.props.type === "password"), null);
  f.fill("email", " Buyer@Example.com "); f.fill("name", " Buyer "); f.fill("message", " Two subscriptions, next week. ");
  await f.submit(); f.render();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/product-inquiries");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { productId: product.id, email: "buyer@example.com", name: "Buyer", message: "Two subscriptions, next week." });
  assert.match(f.calls[0].init.headers["Idempotency-Key"], /^[A-Za-z0-9_-]{8,128}$/);
  assert.match(text(f.tree()), /需求已收到.*inq-1.*buyer@example\.com.*通知邮件已发送/s);
  assert.doesNotMatch(text(f.tree()), /扣款|余额支付|预留额度/);
  assert.equal(find(f.tree(), node => node.type === "form"), null);
});

test("durably saved pending inquiries show queued delivery and cannot be resubmitted", async () => {
  const f = fixture(async () => Response.json({ ok: true, inquiryId: "inq-pending", emailStatus: "pending" }, { status: 202 }));
  f.fill("email", "buyer@example.com"); f.fill("message", "Please confirm availability.");
  await f.submit(); f.render();
  assert.match(text(f.tree()), /需求已收到.*需求已保存，通知邮件正在排队发送，请勿重复提交/s);
  assert.equal(find(f.tree(), node => node.type === "form"), null);
  assert.equal(f.calls.length, 1);
});

test("concurrent clicks submit once and explicit retries reuse only unchanged inquiry contents", async () => {
  let resolveResponse;
  const f = fixture(() => new Promise(resolve => { resolveResponse = resolve; }));
  f.fill("email", "buyer@example.com"); f.fill("message", "One subscription.");
  const first = f.submit(), second = f.submit();
  assert.equal(f.calls.length, 1);
  resolveResponse(Response.json({ error: { message: "Please retry." } }, { status: 503 }));
  await Promise.all([first, second]); f.render();
  const retry = f.submit(); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].init.headers["Idempotency-Key"], f.calls[1].init.headers["Idempotency-Key"]);
  resolveResponse(Response.json({ error: "Please retry." }, { status: 503 })); await retry; f.render();
  f.fill("message", "Two subscriptions.");
  const edited = f.submit(); assert.equal(f.calls.length, 3);
  assert.notEqual(f.calls[1].init.headers["Idempotency-Key"], f.calls[2].init.headers["Idempotency-Key"]);
  resolveResponse(Response.json({ ok: true, inquiryId: "inq-2", emailStatus: "sent" })); await edited;
});

test("invalid email or empty requirements never reaches the inquiry service", async () => {
  const f = fixture();
  f.fill("email", "invalid"); f.fill("message", "One subscription."); await f.submit();
  f.fill("email", "buyer@example.com"); f.fill("message", "   "); await f.submit();
  assert.equal(f.calls.length, 0);
  f.render(); assert.match(text(f.tree()), /有效的联系邮箱和需求说明/);
});

test("all eight audited product details retain their exact prices, source identities and sold-out snapshot", async () => {
  const compiledModule = { exports: {} };
  const source = await readFile(new URL("../lib/products.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: compiledModule, exports: compiledModule.exports });
  const { digitalProducts, productSourceAudit } = compiledModule.exports;
  const observed = [
    ["pro-20x-ph", "11123", 125000, 1], ["pro-5x-ios", "222", 74000, 8],
    ["pro-5x-ph", "1568", 74000, 3], ["plus-year", "132434", 160000, 100],
    ["pro-20x-ios", "2132324", 155000, 0], ["plus-ios", "11111", 14500, 2],
    ["pro-5x-cl", "111", 74000, 5], ["plus-ph", "123", 13500, 19],
  ];
  assert.equal(digitalProducts.length, 8);
  assert.equal(Object.keys(productSourceAudit).length, 8);
  for (const [id, sourceId, cents, stock] of observed) {
    const entry = digitalProducts.find(item => item.id === id), audit = productSourceAudit[id];
    assert.ok(entry && audit, id);
    assert.equal(entry.upstreamCents, cents);
    assert.equal(entry.retailCents, Math.ceil(cents * 6 / 5));
    assert.equal(entry.soldOut, stock === 0);
    assert.equal(audit.sourceUrl, `https://xiaoxincodex.codes/products/${sourceId}`);
    assert.equal(audit.observedStock, stock);
    assert.ok(audit.sourceSpecification && audit.details.length);
    assert.equal(entry.sourceUrl, undefined, "source identity is audit metadata rather than storefront data");
  }
  const page = await readFile(new URL("../app/products/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /PRODUCT_SOURCE|xiaoxin|小鑫/i);
});


test("English inquiries retain the same payload, idempotency and queued-delivery contract", async () => {
  const f = fixture(async () => Response.json({ ok: true, inquiryId: "inq-en", emailStatus: "pending" }, { status: 202 }), "en");
  assert.match(text(f.tree()), /Indicative price/);
  assert.doesNotMatch(text(f.tree()), /[\u4e00-\u9fff]/);
  f.fill("email", " Buyer@Example.com "); f.fill("name", " Buyer "); f.fill("message", " One subscription for next week. ");
  await f.submit(); f.render();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/product-inquiries");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { productId: product.id, email: "buyer@example.com", name: "Buyer", message: "One subscription for next week." });
  assert.match(f.calls[0].init.headers["Idempotency-Key"], /^[A-Za-z0-9_-]{8,128}$/);
  assert.match(text(f.tree()), /Inquiry received.*inq-en.*buyer@example\.com.*24 hours.*saved.*queued/s);
  assert.equal(find(f.tree(), node => node.type === "form"), null);
});

test("English error handling localizes a server error without changing retry identity", async () => {
  const f = fixture(async () => Response.json({ error: "需求提交未完成" }, { status: 503 }), "en");
  f.fill("email", "buyer@example.com"); f.fill("message", "One subscription.");
  await f.submit(); f.render();
  assert.match(text(f.tree()), /could not be confirmed/);
  assert.doesNotMatch(text(f.tree()), /[\u4e00-\u9fff]/);
  await f.submit();
  assert.equal(f.calls[0].init.headers["Idempotency-Key"], f.calls[1].init.headers["Idempotency-Key"]);
});

test("all eight public products have complete English copy without modifying their commercial data", async () => {
  const compiled = { exports: {} };
  const productsSource = await readFile(new URL("../lib/public-products.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(productsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: compiled, exports: compiled.exports });
  const products = compiled.exports.digitalProducts;
  assert.equal(products.length, 8);
  for (const item of products) {
    const before = JSON.stringify(item), copy = copyModule.exports.productCopy(item, "en");
    assert.ok(copy.variant.length > 5 && copy.description.length > 30, item.id);
    assert.doesNotMatch(copy.variant + copy.description, /[\u4e00-\u9fff]/, item.id);
    assert.notEqual(copy.description, "Send an inquiry to confirm product details and availability.", item.id);
    assert.equal(JSON.stringify(item), before);
    assert.equal(copyModule.exports.productCopy(item, "zh").variant, item.variant);
  }
});
