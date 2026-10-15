import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function loadModule(path, mocks = {}, globals = {}) {
  const filename = new URL(path, import.meta.url).pathname;
  const source = await readFile(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const compiledModule = { exports: {} };
  vm.runInNewContext(outputText, {
    module: compiledModule,
    exports: compiledModule.exports,
    require(specifier) {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
      throw new Error(`Unexpected dependency ${specifier} in ${filename}`);
    },
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    AbortController,
    AbortSignal,
    btoa,
    atob,
    setTimeout,
    clearTimeout,
    fetch() {
      throw new Error("Unexpected network request in provider settings test");
    },
    ...globals,
  }, { filename });
  return compiledModule.exports;
}

function d1Database(sql) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(sql);
  let queries = 0;
  const database = {
    prepare(query) {
      queries += 1;
      const statement = sqlite.prepare(query);
      const execute = (parameters = []) => ({
        bind(...next) {
          return execute(next);
        },
        async first() {
          return statement.get(...parameters) || null;
        },
        async all() {
          return { success: true, results: statement.all(...parameters) };
        },
        async run() {
          const result = statement.run(...parameters);
          return { success: true, meta: { changes: result.changes } };
        },
      });
      return execute();
    },
  };
  return { database, sqlite, queryCount: () => queries };
}

const SECRET = "test-encryption-secret-at-least-32-characters";
const KEY = "sk-apimart-test-key-never-send-to-network";
const ENV_KEY = "sk-apimart-environment-fallback";
const ADMIN = { id: "admin", isAdmin: true };
const BASE = "https://api.eco-geo.org";
const providers = await loadModule("../lib/provider-settings.ts");
const migrationNames = (await readdir(new URL("../drizzle/", import.meta.url)))
  .filter(name => name.endsWith(".sql"))
  .sort();
const schema = (await Promise.all(migrationNames.map(name =>
  readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8"),
))).join("\n");

function fixture(t, env = {}) {
  const store = d1Database(schema);
  t.after(() => store.sqlite.close());
  return {
    ...store,
    env: { DB: store.database, ADMIN_SESSION_SECRET: SECRET, ...env },
  };
}

function balanceResponse(remaining = 12.5) {
  return Response.json({ success: true, remain_balance: remaining, unlimited_quota: false });
}

function assertRedacted(value, ...secrets) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) assert.ok(!text.includes(secret), "must not expose the original credential");
}

function request(action, options = {}) {
  const method = action === "save" || action === "test" ? "POST" : "GET";
  return new Request(`${BASE}/api/admin/providers/apimart/${action}`, {
    method,
    headers: { Origin: BASE, "Content-Type": "application/json" },
    ...(action === "save" ? { body: JSON.stringify({ apiKey: KEY }) } : {}),
    ...options,
  });
}

async function handler(env, options = {}) {
  return (await loadModule("../lib/provider-api.ts", {
    "./auth": { getPortalUser: async () => options.user === undefined ? ADMIN : options.user },
    "./config": {
      runtimeEnv: () => { options.onEnvironment?.(); return env; },
      getD1: () => { options.onDatabase?.(); return env.DB; },
    },
    "./crypto": { sha256Hex: async value => createHash("sha256").update(value).digest("hex") },
    "./provider-settings": {
      ...providers,
      createProviderSettings: current => providers.createProviderSettings(current, options.fetcher),
    },
  })).handleProviderRequest;
}

test("saved provider secrets round-trip and reject changed encryption keys or ciphertext", async () => {
  const first = await providers.encryptProviderKey(KEY, SECRET);
  const second = await providers.encryptProviderKey(KEY, SECRET);
  assert.notEqual(first, second, "saving the same key must use a new encryption nonce");
  assertRedacted(first, KEY);
  assert.equal(await providers.decryptProviderKey(first, SECRET), KEY);
  await assert.rejects(providers.decryptProviderKey(first, `${SECRET}-changed`));
  const parts = first.split(".");
  const bytes = Buffer.from(parts[2], "base64");
  bytes[0] ^= 1;
  parts[2] = bytes.toString("base64");
  await assert.rejects(providers.decryptProviderKey(parts.join("."), SECRET));
  await assert.rejects(providers.decryptProviderKey(`${first}.extra`, SECRET));
});

test("status exposes only configuration state and a short hint", async t => {
  const { env } = fixture(t, {
    APIMART_API_KEY: ENV_KEY,
    UPSTREAM_BASE_URL: "https://existing-upstream.example",
    UPSTREAM_API_TOKEN: "existing-upstream-secret",
  });
  const status = await providers.createProviderSettings(env).status();
  assert.equal(status.upstream.configured, true);
  assert.equal(status.apimart.source, "environment");
  assert.equal(status.apimart.keyHint, `••••${ENV_KEY.slice(-4)}`);
  assertRedacted(status, ENV_KEY, "existing-upstream-secret", SECRET);
  const empty = await providers.createProviderSettings({ ...env, APIMART_API_KEY: "" }).status();
  assert.equal(empty.apimart.configured, false);
  assert.equal(empty.apimart.source, "none");
});

test("saving verifies a key with a read-only official request and persists only encrypted credentials", async t => {
  const { env, sqlite } = fixture(t, { APIMART_API_KEY: ENV_KEY });
  const calls = [];
  const service = providers.createProviderSettings(env, async (url, init) => {
    calls.push({ url, init });
    return balanceResponse(0);
  });
  const result = await service.save(` ${KEY} `);
  assert.equal(result.ok, true);
  assert.equal(result.apimart.source, "saved");
  assert.equal(result.quota.remaining, 0, "zero balance is still a valid credential");
  const row = sqlite.prepare("SELECT * FROM provider_settings WHERE provider = ?").get("apimart");
  assertRedacted(row, KEY, ENV_KEY);
  assert.equal(await providers.decryptProviderKey(row.encrypted_key, SECRET), KEY);
  assert.ok(row.verified_at && row.updated_at);
  assertRedacted(result, KEY, ENV_KEY, row.encrypted_key);
  await service.test();
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.equal(url, "https://api.apimart.ai/v1/balance");
    assert.equal(init.method, "GET");
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${KEY}`);
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test("an HTTP 200 authentication failure never replaces a previously verified key", async t => {
  const { env, sqlite } = fixture(t);
  await providers.createProviderSettings(env, async () => balanceResponse()).save(KEY);
  const before = sqlite.prepare("SELECT * FROM provider_settings").get();
  const rejectedKey = "sk-invalid-replacement-value";
  const service = providers.createProviderSettings(env, async () => Response.json({
    success: false,
    message: `Invalid token ${rejectedKey}`,
  }));
  await assert.rejects(service.save(rejectedKey), error => {
    assert.equal(error.status, 422);
    assertRedacted(error.message, rejectedKey);
    return true;
  });
  assert.deepEqual(sqlite.prepare("SELECT * FROM provider_settings").get(), before);
});

test("invalid values and missing encryption configuration fail before an upstream request", async t => {
  const { env, sqlite } = fixture(t);
  let called = false;
  const fetcher = async () => { called = true; return balanceResponse(); };
  for (const value of [null, {}, "", "short", "with a space inside key", "x".repeat(513), "a".repeat(20) + "\nheader:value"]) {
    await assert.rejects(providers.createProviderSettings(env, fetcher).save(value), error => error.status === 400);
  }
  await assert.rejects(providers.createProviderSettings({ ...env, ADMIN_SESSION_SECRET: "short" }, fetcher).save(KEY));
  assert.equal(called, false);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM provider_settings").get().n, 0);
});

test("environment credentials work until a saved credential exists; damaged saved credentials never silently fall back", async t => {
  const { env, sqlite } = fixture(t, { APIMART_API_KEY: ENV_KEY });
  const calls = [];
  const service = providers.createProviderSettings(env, async (_url, init) => {
    calls.push(new Headers(init.headers).get("Authorization"));
    return Response.json({ success: true, remain_balance: -1, unlimited_quota: true });
  });
  const checked = await service.test();
  assert.equal(checked.quota.unlimited, true);
  assert.equal(checked.quota.remaining, null);
  assert.deepEqual(calls, [`Bearer ${ENV_KEY}`]);
  await service.save(KEY);
  sqlite.prepare("UPDATE provider_settings SET encrypted_key = ?").run("damaged-value");
  const callCount = calls.length;
  await assert.rejects(service.test());
  assert.equal(calls.length, callCount, "must not send the fallback key after a saved key fails to decrypt");
});

test("models are fetched with the configured credential and discard arbitrary upstream fields", async t => {
  const { env } = fixture(t, { APIMART_API_KEY: ENV_KEY });
  const service = providers.createProviderSettings(env, async (url, init) => {
    assert.equal(url, "https://api.apimart.ai/v1/models?expand=category");
    assert.equal(init.method, "GET");
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${ENV_KEY}`);
    return Response.json({ success: true, data: [
      { id: "example-chat", owned_by: "example", category: "chat", secret: ENV_KEY },
      { id: "example-image", owned_by: "example", category: ["image", 42] },
      null,
      { id: 123 },
    ] });
  });
  const result = await service.models();
  assert.equal(result.models.length, 2);
  assert.equal(result.models[0].id, "example-chat");
  assert.equal(result.models[0].category.join(","), "chat");
  assert.equal(result.models[1].category.join(","), "image");
  assertRedacted(result, ENV_KEY);
});

test("upstream rejection, malformed responses and transport failures are reported without leaking credentials", async t => {
  const { env, sqlite } = fixture(t);
  const cases = [
    ["unauthorized", () => new Response(KEY, { status: 401 }), 422],
    ["forbidden", () => new Response(KEY, { status: 403 }), 422],
    ["rate limited", () => new Response(KEY, { status: 429 }), 429],
    ["unavailable", () => new Response(KEY, { status: 503 }), 502],
    ["non JSON", () => new Response(`<html>${KEY}</html>`), 502],
    ["oversized", () => new Response("x".repeat(2_000_001)), 502],
    ["missing balance", () => Response.json({ success: true }), 502],
    ["invalid balance", () => Response.json({ success: true, remain_balance: -1, unlimited_quota: false }), 502],
    ["timeout", () => { throw new DOMException(KEY, "TimeoutError"); }, 502],
    ["redirect refused", () => { throw new TypeError(`redirect ${KEY}`); }, 502],
  ];
  for (const [name, response, status] of cases) {
    await t.test(name, async () => {
      await assert.rejects(providers.createProviderSettings(env, async () => response()).save(KEY), error => {
        assert.equal(error.status, status);
        assertRedacted(error.message, KEY);
        return true;
      });
    });
  }
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM provider_settings").get().n, 0);
});

test("all provider operations require an administrator before reading configuration or touching storage", async () => {
  for (const [user, status] of [[null, 401], [{ id: "member", isAdmin: false }, 403]]) {
    const handle = await handler({}, {
      user,
      onEnvironment() { assert.fail("Unauthorized request must not read configuration"); },
      onDatabase() { assert.fail("Unauthorized request must not touch storage"); },
    });
    for (const action of ["status", "save", "test", "models"]) {
      const response = await handle(request(action), action);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  }
});

test("cross-site submissions and wrong methods cannot reach provider storage", async () => {
  const handle = await handler({}, {
    onEnvironment() { assert.fail("Rejected request must not read configuration"); },
    onDatabase() { assert.fail("Rejected request must not touch storage"); },
  });
  for (const action of ["save", "test"]) {
    for (const origin of ["https://other.example", null]) {
      const headers = { "Content-Type": "application/json" };
      if (origin) headers.Origin = origin;
      assert.equal((await handle(request(action, { headers }), action)).status, 403);
    }
  }
  assert.equal((await handle(new Request(`${BASE}/settings`, { method: "GET" }), "save")).status, 405);
  assert.equal((await handle(new Request(`${BASE}/settings`, { method: "POST" }), "status")).status, 405);
});

test("admin request parsing rejects oversized, malformed and unexpected configuration fields", async t => {
  const { env, sqlite } = fixture(t);
  const handle = await handler(env, { fetcher: async () => { assert.fail("Invalid body must not reach APIMart"); } });
  const cases = [
    [{ headers: { Origin: BASE, "Content-Type": "text/plain" }, body: KEY }, 415],
    [{ body: "{" }, 400],
    [{ body: "[]" }, 400],
    [{ body: JSON.stringify({ apiKey: KEY, baseUrl: "https://other.example" }) }, 400],
    [{ body: JSON.stringify({ apiKey: "x".repeat(2050) }) }, 413],
    [{ body: JSON.stringify({ apiKey: 123 }) }, 400],
  ];
  for (const [options, status] of cases) {
    const response = await handle(request("save", options), "save");
    assert.equal(response.status, status);
    assertRedacted(await response.text(), KEY);
  }
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM provider_settings").get().n, 0);
});

test("admin save and status return masked configuration while the key remains server-side", async t => {
  const { env } = fixture(t);
  const handle = await handler(env, { fetcher: async () => balanceResponse() });
  const saved = await handle(request("save"), "save");
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("cache-control"), "private, no-store");
  assert.equal(saved.headers.get("x-content-type-options"), "nosniff");
  assertRedacted(await saved.text(), KEY, SECRET);
  const status = await handle(request("status"), "status");
  const body = await status.json();
  assert.equal(body.apimart.source, "saved");
  assertRedacted(body, KEY, SECRET);
});

test("admin upstream checks stop after ten requests per minute and resume after expiration", async t => {
  const { env, sqlite } = fixture(t, { APIMART_API_KEY: ENV_KEY });
  let upstreamCalls = 0;
  const handle = await handler(env, { fetcher: async () => {
    upstreamCalls += 1;
    return Response.json({ success: true, data: [] });
  } });
  for (let index = 0; index < 10; index += 1) {
    assert.equal((await handle(request("models"), "models")).status, 200);
  }
  assert.equal((await handle(request("models"), "models")).status, 429);
  assert.equal(upstreamCalls, 10);
  assert.equal((await handle(request("status"), "status")).status, 200);
  sqlite.prepare("UPDATE login_rate_limits SET expires_at = ?").run("2000-01-01T00:00:00.000Z");
  assert.equal((await handle(request("models"), "models")).status, 200);
  assert.equal(upstreamCalls, 11);
});

test("unexpected storage exceptions are sanitized at the admin API boundary", async () => {
  const handle = await handler({ DB: { prepare() { throw new Error(`Database detail: ${KEY}`); } } });
  const response = await handle(request("status"), "status");
  assert.equal(response.status, 503);
  assertRedacted(await response.text(), KEY, "Database detail");
});
