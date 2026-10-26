import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(path, mocks) {
  const filename = new URL(path, import.meta.url).pathname;
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const compiled = { exports: {} };
  vm.runInNewContext(outputText, { module: compiled, exports: compiled.exports, require: name => { if (Object.hasOwn(mocks, name)) return mocks[name]; throw new Error(`Unmocked ${name}`); }, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, URL, Request, Response, Headers }, { filename });
  return compiled.exports;
}
const schema = (await Promise.all((await readdir(new URL("../drizzle/", import.meta.url))).filter(name => name.endsWith(".sql")).sort().map(name => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")))).join("\n");
const ADMIN = { id: "admin", email: "operator@example.com", isAdmin: true };
const ALICE = { id: "alice", email: "alice+test@example.com", isAdmin: false };
const BOB = { id: "bob", email: "bob@example.com", isAdmin: false };

async function fixture(t) {
  const sql = new DatabaseSync(":memory:"); sql.exec(schema); t.after(() => sql.close());
  for (const user of [ADMIN, ALICE, BOB]) sql.prepare("INSERT INTO users(id,email,status) VALUES(?,?,'active')").run(user.id, user.email);
  let actor = ADMIN, failSnapshot = false;
  const DB = { prepare(query) {
    if (failSnapshot && query.startsWith("SELECT balance_microusd")) throw new Error("Synthetic lost confirmation response");
    const statement = sql.prepare(query);
    function executable(args = []) { return {
      bind(...values) { return executable(values); },
      async first() { return statement.get(...args) || null; },
      async all() { return { results: statement.all(...args) }; },
      async run() { return { meta: { changes: statement.run(...args).changes } }; },
    }; }
    return executable();
  } };
  const config = { getD1: () => DB };
  const wallet = await load("../lib/wallet.ts", { "./config": config });
  const mod = await load("../lib/admin-wallet.ts", { "./config": config, "./wallet": wallet, "./auth": { getPortalUser: async () => actor }, "./store": { ensureUser: async () => {} } });
  const input = extra => ({ customerId: ALICE.id, email: ALICE.email, amountUSD: "100.01", paymentReference: "Bank:TX-20261024-001", requestId: "manual-request-001", note: "Example company transfer confirmed", reason: "bank_transfer", confirmed: true, receiptConfirmed: true, ...extra });
  async function request(payload, { user = ADMIN, headers = {}, lookupEmail = ALICE.email, method = payload === undefined ? "GET" : "POST", rawBody } = {}) {
    actor = user;
    const response = await mod.handleAdminWallet(new Request(`https://tokvilo.com/api/admin/wallet?${new URLSearchParams({ email: lookupEmail })}`, { method, headers: { origin: "https://tokvilo.com", "content-type": "application/json", ...headers }, ...(method === "GET" ? {} : { body: rawBody ?? JSON.stringify(payload) }) }));
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  return { sql, mod, input, request, setFailSnapshot: value => { failSnapshot = value; }, balance: (id = ALICE.id) => sql.prepare("SELECT balance_microusd FROM wallet_accounts WHERE user_id=?").get(id)?.balance_microusd || 0 };
}

test("manual credit reads and writes require an authenticated active administrator and same-origin JSON", async t => {
  const f = await fixture(t);
  for (const payload of [undefined, f.input()]) {
    assert.equal((await f.request(payload, { user: null })).status, 401);
    assert.equal((await f.request(payload, { user: ALICE })).status, 403);
    assert.equal((await f.request(payload, { headers: { origin: "https://other.example" } })).status, 403);
    assert.equal((await f.request(payload, { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  }
  assert.equal((await f.request(f.input(), { headers: { origin: "" } })).status, 403);
  assert.equal((await f.request(f.input(), { headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await f.request(f.input(), { headers: { "content-type": "application/json-invalid" } })).status, 415);
  assert.equal((await f.request(f.input(), { rawBody: "[]" })).status, 400);
  assert.equal((await f.request(f.input(), { rawBody: "{broken" })).status, 400);
  assert.equal((await f.request(f.input(), { rawBody: JSON.stringify({ note: "A".repeat(8100) }) })).status, 413);
  assert.equal((await f.request(f.input(), { method: "PATCH" })).status, 405);
  f.sql.prepare("UPDATE users SET status='disabled' WHERE id=?").run(ADMIN.id);
  assert.equal((await f.request(f.input())).status, 403);
  assert.equal(f.balance(), 0);
});

test("exact normalized email lookup preserves plus addresses and rejects ambiguous or changed identities", async t => {
  const f = await fixture(t);
  const found = await f.request(undefined, { lookupEmail: " ALICE+TEST@EXAMPLE.COM " });
  assert.equal(found.status, 200); assert.equal(found.data.customer.id, ALICE.id);
  assert.equal(found.headers.get("cache-control"), "private, no-store");
  assert.equal((await f.request(undefined, { lookupEmail: "alice@example.com" })).status, 404);
  assert.equal((await f.request(f.input({ customerId: BOB.id }))).status, 409);
  f.sql.prepare("INSERT INTO users(id,email,status) VALUES('duplicate','ALICE+TEST@EXAMPLE.COM','active')").run();
  assert.equal((await f.request(f.input())).data.error.code, "customer_ambiguous");
  f.sql.prepare("DELETE FROM users WHERE id='duplicate'").run();
  f.sql.prepare("UPDATE users SET status='disabled' WHERE id=?").run(ALICE.id);
  assert.equal((await f.request(f.input())).data.error.code, "customer_disabled");
  assert.equal(f.balance(), 0);
});

test("manual USD parsing is exact and confirmation cannot be bypassed by forged payload fields", async t => {
  const f = await fixture(t);
  assert.equal(f.mod.manualCreditMicrousd("100.01"), 100_010_000);
  assert.equal(f.mod.manualCreditMicrousd(1.1), 1_100_000);
  for (const value of [0, -1, "-10", "0.001", "1e2", "1.234567", "100000.01", "1000000", "NaN", {}, [], null]) assert.throws(() => f.mod.manualCreditMicrousd(value));
  for (const extra of [{ confirmed: false }, { confirmed: "true" }, { receiptConfirmed: false }, { receiptConfirmed: "true" }, { reason: "paddle" }, { note: "a" }, { requestId: "bad!request" }]) {
    assert.equal((await f.request(f.input(extra))).status, 400, JSON.stringify(extra));
  }
  const credit = await f.request(f.input({ amount_microusd: 9_000_000_000, actor_id: BOB.id, actor_email: BOB.email }));
  assert.equal(credit.status, 201); assert.equal(f.balance(), 100_010_000);
  assert.equal(credit.data.entry.actor_id, ADMIN.id); assert.equal(credit.data.entry.actor_email, ADMIN.email);
  assert.equal(credit.data.entry.amount_microusd, 100_010_000); assert.equal(credit.data.entry.receipt_confirmed, 1);
  assert.equal(Object.hasOwn(credit.data.entry, "fingerprint"), false);
});

test("concurrent same-reference replays add credit exactly once even with new request IDs", async t => {
  const f = await fixture(t);
  const attempts = await Promise.all([1, 2, 3].map(index => f.request(f.input({ requestId: `manual-request-${index}`, paymentReference: index === 1 ? " bank:tx-20261024-001 " : "BANK:TX-20261024-001" }))));
  assert.ok(attempts.every(row => row.status === 200 || row.status === 201), JSON.stringify(attempts));
  assert.equal(attempts.filter(row => row.status === 201).length, 1);
  assert.equal(attempts.filter(row => row.data.reused).length, 2);
  assert.equal(new Set(attempts.map(row => row.data.entry.id)).size, 1);
  assert.equal(f.balance(), 100_010_000);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM wallet_ledger").get().n, 1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_manual_wallet_adjustments").get().n, 1);
  for (const extra of [{ amountUSD: "101" }, { customerId: BOB.id, email: BOB.email }, { note: "Changed receipt details" }, { reason: "test_credit" }]) {
    const result = await f.request(f.input({ requestId: webcrypto.randomUUID(), ...extra }));
    assert.equal(result.status, 409); assert.equal(result.data.error.code, "manual_credit_conflict");
  }
  assert.equal(f.balance(), 100_010_000); assert.equal(f.balance(BOB.id), 0);
});

test("reusing a request ID for a different payment reference is rejected before crediting", async t => {
  const f = await fixture(t);
  assert.equal((await f.request(f.input())).status, 201);
  assert.equal((await f.request(f.input({ paymentReference: "BANK:NEW-REFERENCE" }))).status, 409);
  assert.equal((await f.request(f.input())).data.reused, true);
  assert.equal(f.balance(), 100_010_000);
});

test("ledger failure rolls back the audit entry and the original request can be retried", async t => {
  const f = await fixture(t);
  f.sql.exec("CREATE TRIGGER fail_manual BEFORE INSERT ON wallet_ledger WHEN NEW.kind='manual_bank_transfer' BEGIN SELECT RAISE(ABORT,'synthetic ledger failure'); END");
  assert.equal((await f.request(f.input())).status, 503);
  assert.equal(f.balance(), 0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM tokvilo_manual_wallet_adjustments").get().n, 0);
  f.sql.exec("DROP TRIGGER fail_manual");
  assert.equal((await f.request(f.input())).status, 201); assert.equal(f.balance(), 100_010_000);
});

test("lost confirmation after a committed grant recovers the same audited credit without duplication", async t => {
  const f = await fixture(t);
  f.setFailSnapshot(true);
  assert.equal((await f.request(f.input())).status, 503); assert.equal(f.balance(), 100_010_000);
  f.setFailSnapshot(false);
  const recovered = await f.request(f.input());
  assert.equal(recovered.status, 200); assert.equal(recovered.data.reused, true);
  assert.equal(recovered.data.entries.length, 1); assert.equal(recovered.data.wallet.balanceMicrousd, 100_010_000);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM wallet_ledger").get().n, 1);
});

test("audit history is immutable and preserves test/correction classification without claiming bank receipt", async t => {
  const f = await fixture(t);
  for (const reason of ["test_credit", "correction"]) {
    const result = await f.request(f.input({ reason, amountUSD: "10.00", paymentReference: `${reason}-001`, requestId: `${reason}-001`, receiptConfirmed: false }));
    assert.equal(result.status, 201); assert.equal(result.data.entry.receipt_confirmed, 0);
  }
  assert.equal(f.balance(), 20_000_000);
  assert.throws(() => f.sql.prepare("UPDATE tokvilo_manual_wallet_adjustments SET note='revised'").run(), /manual_audit_immutable/);
  assert.throws(() => f.sql.prepare("DELETE FROM tokvilo_manual_wallet_adjustments").run(), /manual_audit_immutable/);
  const snapshot = await f.request();
  assert.equal(snapshot.data.entries.length, 2); assert.equal(snapshot.data.wallet.ledger.length, 2);
  assert.ok(snapshot.data.wallet.ledger.every(row => !row.description.includes("confirmed")));
});

test("database guards recheck account activity and exact identity inside the atomic insert", async t => {
  const f = await fixture(t);
  await f.request(f.input());
  const original = f.sql.prepare("SELECT * FROM tokvilo_manual_wallet_adjustments").get();
  const insert = f.sql.prepare(`INSERT INTO tokvilo_manual_wallet_adjustments(id,request_id,payment_reference,fingerprint,user_id,customer_email,actor_id,actor_email,amount_microusd,reason,receipt_confirmed,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const args = ["direct-2", "request-2", "direct-ref-2", "direct-fingerprint", original.user_id, original.customer_email, original.actor_id, original.actor_email, 1_000_000, "bank_transfer", 1, "Fixture audit"];
  f.sql.prepare("UPDATE users SET status='disabled' WHERE id=?").run(ADMIN.id);
  assert.throws(() => insert.run(...args), /manual_actor_disabled/);
  f.sql.prepare("UPDATE users SET status='active' WHERE id=?").run(ADMIN.id);
  f.sql.prepare("UPDATE users SET email='changed@example.com' WHERE id=?").run(ALICE.id);
  assert.throws(() => insert.run(...args), /manual_customer_changed/);
  assert.equal(f.balance(), 100_010_000);
});
