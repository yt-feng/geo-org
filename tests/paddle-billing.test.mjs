import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const schema = (await Promise.all((await readdir(new URL("../drizzle/", import.meta.url))).filter(name => name.endsWith(".sql")).sort().map(name => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")))).join("\n");
const ALICE = { id: "alice", email: "alice@example.com", displayName: "Alice", isAdmin: false };
const BOB = { id: "bob", email: "bob@example.com", displayName: "Bob", isAdmin: false };
const paddleId = (prefix, n) => `${prefix}_${String(n).padStart(26, "0")}`;
async function load(file, mocks, fetch, diagnostics = []) {
  const filename = new URL(file, import.meta.url).pathname;
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const compiled = { exports: {} };
  vm.runInNewContext(outputText, { module: compiled, exports: compiled.exports, require: name => { if (name in mocks) return mocks[name]; throw new Error(`Unmocked ${name}`); }, console: { error: value => diagnostics.push(value) }, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, URL, Request, Response, Headers, AbortSignal, fetch }, { filename });
  return compiled.exports;
}
async function fixture(t) {
  const sql = new DatabaseSync(":memory:"); sql.exec(schema); t.after(() => sql.close());
  for (const user of [ALICE, BOB]) sql.prepare("INSERT INTO users(id,email,status) VALUES(?,?,'active')").run(user.id, user.email);
  let databaseFailure = false;
  const db = {
    prepare(query) {
      if (databaseFailure && query.startsWith("SELECT * FROM paddle_orders")) throw new Error("D1_ERROR: no such table: private_customer_table alice@example.com");
      const statement = sql.prepare(query);
      function executable(args = []) { return {
        bind(...values) { assert.ok(values.length <= 100); return executable(values); },
        async first() { return statement.get(...args) || null; },
        async all() { return { results: statement.all(...args) }; },
        async run() { return { meta: { changes: statement.run(...args).changes } }; },
      }; }
      return executable();
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec("COMMIT"); return result; }
      catch (cause) { sql.exec("ROLLBACK"); throw cause; }
    },
  };
  const env = { DB: db, PUBLIC_BASE_URL: "https://tokvilo.com", PADDLE_ENVIRONMENT: "production", PADDLE_SALES_ENABLED: "true", PADDLE_APPROVED_DOMAIN: "tokvilo.com", PADDLE_APPROVED_PRODUCT_SCOPE: "tokvilo_api_usage", PADDLE_API_KEY: "secret-api-key", PADDLE_WEBHOOK_SECRET: "secret-webhook", PADDLE_CLIENT_TOKEN: "live_public-token", PADDLE_PRICE_20_ID: paddleId("pri", 20), PADDLE_PRICE_50_ID: paddleId("pri", 50), PADDLE_PRICE_100_ID: paddleId("pri", 100) };
  let user = ALICE, postCount = 0, failPost = false, requestNo = 0, eventNo = 0, invalidPrice = false, apiUnavailable = false, providerFailure = null, redirectStatus = null;
  const transactions = new Map(), adjustments = new Map(), apiCalls = [], diagnostics = [];
  function price(amount) { return { id: paddleId("pri", amount), status: "active", billing_cycle: null, trial_period: null, tax_mode: "external", unit_price: { amount: String(amount * 100), currency_code: "USD" }, unit_price_overrides: [] }; }
  const fetch = async (input, init) => {
    const url = new URL(input); apiCalls.push({ url: url.href, method: init.method });
    // Mirror Workers: redirect:error throws before making an HTTP request.
    if (init.redirect === "error") throw new TypeError("Unsupported redirect mode: error");
    assert.equal(init.redirect, "manual", "Paddle requests must not forward Authorization across redirects");
    assert.ok(["api.paddle.com", "sandbox-api.paddle.com"].includes(url.hostname));
    assert.equal(init.headers.Authorization, "Bearer secret-api-key");
    if (providerFailure) throw providerFailure;
    if (redirectStatus) return new Response(null, { status: redirectStatus, headers: { location: "https://different-origin.example/collect" } });
    if (apiUnavailable) throw new Error("network unavailable");
    if (url.pathname.startsWith("/prices/")) { const amount = Number(url.pathname.split("_").at(-1)); return Response.json({ data: { ...price(amount), ...(invalidPrice ? { billing_cycle: { interval: "month", frequency: 1 } } : {}) } }); }
    if (url.pathname === "/transactions" && init.method === "POST") {
      postCount++;
      const payload = JSON.parse(init.body), amount = Number(payload.items[0].price_id.split("_").at(-1));
      assert.equal(payload.items.length, 1); assert.equal(payload.items[0].quantity, 1); assert.equal(payload.collection_mode, "automatic");
      const id = paddleId("txn", postCount), data = { id, status: "draft", custom_data: payload.custom_data, collection_mode: "automatic", currency_code: "USD", subscription_id: null, items: [{ quantity: 1, price: price(amount) }], details: { totals: { subtotal: String(amount * 100), discount: "0", total: String(amount * 100) } } };
      transactions.set(id, data);
      if (failPost) throw new Error("response was lost AFTER transaction creation");
      return Response.json({ data });
    }
    if (url.pathname.startsWith("/transactions/")) return Response.json({ data: transactions.get(url.pathname.split("/").at(-1)) });
    if (url.pathname === "/transactions") return Response.json({ data: [...transactions.values()], meta: { pagination: { has_more: false } } });
    if (url.pathname === "/adjustments") return Response.json({ data: adjustments.get(url.searchParams.get("transaction_id")) || [], meta: { pagination: { has_more: false } } });
    throw new Error(`Unknown endpoint ${url.pathname}`);
  };
  const config = { getD1: () => db, runtimeEnv: () => env };
  const wallet = await load("../lib/wallet.ts", { "./config": config }, fetch);
  const paddle = await load("../lib/paddle.ts", { "./config": config, "./wallet": wallet, "./auth": { getPortalUser: async () => user }, "./store": { ensureUser: async () => {} } }, fetch, diagnostics);
  async function checkout(payload = {}, owner = ALICE, origin = "https://tokvilo.com") {
    user = owner;
    const response = await paddle.handlePaddleRequest(new Request("https://tokvilo.com/api/billing/paddle/checkout", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ packageId: "20", requestId: `test-request-${++requestNo}`, ...payload }) }), "checkout");
    return { status: response.status, data: await response.json() };
  }
  async function get(id, owner = ALICE) {
    user = owner;
    const response = await paddle.handlePaddleRequest(new Request(`https://tokvilo.com/api/billing/paddle/orders/${id}`), "order", id);
    return { status: response.status, data: await response.json() };
  }
  const signature = (raw, at = Math.floor(Date.now() / 1000), secret = env.PADDLE_WEBHOOK_SECRET) => `ts=${at};h1=${createHmac("sha256", secret).update(`${at}:${raw}`).digest("hex")}`;
  async function event(transactionId, { type = "transaction.completed", id = paddleId("evt", ++eventNo), badSignature = false, payload } = {}) {
    const raw = JSON.stringify(payload || { event_id: id, event_type: type, occurred_at: new Date().toISOString(), data: type === "transaction.completed" ? { id: transactionId } : { id: paddleId("adj", eventNo), transaction_id: transactionId } });
    const response = await paddle.handlePaddleWebhook(new Request("https://tokvilo.com/api/billing/paddle/webhook", { method: "POST", headers: { "Paddle-Signature": badSignature ? "ts=0;h1=0" : signature(raw) }, body: raw }));
    return { status: response.status, data: await response.json() };
  }
  const balance = (owner = ALICE.id) => sql.prepare("SELECT balance_microusd FROM wallet_accounts WHERE user_id=?").get(owner)?.balance_microusd || 0;
  return { sql, env, paddle, wallet, transactions, adjustments, apiCalls, checkout, get, event, signature, balance, diagnostics,
    failNextPost() { failPost = true; }, invalidatePrice() { invalidPrice = true; }, unavailable() { apiUnavailable = true; }, posts: () => postCount,
    failProvider(error) { providerFailure = error; }, failDatabase() { databaseFailure = true; }, redirectProvider(status) { redirectStatus = status; },
    complete(id) { transactions.get(id).status = "completed"; },
    age(id) { sql.prepare("UPDATE paddle_orders SET created_at=?,last_checked_at=0 WHERE id=?").run(new Date(Date.now() - 30_000).toISOString(), id); },
  };
}

test("secret formatting is normalized before constructing the Paddle Authorization header", async t => {
  const f = await fixture(t); f.env.PADDLE_API_KEY = "  secret-api-key\n";
  const result = await f.checkout();
  assert.equal(result.status, 201); assert.equal(result.data.order.status, "checkout_ready"); assert.equal(f.posts(), 1);
  assert.equal(f.diagnostics.length, 0);
});

test("Workers-compatible manual redirect mode rejects all redirects without following or creating an order", async t => {
  const f = await fixture(t);
  for (const status of [301, 302, 303, 307, 308]) {
    const before = f.apiCalls.length; f.redirectProvider(status);
    const result = await f.checkout();
    assert.equal(result.status, 503); assert.equal(result.data.error.code, "paddle_unavailable");
    assert.equal(f.apiCalls.length, before + 1); assert.equal(f.posts(), 0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM paddle_orders").get().n, 0);
    assert.equal(f.balance(), 0);
  }
  assert.ok(f.apiCalls.every(call => new URL(call.url).origin === "https://api.paddle.com"));
});

test("unexpected pre-intent failures identify their stage without logging customer data, payloads or secrets", async t => {
  const f = await fixture(t);
  f.failProvider(new TypeError("fetch failed: secret-api-key alice@example.com private request body"));
  const result = await f.checkout();
  assert.equal(result.status, 503); assert.equal(f.posts(), 0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM paddle_orders").get().n, 0);
  assert.deepEqual(JSON.parse(f.diagnostics[0]), { component: "paddle", stage: "checkout.read_price", errorType: "TypeError", category: "unexpected" });
  assert.ok(!JSON.stringify(f.diagnostics).includes("secret-api-key")); assert.ok(!JSON.stringify(f.diagnostics).includes("alice"));
  assert.ok(!JSON.stringify(result).includes("private request body"));
  f.failDatabase();
  await f.checkout();
  assert.deepEqual(JSON.parse(f.diagnostics[1]), { component: "paddle", stage: "checkout.lookup_order", errorType: "Error", category: "database_schema" });
  assert.ok(!JSON.stringify(f.diagnostics).includes("private_customer_table"));
});

test("production checkout requires explicit domain/scope approval and exposes no secret or price IDs", async t => {
  const f = await fixture(t), config = f.paddle.getPaddleConfig();
  assert.equal(config.enabled, true); assert.equal(config.packages.length, 3);
  assert.ok(!JSON.stringify(config).includes("secret")); assert.ok(!JSON.stringify(config).includes("pri_"));
  for (const edit of [{ PADDLE_SALES_ENABLED: "false" }, { PADDLE_APPROVED_DOMAIN: "other.com" }, { PADDLE_APPROVED_PRODUCT_SCOPE: "store_credit" }, { PADDLE_API_KEY: "" }, { PADDLE_WEBHOOK_SECRET: "" }, { PADDLE_PRICE_20_ID: "invalid" }, { PADDLE_CLIENT_TOKEN: "test_wrong-mode" }]) {
    const disabled = f.paddle.getPaddleConfig({ ...f.env, ...edit }); assert.equal(disabled.enabled, false); assert.equal(disabled.clientToken, null);
  }
  f.env.PADDLE_SALES_ENABLED = "false";
  assert.equal((await f.checkout()).status, 503); assert.equal(f.posts(), 0);
});

test("checkout is authenticated, owner-bound, same-origin and rejects disabled accounts", async t => {
  const f = await fixture(t);
  assert.equal((await f.checkout({}, null)).status, 401);
  assert.equal((await f.checkout({}, ALICE, "https://evil.example")).status, 403);
  assert.equal((await f.checkout({ packageId: "1" })).status, 400);
  f.sql.prepare("UPDATE users SET status='disabled' WHERE id='alice'").run();
  assert.equal((await f.checkout()).status, 403); assert.equal(f.posts(), 0);
});

test("parallel checkout retries bind one transaction; owner and changed-package replays cannot hijack it", async t => {
  const f = await fixture(t), payload = { requestId: "parallel-request-001" };
  const results = await Promise.all([f.checkout(payload), f.checkout(payload), f.checkout(payload)]);
  assert.equal(f.posts(), 1); assert.equal(new Set(results.map(result => result.data.order.id)).size, 1);
  assert.equal((await f.checkout({ ...payload, packageId: "50" })).status, 409);
  const order = results[0].data.order;
  assert.equal((await f.get(order.id, BOB)).status, 404); assert.equal(f.balance(), 0);
  assert.ok(!JSON.stringify(order).includes("binding")); assert.ok(!JSON.stringify(order).includes("alice"));
});

test("misconfigured recurring price cannot create a supposedly one-time usage order", async t => {
  const f = await fixture(t); f.invalidatePrice();
  assert.equal((await f.checkout()).status, 503); assert.equal(f.posts(), 0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM paddle_orders").get().n, 0);
});

test("lost transaction POST response stays unknown; same request never replays and GET recovers original transaction", async t => {
  const f = await fixture(t); f.failNextPost();
  const payload = { requestId: "unknown-response-001" }, initial = await f.checkout(payload);
  assert.equal(initial.data.order.status, "outcome_unknown"); assert.equal(f.posts(), 1);
  await f.checkout(payload); await f.checkout(payload); assert.equal(f.posts(), 1);
  f.age(initial.data.order.id);
  const recovered = await f.get(initial.data.order.id);
  assert.equal(recovered.data.order.transactionId, paddleId("txn", 1)); assert.equal(recovered.data.order.status, "checkout_ready");
  assert.equal(f.posts(), 1); assert.equal(f.balance(), 0);
});

test("raw signed completed webhook grants exactly once; forged/old signatures and non-completed transactions grant nothing", async t => {
  const f = await fixture(t), order = (await f.checkout()).data.order, tx = order.transactionId;
  assert.equal((await f.event(tx, { badSignature: true })).status, 401);
  assert.equal((await f.event(tx)).status, 503); assert.equal(f.balance(), 0);
  f.complete(tx);
  const eventId = paddleId("evt", 999);
  assert.equal((await f.event(tx, { id: eventId })).status, 200);
  assert.equal((await f.event(tx, { id: eventId })).data.duplicate, true);
  assert.equal((await f.event(tx)).status, 200); assert.equal(f.balance(), 20_000_000);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM wallet_ledger WHERE kind='paddle_service_credit'").get().n, 1);
  const raw = '{"event_id":"test"}';
  assert.equal(await f.paddle.verifyPaddleSignature(raw, f.signature(raw), f.env.PADDLE_WEBHOOK_SECRET), true);
  assert.equal(await f.paddle.verifyPaddleSignature(raw + " ", f.signature(raw), f.env.PADDLE_WEBHOOK_SECRET), false);
  assert.equal(await f.paddle.verifyPaddleSignature(raw, f.signature(raw, Math.floor(Date.now() / 1000) - 10), f.env.PADDLE_WEBHOOK_SECRET), false);
});

test("simultaneous completed notifications serialize reconciliation and safely retry the busy delivery", async t => {
  const f = await fixture(t), order = (await f.checkout()).data.order, tx = order.transactionId;
  f.complete(tx);
  const ids = [paddleId("evt", 901), paddleId("evt", 902), paddleId("evt", 903)];
  const results = await Promise.all(ids.map(id => f.event(tx, { id })));
  assert.ok(results.some(result => result.status === 200));
  assert.ok(results.every(result => [200, 503].includes(result.status)));
  for (const id of ids) assert.equal((await f.event(tx, { id })).status, 200);
  assert.equal(f.balance(), 20_000_000);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM wallet_ledger").get().n, 1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM paddle_events").get().n, 3);
});

test("a completed webhook can bind an unknown POST outcome without waiting for browser recovery", async t => {
  const f = await fixture(t); f.failNextPost();
  const initial = (await f.checkout()).data.order;
  assert.equal(initial.transactionId, null);
  const tx = paddleId("txn", 1); f.complete(tx);
  assert.equal((await f.event(tx)).status, 200);
  const recovered = (await f.get(initial.id)).data.order;
  assert.equal(recovered.status, "paid"); assert.equal(recovered.transactionId, tx);
  assert.equal(f.balance(), 20_000_000); assert.equal(f.posts(), 1);
});

test("real line items, quantity, currency, totals and account binding are verified independently of webhook custom data", async t => {
  const f = await fixture(t), order = (await f.checkout()).data.order, tx = order.transactionId;
  f.complete(tx); const original = structuredClone(f.transactions.get(tx));
  for (const mutate of [data => { data.items[0].quantity = 2; }, data => { data.items[0].price.id = paddleId("pri", 100); }, data => { data.currency_code = "EUR"; }, data => { data.custom_data.tokvilo_user_id = "bob"; }, data => { data.custom_data.tokvilo_binding = "forged"; }, data => { data.details.totals.discount = "100"; }, data => { data.details.totals.subtotal = "100"; }]) {
    const bad = structuredClone(original); mutate(bad); f.transactions.set(tx, bad);
    assert.equal((await f.event(tx)).status, 409); assert.equal(f.balance(), 0);
  }
  f.transactions.set(tx, original); assert.equal((await f.event(tx)).status, 200); assert.equal(f.balance(), 20_000_000);
});

test("refunds arriving before completion delivery grant only retained usage; out-of-order and duplicate notifications stay safe", async t => {
  const f = await fixture(t), order = (await f.checkout()).data.order, tx = order.transactionId;
  f.complete(tx);
  const refund = { id: paddleId("adj", 1), transaction_id: tx, currency_code: "USD", action: "refund", status: "approved", totals: { subtotal: "500" } };
  f.adjustments.set(tx, [refund]);
  assert.equal((await f.event(tx, { type: "adjustment.created" })).status, 200); assert.equal(f.balance(), 15_000_000);
  assert.equal((await f.event(tx)).status, 200); assert.equal(f.balance(), 15_000_000);
  assert.equal((await f.get(order.id)).data.order.status, "adjusted");
  refund.totals.subtotal = "2000";
  assert.equal((await f.event(tx, { type: "adjustment.updated" })).status, 200); assert.equal(f.balance(), 0);
  assert.equal((await f.event(tx)).status, 200); assert.equal(f.balance(), 0);
});

test("approved chargeback revokes spent service usage; a reversal restores once without double-counting its reverse entry", async t => {
  const f = await fixture(t), order = (await f.checkout()).data.order, tx = order.transactionId;
  f.complete(tx); await f.event(tx);
  await f.wallet.reserveWallet({ userId: ALICE.id, requestId: "spent-service", amountMicrousd: 18_000_000 });
  await f.wallet.settleWallet({ userId: ALICE.id, requestId: "spent-service", amountMicrousd: 18_000_000 });
  const debit = { id: paddleId("adj", 1), transaction_id: tx, currency_code: "USD", action: "chargeback", status: "approved", totals: { subtotal: "2000" } };
  f.adjustments.set(tx, [debit]); await f.event(tx, { type: "adjustment.created" }); assert.equal(f.balance(), -18_000_000);
  debit.status = "reversed";
  f.adjustments.set(tx, [debit, { ...debit, id: paddleId("adj", 2), action: "chargeback_reverse", status: "approved" }]);
  await f.event(tx, { type: "adjustment.updated" }); assert.equal(f.balance(), 2_000_000);
  await f.event(tx, { type: "adjustment.created" }); assert.equal(f.balance(), 2_000_000);
});

test("pending refunds, rejected refunds and tax-only refunds do not remove service usage", async t => {
  const f = await fixture(t), order = (await f.checkout()).data.order, tx = order.transactionId;
  f.complete(tx); f.adjustments.set(tx, [
    { transaction_id: tx, currency_code: "USD", action: "refund", status: "pending_approval", totals: { subtotal: "2000" } },
    { transaction_id: tx, currency_code: "USD", action: "refund", status: "rejected", totals: { subtotal: "2000" } },
    { transaction_id: tx, currency_code: "USD", action: "refund", status: "approved", totals: { subtotal: "0" } },
  ]);
  await f.event(tx); assert.equal(f.balance(), 20_000_000);
});

test("ledger failure rolls back paid state and event receipt, so webhook retry can complete safely", async t => {
  const f = await fixture(t), order = (await f.checkout()).data.order, tx = order.transactionId;
  f.complete(tx); f.sql.exec("CREATE TRIGGER fail_paddle BEFORE INSERT ON wallet_ledger WHEN NEW.kind='paddle_service_credit' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  const id = paddleId("evt", 888);
  assert.equal((await f.event(tx, { id })).status, 503); assert.equal(f.balance(), 0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM paddle_events").get().n, 0);
  assert.equal(f.sql.prepare("SELECT status FROM paddle_orders").get().status, "checkout_ready");
  f.sql.exec("DROP TRIGGER fail_paddle");
  assert.equal((await f.event(tx, { id })).status, 200); assert.equal(f.balance(), 20_000_000);
});

test("sandbox success never creates real wallet balance", async t => {
  const f = await fixture(t); f.env.PADDLE_ENVIRONMENT = "sandbox"; f.env.PADDLE_CLIENT_TOKEN = "test_public-token";
  const order = (await f.checkout()).data.order; f.complete(order.transactionId);
  assert.equal((await f.event(order.transactionId)).status, 200);
  assert.equal((await f.get(order.id)).data.order.credited, false); assert.equal(f.balance(), 0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM wallet_ledger").get().n, 0);
});

test("unavailable provider does not turn an existing receipt into a duplicate purchase", async t => {
  const f = await fixture(t), payload = { requestId: "receipt-unavailable-001" }, order = (await f.checkout(payload)).data.order;
  f.age(order.id); f.unavailable();
  assert.equal((await f.get(order.id)).data.order.id, order.id);
  assert.equal((await f.checkout(payload)).data.order.transactionId, order.transactionId); assert.equal(f.posts(), 1);
});

test("pausing new Paddle sales preserves original order lookup and signed completion", async t => {
  const f = await fixture(t), payload = { requestId: "sales-pause-recovery-001" }, order = (await f.checkout(payload)).data.order;
  f.env.PADDLE_SALES_ENABLED = "false";
  assert.equal((await f.checkout()).status, 503);
  const recovered = await f.checkout(payload);
  assert.equal(recovered.status, 200); assert.equal(recovered.data.order.id, order.id); assert.equal(f.posts(), 1);
  f.complete(order.transactionId); assert.equal((await f.event(order.transactionId)).status, 200); assert.equal(f.balance(), 20_000_000);
});
