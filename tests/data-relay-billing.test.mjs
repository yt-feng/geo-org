import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(path, mocks = {}, globals = {}) {
  const fileName = new URL(path, import.meta.url).pathname;
  const { outputText } = ts.transpileModule(await readFile(fileName, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const m = { exports: {} };
  vm.runInNewContext(outputText, { module: m, exports: m.exports, require(name) { if (name in mocks) return mocks[name]; throw new Error(name); },
    TextEncoder, TextDecoder, Uint8Array, URL, Response, Request, Headers, AbortSignal, crypto: webcrypto, ...globals });
  return m.exports;
}
const schema = (await Promise.all((await readdir(new URL("../drizzle/", import.meta.url))).filter(n => n.endsWith(".sql")).sort().map(n => readFile(new URL(`../drizzle/${n}`, import.meta.url), "utf8")))).join("\n");
const valuePricing = await load("../lib/value-pricing.ts", { "./official-pricing": await load("../lib/official-pricing.ts") });
const pricing = await load("../lib/pricing.ts", { "./model-id": await load("../lib/model-id.ts"), "./value-pricing": valuePricing });
const KEY = "tk_live_012345678901234567890123456789";
const FIXED = "/api/v1/twitter/web/fetch_tweet_detail";
async function fixture(t, opts = {}) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec(schema); t.after(() => sqlite.close());
  const DB = { prepare(query) {
    const stmt = sqlite.prepare(query);
    const bound = (args = []) => ({ bind(...next) { return bound(next); }, async first() { return stmt.get(...args) || null; }, async all() { return { results: stmt.all(...args) }; }, async run() { return { meta: { changes: stmt.run(...args).changes } }; } });
    return bound();
  }, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); } };
  const userId = opts.admin ? "admin" : "member";
  sqlite.prepare("INSERT INTO users(id,email,daily_limit,status) VALUES(?,?,100,'active')").run(userId, `${userId}@example.com`);
  sqlite.prepare("INSERT INTO api_keys(id,user_id,key_prefix,key_hash) VALUES('key',?,?,?)").run(userId, KEY.slice(0, 12), createHash("sha256").update(KEY).digest("hex"));
  sqlite.prepare("INSERT INTO wallet_accounts(user_id,balance_microusd) VALUES(?,?)").run(userId, opts.balance ?? 1000000);
  const wallet = await load("../lib/wallet.ts", { "./config": { getD1: () => DB } });
  const env = { UPSTREAM_PRICE_ENDPOINT: "https://price.example/info", UPSTREAM_BASE_URL: "https://upstream.example", UPSTREAM_API_TOKEN: "server-only-key", ...opts.env };
  const config = { getD1: () => DB, runtimeEnv: () => env, isServiceEnabled: () => true, numericEnv: (_name, fallback) => fallback, decimalEnv: (_name, fallback) => fallback,
    requiredEnv(name) { if (!env[name]) throw new Error("Missing config"); return env[name]; } };
  const calls = [];
  const { handleApiProxy } = await load("../lib/proxy.ts", {
    "./config": config, "./auth": { isAdminEmail: () => false }, "./pricing": pricing, "./wallet": wallet,
    "./crypto": { randomId: prefix => prefix + webcrypto.randomUUID(), sha256Hex: async value => createHash("sha256").update(value).digest("hex") },
    "./sanitize": { buildReplacements: () => [], isTextualContentType: () => false, sanitizeLocation: value => value, sanitizeText: value => value, sanitizeTextStream: value => value },
  }, { fetch: async (url, init) => {
    if (String(url).startsWith("https://price.example")) return opts.priceError ? new Response("bad", { status: 503 }) : Response.json({ data: { endpoint_cost: opts.price === undefined ? 0.001 : opts.price } });
    calls.push({ url, init });
    if (opts.fetcher) return opts.fetcher(url, init);
    return Response.json({ code: 200, data: { result: "ok" } });
  } });
  return { handle: handleApiProxy, calls, wallet, userId, sqlite };
}
function request(path = FIXED, headers = {}) { return new Request("https://tokvilo.com" + path, { headers: { Authorization: `Bearer ${KEY}`, "Idempotency-Key": "fixed-request-1", ...headers } }); }
test("verified fixed-price member data requests settle source price plus 20 percent and retain the response", async t => {
  const f = await fixture(t);
  const response = await f.handle(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.result, "ok");
  assert.equal(response.headers.get("x-tokvilo-charge-microusd"), "1200");
  assert.equal((await f.wallet.getWallet(f.userId)).balanceMicrousd, 998800);
  const replay = await f.handle(request());
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-tokvilo-replayed"), "true");
  assert.equal((await replay.json()).data.result, "ok");
  assert.equal(f.calls.length, 1);
  assert.equal(new Headers(f.calls[0].init.headers).get("Authorization"), "Bearer server-only-key");
});
test("variable-cost endpoints are unavailable and administrators use the same prepaid rates", async t => {
  for (const path of ["/api/v1/linkedin/web/get_user_profile", "/api/v1/tiktok/web/fetch_batch_check_live_alive?room_ids=1,2", "/api/v1/unknown"]) {
    const f = await fixture(t); const response = await f.handle(request(path));
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "pricing_unavailable"); assert.equal(f.calls.length, 0);
  }
  const admin = await fixture(t, { admin: true });
  assert.equal((await admin.handle(request("/api/v1/linkedin/web/get_user_profile"))).status, 503);
  assert.equal((await admin.handle(request())).status, 200);
  assert.equal((await admin.wallet.getWallet(admin.userId)).balanceMicrousd, 998800);
});
test("missing/invalid fresh price, missing key, and insufficient credit never send a paid data request", async t => {
  for (const opts of [{ priceError: true }, { price: null }, { price: 0 }, { price: -1 }, { balance: 1 }]) {
    const f = await fixture(t, opts);
    const response = await f.handle(request());
    assert.equal(response.status, opts.balance ? 402 : 503); assert.equal(f.calls.length, 0);
  }
  const f = await fixture(t);
  assert.equal((await f.handle(request(FIXED, { "Idempotency-Key": "" }))).status, 400);
  assert.equal(f.calls.length, 0);
});
test("explicit rejected data responses refund while incomplete results stay held", async t => {
  const failed = await fixture(t, { fetcher: async () => Response.json({ code: 422 }, { status: 422 }) });
  assert.equal((await failed.handle(request())).headers.get("x-tokvilo-billing-status"), "refunded");
  assert.equal((await failed.wallet.getWallet(failed.userId)).balanceMicrousd, 1000000);
  const uncertain = await fixture(t, { fetcher: async () => { throw new Error("timeout"); } });
  assert.equal((await uncertain.handle(request())).status, 502);
  assert.equal((await uncertain.wallet.getWallet(uncertain.userId)).reservedMicrousd, 1200);
  assert.equal((await uncertain.handle(request())).status, 409);
  assert.equal(uncertain.calls.length, 1);
});
test("local gateway describes prepaid pricing and known zero-cost endpoints stay free", async t => {
  const f = await fixture(t, { balance: 0 });
  const response = await f.handle(request("/api/v1/gateway/user/calculate_price"));
  const data = (await response.json()).data;
  assert.equal(data.plan, "prepaid"); assert.equal(data.markup_percent, undefined); assert.equal(data.unit_price, undefined);
  assert.doesNotMatch(JSON.stringify(data), /upstream|markup|20%/i);
  assert.equal((await f.handle(request("/api/v1/health/check", { "Idempotency-Key": "" }))).status, 200);
  assert.equal((await f.wallet.getWallet(f.userId)).balanceMicrousd, 0);
});
