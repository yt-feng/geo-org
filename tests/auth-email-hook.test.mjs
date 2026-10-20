import assert from "node:assert/strict";
import { createHash, createHmac, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const secret = Buffer.alloc(32, 0x71);
const payload = {
  user: { id: "8484b834-f29e-4af2-bf42-80644d154f76", email: "qa-auth@example.invalid" },
  email_data: {
    email_action_type: "signup", token_hash: "7d5b7b1964cf5d388340a7f04f1dbb5eeb6c7b52ef8270e1737a58d0",
    token: "305805", site_url: "https://attacker.invalid", redirect_to: "https://attacker.invalid/capture",
  },
};
const source = await readFile(new URL("../lib/auth-email-hook.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const schema = await readFile(new URL("../drizzle/0016_auth_email_hook.sql", import.meta.url), "utf8");
function signedRequest(input = payload, options = {}) {
  const body = typeof input === "string" ? input : JSON.stringify(input);
  const id = options.id || "msg_auth_test_001";
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", options.secret || secret).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Request("https://tokvilo.com/api/auth/email-hook", {
    method: options.method || "POST",
    headers: {
      "content-type": "application/json", "webhook-id": id, "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`, ...options.headers,
    },
    ...((options.method || "POST") === "POST" ? { body: options.actualBody ?? body } : {}),
  });
}
async function fixture(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec(schema); t.after(() => sqlite.close());
  const DB = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    const bind = (values = []) => ({
      bind: (...next) => bind(next), first: async () => statement.get(...values) || null,
      run: async () => ({ success: true, meta: { changes: statement.run(...values).changes } }),
    });
    return bind();
  } };
  const sent = [], timers = [];
  const env = {
    DB, AUTH_BASE_URL: "https://qa-project.supabase.co",
    AUTH_EMAIL_HOOK_SECRET: `v1,whsec_${secret.toString("base64")}`,
    AUTH_EMAIL: { send: async message => { sent.push(message); return options.send?.(message); } },
    ...options.env,
  };
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    module: mod, exports: mod.exports, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array,
    Request, Response, URL, URLSearchParams, atob, btoa, clearTimeout,
    Date: options.now === undefined ? Date : class extends Date { static now() { return options.now; } },
    setTimeout(callback, delay) { timers.push(delay); return setTimeout(callback, options.fastTimeout && delay === 3000 ? 5 : delay); },
    require(name) {
      if (name === "./config") return { runtimeEnv: () => env };
      if (name === "./crypto") return { sha256Hex: async value => createHash("sha256").update(value).digest("hex") };
      if (name === "cloudflare:email") return { EmailMessage: class {
        constructor(from, to, raw) { Object.assign(this, { from, to, raw }); }
      } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { ...mod.exports, sqlite, env, sent, timers };
}
async function expect(f, request, status) {
  const response = await f.handleAuthEmailHook(request);
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json();
  if (status !== 200) assert.equal(result.error.http_code, status);
  return result;
}
function assertNoSideEffects(f) {
  assert.equal(f.sent.length, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM auth_email_hook_messages").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM auth_email_deliveries").get().n, 0);
}

test("signed signup delivers one fixed-origin confirmation and stores only hashes and state", async t => {
  const f = await fixture(t);
  assert.deepEqual(await expect(f, signedRequest(JSON.stringify(payload, null, 2)), 200), {});
  assert.equal(f.sent.length, 1);
  const message = f.sent[0], [headers, encoded] = message.raw.split("\r\n\r\n");
  assert.equal(message.from, "auth@tokvilo.com"); assert.equal(message.to, payload.user.email);
  assert.match(headers, /Message-ID: <auth\.[a-f0-9]{64}@tokvilo\.com>/);
  const text = Buffer.from(encoded.replaceAll("\r\n", ""), "base64").toString("utf8");
  const url = new URL(text.match(/https:\/\/\S+/)[0]);
  assert.equal(url.origin, f.env.AUTH_BASE_URL);
  assert.equal(url.pathname, "/auth/v1/verify");
  assert.equal(url.searchParams.get("type"), "signup");
  assert.equal(url.searchParams.get("token"), payload.email_data.token_hash);
  assert.equal(url.searchParams.get("redirect_to"), "https://tokvilo.com/login?verified=1");
  assert.doesNotMatch(text, /attacker\.invalid|305805/);
  const stored = JSON.stringify([
    f.sqlite.prepare("SELECT * FROM auth_email_hook_messages").all(),
    f.sqlite.prepare("SELECT * FROM auth_email_deliveries").all(),
  ]);
  assert.doesNotMatch(stored, new RegExp(`${payload.user.email}|${payload.email_data.token_hash}|305805`));
  assert.equal(f.sqlite.prepare("SELECT status FROM auth_email_deliveries").get().status, "sent");
});

test("forged signatures and changed raw bytes, identifiers or timestamps cannot write or send", async t => {
  const timestamp = Math.floor(Date.now() / 1000);
  const f = await fixture(t, { now: timestamp * 1000 });
  const sign = (input, options = {}) => signedRequest(input, { timestamp, ...options });
  const bad = Buffer.alloc(32).toString("base64");
  for (const request of [
    sign(payload, { secret: Buffer.alloc(32, 0x72) }),
    sign(payload, { headers: { "webhook-signature": "" } }),
    sign(payload, { headers: { "webhook-signature": `v2,${bad}` } }),
    sign(payload, { headers: { "webhook-signature": `v1,${bad}` } }),
    sign(payload, { headers: { "webhook-id": "msg_changed" } }),
    sign(payload, { headers: { "webhook-timestamp": String(timestamp - 1) } }),
    sign(payload, { actualBody: JSON.stringify(payload, null, 2) }),
    sign(payload, { timestamp: timestamp - 301 }),
    sign(payload, { timestamp: timestamp + 301 }),
    sign(payload, { headers: { "webhook-timestamp": "1e9" } }),
    sign(payload, { headers: { "webhook-signature": "v1,invalid ".repeat(300) } }),
  ]) await expect(f, request, 401);
  assertNoSideEffects(f);
});

test("standard-webhooks accepts a valid v1 rotation candidate and supported secret encodings", async t => {
  for (const configured of [`v1,whsec_${secret.toString("base64")}`, `whsec_${secret.toString("base64")}`, secret.toString("base64")]) {
    const f = await fixture(t, { env: { AUTH_EMAIL_HOOK_SECRET: configured } });
    const original = signedRequest(), headers = new Headers(original.headers);
    headers.set("webhook-signature", `v1,${Buffer.alloc(32).toString("base64")} ${headers.get("webhook-signature")}`);
    await expect(f, new Request(original, { headers }), 200);
  }
});

test("signed recovery uses only the tokvilo reset page and cannot be confused with signup", async t => {
  const f = await fixture(t);
  const recovery = { ...payload, email_data: { ...payload.email_data, email_action_type: "recovery" } };
  await expect(f, signedRequest(recovery), 200);
  await expect(f, signedRequest(recovery, { id: "msg_recovery_retry" }), 200);
  assert.equal(f.sent.length, 1);
  const [headers, encoded] = f.sent[0].raw.split("\r\n\r\n");
  assert.match(headers, /Subject: Reset your tokvilo password/);
  const text = Buffer.from(encoded.replaceAll("\r\n", ""), "base64").toString("utf8");
  const url = new URL(text.match(/https:\/\/\S+/)[0]);
  assert.equal(url.origin, "https://tokvilo.com");
  assert.equal(url.pathname, "/reset-password");
  const fragment = new URLSearchParams(url.hash.slice(1));
  assert.equal(fragment.get("type"), "recovery");
  assert.equal(fragment.get("token_hash"), payload.email_data.token_hash);
  assert.equal(url.search, "");
  assert.doesNotMatch(text, /attacker\.invalid|305805|access_token|refresh_token/);
  await expect(f, signedRequest(payload, { id: "msg_separate_signup" }), 200);
  assert.equal(f.sent.length, 2);
});

test("unsupported actions, unsafe recipient and malformed or oversized bodies never send", async t => {
  const f = await fixture(t);
  for (const action of ["email_change", "magiclink", "invite"]) {
    const result = await expect(f, signedRequest({ ...payload, email_data: { ...payload.email_data, email_action_type: action } }), 422);
    assert.equal(result.error.code, "unsupported_email_action");
  }
  for (const input of [
    { ...payload, user: { ...payload.user, email: "qa@example.invalid\r\nBcc: other@example.invalid" } },
    { ...payload, email_data: { ...payload.email_data, token_hash: "hash&redirect_to=https://attacker.invalid" } },
    {}, "not-json", "[]",
  ]) await expect(f, signedRequest(input), 400);
  await expect(f, signedRequest("x".repeat(65537)), 413);
  await expect(f, signedRequest(payload, { headers: { "content-type": "text/plain" } }), 415);
  await expect(f, signedRequest(payload, { method: "GET" }), 405);
  assertNoSideEffects(f);
});

test("missing configuration and an invalid configured auth origin cannot send", async t => {
  for (const env of [
    { AUTH_EMAIL: undefined }, { DB: undefined }, { AUTH_EMAIL_HOOK_SECRET: "" },
    { AUTH_EMAIL_HOOK_SECRET: "whsec_c2hvcnQ=" }, { AUTH_BASE_URL: "https://attacker.invalid" },
    { AUTH_BASE_URL: "https://qa-project.supabase.co/evil" },
    { AUTH_BASE_URL: "https://user@qa-project.supabase.co" },
    { AUTH_BASE_URL: "http://qa-project.supabase.co" },
  ]) {
    const f = await fixture(t, { env }); await expect(f, signedRequest(), 503); assertNoSideEffects(f);
  }
});

test("successful retries and a different webhook ID for the same confirmation never resend", async t => {
  const f = await fixture(t);
  await expect(f, signedRequest(), 200);
  await expect(f, signedRequest(), 200);
  await expect(f, signedRequest(payload, { id: "msg_retry_new_id" }), 200);
  await expect(f, signedRequest({ ...payload, user: { ...payload.user, email: "different@example.invalid" } }), 409);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM auth_email_deliveries").get().n, 1);
});

test("concurrent deliveries have one owner and a sent receipt can later be replayed", async t => {
  let finish;
  const f = await fixture(t, { send: () => new Promise(resolve => { finish = resolve; }) });
  const first = f.handleAuthEmailHook(signedRequest());
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const second = await expect(f, signedRequest(), 503);
  assert.equal(second.error.code, "email_delivery_unconfirmed"); assert.equal(f.sent.length, 1);
  finish();
  assert.equal((await first).status, 200);
  await expect(f, signedRequest(), 200); assert.equal(f.sent.length, 1);
});

test("unconfirmed sends do not repeat, and no provider diagnostic or recipient escapes", async t => {
  const f = await fixture(t, { send: () => { throw Error(`provider diagnostic ${payload.user.email} ${payload.email_data.token}`); } });
  const result = await expect(f, signedRequest(), 503);
  assert.doesNotMatch(JSON.stringify(result), /provider diagnostic|qa-auth|305805/);
  await expect(f, signedRequest(), 503);
  await expect(f, signedRequest(payload, { id: "msg_retry_unknown" }), 503);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sqlite.prepare("SELECT status FROM auth_email_deliveries").get().status, "unknown");
  // A newly issued confirmation token is a new delivery, without clearing history.
  await expect(f, signedRequest({ ...payload, email_data: { ...payload.email_data, token_hash: "b".repeat(56) } }, { id: "msg_fresh_token" }), 503);
  assert.equal(f.sent.length, 2);
});

test("sending is bounded within the Supabase hook timeout and remains unconfirmed", async t => {
  const f = await fixture(t, { fastTimeout: true, send: () => new Promise(() => {}) });
  await expect(f, signedRequest(), 503);
  assert.ok(f.timers.includes(3000));
  assert.equal(f.sqlite.prepare("SELECT status FROM auth_email_deliveries").get().status, "unknown");
  await expect(f, signedRequest(), 503); assert.equal(f.sent.length, 1);
});
