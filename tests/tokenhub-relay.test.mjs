import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function loadModule(path, mocks = {}, globals = {}) {
  const filename = new URL(path, import.meta.url).pathname;
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const compiledModule = { exports: {} };
  vm.runInNewContext(outputText, {
    module: compiledModule, exports: compiledModule.exports,
    require(specifier) { if (Object.hasOwn(mocks, specifier)) return mocks[specifier]; throw new Error(`Unexpected dependency ${specifier}`); },
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Request, Response, Headers, AbortSignal,
    fetch() { throw new Error("Unexpected network request in TokenHub relay test"); }, ...globals,
  }, { filename });
  return compiledModule.exports;
}

const BASE = "https://api.eco-geo.org/api/tokenhub";
const TASKS = "/v3/contents/generations/tasks";
const PROVIDER_KEY = "sk-tokenhub-upstream-secret-never-send-to-network";
const ADMIN = { id: "admin", email: "admin@example.com", displayName: "Admin", isAdmin: true };
const VIDEO = { model: "doubao-seedance-2-0", content: [{ type: "text", text: "A still life" }], duration: 4 };
const hash = value => createHash("sha256").update(value).digest("hex");
const { ProviderError } = await loadModule("../lib/provider-settings.ts");
const pricing = await loadModule("../lib/pricing.ts", { "./model-id": await loadModule("../lib/model-id.ts") });
const amount = (value, unit = "1M tokens") => ({ amount: { currencyCode: "USD", unitsMicros: value, exactUnits: String(value / 1e6) }, display: `USD ${value / 1e6} / ${unit}` });
const PRICE_CATALOG = pricing.normalizeTokenHubPricing({ currencyCode: "USD", data: [
  { id: VIDEO.model, deployments: [{ enabled: true, pricing: { video: { withoutVideo480p: amount(7e6), withoutVideo720p: amount(7e6) } } }] },
  { id: "chat", deployments: [{ enabled: true, pricing: { input: amount(1e6), output: amount(2e6), cacheRead: amount(100000), cacheWrite: amount(0) } }] },
  { id: "image", deployments: [{ enabled: true, pricing: { fixed: { ...amount(90000, "image"), priceUnit: "image" } } }] },
] });
for (const id of ["glm-5-3-flash-260828", "glm-5-2-260617", "deepseek-v4-pro-ga-260813", "deepseek-v4-flash-ga-260731", "dola-seedream-5-0-pro-260628", "dreamina-seedance-2-0-260128", "dreamina-seedance-2-0-fast-260128", "dreamina-seedance-2-0-mini-260615", "dreamina-seedance-2-5-260628"]) {
  const source = PRICE_CATALOG.models.find(model => model.kind === (id.includes("seedance") ? "video" : id.includes("seedream") ? "image" : "chat"));
  PRICE_CATALOG.models.push({ ...source, model: id, name: id });
}
const schema = (await Promise.all((await readdir(new URL("../drizzle/", import.meta.url))).filter(name => name.endsWith(".sql")).sort().map(name => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")))).join("\n");

async function fixture(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  t.after(() => sqlite.close());
  const DB = { prepare(query) {
    const statement = sqlite.prepare(query);
    const execute = (args = []) => ({
      bind(...next) { return execute(next); },
      async first() { return statement.get(...args) || null; },
      async all() { return { success: true, results: statement.all(...args) }; },
      async run() { return { success: true, meta: { changes: statement.run(...args).changes } }; },
    });
    return execute();
  } };
  let currentUser = options.user === undefined ? ADMIN : options.user;
  const calls = [], modelCalls = [];
  const env = { DB, SERVICE_ENABLED: "true", ...options.env };
  const wallet = await loadModule("../lib/wallet.ts", { "./config": { getD1: () => DB } });
  function insertUser(user = ADMIN, status = "active") {
    sqlite.prepare("INSERT INTO users (id,email,display_name,status) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING").run(user.id, user.email, user.displayName || "", status);
    if (user.isAdmin && options.fundAdmin !== false) sqlite.prepare("INSERT INTO wallet_accounts(user_id,balance_microusd) VALUES(?,100000000) ON CONFLICT DO NOTHING").run(user.id);
  }
  function insertKey(user, key, revoked = false, status = "active") {
    insertUser(user, status);
    sqlite.prepare("INSERT INTO api_keys (id,user_id,key_prefix,key_hash,revoked_at) VALUES (?,?,?,?,?)").run(`key-${user.id}`, user.id, key.slice(0, 12), hash(key), revoked ? new Date().toISOString() : null);
  }
  const { handleTokenHubRelay, reconcileTokenHubTasks } = await loadModule("../lib/tokenhub-relay.ts", {
    "./auth": { getPortalUser: async () => { options.onSession?.(); return currentUser; }, isAdminEmail: email => email === "delegated-admin@example.com" },
    "./config": { runtimeEnv: () => env, getD1: () => DB },
    "./crypto": { sha256Hex: async value => hash(value) },
    "./store": { ensureUser: async user => insertUser(user) },
    "./provider-settings": { ProviderError },
    "./pricing": { ...pricing, getTokenHubPricing: async () => { if (options.pricingError) throw new pricing.PricingError("Live pricing unavailable"); return options.pricing || PRICE_CATALOG; } },
    "./wallet": wallet,
    "./tokenhub-settings": { TOKENHUB_ORIGIN: "https://ai-tokenhub.ai", createTokenHubSettings: () => ({ credential: async () => { options.onCredential?.(); return options.key || PROVIDER_KEY; }, models: async () => { modelCalls.push(true); if (options.modelsError) throw options.modelsError; return options.models || { models: [{ id: "chat-example", provider: "vendor", modelType: "chat" }], catalog: { complete: true } }; } }) },
  }, { fetch: async (url, init) => { calls.push({ url, init }); return options.fetcher ? options.fetcher(url, init) : Response.json({ id: "task-default", status: "queued" }); } });
  function credit(user, amount = 100_000_000) {
    insertUser(user);
    sqlite.prepare("INSERT INTO wallet_accounts(user_id,balance_microusd) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance_microusd=excluded.balance_microusd").run(user.id, amount);
  }
  return { sqlite, calls, modelCalls, wallet, credit, reconcile: options => reconcileTokenHubTasks(env, options), handle: handleTokenHubRelay, insertUser, insertKey, setUser: user => { currentUser = user; } };
}
function request(path = TASKS, options = {}) {
  const method = options.method || "POST";
  return new Request(BASE + path, {
    method,
    ...(method === "POST" ? { body: JSON.stringify(VIDEO) } : {}), ...options,
    // Allow header overrides without losing required defaults unless explicitly requested.
    headers: options.rawHeaders || { Origin: "https://api.eco-geo.org", "Content-Type": "application/json", "Idempotency-Key": "request-0001", ...options.headers },
  });
}
async function expectStatus(handle, requestValue, status) {
  const response = await handle(requestValue);
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response;
}

test("relay requires an active account, funded wallet, and same-origin browser mutations", async t => {
  for (const [user, status] of [[null, 401], [{ ...ADMIN, id: "member", isAdmin: false }, 402]]) {
    const f = await fixture(t, { user });
    await expectStatus(f.handle, request(), status);
    assert.equal(f.calls.length, 0);
  }
  const f = await fixture(t);
  await expectStatus(f.handle, request(TASKS, { headers: { Origin: "https://external.example" } }), 403);
  await expectStatus(f.handle, request(TASKS, { rawHeaders: { "Content-Type": "application/json" } }), 403);
  f.insertUser(ADMIN, "disabled");
  await expectStatus(f.handle, request(), 403);
  assert.equal(f.calls.length, 0);
  const disabled = await fixture(t, { env: { SERVICE_ENABLED: "false" } });
  await expectStatus(disabled.handle, request(), 503);
  assert.equal(disabled.calls.length, 0);
  const unfundedAdmin = await fixture(t, { fundAdmin: false });
  await expectStatus(unfundedAdmin.handle, request(), 402);
  assert.equal(unfundedAdmin.calls.length, 0);
});

const MEMBER = { id: "member-paid", email: "member@example.com", displayName: "Member", isAdmin: false };
const CHAT = { model: "chat", messages: [{ role: "user", content: "Hello" }], max_tokens: 100 };
test("a funded member pays returned chat usage at upstream plus 20%, once across retries", async t => {
  const f = await fixture(t, { user: MEMBER, fetcher: async () => Response.json({ model: "chat", choices: [{ message: { content: "Hello" } }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_tokens_details: { cached_tokens: 500 } } }) });
  f.credit(MEMBER);
  const first = await expectStatus(f.handle, request("/v1/chat/completions", { body: JSON.stringify(CHAT) }), 200);
  assert.equal((await first.json()).tokvilo_billing.chargedMicrousd, 900);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 100_000_000 - 900);
  await expectStatus(f.handle, request("/v1/chat/completions", { body: JSON.stringify(CHAT) }), 200);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 100_000_000 - 900);
  await expectStatus(f.handle, request("/v1/chat/completions", { body: JSON.stringify({ ...CHAT, max_tokens: 200 }) }), 409);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM wallet_reservations").get().n, 1);
});
test("studio and legacy URLs share the same paid request receipt and never generate twice", async t => {
  const f = await fixture(t, { user: MEMBER, fetcher: async () => Response.json({ model: "chat",
    choices: [{ message: { content: "Hello" } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }) });
  f.credit(MEMBER);
  const legacy = request("/v1/chat/completions", { body: JSON.stringify(CHAT) });
  const studio = new Request(legacy.url.replace("/api/tokenhub/", "/api/studio/"), {
    method: legacy.method, headers: legacy.headers, body: JSON.stringify(CHAT),
  });
  const first = await (await expectStatus(f.handle, studio, 200)).json();
  const repeated = await (await expectStatus(f.handle, legacy, 200)).json();
  assert.deepEqual(repeated.choices, first.choices);
  assert.deepEqual(repeated.usage, first.usage);
  assert.equal(repeated.tokvilo_billing.status, "settled");
  assert.equal(repeated.tokvilo_billing.chargedMicrousd, first.tokvilo_billing.chargedMicrousd);
  assert.equal(f.calls.length, 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM wallet_reservations").get().n, 1);
});
test("member requests require live prices and available funds before a generation call", async t => {
  const f = await fixture(t, { user: MEMBER, pricingError: true }); f.credit(MEMBER);
  await expectStatus(f.handle, request("/v1/chat/completions", { body: JSON.stringify(CHAT) }), 503);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 100_000_000);
  const poor = await fixture(t, { user: MEMBER }); poor.credit(MEMBER, 1);
  await expectStatus(poor.handle, request("/v1/chat/completions", { body: JSON.stringify(CHAT) }), 402);
  assert.equal(poor.calls.length, 0);
  assert.equal((await poor.wallet.getWallet(MEMBER.id)).balanceMicrousd, 1);
});
test("a changed price above the client reserve ceiling requires repricing without wallet or generation mutations", async t => {
  const oldQuote = pricing.quoteTokenHubRequest(PRICE_CATALOG, "chat", CHAT);
  const changed = structuredClone(PRICE_CATALOG);
  for (const rate of changed.models.find(model => model.model === "chat").rates) {
    rate.upstreamMicrousd *= 2; rate.retailMicrousd *= 2;
  }
  const f = await fixture(t, { user: MEMBER, pricing: changed, fetcher: async () => Response.json({ usage: { prompt_tokens: 10, completion_tokens: 1 } }) });
  f.credit(MEMBER);
  const refused = await expectStatus(f.handle, request("/v1/chat/completions", { body: JSON.stringify(CHAT), headers: { "X-Tokvilo-Max-Reserve-Microusd": String(oldQuote.reservedMicrousd) } }), 409);
  const error = (await refused.json()).error;
  assert.equal(error.code, "reservation_limit_exceeded");
  assert.ok(error.requiredReserveMicrousd > oldQuote.reservedMicrousd);
  assert.equal(f.calls.length, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM wallet_reservations").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM tokenhub_requests").get().n, 0);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 100_000_000);
  await expectStatus(f.handle, request("/v1/chat/completions", { body: JSON.stringify(CHAT), headers: { "X-Tokvilo-Max-Reserve-Microusd": String(error.requiredReserveMicrousd) } }), 200);
  assert.equal(f.calls.length, 1);
});
test("reserve ceiling headers reject malformed integers before credential lookup or wallet reservation", async t => {
  for (const value of ["", "0", "-1", "1.5", "1e6", "NaN", "Infinity", "9007199254740992", "1,2"]) {
    const f = await fixture(t, { user: MEMBER, onCredential: () => assert.fail("Malformed ceilings must not access provider credentials") });
    f.credit(MEMBER);
    await expectStatus(f.handle, request("/v1/chat/completions", { body: JSON.stringify(CHAT), headers: { "X-Tokvilo-Max-Reserve-Microusd": value } }), 400);
    assert.equal(f.calls.length, 0);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM wallet_reservations").get().n, 0);
  }
});
test("member image and video billing settles only evidenced output, refunds confirmed failures, and preserves unknown outcomes", async t => {
  const image = await fixture(t, { user: MEMBER, fetcher: async () => Response.json({ data: [{ url: "https://media.example/image.png" }] }) }); image.credit(MEMBER);
  const imageResponse = await expectStatus(image.handle, request("/v3/images/generations", { body: JSON.stringify({ model: "image", prompt: "A tree", n: 2 }) }), 200);
  assert.equal((await imageResponse.json()).tokvilo_billing.chargedMicrousd, 108000);
  assert.equal((await image.wallet.getWallet(MEMBER.id)).balanceMicrousd, 100_000_000 - 108000);
  const video = await fixture(t, { user: MEMBER, fetcher: async (_url, init) => Response.json(init.method === "POST" ? { id: "paid-video", status: "queued" } : { id: "paid-video", status: "succeeded", usage: { completion_tokens: 100000 } }) }); video.credit(MEMBER);
  await expectStatus(video.handle, request(), 200);
  assert.ok((await video.wallet.getWallet(MEMBER.id)).reservedMicrousd > 0);
  const final = await expectStatus(video.handle, request(`${TASKS}/paid-video`, { method: "GET" }), 200);
  assert.equal((await final.json()).tokvilo_billing.chargedMicrousd, 840000);
  await expectStatus(video.handle, request(`${TASKS}/paid-video`, { method: "GET" }), 200);
  assert.equal((await video.wallet.getWallet(MEMBER.id)).balanceMicrousd, 100_000_000 - 840000);
  const rejected = await fixture(t, { user: MEMBER, fetcher: async () => Response.json({ error: "invalid" }, { status: 422 }) }); rejected.credit(MEMBER);
  await expectStatus(rejected.handle, request("/v1/chat/completions", { body: JSON.stringify(CHAT) }), 422);
  assert.equal((await rejected.wallet.getWallet(MEMBER.id)).balanceMicrousd, 100_000_000);
  const unknown = await fixture(t, { user: MEMBER, fetcher: async () => { throw new Error("timeout"); } }); unknown.credit(MEMBER);
  await expectStatus(unknown.handle, request("/v1/chat/completions", { body: JSON.stringify(CHAT) }), 502);
  assert.ok((await unknown.wallet.getWallet(MEMBER.id)).reservedMicrousd > 0);
  await expectStatus(unknown.handle, request("/v1/chat/completions", { body: JSON.stringify(CHAT) }), 409);
  assert.equal(unknown.calls.length, 1);
});
test("unreported or above-reservation usage stays held, and tk_live keys support paid members", async t => {
  const f = await fixture(t, { user: null, fetcher: async () => Response.json({ usage: { prompt_tokens: 10000000, completion_tokens: 1 } }) });
  f.credit(MEMBER); f.insertKey(MEMBER, "tk_live_012345678901234567890123456789");
  const response = await expectStatus(f.handle, request("/v1/chat/completions", { body: JSON.stringify(CHAT), rawHeaders: { "Content-Type": "application/json", Authorization: "Bearer tk_live_012345678901234567890123456789", "Idempotency-Key": "member-key-call" } }), 200);
  assert.equal((await response.json()).tokvilo_billing.status, "pending_confirmation");
  assert.ok((await f.wallet.getWallet(MEMBER.id)).reservedMicrousd > 0);
});
test("cron settles owner-bound existing videos without sending generation and stops polling settled rows", async t => {
  const f = await fixture(t, { user: MEMBER, fetcher: async (_url, init) => Response.json(init.method === "POST" ? { id: "cron-video", status: "queued" } : { id: "cron-video", status: "succeeded", usage: { completion_tokens: 100000 } }) });
  f.credit(MEMBER);
  await expectStatus(f.handle, request(), 200);
  const result = await f.reconcile({ maxTasks: 10 });
  assert.equal(result.examined, 1); assert.equal(result.settled, 1);
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, 1);
  assert.equal(f.calls.filter(call => call.init.method === "GET").length, 1);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 100_000_000 - 840000);
  assert.equal((await f.reconcile({ maxTasks: 10 })).examined, 0);
});
test("cron uses leases, preserves unresolved holds, refunds confirmed video failures, and refuses swapped task IDs", async t => {
  for (const [replyValue, refund] of [[{ id: "cron-video", status: "failed" }, true], [{ id: "different-task", status: "failed" }, false], [{ id: "cron-video", status: "succeeded" }, false]]) {
    const f = await fixture(t, { user: MEMBER, fetcher: async (_url, init) => Response.json(init.method === "POST" ? { id: "cron-video", status: "queued" } : replyValue) });
    f.credit(MEMBER); await expectStatus(f.handle, request(), 200);
    const result = await f.reconcile();
    assert.equal(result.refunded, refund ? 1 : 0);
    assert.equal((await f.reconcile()).examined, 0);
    const state = await f.wallet.getWallet(MEMBER.id);
    assert.equal(state.reservedMicrousd === 0, refund);
    assert.equal(f.calls.length, 2);
  }
});

test("portal keys require a funded member wallet, reject revoked or inactive users, and never forward the client credential", async t => {
  const key = "eco_live_012345678901234567890123456789";
  for (const [user, revoked, status, expected] of [
    [{ ...ADMIN, id: "member", isAdmin: false }, false, "active", 402],
    [ADMIN, true, "active", 401], [ADMIN, false, "disabled", 401],
    [ADMIN, false, "active", 200],
    [{ ...ADMIN, id: "other-admin", email: "delegated-admin@example.com" }, false, "active", 200],
  ]) {
    const f = await fixture(t, { user: null, onSession: () => assert.fail("API-key requests must not require a browser session") });
    f.insertKey(user, key, revoked, status);
    await expectStatus(f.handle, request(TASKS, { rawHeaders: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": "api-key-request" } }), expected);
    if (expected === 200) {
      assert.equal(new Headers(f.calls[0].init.headers).get("Authorization"), `Bearer ${PROVIDER_KEY}`);
      assert.ok(f.sqlite.prepare("SELECT last_used_at FROM api_keys").get().last_used_at);
    } else assert.equal(f.calls.length, 0);
  }
  const f = await fixture(t);
  for (const value of ["Bearer wrong", "Basic value", `Bearer eco_live_${"x".repeat(32)}`]) await expectStatus(f.handle, request(TASKS, { headers: { Authorization: value } }), 401);
  assert.equal(f.calls.length, 0);
});

test("relay blocks unlisted upstream paths, unsupported methods and query parameters", async t => {
  const f = await fixture(t);
  for (const path of ["/v1/balance", "/v2/contents/generations/tasks", "/v3/files", `${TASKS}/invalid/task`]) await expectStatus(f.handle, request(path, { method: "GET" }), 404);
  await expectStatus(f.handle, request("/v1/models", { method: "POST" }), 405);
  await expectStatus(f.handle, request(TASKS, { method: "DELETE" }), 405);
  await expectStatus(f.handle, request("/v1/models?url=https://elsewhere.example", { method: "GET" }), 400);
  assert.equal(f.calls.length, 0);
});

test("task list, polling and cancellation are scoped to their original ECO-GEO owner", async t => {
  const f = await fixture(t, { fetcher: async (_url, init) => Response.json(init.method === "DELETE" ? { id: "owned-task", status: "cancelled" } : { id: "owned-task", status: "succeeded", content: { video_url: "https://media.example/video.mp4" } }) });
  f.insertUser();
  f.sqlite.prepare("INSERT INTO tokenhub_tasks (id,user_id,model,status) VALUES (?,?,?,?)").run("owned-task", ADMIN.id, VIDEO.model, "queued");
  f.sqlite.prepare("INSERT INTO tokenhub_tasks (id,user_id,model,status) VALUES (?,?,?,?)").run("someone-elses-task", "other", VIDEO.model, "queued");
  const list = await expectStatus(f.handle, request(TASKS, { method: "GET" }), 200);
  const listed = (await list.json()).data;
  assert.deepEqual(listed.map(row => row.id), ["owned-task"]);
  assert.match(listed[0].created_at, /T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  await expectStatus(f.handle, request(`${TASKS}/someone-elses-task`, { method: "GET" }), 404);
  await expectStatus(f.handle, request(`${TASKS}/someone-elses-task`, { method: "DELETE" }), 404);
  assert.equal(f.calls.length, 0);
  await expectStatus(f.handle, request(`${TASKS}/owned-task`, { method: "GET" }), 200);
  assert.equal(f.sqlite.prepare("SELECT status FROM tokenhub_tasks WHERE id='owned-task'").get().status, "succeeded");
  await expectStatus(f.handle, request(`${TASKS}/owned-task`, { method: "DELETE" }), 200);
  assert.equal(f.sqlite.prepare("SELECT status FROM tokenhub_tasks WHERE id='owned-task'").get().status, "cancelled");
  assert.equal(f.calls.length, 2);
});

test("an empty successful cancellation response records cancellation or deletion without inventing a terminal state", async t => {
  const f = await fixture(t, { fetcher: async () => new Response(null, { status: 204 }) });
  f.insertUser();
  f.sqlite.prepare("INSERT INTO tokenhub_tasks (id,user_id,model,status) VALUES (?,?,?,?)").run("owned-task", ADMIN.id, VIDEO.model, "queued");
  const response = await expectStatus(f.handle, request(`${TASKS}/owned-task`, { method: "DELETE" }), 200);
  assert.equal((await response.json()).status, "cancelled_or_deleted");
  assert.equal(f.sqlite.prepare("SELECT status FROM tokenhub_tasks WHERE id='owned-task'").get().status, "cancelled_or_deleted");
  assert.equal(f.calls.length, 1);
});

test("a video request retries from its persisted result and rejects changed payload reuse", async t => {
  const f = await fixture(t, { fetcher: async () => Response.json({ id: "task-durable", status: "queued" }, { status: 201 }) });
  const first = await expectStatus(f.handle, request(), 201);
  const retry = await expectStatus(f.handle, request(), 201);
  const firstData = await first.json(), retryData = await retry.json();
  assert.equal(retryData.id, firstData.id);
  assert.equal(retryData.status, firstData.status);
  await expectStatus(f.handle, request(TASKS, { body: JSON.stringify({ ...VIDEO, duration: 5 }) }), 409);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://ai-tokenhub.ai/api/v3/contents/generations/tasks");
  assert.equal(f.calls[0].init.redirect, "manual");
  assert.equal(f.calls[0].init.cache, "no-store");
  assert.equal(f.sqlite.prepare("SELECT calls FROM usage_daily WHERE user_id=?").get(ADMIN.id).calls, 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM tokenhub_tasks").get().n, 1);
});

test("concurrent duplicate videos reserve once and preserve an unresolved submission after transport failure", async t => {
  let complete;
  let started;
  const sent = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { fetcher: async () => { started(); return new Promise(resolve => { complete = resolve; }); } });
  const first = f.handle(request());
  await sent;
  await expectStatus(f.handle, request(), 409);
  complete(Response.json({ id: "task-concurrent", status: "queued" }));
  assert.equal((await first).status, 200);
  await expectStatus(f.handle, request(), 200);
  assert.equal(f.calls.length, 1);
  const uncertain = await fixture(t, { fetcher: async () => { throw new TypeError("Connection failed"); } });
  await expectStatus(uncertain.handle, request(), 502);
  await expectStatus(uncertain.handle, request(), 409);
  assert.equal(uncertain.calls.length, 1);
  const row = uncertain.sqlite.prepare("SELECT response_json,status_code FROM tokenhub_requests").get();
  assert.equal(row.response_json, null);
  assert.equal(row.status_code, null);
});

test("malformed or missing task responses stay reserved instead of repeating a possibly paid request", async t => {
  for (const response of [() => new Response("not json"), () => Response.json({ status: "queued" }), () => new Response("x".repeat(8_000_001))]) {
    const f = await fixture(t, { fetcher: async () => response() });
    await expectStatus(f.handle, request(), 502);
    await expectStatus(f.handle, request(), 409);
    assert.equal(f.calls.length, 1);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM tokenhub_tasks").get().n, 0);
  }
});

test("invalid content, oversized bodies, streaming and missing idempotency keys never reach generation", async t => {
  const cases = [
    [TASKS, { rawHeaders: { Origin: "https://api.eco-geo.org", "Content-Type": "text/plain" } }, 415],
    [TASKS, { body: "{" }, 400], [TASKS, { body: "[]" }, 400],
    [TASKS, { body: JSON.stringify({ ...VIDEO, content: [] }) }, 400],
    [TASKS, { body: JSON.stringify({ ...VIDEO, duration: 16 }) }, 400],
    [TASKS, { body: JSON.stringify({ ...VIDEO, model: "" }) }, 400],
    [TASKS, { body: JSON.stringify({ ...VIDEO, extra: "x".repeat(1_000_000) }) }, 413],
    [TASKS, { headers: { "Idempotency-Key": "short" } }, 400],
    [TASKS, { body: JSON.stringify({ ...VIDEO, stream: true }) }, 400],
    ["/v3/images/generations", { body: JSON.stringify({ model: "image", prompt: "test", stream: true }) }, 400],
    ["/v1/chat/completions", { body: JSON.stringify({ model: "chat", messages: [{ role: "user", content: "test" }], stream: true }) }, 400],
  ];
  for (const [path, options, status] of cases) {
    const f = await fixture(t);
    await expectStatus(f.handle, request(path, options), status);
    assert.equal(f.calls.length, 0);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM tokenhub_requests").get().n, 0);
  }
});

test("upstream credentials are redacted recursively including JSON-escaped strings before response and cache storage", async t => {
  const key = 'sk-upstream-secret-with-"quote\\slash';
  const payload = { id: "task-redaction", status: "queued", nested: [{ message: `echo ${key}`, [key]: key }], metadata: { key } };
  const f = await fixture(t, { key, fetcher: async () => Response.json(payload) });
  const response = await expectStatus(f.handle, request(), 200);
  const data = await response.json();
  assert.equal(data.nested[0].message, "echo [redacted]");
  assert.equal(data.nested[0]["[redacted]"], "[redacted]");
  assert.equal(data.metadata.key, "[redacted]");
  const cached = JSON.parse(f.sqlite.prepare("SELECT response_json FROM tokenhub_requests").get().response_json);
  assert.deepEqual(cached, data);
});

test("upstream redirects are rejected without forwarding credentials or redirecting the caller", async t => {
  const f = await fixture(t, { fetcher: async () => Response.json({ destination: "https://untrusted.example" }, { status: 302, headers: { location: "https://untrusted.example" } }) });
  const response = await expectStatus(f.handle, request(TASKS), 502);
  assert.equal(response.headers.get("location"), null);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.redirect, "manual");
  assert.ok(!JSON.stringify(await response.json()).includes(PROVIDER_KEY));
});

test("write throttling stops paid requests at five per minute while reads retain their separate allowance", async t => {
  const f = await fixture(t, { fetcher: async () => Response.json({ result: "ok" }) });
  for (let index = 0; index < 5; index++) await expectStatus(f.handle, request("/v3/images/generations", { body: JSON.stringify({ model: "image", prompt: "test" }), headers: { "Idempotency-Key": `image-request-${index}` } }), 200);
  await expectStatus(f.handle, request("/v3/images/generations", { body: JSON.stringify({ model: "image", prompt: "test" }) }), 429);
  await expectStatus(f.handle, request("/v1/models", { method: "GET" }), 200);
  assert.equal(f.calls.length, 5); assert.equal(f.modelCalls.length, 1);
  f.sqlite.prepare("UPDATE login_rate_limits SET expires_at='2000-01-01T00:00:00.000Z'").run();
  await expectStatus(f.handle, request("/v3/images/generations", { body: JSON.stringify({ model: "image", prompt: "test" }) }), 200);
});

test("ECO-GEO model API returns the merged catalog envelope and rejects discovery errors without raw-model fallback", async t => {
  const ids = ["glm-5-3-flash-260828", "glm-5-2-260617", "deepseek-v4-pro-ga-260813", "deepseek-v4-flash-ga-260731", "dola-seedream-5-0-pro-260628", "dreamina-seedance-2-0-260128", "dreamina-seedance-2-0-fast-260128", "dreamina-seedance-2-0-mini-260615", "dreamina-seedance-2-5-260628"];
  const models = { models: ids.map(id => ({ id, provider: "tokenhub", sources: ["pricing"], accountAccess: "unverified_public_catalog" })), catalog: { complete: true } };
  const f = await fixture(t, { models, onCredential: () => assert.fail("Model discovery handles its own credential verification") });
  const response = await expectStatus(f.handle, request("/v1/models", { method: "GET" }), 200), data = await response.json();
  assert.equal(data.object, "list"); assert.deepEqual(data.data.map(model => model.id), ids);
  assert.ok(data.data.every(model => model.object === "model" && model.owned_by === "tokenhub")); assert.equal(data.catalog.complete, true);
  assert.equal(f.modelCalls.length, 1); assert.equal(f.calls.length, 0);
  const failed = await fixture(t, { modelsError: new ProviderError("Credential invalid", 422) });
  await expectStatus(failed.handle, request("/v1/models", { method: "GET" }), 422); assert.equal(failed.calls.length, 0);
});

test("all nine current TokenHub model IDs forward their exact bodies through the matching ECO-GEO API adapters", async t => {
  const examples = [
    ...["glm-5-3-flash-260828", "glm-5-2-260617", "deepseek-v4-pro-ga-260813", "deepseek-v4-flash-ga-260731"].map(model => ({ path: "/v1/chat/completions", body: { model, messages: [{ role: "user", content: "Return OK" }], stream: false, max_tokens: 8 } })),
    { path: "/v3/images/generations", body: { model: "dola-seedream-5-0-pro-260628", prompt: "A red cube", size: "2K", response_format: "url", watermark: false } },
    ...["dreamina-seedance-2-0-260128", "dreamina-seedance-2-0-fast-260128", "dreamina-seedance-2-0-mini-260615", "dreamina-seedance-2-5-260628"].map(model => ({ path: TASKS, body: { model, content: [{ type: "text", text: "A blue ball rolls" }], duration: 4, resolution: "480p", ratio: "16:9", generate_audio: false, watermark: false } })),
  ];
  for (const { path, body } of examples) {
    const f = await fixture(t, { fetcher: async () => Response.json(path === TASKS ? { id: "verified-adapter-task", status: "queued", model: body.model } : { model: body.model, data: [] }) });
    const response = await expectStatus(f.handle, request(path, { body: JSON.stringify(body) }), 200);
    assert.equal((await response.json()).model, body.model); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, `https://ai-tokenhub.ai/api${path}`); assert.deepEqual(JSON.parse(f.calls[0].init.body), body);
    assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${PROVIDER_KEY}`);
    if (path === TASKS) {
      assert.equal(f.sqlite.prepare("SELECT model FROM tokenhub_tasks").get().model, body.model);
      await expectStatus(f.handle, request(path, { body: JSON.stringify(body) }), 200); assert.equal(f.calls.length, 1);
    }
  }
});


test("receipt recovery is owner-scoped, read-only, and available without funds, credentials or an enabled service", async t => {
  const f = await fixture(t, { user: MEMBER, env: { SERVICE_ENABLED: "false" }, onCredential: () => { throw Error("Must not read provider credentials"); } });
  f.insertUser(MEMBER);
  f.sqlite.prepare("INSERT INTO tokenhub_requests(user_id,idempotency_key,request_hash,response_json,status_code) VALUES(?,?,?,?,?)")
    .run(MEMBER.id, "receipt-0001", "hash", JSON.stringify({ choices: [{ message: { content: "Saved answer" } }] }), 200);
  const before = await f.wallet.getWallet(MEMBER.id);
  const response = await expectStatus(f.handle, request("/v1/requests/receipt-0001", { method: "GET" }), 200);
  assert.match(await response.text(), /Saved answer/);
  assert.deepEqual(await f.wallet.getWallet(MEMBER.id), before);
  assert.equal(f.calls.length, 0);
  f.setUser({ ...MEMBER, id: "different-owner", email: "different@example.com" });
  const absent = await expectStatus(f.handle, request("/v1/requests/receipt-0001", { method: "GET" }), 404);
  assert.equal((await absent.json()).error.code, "request_not_found");
  f.setUser(MEMBER);
  f.sqlite.prepare("UPDATE tokenhub_requests SET response_json=NULL,status_code=NULL WHERE idempotency_key=?").run("receipt-0001");
  const pending = await expectStatus(f.handle, request("/v1/requests/receipt-0001", { method: "GET" }), 409);
  assert.equal((await pending.json()).error.code, "outcome_pending");
  assert.equal(f.calls.length, 0);
});
