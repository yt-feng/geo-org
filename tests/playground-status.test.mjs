import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(path, mocks = {}) {
  const filename = new URL(path, import.meta.url).pathname;
  const source = ts.transpileModule(await readFile(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(source, {
    module: mod, exports: mod.exports,
    require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; throw Error(`Unexpected module ${name}`); },
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, btoa, atob, Request, Response, URL,
    fetch() { assert.fail("Status must never contact a model service"); },
  }, { filename });
  return mod.exports;
}

const providers = await load("../lib/provider-settings.ts");
const studio = await load("../lib/tokenhub-settings.ts", { "./provider-settings": providers, "./tokenhub-catalog": {} });
const snapshot = JSON.parse(await readFile(new URL("../lib/rkapi-catalog-snapshot.json", import.meta.url), "utf8"));
class PricingError extends Error {}
const selected = await load("../lib/rkapi-settings.ts", { "./config": {}, "./pricing": { PricingError }, "./rkapi-catalog-snapshot.json": snapshot });
const secret = "test-secret-with-more-than-thirty-two-characters";
const key = "private-provider-key-not-for-public-response";

async function fixture(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE wallet_accounts(user_id TEXT PRIMARY KEY,balance_microusd INTEGER);
    CREATE TABLE provider_settings(provider TEXT PRIMARY KEY,encrypted_key TEXT,key_hint TEXT,updated_at TEXT,verified_at TEXT);`);
  if (!options.newAccount) {
    sqlite.prepare("INSERT INTO users VALUES(?,?)").run("user-1", options.accountStatus || "active");
    sqlite.prepare("INSERT INTO wallet_accounts VALUES(?,?)").run("user-1", options.balance ?? 20_000);
  }
  if (options.saved) sqlite.prepare("INSERT INTO provider_settings VALUES(?,?,?,?,?)").run("apimart", options.saved, "private-hint", "2026-10-23", "");
  const reads = [];
  const db = { prepare(sql) {
    assert.match(sql.trim(), /^SELECT /i, "status may only read the database");
    reads.push(sql);
    const query = sqlite.prepare(sql);
    const statement = args => ({ bind: (...values) => statement(values), first: async () => query.get(...args) || null });
    return statement([]);
  } };
  const env = { DB: db, SERVICE_ENABLED: "true", ADMIN_SESSION_SECRET: secret, APIMART_API_KEY: key, TOKENHUB_API_KEY: key, ...options.env };
  const mod = await load("../lib/playground-status.ts", {
    "./auth": { getPortalUser: async () => options.anonymous ? null : { id: "user-1" } },
    "./config": { runtimeEnv: () => env },
    "./provider-settings": providers, "./tokenhub-settings": studio, "./rkapi-settings": selected,
  });
  return { sqlite, reads, env, handle: service => mod.handlePlaygroundStatus(new Request(`https://tokvilo.com/api/playground/status${service === undefined ? "" : `?${service}`}`)) };
}

test("status requires authentication before reading configuration or balances", async t => {
  const f = await fixture(t, { anonymous: true });
  const response = await f.handle("service=gateway"), body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, "login_required");
  assert.equal(body.authenticated, false);
  assert.equal(body.error.code, "login_required");
  assert.equal(f.reads.length, 0);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
});

test("configuration-only status distinguishes a usable stored key from an empty wallet without leaking it", async t => {
  const f = await fixture(t, { saved: await providers.encryptProviderKey(key, secret), balance: 0 });
  const response = await f.handle("service=gateway"), body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { service: "gateway", authenticated: true, serviceEnabled: true, configured: true, accountActive: true,
    balanceMicrousd: 0, currency: "USD", code: "balance_empty", checks: "configuration_only" });
  assert.doesNotMatch(JSON.stringify(body), /private-|apimart|tokenhub|rkapi|verifiedAt|keyHint|paid|ready/i);
  assert.equal(f.sqlite.prepare("SELECT verified_at FROM provider_settings").get().verified_at, "", "configuration checks do not assert credential verification");
});

test("gateway and studio inspect their own local credentials without network calls", async t => {
  const f = await fixture(t, { env: { APIMART_API_KEY: undefined } });
  const gateway = await (await f.handle()).json();
  assert.equal(gateway.service, "gateway");
  assert.equal(gateway.code, "service_not_configured");
  assert.equal(gateway.configured, false);
  const studioStatus = await (await f.handle("service=studio")).json();
  assert.equal(studioStatus.code, "configuration_available");
  assert.equal(studioStatus.configured, true);
  assert.equal(studioStatus.balanceMicrousd, 20_000);
  assert.equal(studioStatus.checks, "configuration_only");
});

test("broken saved credentials cannot silently fall back to an environment key", async t => {
  const f = await fixture(t, { saved: await providers.encryptProviderKey(key, `${secret}-different`) });
  const body = await (await f.handle("service=gateway")).json();
  assert.equal(body.configured, false);
  assert.equal(body.code, "service_configuration_unavailable");
  assert.doesNotMatch(JSON.stringify(body), /secret|private-|apimart|tokenhub|rkapi/i);
});

test("service and account disabling remain visible independently of a configured key and balance", async t => {
  const f = await fixture(t, { accountStatus: "disabled", env: { SERVICE_ENABLED: "false" } });
  const disabledAccount = await (await f.handle()).json();
  assert.equal(disabledAccount.code, "account_disabled");
  assert.equal(disabledAccount.accountActive, false);
  assert.equal(disabledAccount.serviceEnabled, false);
  assert.equal(disabledAccount.configured, true);
  f.sqlite.prepare("UPDATE users SET status='active'").run();
  const disabledService = await (await f.handle()).json();
  assert.equal(disabledService.code, "service_disabled");
});

test("selected validates local routes but does not discover models or verify execution", async t => {
  const f = await fixture(t);
  assert.equal((await (await f.handle("service=selected")).json()).code, "service_not_configured");
  f.env.RKAPI_ROUTES_JSON = "{broken private-key";
  assert.equal((await (await f.handle("service=selected")).json()).code, "service_configuration_unavailable");
  const model = snapshot.models.find(model => model.groups.length);
  f.env.RKAPI_ROUTES_JSON = JSON.stringify({ routes: [{ group: model.groups[0], apiKey: key, groupVerifiedAt: "2026-01-01T00:00:00Z", crossGroupRetry: false, modelIds: [model.id] }] });
  const body = await (await f.handle("service=selected")).json();
  assert.equal(body.configured, true);
  assert.equal(body.code, "configuration_available");
  assert.equal(body.checks, "configuration_only");
  assert.doesNotMatch(JSON.stringify(body), /private-|group|modelIds|rkapi/i);
});

test("new authenticated accounts report zero balance without writing an account", async t => {
  const f = await fixture(t, { newAccount: true });
  const body = await (await f.handle()).json();
  assert.equal(body.accountActive, true);
  assert.equal(body.code, "balance_empty");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM users").get().n, 0);
});

test("invalid service and unavailable storage return explicit errors without private diagnostics", async t => {
  const f = await fixture(t);
  for (const value of ["service=invalid", "service=gateway&service=studio"]) {
    const response = await f.handle(value);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "unsupported_service");
  }
  assert.equal(f.reads.length, 0);
  f.env.DB = undefined;
  const response = await f.handle();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "status_unavailable");
});
