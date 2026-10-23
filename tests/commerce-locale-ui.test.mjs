import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const modules = {};
for (const name of ["public-products", "product-copy", "brand-display"]) {
  const compiledModule = { exports: {} };
  vm.runInNewContext(compile(await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8")), { module: compiledModule, exports: compiledModule.exports });
  modules[`@/lib/${name}`] = compiledModule.exports;
}
const sources = Object.fromEntries(await Promise.all(["WalletPanel", "OrdersPanel"].map(async name => [name, compile(await readFile(new URL(`../components/${name}.tsx`, import.meta.url), "utf8"))])));
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
function find(node, predicate) {
  if (Array.isArray(node)) { for (const item of node) { const found = find(item, predicate); if (found) return found; } }
  else if (node?.props) { if (predicate(node)) return node; return find(node.props.children, predicate); }
  return null;
}
async function fixture(name, props, responder, locale = "en") {
  let cursor = 0, tree; const hooks = [], effects = [], calls = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const react = {
    useState(initial) { const id = cursor++; hooks[id] ||= { value: initial }; return [hooks[id].value, next => { hooks[id].value = typeof next === "function" ? next(hooks[id].value) : next; }]; },
    useRef(initial) { return hooks[cursor++] ||= { current: initial }; },
    useEffect(fn, deps) { const id = cursor++; if (!same(hooks[id]?.deps, deps)) { hooks[id] = { deps }; effects.push(fn); } },
    useCallback(fn, deps) { const id = cursor++; if (!same(hooks[id]?.deps, deps)) hooks[id] = { deps, fn }; return hooks[id].fn; },
  };
  const compiledModule = { exports: {} };
  vm.runInNewContext(sources[name], {
    module: compiledModule, exports: compiledModule.exports, crypto: webcrypto, URL, Blob, setTimeout,
    require(path) {
      if (path === "react") return react;
      if (path === "react/jsx-runtime") return jsx;
      if (path === "next/link") return { default: "a" };
      if (path === "./LocaleProvider") return { useSiteLocale: () => ({ locale, isEnglish: locale === "en", t: (zh, en) => locale === "en" ? en : zh, href: path => locale === "en" ? `/en${path}` : path }) };
      if (modules[path]) return modules[path];
      throw Error(`Unexpected ${path}`);
    },
    fetch: async (url, init) => { calls.push({ url, init }); return responder(url, init); },
  });
  function render() { cursor = 0; tree = compiledModule.exports[name](props); if (name === "WalletPanel") tree = tree.type(tree.props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { await new Promise(setImmediate); render(); }
  render(); await settle();
  return { tree: () => tree, calls, render, settle, change: (predicate, value, checked) => { const node = find(tree, predicate); assert.ok(node); node.props.onChange({ target: { value, checked } }); render(); } };
}
const wallet = { balanceMicrousd: 10000000, reservedMicrousd: 2000000, ledger: [{ id: "entry", kind: "redemption", amount_microusd: 10000000, created_at: "2026-10-23 08:00:00", description: "链动小铺 Tokvilo 兑换码，面值 ¥30" }] };
const billing = { enabled: true, redemptionEnabled: true, issuanceEnabled: true, usdCny: 7.3, packages: [{ id: "30", amountCny: 30, creditMicrousd: 4109589, purchaseUrl: "https://shop.example/product" }] };

test("English wallet preserves code confirmation, purchase destination, amounts and redemption payload", async () => {
  const f = await fixture("WalletPanel", { userId: "buyer", email: "buyer@example.com", isAdmin: false }, async url => url.endsWith("redeem") ? Response.json({ wallet, alreadyRedeemed: true, redemption: { credit_microusd: 4109589 } }) : Response.json({ wallet, billing }));
  assert.match(text(f.tree()), /Available balance\$10\.00/);
  assert.match(text(f.tree()), /Reserved for pending requests\$2\.00/);
  assert.match(text(f.tree()), /fixed top-up conversion of USD 1 = ¥7\.3/);
  assert.doesNotMatch(text(f.tree()), /[\u4e00-\u9fff]/);
  assert.equal(find(f.tree(), node => node.type === "a").props.href, "https://shop.example/product");
  const button = () => find(f.tree(), node => node.type === "button" && text(node) === "Confirm redemption");
  assert.equal(button().props.disabled, true);
  f.change(node => node.props.id === "redeem-code", "TK-TEST-CODE");
  const form = () => find(f.tree(), node => node.type === "form" && find(node, child => child.props.id === "redeem-code"));
  await form().props.onSubmit({ preventDefault() {} });
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  f.change(node => node.type === "input" && node.props.type === "checkbox", undefined, true);
  assert.equal(button().props.disabled, false);
  await form().props.onSubmit({ preventDefault() {} }); f.render();
  const post = f.calls.filter(call => call.init?.method === "POST");
  assert.equal(post.length, 1); assert.equal(post[0].url, "/api/wallet/redeem");
  assert.deepEqual(JSON.parse(post[0].init.body), { code: "TK-TEST-CODE" });
  assert.match(text(f.tree()), /already redeemed.*No duplicate credit/s);
  assert.equal(find(f.tree(), node => node.props.id === "redeem-code").props.value, "");
  assert.equal(button().props.disabled, true);
});

test("English wallet keeps unavailable redemption and revocation confirmations intact", async () => {
  const f = await fixture("WalletPanel", { userId: "admin", email: "admin@example.com", isAdmin: true }, async url => url.includes("redemption-batches") ? Response.json({ batches: [] }) : Response.json({ wallet, billing: { ...billing, redemptionEnabled: false } }));
  assert.doesNotMatch(text(f.tree()), /[\u4e00-\u9fff]/);
  const revoke = find(f.tree(), node => node.type === "button" && text(node) === "Disable code");
  assert.equal(revoke.props.disabled, true);
  const form = find(f.tree(), node => node.type === "form" && find(node, child => child === revoke));
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  assert.equal(find(f.tree(), node => node.type === "button" && text(node) === "Confirm redemption").props.disabled, true);
});

test("English redemption failures retain actionable server meaning", async () => {
  const f = await fixture("WalletPanel", { userId: "buyer", email: "buyer@example.com", isAdmin: false }, async (url) => url.endsWith("redeem") ? Response.json({ error: { message: "此码暂不可兑换，请核对是否已使用、过期或停用。" } }, { status: 400 }) : Response.json({ wallet, billing }));
  f.change(node => node.props.id === "redeem-code", "TK-TEST-CODE");
  f.change(node => node.type === "input" && node.props.type === "checkbox", undefined, true);
  await find(f.tree(), node => node.type === "form").props.onSubmit({ preventDefault() {} }); f.render();
  assert.match(text(f.tree()), /already used, expired or disabled/);
  assert.equal(find(f.tree(), node => node.props.id === "redeem-code").props.value, "TK-TEST-CODE");
});

const order = { id: "order-1", product_name: "ChatGPT Plus · 菲律宾区", user_id: "buyer", retail_cents: 16200, charge_microusd: 22191781, status: "pending", delivery: "", created_at: "2026-10-23 08:00:00" };
test("English orders translate current product labels while preserving cancellation payload and settlement values", async () => {
  const f = await fixture("OrdersPanel", {}, async (url, init) => Response.json(init?.method === "PATCH" ? { order } : { orders: [order] }));
  assert.match(text(f.tree()), /ChatGPT Plus · Philippines region/);
  assert.match(text(f.tree()), /¥162\.00 \/ \$22\.191781/);
  assert.match(text(f.tree()), /Awaiting processing · Funds reserved/);
  assert.doesNotMatch(text(f.tree()), /[\u4e00-\u9fff]/);
  assert.equal(find(f.tree(), node => node.props.href).props.href, "/en/products");
  await find(f.tree(), node => node.type === "button" && text(node) === "Cancel order and release funds").props.onClick(); f.render();
  const patch = f.calls.find(call => call.init?.method === "PATCH");
  assert.equal(patch.url, "/api/orders"); assert.deepEqual(JSON.parse(patch.init.body), { id: "order-1", action: "cancel" });
});

test("English order administration retains minimum delivery length and exact submitted content", async () => {
  const f = await fixture("OrdersPanel", { admin: true }, async (url, init) => Response.json(init?.method === "PATCH" ? { order } : { orders: [{ ...order, status: "processing" }] }));
  const button = () => find(f.tree(), node => node.type === "button" && text(node) === "Confirm delivery and settle");
  assert.equal(button().props.disabled, true);
  f.change(node => node.type === "textarea", "code"); assert.equal(button().props.disabled, true);
  f.change(node => node.type === "textarea", "  Delivered with personal details  "); assert.equal(button().props.disabled, false);
  await button().props.onClick();
  const patch = f.calls.find(call => call.init?.method === "PATCH");
  assert.equal(patch.url, "/api/admin/orders");
  assert.deepEqual(JSON.parse(patch.init.body), { id: "order-1", action: "complete", delivery: "  Delivered with personal details  " });
});

test("wallet and orders pages preserve English at server render and sign-in redirect", async () => {
  for (const path of ["wallet", "orders"]) {
    const page = await readFile(new URL(`../app/dashboard/${path}/page.tsx`, import.meta.url), "utf8");
    assert.match(page, /\(await searchParams\)\?\.lang === "en"/);
    assert.match(page, /requirePortalUser\(locale\)/);
    assert.match(page, /<LocaleProvider locale=\{locale\}>/);
    assert.match(page, /generateMetadata/);
  }
});
