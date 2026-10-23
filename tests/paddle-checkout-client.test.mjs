import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(await readFile(new URL("../components/paddle-checkout-client.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

const input = (transactionId = "txn_verified", extra = {}) => ({ environment: "production", clientToken: "live_public", transactionId, ...extra });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function fixture({ deferredScript = false, onOpen } = {}) {
  const steps = [], compiledModule = { exports: {} }, timers = new Map();
  let now = 0, timerId = 0, callback, appendedScript, currentTransaction;
  const location = { href: "https://tokvilo.com/dashboard/wallet?lang=en&paddle_order=owned-order&_ptxn=txn_untrusted&paddle_env=sandbox&_paction=update_payment_details&__pw_iic=retained&__pw=retained#?paddle_env=staging&_ptxn=txn_fragment" };
  const assertClean = () => {
    const url = new URL(location.href);
    assert.equal(url.searchParams.get("lang"), "en");
    assert.equal(url.searchParams.get("paddle_order"), "owned-order");
    assert.equal(url.hash, "");
    for (const key of ["_ptxn", "paddle_env", "_paction", "__pw_iic", "__pw"]) assert.equal(url.searchParams.has(key), false);
  };
  const emit = (name, transactionId, id) => callback?.({ name, ...(transactionId ? { data: { transaction_id: transactionId, ...(id ? { id } : {}) } } : {}) });
  const client = {
    Initialize(options) { assertClean(); callback = options.eventCallback; steps.push({ action: "initialize", token: options.token }); },
    Environment: { set(value) { steps.push({ action: "environment", value }); } },
    Checkout: {
      open(options) { assertClean(); currentTransaction = options.transactionId; steps.push({ action: "open", transactionId: options.transactionId }); onOpen?.({ emit, transactionId: options.transactionId }); },
      close() { steps.push({ action: "close", transactionId: currentTransaction }); emit("checkout.closed", currentTransaction); },
    },
  };
  const browser = {
    location, history: { state: { fixture: true }, replaceState(state, unused, value) { assert.deepEqual(state, { fixture: true }); location.href = new URL(value, location.href).href; steps.push({ action: "sanitize" }); } },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const loadScript = () => { browser.Paddle = client; appendedScript.onload?.(); };
  const document = {
    createElement: () => ({ src: "", async: false, onload: null, onerror: null, remove() { steps.push({ action: "remove_script" }); } }),
    head: { appendChild(script) { assertClean(); assert.equal(script.src, "https://cdn.paddle.com/paddle/v2/paddle.js"); steps.push({ action: "load" }); appendedScript = script; if (!deferredScript) loadScript(); } },
  };
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, window: browser, document, URL, Date: { now: () => now } });
  async function advance(milliseconds) {
    const target = now + milliseconds;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      now = next[1].due; timers.delete(next[0]); next[1].fn(); await flush();
    }
    now = target; await flush();
  }
  return { api: compiledModule.exports, steps, emit, advance, loadScript, timers };
}

test("SDK URL controls are removed before loading and Initialize; readiness requires the verified transaction", async () => {
  const f = fixture(); let ready = false;
  const opening = f.api.openPaddleCheckout(input()).then(() => { ready = true; });
  await flush();
  assert.deepEqual(f.steps.map(value => value.action), ["sanitize", "load", "initialize", "open"]);
  assert.equal(f.steps.at(-1).transactionId, "txn_verified"); assert.equal(ready, false);
  f.emit("checkout.loaded", "txn_untrusted", "che_other"); await flush(); assert.equal(ready, false);
  f.emit("checkout.loaded"); await flush(); assert.equal(ready, false);
  f.emit("checkout.loaded", "txn_verified", "che_current"); await opening; assert.equal(ready, true);
  await f.advance(21_000); assert.equal(f.steps.filter(step => step.action === "close").length, 0);
  f.emit("checkout.closed", "txn_verified", "che_current");
  const second = f.api.openPaddleCheckout(input("txn_next")); await flush(); f.emit("checkout.loaded", "txn_next", "che_next"); await second;
  assert.equal(f.steps.filter(value => value.action === "initialize").length, 1);
  assert.equal(f.steps.at(-1).transactionId, "txn_next");
});

test("a stalled overlay closes after 20 seconds and the same saved transaction can be resumed", async () => {
  const f = fixture(), events = [];
  f.api.subscribeToPaddle(event => events.push(event.name));
  const opening = f.api.openPaddleCheckout(input()), rejected = assert.rejects(opening, /did not finish loading.*order is saved/);
  await flush(); await f.advance(19_999); assert.equal(f.steps.filter(step => step.action === "close").length, 0);
  await f.advance(1); await rejected;
  assert.equal(f.steps.filter(step => step.action === "close").length, 1);
  assert.ok(!events.includes("checkout.closed"), "programmatic cleanup must not overwrite the timeout message");
  const retry = f.api.openPaddleCheckout(input()); await flush(); f.emit("checkout.loaded", "txn_verified", "che_retry"); await retry;
  assert.equal(f.steps.filter(step => step.action === "open").length, 2);
  assert.ok(f.steps.filter(step => step.action === "open").every(step => step.transactionId === "txn_verified"));
});

test("a late loaded event from a timed-out iframe cannot pin a same-order retry to the old checkout ID", async () => {
  const f = fixture(), first = f.api.openPaddleCheckout(input());
  const timedOut = assert.rejects(first, /did not finish loading/);
  await flush(); await f.advance(20_000); await timedOut;
  const retry = f.api.openPaddleCheckout(input()); await flush();
  f.emit("checkout.loaded", "txn_verified", "che_old"); await retry;
  f.emit("checkout.loaded", "txn_verified", "che_retry");
  f.emit("checkout.loaded", "txn_verified", "che_old");
  f.emit("checkout.closed", "txn_verified", "che_old");
  assert.equal(f.api.openPaddleCheckout(input()), retry, "retired iframe events must not replace the current checkout");
  f.emit("checkout.closed", "txn_verified", "che_retry");
  const next = f.api.openPaddleCheckout(input()); assert.notEqual(next, retry); await flush();
  f.emit("checkout.loaded", "txn_verified", "che_next"); await next;
  assert.equal(f.steps.filter(step => step.action === "open").length, 3);
  f.emit("checkout.closed", "txn_verified", "che_next"); assert.equal(f.timers.size, 0);
});

test("concurrent same-order opens coalesce and another transaction cannot replace the active checkout", async () => {
  const f = fixture(), first = f.api.openPaddleCheckout(input()), duplicate = f.api.openPaddleCheckout(input());
  assert.equal(first, duplicate); await flush();
  await assert.rejects(f.api.openPaddleCheckout(input("txn_different")), /Another checkout is already open/);
  f.emit("checkout.loaded", "txn_verified", "che_one"); await Promise.all([first, duplicate]);
  assert.equal(f.steps.filter(step => step.action === "open").length, 1);
  assert.equal(f.api.openPaddleCheckout(input()), first);
  f.emit("checkout.closed", "txn_verified", "che_one");
});

test("checkout.error without data and an early close reject promptly with safe order-preserving messages", async () => {
  for (const name of ["checkout.error", "checkout.closed"]) {
    const f = fixture(), opening = f.api.openPaddleCheckout(input());
    const rejected = assert.rejects(opening, /order is saved/);
    await flush(); f.emit(name, name === "checkout.error" ? undefined : "txn_verified", "che_current"); await rejected;
    await f.advance(21_000);
    assert.equal(f.steps.filter(step => step.action === "close").length, name === "checkout.error" ? 1 : 0);
  }
});

test("completion before loaded resolves readiness without closing a completed checkout", async () => {
  const f = fixture(), events = [];
  f.api.subscribeToPaddle(event => events.push(event.name));
  const opening = f.api.openPaddleCheckout(input()); await flush();
  f.emit("checkout.completed", "txn_verified", "che_current"); await opening;
  f.emit("checkout.closed");
  f.emit("checkout.loaded", "txn_verified", "che_current"); await f.advance(21_000);
  assert.equal(f.steps.filter(step => step.action === "close").length, 0);
  assert.ok(events.includes("checkout.completed"));
  assert.ok(!events.includes("checkout.closed"), "a late close must not replace completion with a cancellation message");
});

test("close events without transaction data release both opening and ready sessions for resume", async () => {
  const f = fixture(), first = f.api.openPaddleCheckout(input());
  const rejected = assert.rejects(first, /Checkout was closed/); await flush(); f.emit("checkout.closed"); await rejected;
  const second = f.api.openPaddleCheckout(input()); await flush(); f.emit("checkout.loaded", "txn_verified", "che_second"); await second;
  f.emit("checkout.closed");
  const third = f.api.openPaddleCheckout(input()); await flush(); f.emit("checkout.loaded", "txn_verified", "che_third"); await third;
  assert.equal(f.steps.filter(step => step.action === "open").length, 3);
});

test("stale sessions never open after script load and cancel an already opening overlay", async () => {
  const f = fixture({ deferredScript: true }); let current = true;
  const opening = f.api.openPaddleCheckout(input("txn_stale", { isCurrent: () => current }));
  const rejected = assert.rejects(opening, /session changed/); current = false;
  await f.advance(250); await rejected; f.loadScript(); await flush();
  assert.equal(f.steps.filter(step => step.action === "open").length, 0);
  const g = fixture(); current = true;
  const second = g.api.openPaddleCheckout(input("txn_stale_open", { isCurrent: () => current }));
  const secondRejected = assert.rejects(second, /session changed/); await flush(); current = false;
  await g.advance(250); await secondRejected;
  assert.equal(g.steps.filter(step => step.action === "close").length, 1);
});

test("a loaded overlay closes when its owner/session becomes stale without another SDK event", async () => {
  const f = fixture(); let current = true;
  const opening = f.api.openPaddleCheckout(input("txn_previous_owner", { isCurrent: () => current }));
  await flush(); f.emit("checkout.loaded", "txn_previous_owner", "che_previous_owner"); await opening;
  current = false;
  await f.advance(250);
  assert.equal(f.steps.filter(step => step.action === "close").length, 1);
  assert.equal(f.timers.size, 0);
  const next = f.api.openPaddleCheckout(input("txn_current_owner")); await flush();
  f.emit("checkout.loaded", "txn_current_owner", "che_current_owner"); await next;
  assert.equal(f.steps.filter(step => step.action === "open").length, 2);
  f.emit("checkout.closed", "txn_current_owner", "che_current_owner");
  assert.equal(f.timers.size, 0);
});

test("synchronous loaded/error events and throwing observers cannot strand readiness", async () => {
  const f = fixture({ onOpen: ({ emit, transactionId }) => emit("checkout.loaded", transactionId, "che_sync") });
  f.api.subscribeToPaddle(() => { throw new Error("fixture observer failed"); });
  await f.api.openPaddleCheckout(input()); await f.advance(21_000);
  assert.equal(f.steps.filter(step => step.action === "close").length, 0);
  const g = fixture({ onOpen: ({ emit }) => emit("checkout.error") });
  await assert.rejects(g.api.openPaddleCheckout(input()), /order is saved/);
  assert.equal(g.steps.filter(step => step.action === "close").length, 1);
});
