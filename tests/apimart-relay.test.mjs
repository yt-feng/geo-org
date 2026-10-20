import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(path, mocks = {}, globals = {}) {
  const filename = new URL(path, import.meta.url).pathname;
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const compiled = { exports: {} };
  vm.runInNewContext(outputText, {
    module: compiled, exports: compiled.exports,
    require(specifier) { if (Object.hasOwn(mocks, specifier)) return mocks[specifier]; throw Error(`Unexpected dependency: ${specifier}`); },
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, URL, Request, Response, Headers, AbortSignal,
    fetch() { throw Error("Unexpected network request"); }, ...globals,
  }, { filename });
  return compiled.exports;
}
const { ProviderError } = await load("../lib/provider-settings.ts");
const pricing = await load("../lib/pricing.ts");
const apimart = await load("../lib/apimart-pricing.ts", { "./pricing": pricing });
const SOURCE = { success: true, data: { models: {
  llm: [{ id: "gpt-5", name: "GPT 5", pricing: { unit: "usd_per_million_tokens", pricing_mode: "standard", tier_count: 1, effective_rates: { input: 1, cached_input: 0.1, output: 8 } } }],
  image: [{ id: "gpt-image-2", name: "GPT Image 2", fixed_prices: { unit: "usd_per_image", dimension: "resolution", items: [{ key: "default", after_discount: 0.0085 }, { key: "1K", after_discount: 0.0085 }, { key: "2K", after_discount: 0.015 }, { key: "4K", after_discount: 0.022 }] } }],
} } };
const CATALOG = apimart.parseApimartPricing(SOURCE);
const MEMBER = { id: "member", email: "member@example.com", displayName: "Member", isAdmin: false };
const KEY = "sk-provider-test-secret";
const CHAT = { model: "gpt-5", messages: [{ role: "user", content: "hello" }], max_completion_tokens: 100, stream: false };
const IMAGE = { model: "gpt-image-2", prompt: "A tree", resolution: "2k", n: 1 };
const CHAT_PATH = "/v1/chat/completions", IMAGE_PATH = "/v1/images/generations";
const hash = value => createHash("sha256").update(value).digest("hex");
const schema = (await Promise.all((await readdir(new URL("../drizzle/", import.meta.url))).filter(name => name.endsWith(".sql")).sort().map(name => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")))).join("\n");

async function fixture(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec(schema); t.after(() => sqlite.close());
  const DB = { prepare(query) {
    const statement = sqlite.prepare(query);
    const bind = (args = []) => ({
      bind(...next) { return bind(next); },
      async first() { return statement.get(...args) || null; },
      async all() { return { results: statement.all(...args), success: true }; },
      async run() { return { success: true, meta: { changes: statement.run(...args).changes } }; },
    });
    return bind();
  } };
  const wallet = await load("../lib/wallet.ts", { "./config": { getD1: () => DB } });
  function user(value = MEMBER, status = "active") {
    sqlite.prepare("INSERT INTO users(id,email,display_name,status) VALUES(?,?,?,?) ON CONFLICT DO NOTHING").run(value.id, value.email, value.displayName, status);
  }
  function credit(value = MEMBER, amount = 1_000_000) {
    user(value); sqlite.prepare("INSERT INTO wallet_accounts(user_id,balance_microusd) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance_microusd=excluded.balance_microusd").run(value.id, amount);
  }
  credit();
  let currentUser = options.user === undefined ? MEMBER : options.user;
  const calls = [];
  const env = { DB, SERVICE_ENABLED: "true", ...options.env };
  const { handleApimartRelay, reconcileApimartTasks } = await load("../lib/apimart-relay.ts", {
    "./auth": { getPortalUser: async () => currentUser },
    "./config": { runtimeEnv: () => env, getD1: () => DB },
    "./crypto": { sha256Hex: async value => hash(value) },
    "./store": { ensureUser: async value => user(value) },
    "./provider-settings": { ProviderError, createProviderSettings: () => ({ credential: async () => KEY, models: async () => ({ models: [{ id: "gpt-5", provider: "openai" }] }) }) },
    "./pricing": pricing, "./wallet": wallet,
    "./apimart-pricing": { ...apimart, getApimartPricing: async () => { if (options.priceFailure) throw new pricing.PricingError("Unavailable"); return options.pricingCatalog || CATALOG; } },
  }, { fetch: async (url, init) => { calls.push({ url, init }); return options.fetcher ? options.fetcher(url, init) : Response.json({ code: 200, data: { choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 20, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 10 } } } }); } });
  return { handle: handleApimartRelay, reconcile: () => reconcileApimartTasks(env, { maxTasks: 10 }), calls, sqlite, wallet, credit, user, setUser: value => { currentUser = value; } };
}
function request(path = CHAT_PATH, options = {}) {
  const method = options.method || "POST";
  return new Request("https://tokvilo.com/api/apimart" + path, {
    method, ...(method === "POST" ? { body: JSON.stringify(path === IMAGE_PATH ? IMAGE : CHAT) } : {}), ...options,
    headers: options.rawHeaders || { Origin: "https://tokvilo.com", "Content-Type": "application/json", "Idempotency-Key": "request-0001", ...options.headers },
  });
}
async function expect(f, req, status) {
  const res = await f.handle(req); assert.equal(res.status, status, await res.clone().text());
  assert.equal(res.headers.get("cache-control"), "private, no-store"); return res.json();
}

test("official APIMart prices receive exactly 20% markup and unsupported billing stays unavailable", () => {
  const image = CATALOG.models.find(model => model.model === "gpt-image-2");
  assert.equal(image.rates.find(rate => rate.dimension === "2k").retailMicrousd, 18000);
  const altered = structuredClone(SOURCE);
  altered.data.models.llm[0].pricing.tier_count = 2;
  const parsed = apimart.parseApimartPricing(altered);
  assert.equal(parsed.models.length, 1); assert.equal(parsed.unavailable[0].model, "gpt-5");
  assert.throws(() => apimart.quoteApimartRequest({ ...IMAGE, resolution: "8k" }, IMAGE_PATH, CATALOG));
  const quote = apimart.quoteApimartRequest(CHAT, CHAT_PATH, CATALOG);
  assert.equal(apimart.apimartChatCharge(quote, { usage: { prompt_tokens: 20, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 10 } } }), 110);
  assert.throws(() => apimart.apimartChatCharge(quote, { usage: { prompt_tokens: 20, completion_tokens: 101 } }));
  assert.throws(() => apimart.apimartTaskCharge({ credits_cost: 1 }));
  assert.throws(() => apimart.apimartChatCharge(quote, { model: "different", usage: { prompt_tokens: 20, completion_tokens: 10 } }));
  assert.throws(() => apimart.apimartChatCharge(quote, { usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 99 } }));
  const branded = structuredClone(SOURCE);
  branded.data.models.llm[0].name = "APIMart GPT 5";
  const publicModel = apimart.parseApimartPricing(branded).models.find(model => model.model === "gpt-5");
  assert.equal(publicModel.name, "tokvilo 文本与图像 GPT 5");
  assert.equal(publicModel.provider, "apimart");
  assert.equal(publicModel.model, "gpt-5");
  assert.deepEqual(publicModel.rates, CATALOG.models.find(model => model.model === "gpt-5").rates);
});

test("member chat uses the documented /api path and settles once from real usage including cache", async t => {
  const f = await fixture(t);
  const first = await expect(f, request(), 200), repeat = await expect(f, request(), 200);
  assert.deepEqual(first, repeat); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://api.apimart.ai/api/v1/chat/completions");
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(JSON.parse(f.calls[0].init.body).max_tokens, 100);
  assert.equal(JSON.parse(f.calls[0].init.body).max_completion_tokens, undefined);
  assert.equal(first.tokvilo_billing.status, "settled"); assert.equal(first.tokvilo_billing.chargedMicrousd, 110);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 999890);
  await expect(f, request(CHAT_PATH, { body: JSON.stringify({ ...CHAT, temperature: 0.1 }) }), 409);
  assert.equal(f.calls.length, 1);
});
test("gateway and legacy URLs replay a shared receipt without a second paid request", async t => {
  const f = await fixture(t);
  const legacy = request();
  const gateway = new Request(legacy.url.replace("/api/apimart/", "/api/gateway/"), {
    method: legacy.method, headers: legacy.headers, body: JSON.stringify(CHAT),
  });
  const first = await expect(f, gateway, 200);
  const repeated = await expect(f, legacy, 200);
  assert.deepEqual(repeated, first);
  assert.equal(f.calls.length, 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM wallet_reservations").get().n, 1);
});

test("anonymous, disabled accounts, cross-origin mutations, revoked keys and insufficient balances never generate", async t => {
  const anonymous = await fixture(t, { user: null }); await expect(anonymous, request(), 401);
  const f = await fixture(t);
  await expect(f, request(CHAT_PATH, { headers: { Origin: "https://elsewhere.example" } }), 403);
  f.credit(MEMBER, 0); await expect(f, request(), 402);
  assert.equal(f.calls.length, 0); assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM apimart_requests").get().n, 0);
  f.sqlite.prepare("UPDATE users SET status='disabled' WHERE id=?").run(MEMBER.id);
  await expect(f, request(), 403);
  assert.equal(f.calls.length, 0);
});

test("tokvilo and legacy API keys authenticate members without forwarding caller credentials", async t => {
  for (const prefix of ["tk_live_", "eco_live_"]) {
    const f = await fixture(t, { user: null });
    const key = prefix + "1".repeat(32);
    f.sqlite.prepare("INSERT INTO api_keys(id,user_id,key_prefix,key_hash) VALUES(?,?,?,?)").run("key1", MEMBER.id, prefix, hash(key));
    await expect(f, request(CHAT_PATH, { rawHeaders: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": "key-request" } }), 200);
    assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${KEY}`);
    assert.ok(f.sqlite.prepare("SELECT last_used_at FROM api_keys").get().last_used_at);
    f.sqlite.prepare("UPDATE api_keys SET revoked_at=CURRENT_TIMESTAMP").run();
    await expect(f, request(CHAT_PATH, { headers: { Authorization: `Bearer ${key}` } }), 401);
  }
});

test("image task ownership and cost settlement survive polling and return reserve difference exactly once", async t => {
  const f = await fixture(t, { fetcher: async (_url, init) => Response.json(init.method === "POST" ? { code: 200, data: [{ task_id: "image_task", status: "submitted" }] } : { code: 200, data: { id: "image_task", status: "completed", cost: 0.014, result: { images: [] } } }) });
  const submitted = await expect(f, request(IMAGE_PATH), 200);
  assert.equal(submitted.tokvilo_billing.reservedMicrousd, 18000);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 982000);
  const other = { ...MEMBER, id: "other", email: "other@example.com" }; f.user(other); f.setUser(other);
  await expect(f, request("/v1/tasks/image_task", { method: "GET" }), 404);
  assert.equal(f.calls.length, 1);
  f.setUser(MEMBER);
  const done = await expect(f, request("/v1/tasks/image_task", { method: "GET" }), 200);
  assert.equal(done.tokvilo_billing.chargedMicrousd, 16800);
  await expect(f, request("/v1/tasks/image_task", { method: "GET" }), 200);
  assert.equal(f.calls.length, 2); assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 983200);
  const replay = await expect(f, request(IMAGE_PATH), 200); assert.equal(replay.tokvilo_billing.status, "settled"); assert.equal(replay.tokvilo_billing.chargedMicrousd, 16800);
});

test("failed image tasks refund once; task responses cannot swap another task ID", async t => {
  let wrong = true;
  const f = await fixture(t, { fetcher: async (_url, init) => Response.json(init.method === "POST" ? { data: [{ task_id: "image_task", status: "submitted" }] } : { data: { id: wrong ? "other" : "image_task", status: "failed" } }) });
  await expect(f, request(IMAGE_PATH), 200);
  await expect(f, request("/v1/tasks/image_task", { method: "GET" }), 502);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).reservedMicrousd, 18000);
  wrong = false;
  const data = await expect(f, request("/v1/tasks/image_task", { method: "GET" }), 200);
  assert.equal(data.tokvilo_billing.status, "refunded"); assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 1_000_000);
});

test("network uncertainty, malformed responses and redirects retain reservations and do not resend", async t => {
  for (const fetcher of [
    async () => { throw Error("Timeout"); },
    async () => new Response("invalid"),
    async () => Response.json({}, { status: 302, headers: { location: "https://bad.example" } }),
    async () => Response.json({ data: [] }),
  ]) {
    const f = await fixture(t, { fetcher });
    await expect(f, request(IMAGE_PATH), 502); await expect(f, request(IMAGE_PATH), 409);
    assert.equal(f.calls.length, 1); assert.equal((await f.wallet.getWallet(MEMBER.id)).reservedMicrousd, 18000);
    assert.equal(f.calls[0].init.redirect, "manual");
  }
});

test("explicit upstream client failures refund while unknown server outcomes retain the hold", async t => {
  for (const status of [400, 402, 429, 500]) {
    const f = await fixture(t, { fetcher: async () => Response.json({ error: { message: "failed" } }, { status }) });
    const result = await expect(f, request(), status);
    assert.equal(result.tokvilo_billing.status, status < 500 ? "refunded" : "awaiting_reconciliation");
    await expect(f, request(), status); assert.equal(f.calls.length, 1);
  }
});

test("missing usage or over-budget task cost returns output with pending settlement instead of invented charges", async t => {
  const chat = await fixture(t, { fetcher: async () => Response.json({ choices: [{ message: { content: "output" } }] }) });
  const res = await expect(chat, request(), 200); assert.equal(res.tokvilo_billing.status, "awaiting_reconciliation");
  assert.ok((await chat.wallet.getWallet(MEMBER.id)).reservedMicrousd > 0);
  const image = await fixture(t, { fetcher: async (_url, init) => Response.json(init.method === "POST" ? { data: [{ task_id: "image_task" }] } : { data: { id: "image_task", status: "completed", cost: 2 } }) });
  await expect(image, request(IMAGE_PATH), 200);
  const done = await expect(image, request("/v1/tasks/image_task", { method: "GET" }), 200);
  assert.equal(done.tokvilo_billing.status, "awaiting_reconciliation");
  assert.equal((await image.wallet.getWallet(MEMBER.id)).reservedMicrousd, 18000);
});

test("unknown routes, streaming, unknown price dimensions and paid extra options are blocked before upstream", async t => {
  for (const [path, options, status] of [
    ["/v1/balance", { method: "GET" }, 404],
    ["/v1/videos/generations", {}, 404],
    ["/v1/models?target=https://elsewhere.example", { method: "GET" }, 400],
    [CHAT_PATH, { body: JSON.stringify({ ...CHAT, stream: true }) }, 400],
    [CHAT_PATH, { body: JSON.stringify({ ...CHAT, tools: [] }) }, 400],
    [IMAGE_PATH, { body: JSON.stringify({ ...IMAGE, n: 2 }) }, 400],
    [IMAGE_PATH, { body: JSON.stringify({ ...IMAGE, resolution: "1.5k" }) }, 422],
    [CHAT_PATH, { headers: { "Idempotency-Key": "short" } }, 400],
  ]) {
    const f = await fixture(t); await expect(f, request(path, options), status); assert.equal(f.calls.length, 0);
  }
  const fail = await fixture(t, { priceFailure: true }); await expect(fail, request(), 503); assert.equal(fail.calls.length, 0);
});

test("upstream credentials are removed recursively before storage and response", async t => {
  const f = await fixture(t, { fetcher: async () => Response.json({ data: { choices: [{ message: { content: KEY } }], usage: { prompt_tokens: 1, completion_tokens: 1 }, [KEY]: KEY } }) });
  const result = await expect(f, request(), 200);
  assert.ok(!JSON.stringify(result).includes(KEY));
  assert.ok(!f.sqlite.prepare("SELECT response_json FROM apimart_requests").get().response_json.includes(KEY));
});

test("concurrent duplicate requests create one paid upstream operation", async t => {
  let release, started;
  const sent = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { fetcher: async () => { started(); return new Promise(resolve => { release = resolve; }); } });
  const pending = f.handle(request(IMAGE_PATH)); await sent;
  await expect(f, request(IMAGE_PATH), 409);
  release(Response.json({ data: [{ task_id: "once", status: "submitted" }] }));
  assert.equal((await pending).status, 200); assert.equal(f.calls.length, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM wallet_reservations").get().n, 1);
});

test("scheduled reconciliation settles only recorded owner tasks without issuing paid requests", async t => {
  const f = await fixture(t, { fetcher: async (_url, init) => Response.json(init.method === "POST"
    ? { data: [{ task_id: "cron_task", status: "submitted" }] }
    : { data: { id: "cron_task", status: "completed", cost: 0.015 } }) });
  await expect(f, request(IMAGE_PATH), 200);
  const result = await f.reconcile();
  assert.equal(result.completed, 1); assert.equal(result.checked, 1);
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, 1);
  assert.equal(f.calls.filter(call => call.init.method === "GET").length, 1);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 982000);
  await f.reconcile(); assert.equal(f.calls.length, 2);
  assert.equal(f.sqlite.prepare("SELECT poll_count FROM apimart_tasks").get().poll_count, 1);
});

test("pending scheduled queries have a five-minute lease and a bounded retry count", async t => {
  const f = await fixture(t, { fetcher: async (_url, init) => Response.json(init.method === "POST"
    ? { data: [{ task_id: "pending_task", status: "submitted" }] }
    : { data: { id: "pending_task", status: "processing" } }) });
  await expect(f, request(IMAGE_PATH), 200);
  await f.reconcile(); await f.reconcile();
  assert.equal(f.calls.length, 2);
  f.sqlite.prepare("UPDATE apimart_tasks SET next_poll_at='2000-01-01',poll_count=288").run();
  await f.reconcile(); assert.equal(f.calls.length, 2);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).reservedMicrousd, 18000);
});

test("a higher recalculated reservation is rejected before creating receipts, holds or upstream requests", async t => {
  const increased = structuredClone(SOURCE);
  increased.data.models.image[0].fixed_prices.items.find(item => item.key === "2K").after_discount = 0.02;
  const f = await fixture(t, { pricingCatalog: apimart.parseApimartPricing(increased) });
  const response = await expect(f, request(IMAGE_PATH, { headers: { "X-Tokvilo-Max-Reserve-Microusd": "18000" } }), 409);
  assert.equal(response.error.code, "reservation_limit_exceeded"); assert.equal(response.reservedMicrousd, 24000);
  assert.equal(f.calls.length, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM apimart_requests").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM wallet_reservations").get().n, 0);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 1_000_000);
});

test("reservation caps accept exact ceilings, retain original receipts and reject malformed amounts", async t => {
  const f = await fixture(t, { fetcher: async () => Response.json({ data: [{ task_id: "ceiling_task", status: "submitted" }] }) });
  await expect(f, request(IMAGE_PATH, { headers: { "X-Tokvilo-Max-Reserve-Microusd": "18000" } }), 200);
  await expect(f, request(IMAGE_PATH, { headers: { "X-Tokvilo-Max-Reserve-Microusd": "0" } }), 200);
  assert.equal(f.calls.length, 1);
  for (const value of ["", "0", "-1", "1.5", "1e6", "NaN", "1000000000001", "9007199254740992"]) {
    const malformed = await fixture(t);
    await expect(malformed, request(CHAT_PATH, { headers: { "X-Tokvilo-Max-Reserve-Microusd": value } }), 400);
    assert.equal(malformed.calls.length, 0);
    assert.equal(malformed.sqlite.prepare("SELECT COUNT(*) AS n FROM wallet_reservations").get().n, 0);
    assert.equal(malformed.sqlite.prepare("SELECT COUNT(*) AS n FROM apimart_requests").get().n, 0);
  }
});
