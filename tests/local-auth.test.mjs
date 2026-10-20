import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(relative, mocks) {
  const filename = new URL(relative, import.meta.url).pathname;
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const compiled = { exports: {} };
  vm.runInNewContext(outputText, {
    module: compiled, exports: compiled.exports, crypto: webcrypto, TextEncoder, Uint8Array,
    require(name) { assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`); return mocks[name]; },
  }, { filename });
  return compiled.exports;
}

async function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(await readFile(new URL("../drizzle/0000_lumpy_naoko.sql", import.meta.url), "utf8"));
  sql.exec(await readFile(new URL("../drizzle/0014_local_auth.sql", import.meta.url), "utf8"));
  t.after(() => sql.close());
  let queue = Promise.resolve();
  const DB = {
    prepare(query) {
      const statement = sql.prepare(query);
      const bind = (values = []) => ({
        bind: (...args) => bind(args),
        async first() { return statement.get(...values) || null; },
        async run() { return { meta: { changes: statement.run(...values).changes } }; },
      });
      return bind();
    },
    batch(statements) {
      const next = queue.then(async () => {
        sql.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sql.exec("COMMIT"); return results;
        } catch (error) { sql.exec("ROLLBACK"); throw error; }
      });
      queue = next.catch(() => {});
      return next;
    },
  };
  const cryptoHelpers = await load("../lib/crypto.ts", {});
  const auth = await load("../lib/local-auth.ts", {
    "./crypto": cryptoHelpers,
    "./config": { getD1: () => DB, numericEnv: (_name, fallback) => fallback },
  });
  const store = await load("../lib/store.ts", {
    "./config": { getD1: () => DB, numericEnv: (_name, fallback) => fallback, decimalEnv: (_name, fallback) => fallback },
  });
  const register = (email = "new@example.invalid", extra = {}) =>
    auth.createLocalAccount({ email, password: "test-password-12345", displayName: "Test member", ...extra });
  return { auth, sql, register, store };
}

test("local signup stores independent salted password hashes and never grants admin rights", async t => {
  const f = await fixture(t);
  const alice = await f.register(" ADMIN@Example.Invalid ", { isAdmin: true });
  const bob = await f.register("second@example.invalid");
  assert.match(alice.id, /^local_[a-f0-9-]{36}$/);
  assert.equal(alice.email, "admin@example.invalid");
  assert.equal(alice.isAdmin, false);
  assert.equal(bob.isAdmin, false);
  const rows = f.sql.prepare("SELECT * FROM local_credentials ORDER BY email").all();
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].password_salt, rows[1].password_salt);
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  assert.ok(rows.every(row => row.password_iterations === 100000 && row.password_algorithm === "PBKDF2-SHA256"));
  assert.doesNotMatch(JSON.stringify(rows), /test-password/);
  assert.equal((await f.auth.authenticateLocalAccount(" admin@example.invalid ", "test-password-12345")).id, alice.id);
  assert.equal((await f.auth.authenticateLocalAccount("ADMIN@example.invalid", "test-password-12345")).isAdmin, false);
  assert.equal(await f.auth.authenticateLocalAccount(alice.email, "wrong-password-12345"), null);
  assert.equal(await f.auth.authenticateLocalAccount("absent@example.invalid", "test-password-12345"), null);
});

test("duplicate and legacy email registration cannot replace or acquire another account", async t => {
  const f = await fixture(t);
  f.sql.prepare("INSERT INTO users(id,email,display_name) VALUES(?,?,?)").run("legacy-user", " Legacy@Example.Invalid ", "Legacy");
  await assert.rejects(f.register("legacy@example.invalid"), error => error.code === "account_exists" && error.status === 409);
  assert.equal(await f.auth.hasLocalAccount("legacy@example.invalid"), false);
  assert.equal(f.sql.prepare("SELECT count(*) count FROM local_credentials").get().count, 0);
  const user = await f.register();
  await assert.rejects(f.register(" NEW@example.invalid "), error => error.code === "account_exists");
  assert.equal(f.sql.prepare("SELECT user_id FROM local_credentials").get().user_id, user.id);
  assert.equal(f.sql.prepare("SELECT display_name FROM users WHERE id='legacy-user'").get().display_name, "Legacy");
});

test("concurrent signup for one normalized email creates exactly one user and credential", async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.register(), f.register(" NEW@example.invalid "), f.register()]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(results.filter(result => result.status === "rejected").every(result => result.reason.code === "account_exists"));
  assert.equal(f.sql.prepare("SELECT count(*) count FROM users").get().count, 1);
  assert.equal(f.sql.prepare("SELECT count(*) count FROM local_credentials").get().count, 1);
});

test("credential insertion failure rolls back user insertion and returns a safe typed error", async t => {
  const f = await fixture(t);
  f.sql.exec("CREATE TRIGGER fail_credentials BEFORE INSERT ON local_credentials BEGIN SELECT RAISE(ABORT,'private failure'); END;");
  await assert.rejects(f.register(), error => error.code === "local_auth_unavailable" && error.status === 503 && !error.message.includes("private"));
  assert.equal(f.sql.prepare("SELECT count(*) count FROM users").get().count, 0);
  assert.equal(f.sql.prepare("SELECT count(*) count FROM local_credentials").get().count, 0);
});

test("sessions use 32 random bytes, store only hashes, expire, and revoke only the exact session", async t => {
  const f = await fixture(t), user = await f.register();
  const one = await f.auth.createLocalSession(user.id), two = await f.auth.createLocalSession(user.id);
  assert.match(one, /^tk_session_[a-f0-9]{64}$/);
  assert.notEqual(one, two);
  const rows = f.sql.prepare("SELECT * FROM local_sessions").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.expires_at - row.created_at >= 604798 && row.expires_at - row.created_at <= 604801));
  assert.equal(rows[0].token_hash, createHash("sha256").update(one).digest("hex"));
  assert.ok(!JSON.stringify(rows).includes(one));
  assert.equal((await f.auth.verifyLocalSession(one)).id, user.id);
  assert.equal((await f.auth.verifyLocalSession(one)).isAdmin, false);
  assert.equal(await f.auth.verifyLocalSession(one + "x"), null);
  await f.auth.revokeLocalSession(one);
  await f.auth.revokeLocalSession(one);
  assert.equal(await f.auth.verifyLocalSession(one), null);
  assert.equal((await f.auth.verifyLocalSession(two)).id, user.id);
  f.sql.prepare("UPDATE local_sessions SET created_at=0, expires_at=unixepoch() WHERE token_hash=?").run(createHash("sha256").update(two).digest("hex"));
  assert.equal(await f.auth.verifyLocalSession(two), null);
});

test("disabled users remain local, cannot login or mint sessions, and existing sessions stop immediately", async t => {
  const f = await fixture(t), user = await f.register();
  const token = await f.auth.createLocalSession(user.id);
  f.sql.prepare("UPDATE users SET status='disabled' WHERE id=?").run(user.id);
  assert.equal(await f.auth.hasLocalAccount(user.email), true);
  assert.equal(await f.auth.authenticateLocalAccount(user.email, "test-password-12345"), null);
  assert.equal(await f.auth.verifyLocalSession(token), null);
  await assert.rejects(f.auth.createLocalSession(user.id), error => error.code === "local_account_unavailable" && error.status === 401);
  await assert.rejects(f.auth.createLocalSession("legacy-user"), error => error.code === "local_account_unavailable");
  assert.equal(f.sql.prepare("SELECT count(*) count FROM local_sessions").get().count, 1);
});

test("invalid account input creates no records", async t => {
  const f = await fixture(t);
  for (const input of [
    { email: 4, password: "test-password-12345" },
    { email: "bad", password: "test-password-12345" },
    { email: "valid@example.invalid", password: "short" },
    { email: "valid@example.invalid", password: "x".repeat(513) },
    { email: "valid@example.invalid", password: "test-password-12345", displayName: {} },
  ]) await assert.rejects(f.auth.createLocalAccount(input), error => error.code === "invalid_registration");
  assert.equal(f.sql.prepare("SELECT count(*) count FROM users").get().count, 0);
});

test("the real ensureUser upsert can revisit local users without changing their login identity", async t => {
  const f = await fixture(t), user = await f.register();
  await f.store.ensureUser(user);
  await f.store.ensureUser({ ...user, displayName: "Updated display name" });
  assert.equal(f.sql.prepare("SELECT count(*) count FROM users").get().count, 1);
  assert.equal(f.sql.prepare("SELECT display_name FROM users").get().display_name, "Updated display name");
  assert.equal((await f.auth.authenticateLocalAccount(user.email, "test-password-12345")).id, user.id);
  await assert.rejects(f.store.ensureUser({ ...user, email: "changed@example.invalid" }));
  assert.equal(f.sql.prepare("SELECT email FROM users").get().email, user.email);
});
