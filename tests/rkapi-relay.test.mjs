import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(path, mocks = {}, globals = {}) {
  const filename = new URL(path, import.meta.url).pathname, mod = { exports: {} };
  const code = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, crypto: webcrypto, structuredClone, TextEncoder, TextDecoder, Uint8Array, URL, Request, Response, Headers, AbortSignal, setTimeout, clearTimeout,
    require(name) { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; }, fetch() { throw Error("Unexpected network"); }, ...globals }, { filename });
  return mod.exports;
}
const snapshot = JSON.parse(await readFile(new URL("../lib/rkapi-catalog-snapshot.json", import.meta.url), "utf8"));
const modelIds = await load("../lib/model-id.ts");
const common = await load("../lib/pricing.ts", { "./model-id": modelIds });
const provider = await load("../lib/provider-settings.ts");
const dependencies = { "./pricing": common, "./rkapi-catalog-snapshot.json": { default: snapshot } };
const requestTools = await load("../lib/rkapi-request.ts", dependencies);
const conversion = { cnyPerQuota: 0.2, cnyPerUsd: 7.3, observedAt: snapshot.observedAt };
const KEY = "sk-rkapi-test-secret-only";
const group = "codex", MODEL = "gpt-6.1-sol";
const route = { group, apiKey: KEY, groupVerifiedAt: snapshot.observedAt, crossGroupRetry: false, modelIds: [MODEL] };
const settings = await load("../lib/rkapi-settings.ts", { ...dependencies, "./config": { runtimeEnv: () => ({}) } });
const math = await load("../lib/rkapi-pricing.ts", { ...dependencies, "./config": { runtimeEnv: () => ({}) }, "./rkapi-request": requestTools,
  "./rkapi-settings": { getRkapiConversion: async () => conversion, verifiedRkapiRoutes: async () => [route] } });
const body = { model: MODEL, messages: [{ role: "user", content: "hello" }], max_tokens: 100 };
const model = id => snapshot.models.find(model => model.id === id);
const quote = (id = MODEL, group = "codex", content = "hello") => math.createRkapiQuote(requestTools.normalizeRkapiRequest({ ...body, model: id, messages: [{ role: "user", content }] }), model(id), group, conversion);
function response(extra = {}) { return { model: MODEL, choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, prompt_tokens_details: { cached_tokens: 5, cache_write_tokens: 0 } }, ...extra }; }

test("cash conversion applies fixed group and 20% once; public rates never reinterpret quota dollars", () => {
  assert.equal(snapshot.models.length, 32); assert.equal(snapshot.models.filter(model => model.adapter).length, 30);
  assert.equal(math.rkapiAmount([{ count: 1_000_000, rateCny: "0.4" }], { groupRatio: 2, conversion }), Math.ceil(0.4 * 2 / 7.3 * 1.2 * 1_000_000));
  assert.equal(math.rkapiAmount([{ count: 1, rateCny: "0.1", unit: "call" }], { groupRatio: 1, conversion }), 16439);
  const changed = { ...conversion, cnyPerQuota: 0.4 };
  assert.equal(math.rkapiAmount([{ count: 1_000_000, rateCny: "0.4" }], { groupRatio: 2, conversion: changed }), Math.ceil(0.4 * 2 * 2 / 7.3 * 1.2 * 1_000_000));
  assert.equal(math.rkapiAmount([{ count: 1, rateCny: "0.000001" }, { count: 1, rateCny: "0.000001" }], { groupRatio: 1, conversion }), 1, "final total rounds once");
});
test("fixed groups, explicit allowlists and current snapshots are required before dispatch", async () => {
  assert.deepEqual(Array.from(settings.parseRkapiRoutes(undefined)), []);
  assert.equal(settings.parseRkapiRoutes(JSON.stringify({ routes: [route] })).length, 1);
  for (const invalid of [{ ...route, group: "auto" }, { ...route, crossGroupRetry: true }, { ...route, groupVerifiedAt: "" }, { ...route, modelIds: ["claude-opus-5"] }, { ...route, apiKey: "" }]) assert.throws(() => settings.parseRkapiRoutes(JSON.stringify({ routes: [invalid] })));
  const permitted = await settings.verifiedRkapiRoutes({ RKAPI_ROUTES_JSON: JSON.stringify({ routes: [route] }) }, async () => Response.json({ data: [{ id: MODEL }] }));
  assert.equal(permitted.length, 1);
  const invisible = await settings.verifiedRkapiRoutes({ RKAPI_ROUTES_JSON: JSON.stringify({ routes: [route] }) }, async () => Response.json({ data: [{ id: "other" }] }));
  assert.equal(invisible.length, 0);
  assert.equal(math.rkapiSnapshotCurrent(Date.parse(snapshot.expiresAt)), false);
  assert.equal(math.rkapiSnapshotCurrent(Date.parse(snapshot.observedAt) - 1), false);
  assert.equal(math.rkapiSnapshotCurrent(Date.parse(snapshot.observedAt) + 1), true);
});
test("request bounds reject streams, media, tools, parallel outputs and unsupported images before charging", () => {
  for (const extra of [{ stream: true }, { n: 2 }, { tools: [{}] }, { max_tokens: 4097 }, { max_tokens: 100, max_completion_tokens: 100 },
    { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/x" } }] }] }, { messages: [{ role: "user", content: "a".repeat(33000) }] }]) assert.throws(() => requestTools.normalizeRkapiRequest({ ...body, ...extra }));
  assert.throws(() => requestTools.normalizeRkapiRequest({ model: "gpt-image-2.5", prompt: "test" }));
  assert.throws(() => requestTools.normalizeRkapiRequest({ model: "gpt-image-2", prompt: "test", size: "4096x4096" }));
  assert.throws(() => requestTools.normalizeRkapiRequest({ model: "gpt-image-2", prompt: "test", response_format: "b64_json" }));
  assert.equal(requestTools.normalizeRkapiRequest({ model: "gpt-image-2", prompt: "test" }).response_format, "url");
});
test("cache buckets and context tiers settle once; absent or inconsistent usage keeps the hold", () => {
  const q = quote();
  assert.equal(math.settleRkapiResponse(q.basis, response()), Math.ceil((15 * 0.4 + 5 * 0.02 + 10 * 2) * 2 / 7.3 * 1.2));
  assert.ok(math.settleRkapiResponse(q.basis, response()) <= q.quote.reservedMicrousd);
  for (const change of [
    { usage: undefined }, { model: "wrong" },
    { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } },
    { usage: { ...response().usage, prompt_tokens_details: {} } },
    { usage: { ...response().usage, cache_read_input_tokens: 10 } },
    { usage: { ...response().usage, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_creation_tokens: 10 } } },
    { usage: { ...response().usage, completion_tokens_details: { audio_tokens: 10 } } },
    { usage: { ...response().usage, prompt_tokens_details: { cached_tokens: 19, cache_write_tokens: 2 } } },
  ]) assert.throws(() => math.settleRkapiResponse(q.basis, response(change)), common.PricingError);
  const long = { ...q.basis, inputTokenLimit: 300_000 };
  const one = amount => response({ usage: { prompt_tokens: amount, completion_tokens: 10, total_tokens: amount + 10, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } });
  assert.equal(math.settleRkapiResponse(long, one(272000)), Math.ceil((272000 * 0.4 + 10 * 2) * 2 / 7.3 * 1.2));
  assert.equal(math.settleRkapiResponse(long, one(272001)), Math.ceil((272001 * 0.8 + 10 * 4) * 2 / 7.3 * 1.2));
});

const schema = (await Promise.all((await readdir(new URL("../drizzle/", import.meta.url))).filter(name => name.endsWith(".sql")).sort().map(name => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")))).join("\n");
const MEMBER = { id: "member", email: "qa@example.invalid", displayName: "QA" };
const hash = value => createHash("sha256").update(value).digest("hex");
async function fixture(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec(schema); t.after(() => sqlite.close());
  let failRead = options.failReservationRead === true, failResultWrite = options.failResultWrite === true, failFinalWrite = options.failFinalWrite === true, reservationReads = 0;
  const DB = { prepare(query) { const statement = sqlite.prepare(query); const bind = (args = []) => ({ bind(...args) { return bind(args); },
    async first() { if (query === "SELECT * FROM wallet_reservations WHERE user_id=? AND request_id=?") { reservationReads++; if (failRead || options.failSettlementRead && reservationReads === 3) { failRead = false; throw Error("injected read failure after committed wallet mutation"); } } return statement.get(...args) || null; }, async all() { return { results: statement.all(...args) }; }, async run() {
      if (failResultWrite && query.includes("SET response_json=?,status_code=200,state='unknown'")) { failResultWrite = false; throw Error("injected initial result persistence failure"); }
      if (failFinalWrite && query.includes("SET response_json=?,status_code=?,state=?,updated_at")) { failFinalWrite = false; throw Error("injected final state persistence failure after charge"); }
      return { meta: { changes: statement.run(...args).changes } }; } }); return bind(); } };
  function user(value = MEMBER) { sqlite.prepare("INSERT INTO users(id,email,display_name,status) VALUES(?,?,?,'active') ON CONFLICT DO NOTHING").run(value.id, value.email, value.displayName); }
  user(); sqlite.prepare("INSERT INTO wallet_accounts(user_id,balance_microusd) VALUES(?,?)").run(MEMBER.id, options.balance ?? 1000000);
  const wallet = await load("../lib/wallet.ts", { "./config": { getD1: () => DB } });
  const env = { DB, SERVICE_ENABLED: "true" }; let currentUser = options.anonymous ? null : MEMBER; const calls = [];
  const relay = await load("../lib/rkapi-relay.ts", {
    "./auth": { getPortalUser: async () => currentUser }, "./config": { getD1: () => DB, runtimeEnv: () => env }, "./crypto": { sha256Hex: async value => hash(value) },
    "./store": { ensureUser: async value => user(value) }, "./provider-settings": provider, "./pricing": common, "./wallet": wallet,
    "./rkapi-settings": { RKAPI_ORIGIN: "https://rkapi.com" }, "./rkapi-request": requestTools,
    "./rkapi-pricing": { ...math, prepareRkapiRequest: async value => ({ body: requestTools.normalizeRkapiRequest(value), route, ...quote() }) },
  }, { fetch: async (url, init) => { calls.push({ url, init }); return options.fetcher ? options.fetcher(url, init) : Response.json(response({ cost: 123, source_price: 456 })); } });
  return { ...relay, calls, sqlite, wallet, user, setUser: value => { currentUser = value; } };
}
function request(path = "/v1/chat/completions", options = {}) { const method = options.method || "POST"; return new Request("https://tokvilo.com/api/selected" + path, {
  method, ...(method === "POST" ? { body: JSON.stringify(body) } : {}), ...options, headers: { Origin: "https://tokvilo.com", "Content-Type": "application/json", "Idempotency-Key": "selected-test-001", ...options.headers },
}); }
async function expect(f, request, status) { const res = await f.handleRkapiRelay(request); assert.equal(res.status, status, await res.clone().text()); return res.json(); }
test("wallet settles once, same request replays without generation, and public output hides source metadata", async t => {
  const f = await fixture(t), result = await expect(f, request(), 200), replay = await expect(f, request(), 200);
  assert.deepEqual(replay, result); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, "https://rkapi.com/v1/chat/completions");
  assert.equal(result.tokvilo_billing.status, "settled"); assert.doesNotMatch(JSON.stringify(result), /source_price|cost|groupRatio|rkapi|sk-rkapi/);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 1000000 - result.tokvilo_billing.chargedMicrousd);
  await expect(f, request("/v1/chat/completions", { body: JSON.stringify({ ...body, temperature: 0.2 }) }), 409);
  assert.equal(f.calls.length, 1);
});
test("unknown send outcomes and missing usage never replay or release the original hold", async t => {
  for (const fetcher of [async () => { throw Error("timeout"); }, async () => new Response("bad-json"), async () => Response.json({}, { status: 302 }), async () => Response.json(response({ usage: undefined }))]) {
    const f = await fixture(t, { fetcher }); const first = await f.handleRkapiRelay(request()); const payload = await first.json();
    assert.equal(payload.tokvilo_billing.status, "awaiting_reconciliation");
    const repeat = await f.handleRkapiRelay(request()); assert.equal(repeat.status, first.status); assert.equal(f.calls.length, 1);
    assert.ok((await f.wallet.getWallet(MEMBER.id)).reservedMicrousd > 0);
  }
});
test("known rejected requests refund once; auth, ownership, low balance and quote cap prevent sends", async t => {
  const rejected = await fixture(t, { fetcher: async () => Response.json({ error: { message: KEY + " upstream error" } }, { status: 429 }) });
  const result = await expect(rejected, request(), 429); assert.equal(result.tokvilo_billing.status, "refunded");
  assert.equal((await rejected.wallet.getWallet(MEMBER.id)).balanceMicrousd, 1000000); await expect(rejected, request(), 429); assert.equal(rejected.calls.length, 1);
  const anon = await fixture(t, { anonymous: true }); await expect(anon, request(), 401); assert.equal(anon.calls.length, 0);
  const poor = await fixture(t, { balance: 0 }); await expect(poor, request(), 402); assert.equal(poor.calls.length, 0); assert.equal(poor.sqlite.prepare("SELECT count(*) AS n FROM rkapi_requests").get().n, 0);
  const f = await fixture(t); await expect(f, request("/v1/chat/completions", { headers: { Origin: "https://evil.invalid" } }), 403);
  await expect(f, request("/v1/chat/completions", { headers: { "X-Tokvilo-Max-Reserve-Microusd": "1" } }), 409); assert.equal(f.calls.length, 0);
  await expect(f, request(), 200);
  const other = { ...MEMBER, id: "other", email: "other@example.invalid" }; f.user(other); f.setUser(other);
  await expect(f, request("/v1/requests/selected-test-001", { method: "GET" }), 404); assert.equal(f.calls.length, 1);
});
test("a committed reservation followed by a read failure is refunded without losing its receipt", async t => {
  const f = await fixture(t, { failReservationRead: true });
  const first = await expect(f, request(), 503), repeated = await expect(f, request(), 503);
  assert.deepEqual(repeated, first); assert.equal(first.tokvilo_billing.status, "refunded");
  assert.equal(f.calls.length, 0); assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 1000000);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM rkapi_requests").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT status FROM wallet_reservations").get().status, "refunded");
});
test("result persistence faults preserve generated content before and after wallet settlement", async t => {
  for (const mode of ["failResultWrite", "failFinalWrite"]) {
    const f = await fixture(t, { [mode]: true });
    const first = await expect(f, request(), 200), replay = await expect(f, request(), 200);
    assert.equal(first.choices[0].message.content, "Hello"); assert.equal(replay.choices[0].message.content, "Hello");
    assert.equal(f.calls.length, 1);
    assert.equal(replay.tokvilo_billing.status, mode === "failFinalWrite" ? "settled" : "awaiting_reconciliation");
    assert.equal(f.sqlite.prepare("SELECT status FROM wallet_reservations").get().status, mode === "failFinalWrite" ? "settled" : "reserved");
  }
});
test("settlement committed before a read failure is reported from the durable wallet row", async t => {
  const f = await fixture(t, { failSettlementRead: true });
  const first = await expect(f, request(), 200), replay = await expect(f, request(), 200);
  assert.equal(first.tokvilo_billing.status, "settled"); assert.deepEqual(replay, first);
  assert.equal(f.sqlite.prepare("SELECT state FROM rkapi_requests").get().state, "completed"); assert.equal(f.calls.length, 1);
});

test("images only settle HTTPS URL results and reject inline payloads before reserving", async t => {
  const imageBody = { model: "gpt-image-2", prompt: "test", response_format: "url" };
  const q = math.createRkapiQuote(requestTools.normalizeRkapiRequest(imageBody), model("gpt-image-2"), "gpt-image-2", conversion);
  assert.equal(math.settleRkapiResponse(q.basis, { data: [{ url: "https://images.example.invalid/generated.png" }] }), 16439);
  for (const item of [{ b64_json: "a".repeat(32) }, { url: "http://images.example.invalid/image.png" }, { url: "https://images.example.invalid/image.png", b64_json: "a".repeat(32) }]) {
    assert.throws(() => math.settleRkapiResponse(q.basis, { data: [item] }), common.PricingError);
  }
  const f = await fixture(t);
  await expect(f, request("/v1/images/generations", { body: JSON.stringify({ ...imageBody, response_format: "b64_json" }) }), 400);
  assert.equal(f.calls.length, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM wallet_reservations").get().n, 0);
  assert.doesNotMatch(JSON.stringify(f.publicRkapiResponse({ data: [{ b64_json: "inline-payload" }] })), /b64_json|inline-payload/);
});
