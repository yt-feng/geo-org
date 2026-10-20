import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

const filename = new URL("../components/ProductMarket.tsx", import.meta.url).pathname;
const code = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const product = { id: "plus-test", name: "ChatGPT Plus", variant: "Test region", upstreamCents: 10000, retailCents: 12000, sourceDelivery: "code", soldOut: false, description: "Subscription inquiry" };
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
function find(node, predicate) {
  if (Array.isArray(node)) { for (const item of node) { const result = find(item, predicate); if (result) return result; } }
  else if (node?.props) { if (predicate(node)) return node; return find(node.props.children, predicate); }
  return null;
}
function fixture(fetcher = async () => Response.json({ ok: true, inquiryId: "inq-1", emailStatus: "sent" })) {
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
      if (name === "@/lib/products") return { digitalProducts: [product], cny: cents => `¥${(cents / 100).toFixed(2)}` };
      throw Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url, init) => { calls.push({ url, init }); return fetcher(url, init); },
  }, { filename });
  function render() { cursor = 0; tree = compiled.exports.ProductMarket(); return tree; }
  function fill(name, value) { find(tree, node => node.props.name === name).props.onChange({ target: { value } }); render(); }
  const submit = () => find(tree, node => node.type === "form").props.onSubmit({ preventDefault() {} });
  render();
  find(tree, node => node.type === "button" && text(node) === "提交购买需求").props.onClick(); render();
  return { calls, fill, submit, render, tree: () => tree };
}

test("a public product inquiry sends contact requirements without login or wallet requests", async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  assert.match(text(f.tree()), /¥120\.00/);
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
