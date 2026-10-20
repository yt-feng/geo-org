import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(relative, mocks = {}, globals = {}) {
  const filename = new URL("../" + relative, import.meta.url).pathname, compiled = { exports: {} };
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInNewContext(outputText, {
    module: compiled, exports: compiled.exports, Request, Response, Headers, URL, TextEncoder,
    TextDecoder, Uint8Array, AbortSignal, atob, btoa, crypto: webcrypto,
    require(name) { assert.ok(Object.hasOwn(mocks, name), `Unknown dependency: ${name}`); return mocks[name]; },
    ...globals,
  }, { filename });
  return compiled.exports;
}
const hash = value => createHash("sha256").update(value).digest("hex");
const LINK_HASH = "a".repeat(64);
const RECOVERY_COOKIE = "tokvilo_password_recovery";
const PASSWORD = "new-password-12345";

async function fixture(t, options = {}) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(await readFile(new URL("../drizzle/0017_password_recovery.sql", import.meta.url), "utf8"));
  t.after(() => sql.close());
  const DB = {
    prepare(query) {
      const statement = sql.prepare(query);
      const bind = (values = []) => ({
        bind: (...args) => bind(args),
        async first() { return statement.get(...values) || null; },
        async run() {
          if (options.receiptFailure && query.includes("CASE WHEN id=")) throw new Error("private DB failure");
          return { meta: { changes: statement.run(...values).changes } };
        },
      });
      return bind();
    },
  };
  const calls = [], verified = new Set();
  const env = { ADMIN_SESSION_SECRET: "test-only-encryption-secret-with-over-32-characters" };
  let baseUrl = "https://project.supabase.co";
  const auth = {
    ACCESS_COOKIE: "eco_geo_access", REFRESH_COOKIE: "eco_geo_refresh",
    authBaseUrl: () => { if (options.notConfigured) throw new Error("private configuration"); return baseUrl; },
    authRequestHeaders: () => new Headers({ apikey: "test-key", "content-type": "application/json" }),
  };
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname, body = JSON.parse(init.body);
    calls.push({ url, init, body });
    assert.equal(init.redirect, "manual");
    if (options.transport) throw new Error("private transport detail");
    if (path.endsWith("/recover")) return Response.json(options.recoverBody || {}, { status: options.recoverStatus || 200 });
    if (path.endsWith("/verify")) {
      assert.equal(body.type, "recovery");
      if (options.verifyStatus || verified.has(body.token_hash)) return Response.json({ error_code: "otp_expired", message: "private expired detail" }, { status: options.verifyStatus || 403 });
      verified.add(body.token_hash);
      return Response.json(options.verifyBody || { access_token: "recovery-access-private", refresh_token: "recovery-refresh-private", expires_in: 3600, user: { id: "recovered-user" } });
    }
    if (path.endsWith("/user")) {
      assert.equal(init.method, "PUT");
      assert.equal(init.headers.get("authorization"), "Bearer recovery-access-private");
      if (options.updateWait) await options.updateWait;
      if (options.updateTransport) throw new Error("private update failure");
      if (options.updateBody) return Response.json(options.updateBody, { status: options.updateStatus || 400 });
      return Response.json({ id: options.updateId || "recovered-user" });
    }
    if (path.endsWith("/logout")) {
      assert.equal(new URL(url).searchParams.get("scope"), "global");
      assert.equal(init.headers.get("authorization"), "Bearer recovery-access-private");
      return options.logoutFailure ? Response.json({ message: "private logout failure" }, { status: 500 }) : new Response(null, { status: 204 });
    }
    throw new Error("unexpected auth path");
  };
  const config = { getD1: () => DB, runtimeEnv: () => env, publicBaseUrl: () => "https://tokvilo.com" };
  const cryptoHelpers = await load("lib/crypto.ts");
  const encryption = await load("lib/provider-settings.ts");
  const http = await load("lib/auth-http.ts", { "./auth": auth });
  const provider = await load("lib/auth-provider.ts", { "./auth": auth }, { fetch: fetcher });
  const recovery = await load("lib/password-recovery.ts", {
    "./auth": auth, "./auth-http": http, "./auth-provider": provider, "./config": config,
    "./crypto": cryptoHelpers, "./login-rate-limit": { consumeLoginAttempt: async () => options.allowed !== false },
    "./provider-settings": encryption,
  });
  const forgot = await load("app/api/auth/forgot-password/route.ts", { "@/lib/password-recovery": recovery });
  const reset = await load("app/api/auth/reset-password/route.ts", { "@/lib/password-recovery": recovery });
  function request(path, body, cookie = "", headers = {}) {
    return new Request(`https://tokvilo.com/api/auth/${path}`, {
      method: "POST", headers: { origin: "https://tokvilo.com", "content-type": "application/json", cookie, ...headers },
      body: JSON.stringify(body),
    });
  }
  return {
    sql, calls, env, options,
    changeProvider: () => { baseUrl = "https://different.supabase.co"; },
    forgot: (body = { email: "member@example.invalid" }, headers) => forgot.POST(request("forgot-password", body, "", headers)),
    reset: (body, cookie = "", headers) => reset.POST(request("reset-password", body, cookie, headers)),
    async grant(tokenHash = LINK_HASH) {
      const response = await reset.POST(request("reset-password", { tokenHash }));
      assert.equal(response.status, 200, await response.clone().text());
      const cookie = response.headers.get("set-cookie").split(";")[0];
      return { response, cookie, token: decodeURIComponent(cookie.split("=")[1]) };
    },
  };
}

test("forgot password normalizes email and hides account existence, delivery failures and per-email throttling", async t => {
  let expected;
  for (const options of [{}, { recoverStatus: 404, recoverBody: { error_code: "user_not_found" } },
    { recoverStatus: 422, recoverBody: { error_code: "email_address_not_authorized", message: "private account detail" } },
    { recoverStatus: 429 }, { transport: true }]) {
    const f = await fixture(t, options);
    const response = await f.forgot({ email: " Member@Example.Invalid " });
    assert.equal(response.status, 200);
    const value = await response.text();
    assert.doesNotMatch(value, /private|user_not_found|not_authorized/);
    expected ||= value; assert.equal(value, expected);
    assert.equal(f.calls[0].body.email, "member@example.invalid");
    assert.equal(new URL(f.calls[0].url).searchParams.get("redirect_to"), "https://tokvilo.com/reset-password");
    for (let i = 0; i < 4; i++) assert.equal(await (await f.forgot()).text(), expected);
    assert.equal(f.calls.length, 3);
    assert.doesNotMatch(JSON.stringify(f.sql.prepare("SELECT * FROM auth_recovery_email_limits").all()), /member@example/);
  }
});

test("same-origin, bounded JSON, input and IP limits are enforced before upstream calls", async t => {
  const f = await fixture(t);
  assert.equal((await f.forgot(undefined, { origin: "https://foreign.invalid" })).status, 403);
  for (const payload of [null, [], { email: {} }, { email: "invalid" }]) assert.equal((await f.forgot(payload)).status, 400);
  assert.equal((await f.forgot({ email: "x".repeat(17000) })).status, 413);
  assert.equal((await f.reset({ tokenHash: LINK_HASH }, "", { origin: "https://foreign.invalid" })).status, 403);
  assert.equal(f.calls.length, 0);
  const limited = await fixture(t, { allowed: false });
  assert.equal((await limited.forgot()).status, 429);
  assert.equal((await limited.reset({ tokenHash: LINK_HASH })).status, 429);
  assert.equal(limited.calls.length, 0);
});

test("recovery verification creates only a scoped HttpOnly 10 minute grant with encrypted upstream token", async t => {
  const f = await fixture(t), { response, cookie, token } = await f.grant();
  assert.deepEqual(await response.json(), { ok: true, ready: true });
  assert.match(token, /^[a-f0-9]{64}$/);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /Path=\/api\/auth\/reset-password; HttpOnly; SameSite=Strict; Secure; Max-Age=600/);
  assert.doesNotMatch(setCookie, /eco_geo_access|eco_geo_refresh|recovery-access-private|recovery-refresh-private/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const row = f.sql.prepare("SELECT * FROM auth_password_recovery").get();
  assert.equal(row.id, hash(token)); assert.equal(row.expires_at - row.created_at, 600);
  assert.match(row.encrypted_access_token, /^v1\./);
  assert.doesNotMatch(JSON.stringify(row), /recovery-access-private|recovery-refresh-private|aaaaaaa/);
  assert.equal((await f.reset({}, cookie)).status, 200);
  assert.equal((await f.reset({ tokenHash: LINK_HASH })).status, 401);
  assert.equal(f.calls.length, 1);
});

test("ordinary login cookies, browser access tokens and malformed payloads cannot authorize a reset", async t => {
  const f = await fixture(t);
  for (const cookie of ["", "eco_geo_access=recovery-access-private; eco_geo_refresh=refresh", RECOVERY_COOKIE + "=" + "f".repeat(64)]) {
    assert.equal((await f.reset({ password: PASSWORD }, cookie)).status, 401);
  }
  for (const payload of [{ accessToken: "forged", password: PASSWORD }, { tokenHash: LINK_HASH, password: PASSWORD },
    { tokenHash: [] }, { tokenHash: "short" }, { password: {} }, { password: "short" }, { password: "x".repeat(513) }]) {
    assert.equal((await f.reset(payload)).status, 400);
  }
  assert.equal(f.calls.length, 0);
});

test("expired or mismatched-project grants cannot call the update API", async t => {
  const f = await fixture(t), { cookie } = await f.grant();
  f.changeProvider();
  assert.equal((await f.reset({ password: PASSWORD }, cookie)).status, 401);
  const expired = await fixture(t), grant = await expired.grant();
  expired.sql.exec("UPDATE auth_password_recovery SET created_at=0,expires_at=1");
  assert.equal((await expired.reset({}, grant.cookie)).status, 401);
  assert.equal((await expired.reset({ password: PASSWORD }, grant.cookie)).status, 401);
  assert.equal(f.calls.length, 1); assert.equal(expired.calls.length, 1);
});

test("successful password update revokes all provider refresh sessions, clears all cookies and cannot replay", async t => {
  const f = await fixture(t), { cookie } = await f.grant();
  const response = await f.reset({ password: PASSWORD }, cookie);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.passwordReset, true); assert.equal(body.sessionsRevoked, true);
  assert.match(response.headers.get("set-cookie"), /tokvilo_password_recovery=;.*Max-Age=0/);
  assert.match(response.headers.get("set-cookie"), /eco_geo_access=;.*Max-Age=0/);
  assert.match(response.headers.get("set-cookie"), /eco_geo_refresh=;.*Max-Age=0/);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls[1].body, { password: PASSWORD });
  const row = f.sql.prepare("SELECT state,encrypted_access_token FROM auth_password_recovery").get();
  assert.equal(row.state, "completed"); assert.equal(row.encrypted_access_token, "");
  assert.equal((await f.reset({ password: "another-password" }, cookie)).status, 401);
  assert.equal(f.calls.length, 3);
});

test("concurrent requests for the same grant produce exactly one upstream password update", async t => {
  let release; const updateWait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { updateWait }), { cookie } = await f.grant();
  const requests = [f.reset({ password: PASSWORD }, cookie), f.reset({ password: "another-password" }, cookie)];
  await new Promise(resolve => setImmediate(resolve)); release();
  const results = await Promise.all(requests);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 401]);
  assert.equal(f.calls.filter(c => c.url.endsWith("/user")).length, 1);
});

test("independent grants for one user cannot update concurrently and old ready grants expire after success", async t => {
  let release; const updateWait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { updateWait });
  const first = await f.grant(), second = await f.grant("b".repeat(64));
  const requests = [f.reset({ password: PASSWORD }, first.cookie), f.reset({ password: "another-password" }, second.cookie)];
  await new Promise(resolve => setImmediate(resolve)); release();
  const results = await Promise.all(requests);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 401]);
  assert.equal(f.calls.filter(c => c.url.endsWith("/user")).length, 1);
  assert.deepEqual(f.sql.prepare("SELECT state FROM auth_password_recovery ORDER BY state").all().map(r => r.state), ["completed", "expired"]);
});

test("definite weak or unchanged passwords can retry within the original grant lifetime", async t => {
  for (const error_code of ["weak_password", "same_password"]) {
    const f = await fixture(t, { updateBody: { error_code, message: "private password detail" } }), { cookie } = await f.grant();
    const before = f.sql.prepare("SELECT expires_at FROM auth_password_recovery").get().expires_at;
    const failure = await f.reset({ password: PASSWORD }, cookie);
    assert.equal(failure.status, 400); assert.doesNotMatch(await failure.text(), /private/);
    assert.equal(f.sql.prepare("SELECT state FROM auth_password_recovery").get().state, "ready");
    assert.equal(f.sql.prepare("SELECT expires_at FROM auth_password_recovery").get().expires_at, before);
    f.options.updateBody = undefined;
    assert.equal((await f.reset({ password: "better-password-123" }, cookie)).status, 200);
  }
});

test("uncertain update results are consumed and never automatically sent twice", async t => {
  for (const options of [{ updateTransport: true }, { updateBody: { message: "private failure" }, updateStatus: 500 }, { updateId: "wrong-user" }]) {
    const f = await fixture(t, options), { cookie } = await f.grant();
    const response = await f.reset({ password: PASSWORD }, cookie);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "recovery_result_unknown");
    const row = f.sql.prepare("SELECT * FROM auth_password_recovery").get();
    assert.equal(row.state, "unknown"); assert.equal(row.encrypted_access_token, "");
    assert.equal((await f.reset({ password: PASSWORD }, cookie)).status, 401);
    assert.equal(f.calls.filter(c => c.url.endsWith("/user")).length, 1);
  }
});

test("logout or local receipt failure never misreports a completed password change", async t => {
  for (const options of [{ logoutFailure: true }, { receiptFailure: true }]) {
    const f = await fixture(t, options), { cookie } = await f.grant();
    const response = await f.reset({ password: PASSWORD }, cookie);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.passwordReset, true);
    assert.equal(body.sessionsRevoked, !options.logoutFailure);
    assert.equal((await f.reset({ password: PASSWORD }, cookie)).status, 401);
  }
});

test("invalid or incomplete provider verification cannot mint a recovery grant", async t => {
  for (const options of [{ verifyStatus: 403 }, { verifyBody: {} }, { verifyBody: { access_token: "partial", user: { id: "u" } } }]) {
    const f = await fixture(t, options), response = await f.reset({ tokenHash: LINK_HASH });
    assert.ok([401, 503].includes(response.status));
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(f.sql.prepare("SELECT count(*) n FROM auth_password_recovery").get().n, 0);
    assert.doesNotMatch(await response.text(), /private/);
  }
});

test("encryption configuration is checked before consuming a recovery link", async t => {
  const f = await fixture(t); f.env.ADMIN_SESSION_SECRET = "";
  const response = await f.reset({ tokenHash: LINK_HASH });
  assert.equal(response.status, 503); assert.equal(f.calls.length, 0);
  const missing = await fixture(t, { notConfigured: true });
  assert.equal((await missing.forgot()).status, 503); assert.equal(missing.calls.length, 0);
});
