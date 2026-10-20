import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { prepareInventory } from "../scripts/prepare-tokvilo-inventory.mjs";
import { remoteD1, runVerification } from "../scripts/verify-tokvilo-wallet-remote.mjs";

async function load(path, mocks) {
  const filename = new URL(path, import.meta.url).pathname;
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const compiled = { exports: {} };
  vm.runInNewContext(outputText, { module: compiled, exports: compiled.exports, require: name => { if (Object.hasOwn(mocks, name)) return mocks[name]; throw new Error(`Unmocked ${name}`); }, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, URL, Request, Response, Headers }, { filename });
  return compiled.exports;
}
const schema = (await Promise.all((await readdir(new URL("../drizzle/", import.meta.url))).filter(name => name.endsWith(".sql")).sort().map(name => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")))).join("\n");
const ALICE = { id: "alice", email: "alice@example.com", isAdmin: false };
const BOB = { id: "bob", email: "bob@example.com", isAdmin: false };
const ADMIN = { id: "admin", email: "admin@example.com", isAdmin: true };
const hash = value => createHash("sha256").update(value).digest("hex");

async function fixture(t) {
  const sql = new DatabaseSync(":memory:"); sql.exec(schema); t.after(() => sql.close());
  for (const user of [ALICE, BOB, ADMIN]) sql.prepare("INSERT INTO users(id,email,status) VALUES(?,?,'active')").run(user.id, user.email);
  let pending = Promise.resolve(), user = ALICE;
  const DB = {
    prepare(query) {
      assert.ok((query.match(/\bUNION\b/gi) || []).length < 5);
      const statement = sql.prepare(query);
      function executable(args = []) { return {
        bind(...values) { assert.ok(values.length <= 100); return executable(values); },
        async first() { return statement.get(...args) || null; },
        async all() { return { results: statement.all(...args) }; },
        async run() { return { meta: { changes: statement.run(...args).changes } }; },
      }; }
      return executable();
    },
    batch(statements) {
      const next = pending.then(async () => {
        sql.exec("BEGIN");
        try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec("COMMIT"); return result; }
        catch (cause) { sql.exec("ROLLBACK"); throw cause; }
      });
      pending = next.catch(() => {}); return next;
    },
  };
  const env = { DB, USD_CNY: "7.2", REDEMPTION_ENABLED: "true", REDEMPTION_ISSUANCE_ENABLED: "true", LIANDONG_SALES_ENABLED: "true", LIANDONG_STORE_URL: "https://wzyp.cn/shop/test", LIANDONG_PRODUCT_30_URL: "https://wzyp.cn/item/tokvilo30", LIANDONG_PRODUCT_90_URL: "https://wzyp.cn/item/tokvilo90", LIANDONG_PRODUCT_300_URL: "https://wzyp.cn/item/tokvilo300" };
  const config = { getD1: () => DB, runtimeEnv: () => env };
  const wallet = await load("../lib/wallet.ts", { "./config": config });
  const redemption = await load("../lib/redemption.ts", {
    "./config": config, "./wallet": wallet, "./crypto": { sha256Hex: async value => hash(value) },
    "./auth": { getPortalUser: async () => user }, "./store": { ensureUser: async () => {} },
  });
  const products = await load("../lib/products.ts", {});
  const orders = await load("../lib/orders.ts", {
    "./config": config, "./wallet": wallet, "./products": products,
    "./auth": { getPortalUser: async () => user }, "./store": { ensureUser: async () => {} },
  });
  let grantNo = 0;
  function grant(amount, owner = ALICE.id) { sql.prepare("INSERT INTO wallet_ledger(id,user_id,kind,amount_microusd,reference_id,description) VALUES(?,?,'test',?,'test','Test fixture')").run(`fixture-${++grantNo}`, owner, amount); }
  async function request(action, payload, current = ALICE, headers = {}) {
    user = current;
    const method = payload === undefined ? "GET" : "POST";
    const response = await redemption.handleWalletRequest(new Request("https://tokvilo.com/api/wallet", { method, headers: { origin: "https://tokvilo.com", "content-type": "application/json", ...headers }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }), action);
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function issue(extra = {}) {
    const response = await request("batches", { packageId: "30", count: 2, note: "Test Tokvilo stock", requestId: webcrypto.randomUUID(), ...extra }, ADMIN);
    assert.equal(response.status, 201, JSON.stringify(response)); return response.data;
  }
  async function orderRequest(method = "GET", payload, current = ALICE, { admin = false, key = "order-request-001", origin = "https://tokvilo.com" } = {}) {
    user = current;
    const response = await orders.handleOrders(new Request("https://tokvilo.com/api/orders", { method, headers: { origin, "content-type": "application/json", "Idempotency-Key": key }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }), admin);
    return { status: response.status, data: await response.json() };
  }
  const orderInput = (productId = "plus-ph") => {
    const product = products.digitalProducts.find(product => product.id === productId);
    return { productId, confirmed: true, expectedRetailCents: product.retailCents, expectedChargeMicrousd: Math.ceil(product.retailCents * 10000 / Number(env.USD_CNY)) };
  };
  const balance = (owner = ALICE.id) => sql.prepare("SELECT balance_microusd FROM wallet_accounts WHERE user_id=?").get(owner)?.balance_microusd || 0;
  return { sql, DB, env, wallet, redemption, grant, balance, request, issue, orderRequest, orderInput };
}
const reserve = (f, id = "call-1", amount = 700_000, owner = ALICE.id) => f.wallet.reserveWallet({ userId: owner, requestId: id, amountMicrousd: amount });

test("wallet reservations prevent parallel overspending and duplicate requests debit once", async t => {
  const f = await fixture(t); f.grant(1_000_000);
  const contested = await Promise.allSettled([reserve(f, "a"), reserve(f, "b")]);
  assert.equal(contested.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(contested.find(result => result.status === "rejected").reason.code, "insufficient_balance");
  const id = contested.find(result => result.status === "fulfilled").value.requestId;
  assert.equal(f.balance(), 300_000);
  const again = await Promise.all([reserve(f, id), reserve(f, id)]);
  assert.ok(again.every(row => row.reused)); assert.equal(f.balance(), 300_000);
  await assert.rejects(reserve(f, id, 600_000), error => error.code === "wallet_request_conflict");
  assert.equal(f.sql.prepare("SELECT count(*) n FROM wallet_ledger WHERE kind='reserve'").get().n, 1);
});

test("settlement releases the exact difference once; over-reservation and cross-owner attempts change nothing", async t => {
  const f = await fixture(t); f.grant(1_000_000); await reserve(f);
  await assert.rejects(f.wallet.settleWallet({ userId: ALICE.id, requestId: "call-1", amountMicrousd: 800_000 }), error => error.code === "settlement_exceeds_reservation");
  await assert.rejects(f.wallet.settleWallet({ userId: BOB.id, requestId: "call-1", amountMicrousd: 200_000 }), error => error.code === "wallet_reservation_missing");
  assert.equal(f.balance(), 300_000);
  const completed = await Promise.all([1, 2, 3].map(() => f.wallet.settleWallet({ userId: ALICE.id, requestId: "call-1", amountMicrousd: 250_000 })));
  assert.equal(completed.filter(value => !value.reused).length, 1); assert.equal(f.balance(), 750_000);
  await assert.rejects(f.wallet.refundWallet({ userId: ALICE.id, requestId: "call-1" }), error => error.code === "wallet_settlement_conflict");
  await assert.rejects(f.wallet.settleWallet({ userId: ALICE.id, requestId: "call-1", amountMicrousd: 200_000 }), error => error.code === "wallet_settlement_conflict");
  assert.equal(f.balance(), 750_000);
});

test("unknown work stays reserved; explicit failure refunds once, and owner history excludes other accounts", async t => {
  const f = await fixture(t); f.grant(1_000_000); f.grant(2_000_000, BOB.id); await reserve(f);
  assert.equal((await f.wallet.getWallet(ALICE.id)).reservedMicrousd, 700_000);
  await Promise.all([1, 2].map(() => f.wallet.refundWallet({ userId: ALICE.id, requestId: "call-1" })));
  assert.equal(f.balance(), 1_000_000); assert.equal((await f.wallet.getWallet(ALICE.id)).reservedMicrousd, 0);
  assert.equal((await f.wallet.getWallet(BOB.id)).ledger.length, 1);
  f.sql.prepare("UPDATE users SET status='disabled' WHERE id=?").run(ALICE.id);
  await assert.rejects(reserve(f, "call-2"), error => error.code === "account_disabled");
});

test("a failed reserve or finalization ledger trigger rolls back the complete balance operation", async t => {
  const f = await fixture(t); f.grant(1_000_000);
  f.sql.exec("CREATE TRIGGER fail_reserve BEFORE INSERT ON wallet_ledger WHEN NEW.kind='reserve' BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  await assert.rejects(reserve(f)); assert.equal(f.balance(), 1_000_000);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM wallet_reservations").get().n, 0);
  f.sql.exec("DROP TRIGGER fail_reserve"); await reserve(f);
  f.sql.exec("CREATE TRIGGER fail_finalize BEFORE INSERT ON wallet_ledger WHEN NEW.kind='settled' BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  await assert.rejects(f.wallet.settleWallet({ userId: ALICE.id, requestId: "call-1", amountMicrousd: 200_000 }));
  assert.equal(f.balance(), 300_000); assert.equal(f.sql.prepare("SELECT status FROM wallet_reservations").get().status, "reserved");
  f.sql.exec("DROP TRIGGER fail_finalize");
  await f.wallet.settleWallet({ userId: ALICE.id, requestId: "call-1", amountMicrousd: 200_000 }); assert.equal(f.balance(), 800_000);
});

test("invalid money cannot enter the ledger and deterministic metadata is part of reservation identity", async t => {
  const f = await fixture(t); f.grant(1_000_000);
  for (const value of [-1, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER]) await assert.rejects(reserve(f, "invalid", value));
  await f.wallet.reserveWallet({ userId: ALICE.id, requestId: "meta", amountMicrousd: 10, metadata: { model: "a" } });
  await assert.rejects(f.wallet.reserveWallet({ userId: ALICE.id, requestId: "meta", amountMicrousd: 10, metadata: { model: "b" } }), error => error.code === "wallet_request_conflict");
  assert.equal(f.balance(), 999_990);
});

test("only configured Tokvilo products enable buying, while redemption remains independent", async t => {
  const f = await fixture(t);
  assert.equal(f.redemption.getBillingConfig().enabled, true);
  for (const value of [undefined, "https://wzyp.cn/item/fb86dz", "https://wzyp.cn/item/rg29py", "https://wzyp.cn/item/wpk4c4/", "https://wzyp.cn.evil.example/item/test", "https://user:pass@wzyp.cn/item/test", "https://wzyp.cn/item/test#token", "http://wzyp.cn/item/test", "https://wzyp.cn/item/test?id=1&id=2", "https://wzyp.cn/item/test?redirect=bad", "https://wzyp.cn/%2ftest"]) {
    const config = f.redemption.getBillingConfig({ ...f.env, LIANDONG_PRODUCT_30_URL: value });
    assert.equal(config.enabled, false, String(value)); assert.equal(config.redemptionEnabled, true);
  }
  for (const rate of [undefined, "0", "-1", "0.00001", "NaN"]) {
    const config = f.redemption.getBillingConfig({ ...f.env, USD_CNY: rate }); assert.equal(config.enabled, false); assert.equal(config.issuanceEnabled, false);
  }
});

test("wallet routes enforce login, active accounts, administrator scope and same-origin writes", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("wallet", undefined, null)).status, 401);
  assert.equal((await f.request("batches", undefined)).status, 403);
  assert.equal((await f.request("revoke", { code: "none", note: "test" })).status, 403);
  assert.equal((await f.request("redeem", { code: "none" }, ALICE, { origin: "https://other.example" })).status, 403);
  assert.equal((await f.request("wallet")).headers.get("cache-control"), "private, no-store");
  f.sql.prepare("UPDATE users SET status='disabled' WHERE id=?").run(ALICE.id);
  assert.equal((await f.request("wallet")).status, 403);
});

test("issuance keeps only hashes, returns codes once, and a retry preserves the original rate snapshot", async t => {
  const f = await fixture(t), requestId = webcrypto.randomUUID(), first = await f.issue({ requestId });
  assert.equal(first.codes.length, 2); first.codes.forEach(code => assert.match(code, /^TK(?:-[A-HJ-NP-Z2-9]{4}){8}$/));
  const stored = JSON.stringify(f.sql.prepare("SELECT * FROM tokvilo_redemption_codes").all());
  first.codes.forEach(code => { assert.ok(!stored.includes(code)); assert.ok(!stored.includes(code.replaceAll("-", ""))); });
  assert.equal(first.batch.credit_microusd, 4_166_666);
  f.env.USD_CNY = "8";
  const retry = await f.request("batches", { packageId: "30", count: 2, note: "Test Tokvilo stock", requestId }, ADMIN);
  assert.equal(retry.status, 200); assert.equal(retry.data.codesAvailable, false); assert.deepEqual(retry.data.codes, []);
  assert.equal(retry.data.batch.credit_microusd, 4_166_666); assert.equal(f.balance(), 0);
  const conflict = await f.request("batches", { packageId: "90", count: 2, note: "Test Tokvilo stock", requestId }, ADMIN);
  assert.equal(conflict.status, 409);
});

test("a thousand-code batch respects D1 limits and concurrent replays issue only one inventory", async t => {
  const f = await fixture(t), payload = { packageId: "90", count: 1000, note: "Bulk Tokvilo stock", requestId: webcrypto.randomUUID() };
  const results = await Promise.all([1, 2, 3].map(() => f.request("batches", payload, ADMIN)));
  assert.equal(results.filter(value => value.data.codesAvailable).length, 1);
  const codes = results.flatMap(value => value.data.codes || []); assert.equal(codes.length, 1000); assert.equal(new Set(codes).size, 1000);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_redemption_codes").get().n, 1000);
});

test("Tokvilo code redemption is atomic, grants its fixed USD amount once and rejects JiaNong codes", async t => {
  const f = await fixture(t), issued = await f.issue(), code = issued.codes[0];
  assert.equal((await f.request("redeem", { code: code.replace("TK", "JN") })).status, 400);
  f.env.USD_CNY = "9";
  const claims = await Promise.all([1, 2, 3].map(() => f.request("redeem", { code: code.toLowerCase().replaceAll("-", " ") })));
  assert.ok(claims.every(value => value.status === 200)); assert.equal(claims.filter(value => !value.data.alreadyRedeemed).length, 1);
  assert.equal(f.balance(), 4_166_666);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM wallet_ledger WHERE kind='redemption'").get().n, 1);
  assert.equal((await f.request("redeem", { code }, BOB)).status, 400);
  const bob = await f.request("wallet", undefined, BOB); assert.deepEqual(bob.data.redemptions, []); assert.equal(bob.data.wallet.balanceMicrousd, 0);
  assert.ok(!JSON.stringify((await f.request("wallet")).data).includes(code));
});

test("competing redeemers cannot both claim a code, and a failed ledger write rolls back the claim", async t => {
  const f = await fixture(t), issued = await f.issue();
  const race = await Promise.all([f.request("redeem", { code: issued.codes[0] }, ALICE), f.request("redeem", { code: issued.codes[0] }, BOB)]);
  assert.deepEqual(race.map(value => value.status).sort(), [200, 400]); assert.equal(f.balance() + f.balance(BOB.id), 4_166_666);
  f.sql.exec("CREATE TRIGGER fail_redemption BEFORE INSERT ON wallet_ledger WHEN NEW.kind='redemption' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.equal((await f.request("redeem", { code: issued.codes[1] })).status, 503);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_redemptions").get().n, 1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_redemption_codes WHERE status='available'").get().n, 1);
  f.sql.exec("DROP TRIGGER fail_redemption"); assert.equal((await f.request("redeem", { code: issued.codes[1] })).status, 200);
});

test("revocation after spending reverses the full original grant once and never reports a cash refund", async t => {
  const f = await fixture(t), issued = await f.issue();
  await f.request("redeem", { code: issued.codes[0] }); await reserve(f, "spent", 4_000_000);
  await f.wallet.settleWallet({ userId: ALICE.id, requestId: "spent", amountMicrousd: 4_000_000 });
  const revoked = await Promise.all([1, 2].map(() => f.request("revoke", { code: issued.codes[0], note: "Platform refund handled separately" }, ADMIN)));
  assert.ok(revoked.every(value => value.status === 200 && value.data.refundProcessed === false));
  assert.equal(revoked.filter(value => !value.data.alreadyRevoked).length, 1); assert.equal(f.balance(), -4_000_000);
  await assert.rejects(reserve(f, "more", 1), error => error.code === "insufficient_balance");
  assert.equal((await f.request("redeem", { code: issued.codes[0] })).status, 400);
  assert.equal((await f.request("revoke", { code: issued.codes[1], note: "Unused stock removal" }, ADMIN)).data.creditReversedMicrousd, 0);
});

test("expired codes, malformed attempts and rate limits cannot credit a wallet", async t => {
  const f = await fixture(t), issued = await f.issue();
  f.sql.prepare("UPDATE tokvilo_redemption_batches SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(issued.batch.id);
  assert.equal((await f.request("redeem", { code: issued.codes[0] })).status, 400);
  for (let index = 0; index < 11; index++) assert.equal((await f.request("redeem", { code: "TK-" + "A".repeat(32) })).status, 400);
  assert.equal((await f.request("redeem", { code: issued.codes[1] })).status, 429); assert.equal(f.balance(), 0);
});

test("closing issuance and purchase links preserves already delivered code redemption", async t => {
  const f = await fixture(t), issued = await f.issue();
  f.env.REDEMPTION_ISSUANCE_ENABLED = "false"; f.env.LIANDONG_SALES_ENABLED = "false"; delete f.env.LIANDONG_PRODUCT_30_URL;
  assert.equal((await f.request("redeem", { code: issued.codes[0] })).status, 200);
  assert.equal((await f.request("batches", {}, ADMIN)).status, 503);
  f.env.REDEMPTION_ENABLED = "false";
  assert.equal((await f.request("redeem", { code: issued.codes[1] })).status, 503);
  assert.equal((await f.request("revoke", { code: issued.codes[0], note: "Support correction" }, ADMIN)).status, 200); assert.equal(f.balance(), 0);
});

test("private offline inventory recovers the same delivery files and imports all offers atomically exactly once", async t => {
  const f = await fixture(t), root = await mkdtemp(path.join(os.tmpdir(), "tokvilo-inventory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = { root, batch: "launch-test-20261020", actor: ADMIN.id, count: 20, usdCny: "7.2" };
  const first = await prepareInventory(input), replay = await prepareInventory(input);
  assert.equal(first.totalCodes, 60); assert.deepEqual(first, replay);
  assert.equal((await stat(first.manifestPath)).mode & 0o777, 0o600);
  const sql = await readFile(first.sqlPath, "utf8"), plaintext = (await readFile(first.files[0].file, "utf8")).trim().split("\n");
  assert.equal(plaintext.length, 20); plaintext.forEach(code => assert.ok(!sql.includes(code) && !sql.includes(code.replaceAll("-", ""))));
  f.sql.exec("CREATE TRIGGER fail_import BEFORE INSERT ON tokvilo_redemption_codes BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(() => f.sql.exec(sql));
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_inventory_imports").get().n, 0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_redemption_batches").get().n, 0);
  f.sql.exec("DROP TRIGGER fail_import"); f.sql.exec(sql); f.sql.exec(sql);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_inventory_imports").get().n, 1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_redemption_batches").get().n, 3);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_redemption_codes").get().n, 60);
  assert.equal((await f.request("redeem", { code: plaintext[0] })).status, 200); assert.equal(f.balance(), 4_166_666);
  await assert.rejects(prepareInventory({ ...input, count: 21 }), /parameters differ/);
  f.sql.exec("UPDATE tokvilo_inventory_imports SET fingerprint='different'");
  assert.throws(() => f.sql.exec(sql), /inventory_import_conflict/);
});

test("a conflicting code in an offline import aborts every new batch and code", async t => {
  const f = await fixture(t), root = await mkdtemp(path.join(os.tmpdir(), "tokvilo-import-conflict-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = await prepareInventory({ root, batch: "conflict-test-20261020", actor: ADMIN.id, count: 20, usdCny: "7.2" });
  const manifest = JSON.parse(await readFile(output.manifestPath, "utf8"));
  const first = await f.issue();
  f.sql.prepare("UPDATE tokvilo_redemption_codes SET code_hash=? WHERE id=(SELECT id FROM tokvilo_redemption_codes WHERE batch_id=? LIMIT 1)").run(manifest.offers[0].codes[0].code_hash, first.batch.id);
  const importSql = await readFile(output.sqlPath, "utf8");
  assert.throws(() => f.sql.exec(importSql), /UNIQUE/);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_inventory_imports").get().n, 0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_redemption_batches").get().n, 1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_redemption_codes").get().n, 2);
});

test("digital orders require the exact confirmed price and amount and cannot overdraw concurrent purchases", async t => {
  const f = await fixture(t); f.grant(30_000_000);
  const original = f.orderInput();
  for (const extra of [{ confirmed: false }, { expectedRetailCents: 1 }, { expectedChargeMicrousd: 1 }, { expectedChargeMicrousd: undefined }]) {
    const response = await f.orderRequest("POST", { ...original, ...extra });
    assert.ok([400, 409].includes(response.status)); assert.equal(f.balance(), 30_000_000);
  }
  f.env.USD_CNY = "8";
  assert.equal((await f.orderRequest("POST", original)).status, 409); f.env.USD_CNY = "7.2";
  const attempts = await Promise.all(["order-distinct-1", "order-distinct-2"].map(key => f.orderRequest("POST", original, ALICE, { key })));
  assert.deepEqual(attempts.map(row => row.status).sort(), [201, 402]); assert.equal(f.balance(), 7_500_000);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM digital_orders").get().n, 1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM wallet_reservations").get().n, 1);
});

test("simultaneous order replays reserve once and return the original price even after rate changes", async t => {
  const f = await fixture(t); f.grant(30_000_000);
  const payload = f.orderInput(), attempts = await Promise.all([1, 2, 3].map(() => f.orderRequest("POST", payload)));
  assert.equal(attempts.filter(row => row.status === 201).length, 1); assert.equal(attempts.filter(row => row.data.reused).length, 2);
  assert.equal(new Set(attempts.map(row => row.data.order.id)).size, 1); assert.equal(f.balance(), 7_500_000);
  f.env.USD_CNY = "9";
  assert.equal((await f.orderRequest("POST", payload)).status, 200);
  assert.equal((await f.orderRequest("POST", f.orderInput())).status, 409);
});

test("claiming an order and user cancellation are exclusive; claimed orders cannot be cancelled by their buyer", async t => {
  const f = await fixture(t); f.grant(30_000_000);
  const order = (await f.orderRequest("POST", f.orderInput())).data.order;
  const race = await Promise.all([
    f.orderRequest("PATCH", { id: order.id, action: "process" }, ADMIN, { admin: true }),
    f.orderRequest("PATCH", { id: order.id, action: "cancel" }),
  ]);
  assert.deepEqual(race.map(row => row.status).sort(), [200, 409]);
  const stored = f.sql.prepare("SELECT * FROM digital_orders WHERE id=?").get(order.id);
  if (stored.status === "processing") {
    assert.equal(f.balance(), 7_500_000);
    assert.equal((await f.orderRequest("PATCH", { id: order.id, action: "cancel" })).status, 409);
    assert.equal((await f.orderRequest("PATCH", { id: order.id, action: "process" }, { ...BOB, isAdmin: true }, { admin: true })).status, 409);
  } else {
    assert.equal(stored.status, "cancelled"); assert.equal(f.balance(), 30_000_000);
  }
});

test("only the processing administrator can deliver, terminal retries are idempotent and delivery stays owner scoped", async t => {
  const f = await fixture(t); f.grant(30_000_000);
  const order = (await f.orderRequest("POST", f.orderInput())).data.order;
  const complete = { id: order.id, action: "complete", delivery: "Private delivery information for this buyer" };
  assert.equal((await f.orderRequest("PATCH", complete, ADMIN, { admin: true })).status, 409);
  assert.equal((await f.orderRequest("PATCH", { id: order.id, action: "process" }, ADMIN, { admin: true })).status, 200);
  assert.equal((await f.orderRequest("PATCH", complete, { ...BOB, isAdmin: true }, { admin: true })).status, 409);
  const completed = await Promise.all([1, 2, 3].map(() => f.orderRequest("PATCH", complete, ADMIN, { admin: true })));
  assert.ok(completed.every(row => row.status === 200)); assert.equal(completed.filter(row => !row.data.reused).length, 1);
  assert.equal(f.balance(), 7_500_000); assert.equal((await f.wallet.getWallet(ALICE.id)).reservedMicrousd, 0);
  assert.equal((await f.orderRequest("PATCH", { ...complete, delivery: "Changed fulfillment payload" }, ADMIN, { admin: true })).status, 409);
  assert.equal((await f.orderRequest("PATCH", { id: order.id, action: "cancel" })).status, 409);
  assert.deepEqual((await f.orderRequest("GET", undefined, BOB)).data.orders, []);
  assert.equal((await f.orderRequest("GET")).data.orders[0].delivery, complete.delivery);
  assert.equal((await f.orderRequest("GET", undefined, BOB, { admin: true })).status, 403);
  assert.equal((await f.orderRequest("POST", f.orderInput(), ALICE, { origin: "https://other.example" })).status, 403);
});

test("a settlement write failure rolls back order delivery, while cancellation releases the complete reservation once", async t => {
  const f = await fixture(t); f.grant(30_000_000);
  const order = (await f.orderRequest("POST", f.orderInput())).data.order;
  await f.orderRequest("PATCH", { id: order.id, action: "process" }, ADMIN, { admin: true });
  f.sql.exec("CREATE TRIGGER fail_order_settlement BEFORE INSERT ON wallet_ledger WHEN NEW.kind='settled' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.equal((await f.orderRequest("PATCH", { id: order.id, action: "complete", delivery: "Private test delivery" }, ADMIN, { admin: true })).status, 503);
  assert.equal(f.sql.prepare("SELECT status FROM digital_orders").get().status, "processing");
  assert.equal(f.sql.prepare("SELECT delivery FROM digital_orders").get().delivery, "");
  assert.equal((await f.wallet.getWallet(ALICE.id)).reservedMicrousd, 22_500_000);
  f.sql.exec("DROP TRIGGER fail_order_settlement");
  const cancelled = await Promise.all([1, 2].map(() => f.orderRequest("PATCH", { id: order.id, action: "cancel" }, ADMIN, { admin: true })));
  assert.ok(cancelled.every(row => row.status === 200)); assert.equal(cancelled.filter(row => !row.data.reused).length, 1);
  assert.equal(f.balance(), 30_000_000); assert.equal((await f.wallet.getWallet(ALICE.id)).reservedMicrousd, 0);
  assert.throws(() => f.sql.prepare("UPDATE digital_orders SET retail_cents=1 WHERE id=?").run(order.id), /order_immutable/);
});

test("the remote QA harness runs the actual modules locally and preserves a zeroed, disabled audit trail", async t => {
  const f = await fixture(t), root = await mkdtemp(path.join(os.tmpdir(), "tokvilo-qa-harness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = { DB: f.DB, vars: f.env, runId: "qa-local-complete", codeRoot: new URL("../", import.meta.url).pathname, artifactsRoot: root };
  const result = await runVerification(input);
  assert.equal(result.completed, true); assert.equal(result.noRealPayment, true); assert.equal(result.noProviderCalls, true);
  assert.equal(result.cleanup.balanceMicrousd, 0); assert.equal(result.cleanup.grants, 1); assert.equal(result.cleanup.reversals, 1);
  assert.deepEqual(result.cleanup.codeStates.map(row => [row.status, row.count]), [["revoked", 1]]);
  assert.deepEqual(result.cleanup.userStates.map(row => [row.status, row.count]), [["disabled", 2]]);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM wallet_ledger WHERE user_id='qa-qa-local-complete-buyer'").get().n, 7);
  assert.equal(f.sql.prepare("SELECT status FROM users WHERE id='alice'").get().status, "active");
  assert.ok(!JSON.stringify(result).includes("TK-"));
  const replay = await runVerification(input);
  assert.equal(replay.alreadyCompleted, true); assert.equal(replay.completed, true);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM wallet_ledger WHERE user_id='qa-qa-local-complete-buyer'").get().n, 7);
});

test("the QA harness cleans up a failed synthetic debit and cannot relabel that failure as a passed rerun", async t => {
  const f = await fixture(t), root = await mkdtemp(path.join(os.tmpdir(), "tokvilo-qa-failed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  f.sql.exec("CREATE TRIGGER fail_qa_settlement BEFORE INSERT ON wallet_ledger WHEN NEW.kind='settled' BEGIN SELECT RAISE(ABORT,'synthetic QA failure'); END");
  const input = { DB: f.DB, vars: f.env, runId: "qa-local-failed", codeRoot: new URL("../", import.meta.url).pathname, artifactsRoot: root };
  await assert.rejects(runVerification(input), /did not complete/);
  const report = JSON.parse(await readFile(path.join(root, ".artifacts/tokvilo-private/qa/qa-local-failed/report.json"), "utf8"));
  assert.equal(report.completed, false); assert.equal(report.cleanup.balanceMicrousd, 0); assert.equal(report.cleanup.pendingReservations, 0);
  assert.deepEqual(report.cleanup.userStates.map(row => [row.status, row.count]), [["disabled", 2]]);
  assert.equal(report.cleanup.codeStates[0].status, "revoked");
  await assert.rejects(runVerification(input), /cleaned up after a failure/);
});

test("the remote D1 adapter uses the documented batch body and does not auto-retry an unknown mutation", async () => {
  const calls = [];
  const DB = remoteD1({ accountId: "a".repeat(32), databaseId: "11111111-1111-1111-1111-111111111111", token: "fixture-only-token", fetcher: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ success: true, result: JSON.parse(init.body).batch.map(() => ({ success: true, results: [], meta: { changes: 1 } })) });
  } });
  await DB.batch([DB.prepare("SELECT ?").bind(1), DB.prepare("SELECT ?").bind("two")]);
  assert.deepEqual(calls[0].body, { batch: [{ sql: "SELECT ?", params: [1] }, { sql: "SELECT ?", params: ["two"] }] });
  assert.ok(!JSON.stringify(calls).includes("fixture-only-token"));
  let attempts = 0;
  const failing = remoteD1({ accountId: "a".repeat(32), databaseId: "11111111-1111-1111-1111-111111111111", token: "fixture-only-token", fetcher: async () => { attempts++; throw new Error("network failed"); } });
  await assert.rejects(failing.prepare("INSERT INTO test VALUES (?)").bind(1).run(), /outcome is unknown/);
  assert.equal(attempts, 1);
});
