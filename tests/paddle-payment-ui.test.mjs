import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

const creditsModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL("../lib/credits.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: creditsModule, exports: creditsModule.exports });
const source = ts.transpileModule(await readFile(new URL("../components/PaddlePaymentPanel.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
function find(node, predicate) {
  if (Array.isArray(node)) { for (const item of node) { const result = find(item, predicate); if (result) return result; } }
  else if (node?.props) { if (predicate(node)) return node; return find(node.props.children, predicate); }
  return null;
}
const config = { enabled: true, environment: "production", clientToken: "live_public_test_fixture", packages: [20, 50, 100].map(amountUsd => ({ id: String(amountUsd), amountUsd, creditMicrousd: amountUsd * 1_000_000 })), reason: null };
const ready = { id: "6e299bcd-95f4-4405-a407-8235718009ea", environment: "production", status: "checkout_ready", transactionId: "txn_fixture", amountUsd: 20, creditMicrousd: 20_000_000, creditedMicrousd: 0, credited: false };
const paid = { ...ready, status: "paid", creditedMicrousd: 20_000_000, credited: true };
const storageKey = "tokvilo:paddle:pending:buyer";

async function fixture({ responder, storage = new Map(), userId = "buyer", brokenStorage = false, url = "https://tokvilo.com/dashboard/wallet?lang=en" } = {}) {
  let cursor = 0, tree, callback, confirmed = 0, nextTimer = 1;
  const hooks = [], effects = [], calls = [], checkouts = [], timers = new Map(), deadlines = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const id = cursor++; hooks[id] ||= { value: initial }; return [hooks[id].value, next => { hooks[id].value = typeof next === "function" ? next(hooks[id].value) : next; }]; },
    useRef(initial) { return hooks[cursor++] ||= { current: initial }; },
    useEffect(fn, deps) { const id = cursor++; if (!same(hooks[id]?.deps, deps)) { hooks[id]?.cleanup?.(); hooks[id] = { deps }; effects.push(() => { hooks[id].cleanup = fn(); }); } },
    useCallback(fn, deps) { const id = cursor++; if (!same(hooks[id]?.deps, deps)) hooks[id] = { deps, fn }; return hooks[id].fn; },
  };
  const compiledModule = { exports: {} };
  vm.runInNewContext(source, {
    module: compiledModule, exports: compiledModule.exports, crypto: webcrypto, URLSearchParams, URL, AbortController,
    window: { location: { href: url }, setInterval(fn) { const id = nextTimer++; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); }, setTimeout(fn, delay) { const id = nextTimer++; deadlines.set(id, { fn, delay }); return id; }, clearTimeout(id) { deadlines.delete(id); } },
    document: { visibilityState: "visible" },
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { if (brokenStorage) throw Error("Storage disabled"); storage.set(key, value); }, removeItem(key) { storage.delete(key); } },
    require(path) {
      if (path === "@/lib/credits") return creditsModule.exports;
      if (path === "react") return react;
      if (path === "react/jsx-runtime") return jsx;
      if (path === "./paddle-checkout-client") return { openPaddleCheckout: async input => { checkouts.push(input); }, subscribeToPaddle: listener => { callback = listener; return () => { callback = null; }; } };
      throw Error(`Unexpected module ${path}`);
    },
    fetch: async (url, init) => { calls.push({ url, init }); return responder ? responder(url, init) : Response.json(url.endsWith("config") ? config : { order: ready }); },
  });
  const props = { userId, email: `${userId}@example.com`, onCreditConfirmed: () => { confirmed++; } };
  function render() { cursor = 0; tree = compiledModule.exports.PaddlePaymentPanel(props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let i = 0; i < 3; i++) { await new Promise(setImmediate); render(); } }
  async function click(label) { const button = find(tree, node => node.type === "button" && text(node) === label); assert.ok(button, `Missing ${label}`); assert.equal(!!button.props.disabled, false, `Disabled ${label}`); await button.props.onClick(); await settle(); }
  function change(id, value) { const input = find(tree, node => node.props.id === id); assert.ok(input); input.props.onChange({ target: { value } }); render(); }
  render(); await settle();
  return { tree: () => tree, calls, storage, checkouts, confirmed: () => confirmed, settle, render, click, change, event: event => callback?.(event), tick: async () => { for (const timer of [...timers.values()]) timer(); await settle(); }, expireRequests: async (milliseconds = 35_000) => { for (const [id, timer] of [...deadlines]) if (timer.delay <= milliseconds) { deadlines.delete(id); timer.fn(); } await settle(); }, pollCount: () => timers.size };
}

test("unapproved or unavailable Paddle never opens checkout and offers honest enterprise instructions", async () => {
  const f = await fixture({ responder: async () => Response.json({ ...config, enabled: false, clientToken: null, reason: "approval_pending" }) });
  assert.match(text(f.tree()), /Online payments are not available yet/);
  assert.equal(find(f.tree(), node => node.type === "button" && text(node) === "Not available yet").props.disabled, true);
  assert.match(text(f.tree()), /opens your email app/);
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  assert.equal(f.checkouts.length, 0);
});

test("usage packs keep their exact dollar payment, disclose tax, and show equivalent credits without changing checkout payloads", async () => {
  for (const amountUsd of [20, 50, 100]) {
    const f = await fixture();
    const packages = find(f.tree(), node => node.props.className === "wallet-packages paddle-packages");
    const card = packages.props.children.find(node => text(find(node, child => child.type === "h3")) === `$${amountUsd}.00`);
    assert.ok(card);
    assert.match(text(card), new RegExp(`${(amountUsd * 35).toLocaleString("en-US")} credits \\(\\$${amountUsd}\\)`));
    assert.match(text(card), /One-time payment \(USD, before tax\)/);
    assert.match(text(card), /taxes do not add credits/);
    assert.match(text(f.tree()), /fixed \$1 = 35 credits/);
    assert.match(text(f.tree()), /cannot be transferred, withdrawn as cash, or used to buy third-party subscriptions or digital goods/);
    await find(card, node => node.type === "button").props.onClick(); await f.settle();
    const payload = JSON.parse(f.calls.find(call => call.init?.method === "POST").init.body);
    assert.deepEqual(Object.keys(payload).sort(), ["packageId", "requestId"]);
    assert.equal(payload.packageId, String(amountUsd));
    assert.equal(f.checkouts[0].transactionId, ready.transactionId);
  }
});

test("client checkout completion cannot credit a wallet; verified order completion refreshes it once", async () => {
  let serverOrder = ready;
  const f = await fixture({ responder: async url => Response.json(url.endsWith("config") ? config : { order: serverOrder }) });
  await f.click("Pay securely");
  assert.equal(f.checkouts.length, 1); assert.equal(f.checkouts[0].transactionId, ready.transactionId);
  const post = f.calls.find(call => call.init?.method === "POST");
  assert.deepEqual(Object.keys(JSON.parse(post.init.body)).sort(), ["packageId", "requestId"]);
  assert.equal(JSON.parse(post.init.body).packageId, "20");
  assert.equal(JSON.parse(f.storage.get(storageKey)).orderId, ready.id);
  f.event({ name: "checkout.completed", data: { transaction_id: "different_transaction" } }); await f.settle();
  assert.equal(f.confirmed(), 0);
  f.event({ name: "checkout.completed", data: { transaction_id: ready.transactionId } }); await f.settle();
  assert.equal(f.confirmed(), 0); assert.match(text(f.tree()), /Waiting for payment confirmation/);
  serverOrder = paid;
  await f.click("Check payment status");
  assert.equal(f.confirmed(), 1); assert.match(text(f.tree()), /Payment confirmed.*700 credits \(\$20\)/s);
  assert.equal(f.storage.has(storageKey), false);
  f.event({ name: "checkout.completed", data: { transaction_id: ready.transactionId } }); await f.settle();
  assert.equal(f.confirmed(), 1);
});

test("unknown creation response persists the exact request across reload, while other accounts cannot resume it", async () => {
  const storage = new Map();
  const first = await fixture({ storage, responder: async (url, init) => { if (init?.method === "POST") throw Error("Connection interrupted"); return Response.json(config); } });
  await first.click("Pay securely");
  const original = JSON.parse(first.calls.find(call => call.init?.method === "POST").init.body);
  assert.equal(JSON.parse(storage.get(storageKey)).requestId, original.requestId);
  const restored = await fixture({ storage });
  await restored.click("Continue payment");
  assert.deepEqual(JSON.parse(restored.calls.find(call => call.init?.method === "POST").init.body), original);
  assert.equal(restored.checkouts.length, 1);
  const other = await fixture({ storage, userId: "other" });
  assert.equal(find(other.tree(), node => node.type === "button" && text(node) === "Continue payment"), null);
  assert.equal(other.calls.some(call => call.url.includes("/orders/")), false);
});

test("refreshing a known order only reads server state and does not create another transaction", async () => {
  const storage = new Map([[storageKey, JSON.stringify({ requestId: "a-valid-request-id-12345", packageId: "20", orderId: ready.id })]]);
  const f = await fixture({ storage, responder: async url => Response.json(url.endsWith("config") ? config : { order: { ...ready, status: "outcome_unknown", transactionId: null } }) });
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  assert.ok(f.calls.some(call => call.url.endsWith(`/orders/${ready.id}`)));
  assert.equal(find(f.tree(), node => node.type === "button" && text(node) === "Continue payment"), null);
  await f.click("Check payment status");
  assert.equal(f.checkouts.length, 0); assert.equal(f.storage.has(storageKey), true);
});

test("storage failure prevents creating a payment that cannot be safely resumed", async () => {
  const f = await fixture({ brokenStorage: true });
  await f.click("Pay securely");
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  assert.match(text(f.tree()), /Browser storage is unavailable/);
});

test("sandbox completion is labeled and never claims spendable balance was added", async () => {
  let serverOrder = { ...ready, environment: "sandbox" };
  const f = await fixture({ responder: async url => Response.json(url.endsWith("config") ? { ...config, environment: "sandbox" } : { order: serverOrder }) });
  assert.match(text(f.tree()), /Test checkout.*no real payment/is);
  await f.click("Pay securely"); serverOrder = { ...serverOrder, status: "paid" };
  await f.click("Check payment status");
  assert.equal(f.confirmed(), 0); assert.equal(f.storage.has(storageKey), false);
  assert.match(text(f.tree()), /no spendable API balance was added/);
});

test("enterprise email contains the signed-in account and entered company and amount without submitting a payment", async () => {
  const f = await fixture();
  f.change("enterprise-company", "Example & Co"); f.change("enterprise-amount", "250.50");
  const link = find(f.tree(), node => node.type === "a" && text(node) === "Request transfer instructions");
  const url = new URL(link.props.href);
  assert.equal(url.pathname, "yt.feng@foxmail.com");
  const body = url.searchParams.get("body");
  assert.match(body, /Account email: buyer@example\.com/); assert.match(body, /Company: Example & Co/); assert.match(body, /USD 250\.50/);
  assert.match(text(f.tree()), /Requested usage: 8,767\.5 credits \(\$250\.5\)/);
  assert.match(text(f.tree()), /This is a request, not credited balance/);
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  f.change("enterprise-amount", "-1");
  assert.equal(find(f.tree(), node => node.type === "a" && text(node) === "Request transfer instructions"), null);
});


test("Paddle return URLs recover only an owner-checked server order and ignore arbitrary transaction IDs", async () => {
  const f = await fixture({ url: `https://tokvilo.com/dashboard/wallet?lang=en&paddle_order=${ready.id}&_ptxn=txn_untrusted` });
  assert.ok(f.calls.some(call => call.url.endsWith(`/orders/${ready.id}`)));
  await f.click("Continue payment");
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  assert.equal(f.checkouts.length, 1); assert.equal(f.checkouts[0].transactionId, ready.transactionId);
  const arbitrary = await fixture({ url: "https://tokvilo.com/dashboard/wallet?lang=en&_ptxn=txn_untrusted" });
  assert.equal(arbitrary.calls.some(call => call.url.includes("/orders/")), false);
  assert.equal(arbitrary.checkouts.length, 0);
});

test("a new payment after completion stays recoverable if its create response is interrupted", async () => {
  let failNext = false, serverOrder = ready;
  const f = await fixture({ responder: async (url, init) => {
    if (init?.method === "POST" && failNext) throw Error("Connection interrupted");
    return Response.json(url.endsWith("config") ? config : { order: serverOrder });
  } });
  await f.click("Pay securely"); serverOrder = paid;
  await f.click("Check payment status");
  failNext = true;
  await f.click("Pay securely");
  const pending = JSON.parse(f.storage.get(storageKey));
  assert.equal(pending.orderId, undefined);
  assert.ok(find(f.tree(), node => node.type === "button" && text(node) === "Continue payment"));
  assert.doesNotMatch(text(f.tree()), new RegExp(`Order ${ready.id}`));
});

test("a saved unpaid package has an actionable top-card resume while other packages explain the existing checkout", async () => {
  const storage = new Map([[storageKey, JSON.stringify({ requestId: "saved-checkout-request-123", packageId: "20", orderId: ready.id })]]);
  const f = await fixture({ storage });
  const packages = find(f.tree(), node => node.props.className === "wallet-packages paddle-packages");
  const cards = packages.props.children;
  const first = find(cards[0], node => node.type === "button");
  assert.equal(text(first), "Continue payment"); assert.equal(first.props.disabled, false);
  for (const card of cards.slice(1)) {
    const button = find(card, node => node.type === "button");
    assert.equal(button.props.disabled, true); assert.equal(text(button), "Finish existing checkout first");
    assert.equal(button.props["aria-busy"], false);
  }
  assert.ok(text(f.tree()).indexOf("Your $20.00 checkout is saved") < text(f.tree()).indexOf("Your saved checkout"));
  await first.props.onClick(); await f.settle();
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  assert.equal(f.checkouts[0].transactionId, ready.transactionId);
});

test("a hanging create request times out, releases the action, and retries only its saved idempotency key", async () => {
  let hanging = true;
  const f = await fixture({ responder: async (url, init) => {
    if (init?.method === "POST" && hanging) return new Promise(() => {});
    return Response.json(url.endsWith("config") ? config : { order: ready });
  } });
  await f.click("Pay securely");
  const post = f.calls.find(call => call.init?.method === "POST"), saved = f.storage.get(storageKey);
  assert.ok(find(f.tree(), node => node.type === "button" && text(node) === "Preparing checkout…").props["aria-busy"]);
  await f.expireRequests();
  assert.equal(post.init.signal.aborted, true);
  assert.equal(f.storage.get(storageKey), saved);
  assert.match(text(f.tree()), /Checkout confirmation took too long/);
  assert.equal(find(f.tree(), node => node.type === "button" && text(node) === "Continue payment").props.disabled, false);
  hanging = false;
  await f.click("Continue payment");
  const posts = f.calls.filter(call => call.init?.method === "POST");
  assert.equal(posts.length, 2); assert.equal(posts[1].init.body, post.init.body);
  assert.equal(f.checkouts.length, 1);
});

test("request deadline includes a stalled response body and config stops showing an endless loading state", async () => {
  const f = await fixture({ responder: async () => ({ ok: true, json: () => new Promise(() => {}) }) });
  assert.match(text(f.tree()), /Checking online payment availability/);
  await f.expireRequests(20_000);
  assert.doesNotMatch(text(f.tree()), /Checking online payment availability/);
  assert.match(text(f.tree()), /Online payment is unavailable right now/);
  assert.equal(f.calls[0].init.signal.aborted, true);
});

test("stalled background status reads do not display a blocking spinner and their deadlines permit later recovery", async () => {
  let hanging = true;
  const storage = new Map([[storageKey, JSON.stringify({ requestId: "saved-checkout-request-456", packageId: "20", orderId: ready.id })]]);
  const f = await fixture({ storage, responder: async url => {
    if (url.includes("/orders/") && hanging) return new Promise(() => {});
    return Response.json(url.endsWith("config") ? config : { order: ready });
  } });
  assert.doesNotMatch(text(f.tree()), /Checking payment…/);
  assert.equal(find(f.tree(), node => node.type === "button" && text(node) === "Continue payment").props.disabled, false);
  await f.expireRequests(20_000);
  assert.match(text(f.tree()), /Payment status took too long/);
  assert.equal(JSON.parse(f.storage.get(storageKey)).orderId, ready.id);
  hanging = false;
  await f.tick();
  await f.click("Continue payment");
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  assert.equal(f.checkouts.length, 1);
});

test("checkout completion after the initial polling window restarts confirmation until the delayed server receipt arrives", async () => {
  let serverOrder = ready;
  const f = await fixture({ responder: async url => Response.json(url.endsWith("config") ? config : { order: serverOrder }) });
  await f.click("Pay securely");
  for (let index = 0; index < 30; index++) await f.tick();
  assert.equal(f.pollCount(), 0); assert.equal(f.confirmed(), 0);
  f.event({ name: "checkout.completed", data: { transaction_id: ready.transactionId } }); await f.settle();
  assert.equal(f.pollCount(), 1); assert.equal(f.confirmed(), 0);
  assert.match(text(f.tree()), /Waiting for payment confirmation/);
  serverOrder = paid;
  await f.tick();
  assert.equal(f.confirmed(), 1); assert.equal(f.pollCount(), 0);
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 1);
});

for (const lateFailure of ["network error", "deadline"]) test(`a stale background ${lateFailure} cannot overwrite a payment verified by a concurrent resume read`, async () => {
  let reads = 0, rejectBackground;
  const storage = new Map([[storageKey, JSON.stringify({ requestId: "saved-checkout-request-789", packageId: "20", orderId: ready.id })]]);
  const f = await fixture({ storage, responder: async url => {
    if (url.endsWith("config")) return Response.json(config);
    if (++reads === 1) return new Promise((_, reject) => { rejectBackground = reject; });
    return Response.json({ order: paid });
  } });
  await f.click("Continue payment");
  assert.equal(f.confirmed(), 1); assert.equal(f.storage.has(storageKey), false);
  assert.match(text(f.tree()), /Payment confirmed\. 700 credits \(\$20\) has been added/);
  if (lateFailure === "deadline") await f.expireRequests(20_000);
  else { rejectBackground(Error("Old background request failed")); await f.settle(); }
  assert.match(text(f.tree()), /Payment confirmed\. 700 credits \(\$20\) has been added/);
  assert.doesNotMatch(text(f.tree()), /Old background request failed|Payment status took too long/);
  assert.equal(f.confirmed(), 1); assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
});


test("customer payment controls and lifecycle notices keep tokvilo branding", async () => {
  for (const paymentConfig of [config, { ...config, enabled: false, clientToken: null }, { ...config, environment: "sandbox" }]) {
    const f = await fixture({ responder: async url => Response.json(url.endsWith("config") ? paymentConfig : { order: { ...ready, environment: paymentConfig.environment } }) });
    assert.doesNotMatch(text(f.tree()), /paddle/i);
    assert.match(text(f.tree()), /tokvilo API credit packs/);
    if (!paymentConfig.enabled) continue;
    await f.click("Pay securely");
    assert.doesNotMatch(text(f.tree()), /paddle/i);
    assert.ok(find(f.tree(), node => node.type === "button" && text(node) === "Continue payment"));
    for (const name of ["checkout.completed", "checkout.closed", "checkout.error"]) {
      f.event({ name, data: { transaction_id: ready.transactionId } }); await f.settle();
      assert.doesNotMatch(text(f.tree()), /paddle/i);
    }
    assert.ok(f.calls.some(call => call.url === "/api/billing/paddle/checkout"), "branding must not change the integration route");
    assert.equal(JSON.parse(f.storage.get(storageKey)).orderId, ready.id);
  }
});

test("processor-specific server diagnostics do not leak into customer errors or discard the saved request", async () => {
  const f = await fixture({ responder: async (url, init) => init?.method === "POST"
    ? Response.json({ error: { message: "Paddle checkout is awaiting approval for Tokvilo API services." } }, { status: 503 })
    : Response.json(config) });
  await f.click("Pay securely");
  assert.doesNotMatch(text(f.tree()), /paddle/i);
  assert.match(text(f.tree()), /Online payment could not be confirmed.*request is saved/s);
  const original = JSON.parse(f.storage.get(storageKey));
  await f.click("Continue payment");
  assert.deepEqual(JSON.parse(f.storage.get(storageKey)), original);
  const attempts = f.calls.filter(call => call.init?.method === "POST").map(call => JSON.parse(call.init.body));
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]);
});
