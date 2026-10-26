import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const modules = {};
for (const name of ["public-products", "product-copy", "brand-display", "credits"]) {
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
      if (path === "./PaddlePaymentPanel") return { PaddlePaymentPanel: "PaddlePaymentPanel" };
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

test("English customers see only the Paddle and enterprise payment panel, with no Liandong checkout or redemption", async () => {
  const f = await fixture("WalletPanel", { userId: "buyer", email: "buyer@example.com", isAdmin: false }, async () => Response.json({ wallet, billing }));
  assert.match(text(f.tree()), /Available credits10,000 credits\$10\.00 USD/);
  assert.match(text(f.tree()), /Reserved for pending requests2,000 credits\$2\.00 USD/);
  assert.doesNotMatch(text(f.tree()), /Liandong|链动|JiaNong|佳农|Redeem a code|Redemption code inventory|fixed top-up conversion/i);
  assert.equal(find(f.tree(), node => node.props.id === "redeem-code"), null);
  assert.equal(find(f.tree(), node => node.props.href === "https://shop.example/product"), null);
  const panel = find(f.tree(), node => node.type === "PaddlePaymentPanel");
  assert.equal(panel.props.email, "buyer@example.com");
  assert.equal(panel.props.userId, "buyer");
  await panel.props.onCreditConfirmed();
  assert.equal(f.calls.filter(call => call.url === "/api/wallet").length, 2);
});

test("English administrators retain inventory tools with revocation confirmation", async () => {
  const f = await fixture("WalletPanel", { userId: "admin", email: "admin@example.com", isAdmin: true }, async url => url.includes("redemption-batches") ? Response.json({ batches: [] }) : Response.json({ wallet, billing }));
  assert.match(text(f.tree()), /Redemption code inventory/);
  assert.doesNotMatch(text(f.tree()), /Liandong|链动|JiaNong|佳农/i);
  const revoke = find(f.tree(), node => node.type === "button" && text(node) === "Disable code");
  assert.equal(revoke.props.disabled, true);
  const form = find(f.tree(), node => node.type === "form" && find(node, child => child === revoke));
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
});

test("Chinese checkout and redemption preserve their destination, confirmation, and exact code", async () => {
  const f = await fixture("WalletPanel", { userId: "buyer", email: "buyer@example.com", isAdmin: false }, async url => url.endsWith("redeem") ? Response.json({ wallet, alreadyRedeemed: true, redemption: { credit_microusd: 4109589 } }) : Response.json({ wallet, billing }), "zh");
  assert.equal(find(f.tree(), node => node.type === "PaddlePaymentPanel"), null);
  assert.match(text(f.tree()), /tokvilo 用量包/);
  assert.match(text(f.tree()), /一次性付款（人民币）¥30获得 4,109\.589 积分 \(\$4\.109589\)/);
  assert.match(text(f.tree()), /最终付款金额及适用税费以收银台确认为准/);
  assert.match(text(f.tree()), /税费不增加积分/);
  assert.match(text(f.tree()), /购买用量/);
  assert.match(text(f.tree()), /不支持其他平台的兑换码/);
  assert.doesNotMatch(text(f.tree()), /Liandong|链动|JiaNong|佳农/i);
  assert.equal(find(f.tree(), node => node.type === "a").props.href, "https://shop.example/product");
  const button = () => find(f.tree(), node => node.type === "button" && text(node) === "确认兑换");
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
  assert.match(text(f.tree()), /本次没有重复入账/);
  assert.equal(find(f.tree(), node => node.props.id === "redeem-code").props.value, "");
});

const order = { id: "order-1", product_name: "ChatGPT Plus · 菲律宾区", user_id: "buyer", retail_cents: 16200, charge_microusd: 22191781, status: "pending", delivery: "", created_at: "2026-10-23 08:00:00" };
test("English orders translate current product labels while preserving cancellation payload and settlement values", async () => {
  const f = await fixture("OrdersPanel", {}, async (url, init) => Response.json(init?.method === "PATCH" ? { order } : { orders: [order] }));
  assert.match(text(f.tree()), /ChatGPT Plus · Philippines region/);
  assert.match(text(f.tree()), /Product price: ¥162\.00/);
  assert.match(text(f.tree()), /Wallet reservation: \$22\.191781/);
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
    assert.match(page, /requirePortalUser\(locale(?:, next)?\)/);
    assert.match(page, /<LocaleProvider locale=\{locale\}>/);
    assert.match(page, /generateMetadata/);
  }
});


test("historical redemption entries display tokvilo labels without changing recorded descriptions or values", async () => {
  const original = JSON.stringify(wallet);
  for (const locale of ["en", "zh"]) {
    const f = await fixture("WalletPanel", { userId: "buyer", email: "buyer@example.com", isAdmin: false }, async () => Response.json({ wallet, billing }), locale);
    assert.match(text(f.tree()), locale === "en" ? /tokvilo code, face value ¥30/ : /tokvilo 兑换码，面值 ¥30/);
    assert.doesNotMatch(text(f.tree()), /Liandong|链动|JiaNong|佳农/i);
    assert.match(text(f.tree()), locale === "en" ? /\+10,000 credits \(\$10\)/ : /\+10,000 积分 \(\$10\)/);
  }
  assert.equal(JSON.stringify(wallet), original);
});

test("wallet balances and debits retain micro-dollar precision in both display units and languages", async () => {
  const tiny = { balanceMicrousd: 1, reservedMicrousd: 999, ledger: [{ ...wallet.ledger[0], reference_id: "request-1", amount_microusd: -1, description: "API request reservation" }] };
  for (const locale of ["en", "zh"]) {
    const f = await fixture("WalletPanel", { userId: "buyer", email: "buyer@example.com", isAdmin: false }, async () => Response.json({ wallet: tiny, billing }), locale);
    const summary = find(f.tree(), node => node.props.className === "wallet-summary");
    assert.match(text(summary), locale === "en" ? /0\.001 credits\$0\.000001 USD/ : /0\.001 积分\$0\.000001 USD/);
    assert.match(text(summary), locale === "en" ? /0\.999 credits\$0\.000999 USD/ : /0\.999 积分\$0\.000999 USD/);
    const debit = find(f.tree(), node => node.props.className === "wallet-debit");
    assert.equal(text(debit), locale === "en" ? "-0.001 credits (-$0.000001)" : "-0.001 积分 (-$0.000001)");
  }
  assert.equal(tiny.ledger[0].amount_microusd, -1);
  const largest = await fixture("WalletPanel", { userId: "buyer", email: "buyer@example.com", isAdmin: false }, async () => Response.json({ wallet: { ...tiny, balanceMicrousd: Number.MAX_SAFE_INTEGER }, billing }));
  assert.match(text(find(largest.tree(), node => node.props.className === "wallet-summary")), /9,007,199,254,740\.991 credits\$9,007,199,254\.740991 USD/);
});

test("historical digital goods ledger entries retain dollar amounts without becoming API credits", async () => {
  const historical = { ...wallet, ledger: [{ ...wallet.ledger[0], reference_id: "order:legacy-product", amount_microusd: -22_191_781, description: "数字商品订单：ChatGPT Plus · 菲律宾区" }] };
  const original = JSON.stringify(historical);
  for (const locale of ["en", "zh"]) {
    const f = await fixture("WalletPanel", { userId: "buyer", email: "buyer@example.com", isAdmin: false }, async () => Response.json({ wallet: historical, billing }), locale);
    const table = find(f.tree(), node => node.type === "table");
    assert.match(text(table), locale === "en" ? /Historical digital goods record/ : /历史数字商品记录/);
    assert.equal(text(find(table, node => node.props.className === "wallet-debit")), "-$22.191781");
    assert.doesNotMatch(text(find(table, node => node.type === "tbody")), /22,191\.781|credits|积分/);
  }
  assert.equal(JSON.stringify(historical), original);
});

test("administrator revocation copy uses the payment provider label and preserves exact code and note", async () => {
  for (const locale of ["en", "zh"]) {
    const f = await fixture("WalletPanel", { userId: "admin", email: "admin@example.com", isAdmin: true }, async url => {
      if (url.endsWith("/revoke")) return Response.json({ creditReversedMicrousd: 10_000_000, alreadyRevoked: false });
      return url.includes("redemption-batches") ? Response.json({ batches: [] }) : Response.json({ wallet, billing });
    }, locale);
    const form = () => find(f.tree(), node => node.type === "form" && text(node).includes(locale === "en" ? "Full redemption code" : "完整兑换码"));
    const codeInput = find(form(), node => node.type === "input" && node.props.maxLength === 128);
    codeInput.props.onChange({ target: { value: "TK-EXACT-ADMIN-CODE" } }); f.render();
    find(form(), node => node.type === "input" && node.props.maxLength === 500).props.onChange({ target: { value: "  Buyer refund confirmed  " } }); f.render();
    find(form(), node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } }); f.render();
    await form().props.onSubmit({ preventDefault() {} }); await f.settle();
    const post = f.calls.find(call => call.init?.method === "POST");
    assert.equal(post.url, "/api/admin/redemption-codes/revoke");
    assert.deepEqual(JSON.parse(post.init.body), { code: "TK-EXACT-ADMIN-CODE", note: "  Buyer refund confirmed  " });
    assert.doesNotMatch(text(f.tree()), /Liandong|链动|JiaNong|佳农/i);
    assert.match(text(f.tree()), locale === "en" ? /Code disabled.*payment provider/s : /兑换码已停用.*支付服务商/s);
  }
});


test("historical orders preserve CNY and exact USD amounts without creating API credit prices", async () => {
  for (const locale of ["zh", "en"]) for (const status of ["pending", "completed", "cancelled"]) {
    const row = { ...order, status, charge_microusd: 1 };
    const original = JSON.stringify(row);
    const f = await fixture("OrdersPanel", {}, async () => Response.json({ orders: [row] }), locale);
    assert.match(text(f.tree()), /¥162\.00/);
    assert.match(text(f.tree()), /\$0\.000001/);
    assert.doesNotMatch(text(f.tree()), /(?:162,000|0\.001) (?:credits|积分)/);
    assert.doesNotMatch(text(f.tree()), /\$1 = 1,000/);
    assert.equal(JSON.stringify(row), original);
  }
});
