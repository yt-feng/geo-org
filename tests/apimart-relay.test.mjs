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
    crypto: webcrypto, structuredClone, TextEncoder, TextDecoder, Uint8Array, URL, Request, Response, Headers, AbortSignal,
    fetch() { throw Error("Unexpected network request"); }, ...globals,
  }, { filename });
  return compiled.exports;
}
const { ProviderError } = await load("../lib/provider-settings.ts");
const modelIds = await load("../lib/model-id.ts");
const kinds = await load("../lib/model-request-kind.ts");
const pricing = await load("../lib/pricing.ts", { "./model-id": modelIds });
const imageOptions = await load("../lib/apimart-image-options.ts");
const midjourney = await load("../lib/apimart-midjourney.ts", { "./pricing": pricing });
const videoOptions = await load("../lib/apimart-video-options.ts");
const videoRequest = await load("../lib/apimart-video-request.ts", { "./pricing": pricing, "./apimart-video-options": videoOptions });
const requestTools = await load("../lib/apimart-request.ts", { "./pricing": pricing, "./model-id": modelIds, "./model-request-kind": kinds, "./apimart-video-options": videoOptions, "./apimart-video-request": videoRequest, "./apimart-midjourney": midjourney, "./apimart-image-options": imageOptions });
const textPricing = await load("../lib/apimart-text-pricing.ts", { "./pricing": pricing, "./model-request-kind": kinds });
const apimart = await load("../lib/apimart-pricing.ts", { "./pricing": pricing, "./apimart-request": requestTools, "./apimart-text-pricing": textPricing, "./apimart-midjourney": midjourney });
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
  let credentialReads = 0, pricingReads = 0;
  const env = { DB, SERVICE_ENABLED: "true", ...options.env };
  const { handleApimartRelay, reconcileApimartTasks } = await load("../lib/apimart-relay.ts", {
    "./auth": { getPortalUser: async () => currentUser },
    "./config": { runtimeEnv: () => env, getD1: () => DB },
    "./crypto": { sha256Hex: async value => hash(value) },
    "./store": { ensureUser: async value => user(value) },
    "./provider-settings": { ProviderError, createProviderSettings: () => ({ credential: async () => { credentialReads++; if (options.credentialFailure) throw new ProviderError("Unavailable"); return KEY; }, models: async () => ({ models: [{ id: "gpt-5", provider: "openai" }] }) }) },
    "./pricing": pricing, "./wallet": wallet, "./apimart-request": requestTools, "./model-id": modelIds,
    "./apimart-pricing": { ...apimart, getApimartPricing: async () => { pricingReads++; if (options.priceFailure) throw new pricing.PricingError("Unavailable"); return options.pricingCatalog || CATALOG; } },
  }, { fetch: async (url, init) => { calls.push({ url, init }); return options.fetcher ? options.fetcher(url, init) : Response.json({ code: 200, data: { choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 20, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 10 } } } }); } });
  return { handle: handleApimartRelay, reconcile: () => reconcileApimartTasks(env, { maxTasks: 10 }), calls, sqlite, wallet, credit, user, env,
    credentialReads: () => credentialReads, pricingReads: () => pricingReads, setUser: value => { currentUser = value; } };
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
  assert.equal(publicModel.name, "tokvilo 模型服务 GPT 5");
  assert.equal(publicModel.provider, "apimart");
  assert.equal(publicModel.model, "gpt-5");
  assert.deepEqual(publicModel.rates, CATALOG.models.find(model => model.model === "gpt-5").rates);
});

test("public model catalogue exposes retail rates without internal price snapshots", async t => {
  const f = await fixture(t);
  const result = await expect(f, request("/v1/models", { method: "GET" }), 200);
  assert.equal(result.data[0].pricing.rates[0].retailMicrousd, 1200000);
  assert.doesNotMatch(JSON.stringify(result), /upstreamMicrousd|upstreamRates|markupPercent|after_discount|sourceUrl/);
  assert.equal(f.calls.length, 0);
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
  f.credit(MEMBER, 0); const insufficient = await expect(f, request(), 402);
  assert.equal(insufficient.error.code, "insufficient_balance");
  assert.equal(insufficient.error.message, "可用余额不足，请先充值。");
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
  assert.equal(done.data.cost, undefined);
  assert.equal(done.tokvilo_billing.markupPercent, undefined);
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
    const publicStatus = status === 402 ? 503 : status;
    const result = await expect(f, request(), publicStatus);
    assert.equal(result.tokvilo_billing.status, status < 500 ? "refunded" : "awaiting_reconciliation");
    await expect(f, request(), publicStatus); assert.equal(f.calls.length, 1);
  }
});

test("service account balance and credential failures refund once and expose no private diagnostics", async t => {
  for (const status of [401, 402, 403]) {
    const privateMessage = "[token_id=105092] insufficient balance (current: 0.044204 USD, required: 0.050000 USD). APIMart token sk-private-service-diagnostic";
    const f = await fixture(t, { fetcher: async () => Response.json({ error: { message: privateMessage, type: "apimart_error", token_id: 105092 },
      internal_balance: 0.044204, provider: "apimart", diagnostic: privateMessage }, { status }) });
    const first = await expect(f, request(), 503);
    assert.deepEqual(first.error, {
      code: status === 402 ? "service_balance_unavailable" : "service_authentication_unavailable",
      message: "生成服务暂不可用，本次未扣费。请稍后重试或联系支持。",
    });
    assert.equal(first.tokvilo_billing.status, "refunded");
    assert.equal(first.tokvilo_billing.chargedMicrousd, 0);
    assert.deepEqual(Object.keys(first).sort(), ["error", "tokvilo_billing"]);
    assert.doesNotMatch(JSON.stringify(first), /105092|0\.044204|0\.050000|apimart|token_id|private-service|internal_balance|diagnostic/i);
    const saved = f.sqlite.prepare("SELECT response_json,status_code FROM apimart_requests").get();
    assert.equal(saved.status_code, 503);
    assert.doesNotMatch(saved.response_json, /105092|0\.044204|apimart|private-service/i);
    const repeated = await expect(f, request(), 503);
    assert.deepEqual(repeated, first);
    assert.equal(f.calls.length, 1);
    const wallet = await f.wallet.getWallet(MEMBER.id);
    assert.equal(wallet.balanceMicrousd, 1_000_000);
    assert.equal(wallet.reservedMicrousd, 0);
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM wallet_reservations").get().n, 1);
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM wallet_ledger").get().n, 2, "one reserve and one refund, including replay");
  }
});

test("older service failure receipts are projected on replay without another request or wallet mutation", async t => {
  const f = await fixture(t, { fetcher: async () => Response.json({ error: { message: "old source balance details" } }, { status: 402 }) });
  const first = await expect(f, request(), 503);
  f.sqlite.prepare("UPDATE apimart_requests SET status_code=402,response_json=?").run(JSON.stringify({ error: {
    message: "[token_id=105092] insufficient balance (current: 0.044204 USD, required: 0.050000 USD)", type: "apimart_error",
  }, tokvilo_billing: first.tokvilo_billing }));
  const repeated = await expect(f, request(), 503);
  assert.deepEqual(repeated, first);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 1_000_000);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM wallet_ledger").get().n, 2);
});

test("GET receipt recovery returns an owned result even with zero funds and service configuration unavailable", async t => {
  const options = {};
  const f = await fixture(t, options);
  const first = await expect(f, request(), 200);
  f.credit(MEMBER, 0);
  options.credentialFailure = true; options.priceFailure = true; f.env.SERVICE_ENABLED = "false";
  const before = { credentials: f.credentialReads(), prices: f.pricingReads(), ledger: f.sqlite.prepare("SELECT count(*) n FROM wallet_ledger").get().n };
  for (const base of ["apimart", "gateway"]) {
    const res = await expect(f, new Request(`https://tokvilo.com/api/${base}/v1/requests/request-0001`), 200);
    assert.deepEqual(res, first);
  }
  assert.equal(f.calls.length, 1, "recovery never sends a second generation or polls upstream");
  assert.equal(f.credentialReads(), before.credentials);
  assert.equal(f.pricingReads(), before.prices);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM wallet_ledger").get().n, before.ledger);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 0);
});

test("GET receipt recovery retains uncertain reservations and isolates owners", async t => {
  const f = await fixture(t, { fetcher: async () => { throw Error("Timeout"); } });
  f.credit(MEMBER, 18000);
  await expect(f, request(IMAGE_PATH), 502);
  const pending = await expect(f, request("/v1/requests/request-0001", { method: "GET" }), 409);
  assert.equal(pending.error.code, "outcome_pending");
  assert.equal(pending.tokvilo_billing.status, "awaiting_reconciliation");
  assert.equal(pending.tokvilo_billing.reservedMicrousd, 18000);
  assert.equal(pending.tokvilo_billing.chargedMicrousd, null);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM wallet_ledger").get().n, 1);
  const other = { ...MEMBER, id: "other", email: "other@example.com" }; f.user(other); f.setUser(other);
  const hidden = await expect(f, request("/v1/requests/request-0001", { method: "GET" }), 404);
  assert.equal(hidden.error.code, "request_not_found");
  assert.equal(hidden.tokvilo_billing, undefined);
  f.setUser(MEMBER);
  const absent = await expect(f, request("/v1/requests/missing-request", { method: "GET" }), 404);
  assert.equal(absent.error.code, "request_not_found");
  f.setUser(null);
  await expect(f, request("/v1/requests/request-0001", { method: "GET" }), 401);
  assert.equal(f.calls.length, 1);
  assert.equal(f.sqlite.prepare("SELECT status FROM wallet_reservations").get().status, "reserved");
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM wallet_ledger").get().n, 1);
});

test("GET receipt recovery reads current settlement and projects legacy service errors", async t => {
  const f = await fixture(t, { fetcher: async () => Response.json({ error: { message: "private service balance" } }, { status: 402 }) });
  const first = await expect(f, request(), 503);
  f.sqlite.prepare("UPDATE apimart_requests SET status_code=402,response_json=?").run(JSON.stringify({
    error: { message: "APIMart token_id=105092 balance 0.044204", type: "apimart_error" },
    tokvilo_billing: { status: "reserved", chargedMicrousd: null, reservedMicrousd: first.tokvilo_billing.reservedMicrousd, currency: "USD" },
  }));
  const recovered = await expect(f, request("/v1/requests/request-0001", { method: "GET" }), 503);
  assert.deepEqual(recovered, first);
  assert.equal(f.calls.length, 1);
  await expect(f, request("/v1/requests/request-0001"), 405);
  await expect(f, request("/v1/requests/short", { method: "GET" }), 404);
});

test("task queries distinguish a service authentication or balance problem from customer funds", async t => {
  for (const status of [401, 402, 403]) {
    const f = await fixture(t, { fetcher: async (_url, init) => init.method === "POST"
      ? Response.json({ data: [{ task_id: "existing_task", status: "submitted" }] })
      : Response.json({ error: { message: "APIMart token_id=105092 private balance 0.044204" } }, { status }) });
    await expect(f, request(IMAGE_PATH), 200);
    const result = await expect(f, request("/v1/tasks/existing_task", { method: "GET" }), 503);
    assert.equal(result.error.message, "暂时无法查询任务，请稍后刷新。");
    assert.doesNotMatch(JSON.stringify(result), /APIMart|105092|0\.044204|充值|未扣费|insufficient_balance/);
    assert.equal((await f.wallet.getWallet(MEMBER.id)).reservedMicrousd, 18000, "query failure cannot establish generation failure or refund");
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
    ["/v1/videos/generations", {}, 400],
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

const REAL_SOURCE = JSON.parse(await readFile(new URL("./fixtures/apimart-pricing-20261020.json", import.meta.url), "utf8"));
const REAL_CATALOG = apimart.parseApimartPricing(REAL_SOURCE);
const VIDEO_PATH = "/v1/videos/generations", MUSIC_PATH = "/v1/music/generations";

test("Wan 2.7 reference-image quotes use the selected resolution, exact seconds and current material rates", () => {
  const base = { model: "wan2.7-r2v", prompt: "The character in image 1 walks through the garden", image_urls: ["https://example.com/character.png"] };
  const quote = body => apimart.quoteApimartRequest({ ...base, ...body }, VIDEO_PATH, REAL_CATALOG).amountMicrousd;
  assert.equal(quote({ duration: 2, resolution: "720p" }), 159360);
  assert.equal(quote({ duration: 15, resolution: "1080p" }), 1972800);
  assert.equal(quote({}), 657600, "default 5 seconds at 1080P");
  assert.equal(apimart.quoteApimartRequest({ model: base.model, prompt: base.prompt, duration: 5, resolution: "720P", image_with_roles: [{ url: base.image_urls[0], role: "first_frame" }] }, VIDEO_PATH, REAL_CATALOG).amountMicrousd, 398400);
  const changed = structuredClone(REAL_SOURCE);
  changed.data.models.video.find(model => model.id === base.model).input_material_prices = { image: { unit: "usd_per_image", after_discount: 0.01, free_count: 1 } };
  const updated = apimart.parseApimartPricing(changed);
  assert.equal(apimart.quoteApimartRequest({ ...base, duration: 5, resolution: "720P", image_urls: Array(5).fill(base.image_urls[0]) }, VIDEO_PATH, updated).amountMicrousd, 446400, "all normalized reference roles are counted if the provider adds material fees");
});

test("Wan 2.7 reference-image submissions normalize before hashing, replay once and settle from the owned task", async t => {
  const f = await fixture(t, { pricingCatalog: REAL_CATALOG, fetcher: async (_url, init) => init.method === "POST"
    ? Response.json({ data: [{ task_id: "wan_reference", status: "submitted" }] })
    : Response.json({ data: { id: "wan_reference", model: "wan2.7-r2v", status: "completed", cost: 0.3, result: { videos: [{ url: ["https://cdn.apimart.ai/reference.mp4"] }] } } }) });
  const original = { model: "wan2.7-r2v", prompt: "Use image 1 as the character", image_urls: ["https://example.com/character.png"], duration: 5, resolution: "720p" };
  const first = await expect(f, request(VIDEO_PATH, { body: JSON.stringify(original), headers: { "X-Tokvilo-Max-Reserve-Microusd": "398400" } }), 200);
  assert.equal(first.tokvilo_billing.reservedMicrousd, 398400);
  assert.equal(f.calls[0].url, "https://api.apimart.ai/v1/videos/generations");
  const sent = JSON.parse(f.calls[0].init.body);
  assert.equal(sent.image_urls, undefined);
  assert.deepEqual(sent.image_with_roles, [{ url: original.image_urls[0], role: "reference_image" }]);
  assert.equal(sent.resolution, "720P");
  await expect(f, request(VIDEO_PATH, { body: JSON.stringify(sent) }), 200);
  assert.equal(f.calls.length, 1, "alias and explicit role form share one paid submission");
  f.setUser({ id: "other-user", email: "other@example.com", displayName: "Other" });
  await expect(f, request("/v1/tasks/wan_reference", { method: "GET" }), 404);
  f.setUser(MEMBER);
  const done = await expect(f, request("/v1/tasks/wan_reference", { method: "GET" }), 200);
  assert.equal(done.tokvilo_billing.chargedMicrousd, 360000);
  assert.equal(done.data.cost, undefined);
  await expect(f, request(VIDEO_PATH, { body: JSON.stringify(original) }), 200);
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, 1);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 640000);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).reservedMicrousd, 0);
});

test("unsupported Wan reference media and durations never reserve funds or reach the provider", async t => {
  for (const extras of [
    {}, { image_urls: Array(6).fill("https://example.com/image.png") },
    { image_with_roles: [{ url: "https://example.com/image.png", reference_voice: "https://example.com/audio.mp3" }] },
    { image_with_roles: [{ url: "https://example.com/image.png", role: "last_frame" }] },
    { image_urls: ["https://example.com/image.png"], video_urls: ["https://example.com/video.mp4"] },
    { image_urls: ["https://example.com/image.png"], duration: 0 },
    { image_urls: ["https://example.com/image.png"], duration: 16 },
  ]) {
    const f = await fixture(t, { pricingCatalog: REAL_CATALOG });
    await expect(f, request(VIDEO_PATH, { body: JSON.stringify({ model: "wan2.7-r2v", prompt: "Garden", ...extras }) }), 400);
    assert.equal(f.calls.length, 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM wallet_reservations").get().n, 0);
    assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 1000000);
  }
});

test("documented image variants, input material fees, video units and music versions quote from their exact dimensions", () => {
  const quote = (path, body) => apimart.quoteApimartRequest(body, path, REAL_CATALOG).amountMicrousd;
  assert.equal(quote(IMAGE_PATH, { model: "qwen-image-3.0", prompt: "Tree", resolution: "2k" }), 24686);
  assert.equal(apimart.apimartTaskCharge({ cost: 0.0205712 }), 24686, "fractional micro amounts round after retail conversion");
  const fractional = structuredClone(REAL_SOURCE);
  fractional.data.models.video.find(model => model.id === "wan2.6").fixed_prices.items.find(rate => rate.key === "default").after_discount = 0.0205712;
  assert.equal(apimart.quoteApimartRequest({ model: "wan2.6", prompt: "Ocean", duration: 5, resolution: "720p" }, VIDEO_PATH, apimart.parseApimartPricing(fractional)).amountMicrousd, 123428, "media totals round once after duration multiplication");
  const material = REAL_SOURCE.data.models.image.find(model => model.id === "grok-imagine-image-2.0");
  const imageCost = material.fixed_prices.items.find(rate => rate.key === "1K@medium").after_discount;
  assert.equal(quote(IMAGE_PATH, { model: material.id, prompt: "Tree", resolution: "1k", quality: "medium", image_urls: ["https://example.com/image.png"] }), pricing.retailUsdMicrousd(imageCost + material.input_material_prices.image.after_discount));
  assert.equal(quote(IMAGE_PATH, { model: "gpt-image-2.5-ext", prompt: "Tree", version: "flare", resolution: "2k" }), 36000);
  assert.equal(quote(VIDEO_PATH, { model: "veo3.1-fast", prompt: "Ocean", duration: 8, resolution: "720p" }), 168000, "per-call video is not multiplied by duration");
  assert.equal(quote(VIDEO_PATH, { model: "kling-v3", prompt: "Ocean", duration: 5, mode: "pro", audio: true }), 806400);
  assert.equal(quote(VIDEO_PATH, { model: "wan2.6", prompt: "Ocean", duration: 5, resolution: "720p" }), 300000);
  assert.equal(quote(MUSIC_PATH, { model: "flowmusic", sound_prompt: "Piano" }), 72000);
  assert.equal(quote(MUSIC_PATH, { model: "suno", prompt: "Piano", version: "v6" }), 60000);
  assert.equal(quote(MUSIC_PATH, { model: "suno", custom: true, instrumental: true, version: "v6-mini", max_mode: true }), 120000);
  for (const [path, body] of [
    [IMAGE_PATH, { model: "flux-2-pro", prompt: "Tree", resolution: "1MP", size: "1792x1792" }],
    [IMAGE_PATH, { model: "gpt-image-2.5-ext", prompt: "Tree", version: "flare" }],
    [VIDEO_PATH, { model: "veo3.1-fast", prompt: "Ocean", duration: 10, resolution: "720p" }],
    [VIDEO_PATH, { model: "wan2.6", prompt: "Ocean", duration: 5, resolution: "720p", video_urls: ["https://example.com/video.mp4"] }],
    [MUSIC_PATH, { model: "suno", prompt: "Piano", max_mode: true }],
    [MUSIC_PATH, { model: "suno", prompt: "Piano", custom_model_id: "someone-else" }],
    [CHAT_PATH, { model: "text-embedding-3-large", messages: CHAT.messages }],
  ]) assert.throws(() => quote(path, body), JSON.stringify(body));
});

for (const [label, path, body, taskEndpoint, cost] of [
  ["video", VIDEO_PATH, { model: "veo3.1-fast", prompt: "Ocean", duration: 8, resolution: "720p" }, "/v1/tasks/", 0.1],
  ["music", MUSIC_PATH, { model: "flowmusic", sound_prompt: "Piano" }, "/v1/music/tasks/", 0.048],
]) test(`${label} reserves once, binds task ownership, reconciles through the correct GET endpoint and replays final billing`, async t => {
  const taskId = `${label}_task`;
  const f = await fixture(t, { pricingCatalog: REAL_CATALOG, fetcher: async (_url, init) => init.method === "POST"
    ? Response.json({ data: [{ task_id: taskId, status: "submitted" }] })
    : Response.json({ data: { id: taskId, model: body.model, status: "completed", cost, credits_cost: cost * 10, result: { music: [{ audio_url: "https://cdn.apimart.ai/audio/test.m4a" }] } } }) });
  const req = () => request(path, { body: JSON.stringify(body) });
  const first = await expect(f, req(), 200);
  assert.equal(first.tokvilo_billing.status, "reserved");
  assert.equal(f.calls[0].url, "https://api.apimart.ai" + path);
  assert.deepEqual(await expect(f, req(), 200), first);
  assert.equal(f.calls.length, 1);
  f.setUser({ id: "different", email: "different@example.com", displayName: "Different" });
  await expect(f, request(`/v1/tasks/${taskId}`, { method: "GET" }), 404);
  f.setUser(MEMBER);
  const reconciliation = await f.reconcile();
  assert.equal(reconciliation.completed, 1);
  assert.equal(f.calls[1].url, "https://api.apimart.ai" + taskEndpoint + taskId);
  const done = await expect(f, request(`/v1/tasks/${taskId}`, { method: "GET" }), 200);
  assert.equal(done.tokvilo_billing.status, "settled");
  assert.equal(done.tokvilo_billing.chargedMicrousd, pricing.retailUsdMicrousd(cost));
  assert.equal(done.data.cost, undefined);
  const replay = await expect(f, req(), 200);
  assert.equal(replay.tokvilo_billing.status, "settled");
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, 1);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).reservedMicrousd, 0);
});

test("music failure refunds through the owner-scoped music task alias and anonymous task ids never query upstream", async t => {
  const f = await fixture(t, { pricingCatalog: REAL_CATALOG, fetcher: async (_url, init) => init.method === "POST"
    ? Response.json({ data: [{ task_id: "music_failed", status: "submitted" }] })
    : Response.json({ data: { id: "music_failed", status: "failed" } }) });
  await expect(f, request(MUSIC_PATH, { body: JSON.stringify({ model: "suno", prompt: "Rain", version: "v6" }) }), 200);
  const done = await expect(f, request("/v1/music/tasks/music_failed", { method: "GET" }), 200);
  assert.equal(done.tokvilo_billing.status, "refunded");
  await expect(f, request("/v1/music/tasks/unowned", { method: "GET" }), 404);
  assert.equal(f.calls.length, 2);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 1000000);
});

test("known public model aliases normalize before hashing and only metadata is rewritten in responses", async t => {
  const original = "grok-imagine-1.5-apimart", alias = "grok-imagine-1.5-tokvilo";
  const f = await fixture(t, { pricingCatalog: REAL_CATALOG, fetcher: async () => Response.json({ model: original, data: [{ task_id: "aliased_task", status: "submitted", model: original }], generated_text: original }) });
  const first = await expect(f, request(IMAGE_PATH, { body: JSON.stringify({ model: alias, prompt: "Tree" }) }), 200);
  assert.equal(JSON.parse(f.calls[0].init.body).model, original);
  assert.equal(first.model, alias); assert.equal(first.data[0].model, alias);
  assert.equal(first.generated_text, original, "generated content retains its meaning");
  assert.deepEqual(await expect(f, request(IMAGE_PATH, { body: JSON.stringify({ model: original, prompt: "Tree" }) }), 200), first);
  assert.equal(f.calls.length, 1);
  const tasks = await expect(f, request("/v1/tasks", { method: "GET" }), 200);
  assert.equal(tasks.data[0].model, alias);
  assert.equal(modelIds.upstreamModelId("unknown-tokvilo"), "unknown-tokvilo");
});

test("music task responses cannot change the stored model identity or charge an unsupported extra operation", async t => {
  const f = await fixture(t, { pricingCatalog: REAL_CATALOG, fetcher: async (_url, init) => init.method === "POST"
    ? Response.json({ data: [{ task_id: "music_identity", status: "submitted" }] })
    : Response.json({ data: { id: "music_identity", model: "different", status: "completed", cost: 0.02 } }) });
  await expect(f, request(MUSIC_PATH, { body: JSON.stringify({ model: "flowmusic", sound_prompt: "Piano" }) }), 200);
  await expect(f, request("/v1/music/tasks/music_identity", { method: "GET" }), 502);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).reservedMicrousd, 72000);
  const count = f.calls.length;
  await expect(f, request(MUSIC_PATH, { headers: { "Idempotency-Key": "operation-change" }, body: JSON.stringify({ model: "flowmusic", sound_prompt: "Piano", operation: "cover" }) }), 400);
  assert.equal(f.calls.length, count);
});

test("known alias conversion is an exact reversible lookup rather than arbitrary suffix substitution", () => {
  for (const stem of ["grok-imagine-1.5", "grok-imagine-1.5-edit", "imagen-4.0", "grok-imagine-1.5-video"]) {
    assert.equal(modelIds.publicModelId(`${stem}-apimart`), `${stem}-tokvilo`);
    assert.equal(modelIds.upstreamModelId(`${stem}-tokvilo`), `${stem}-apimart`);
  }
  assert.equal(modelIds.publicModelId("unknown-apimart"), "unknown-apimart");
});

test("all documented video defaults are executable quotes and absent adapter contracts stay closed", t => {
  for (const [model, defaults] of Object.entries(videoOptions.VIDEO_DEFAULTS)) {
    const body = { model, prompt: "Ocean", duration: defaults.duration,
      ...(defaults.mode ? { mode: defaults.mode } : { resolution: defaults.resolution }),
      ...(defaults.referenceRequired ? { image_urls: ["https://example.com/first.png"] } : {}) };
    assert.ok(apimart.quoteApimartRequest(body, VIDEO_PATH, REAL_CATALOG).amountMicrousd > 0, model);
  }
  assert.equal(Object.keys(videoOptions.VIDEO_DEFAULTS).length, 41);
  const counts = Object.fromEntries(["chat", "image", "video", "audio"].map(kind => [kind, REAL_CATALOG.models.filter(model => model.kind === kind).length]));
  t.diagnostic(JSON.stringify({ counts, unavailable: REAL_CATALOG.unavailable.map(model => model.model) }));
  assert.deepEqual(counts, { chat: 174, image: 32, video: 41, audio: 2 });
  for (const model of ["dall-e-3", "grok-imagine-1.5-edit-apimart", "gpt-image-1"]) {
    assert.equal(REAL_CATALOG.models.some(item => item.model === model), false, model);
    assert.throws(() => apimart.quoteApimartRequest({ model, prompt: "Tree" }, IMAGE_PATH, REAL_CATALOG));
  }
  assert.throws(() => apimart.quoteApimartRequest({ model: "seedream-5-0-pro", prompt: "Tree", image_urls: ["https://example.com/1.png", "https://example.com/2.png"] }, IMAGE_PATH, REAL_CATALOG));
});

test("Midjourney submits one Imagine call, preserves idempotency and settles one task rather than output image count", async t => {
  const f = await fixture(t, { pricingCatalog: REAL_CATALOG, fetcher: async (_url, init) => init.method === "POST"
    ? Response.json({ data: [{ task_id: "mj_task", status: "submitted" }] })
    : Response.json({ data: { id: "mj_task", status: "completed", cost: 0.01, result: { images: Array.from({ length: 5 }, (_, index) => ({ url: `https://cdn.apimart.ai/${index}.png` })) } } }) });
  const body = { model: "midjourney", prompt: "A tree" };
  const expected = apimart.quoteApimartRequest(body, IMAGE_PATH, REAL_CATALOG).amountMicrousd;
  const req = () => request(IMAGE_PATH, { body: JSON.stringify(body) });
  const receipt = await expect(f, req(), 200);
  assert.equal(receipt.tokvilo_billing.reservedMicrousd, expected);
  assert.equal(f.calls[0].url, "https://api.apimart.ai/v1/midjourney/generations");
  const sent = JSON.parse(f.calls[0].init.body);
  assert.equal(sent.model, undefined); assert.equal(sent.version, "7"); assert.equal(sent.speed, "relax");
  await expect(f, req(), 200); assert.equal(f.calls.length, 1);
  const done = await expect(f, request("/v1/tasks/mj_task", { method: "GET" }), 200);
  assert.equal(done.tokvilo_billing.chargedMicrousd, 12000);
  assert.equal(done.data.result.images.length, 5);
  assert.equal((await f.wallet.getWallet(MEMBER.id)).reservedMicrousd, 0);
});

const NEW_IMAGES_SOURCE = JSON.parse(await readFile(new URL("./fixtures/apimart-new-images-20261020.json", import.meta.url), "utf8"));
const NEW_IMAGES_CATALOG = apimart.parseApimartPricing(NEW_IMAGES_SOURCE);

test("new fixed image models add exactly two adapters without altering the dated 293-model fixture", () => {
  const combined = structuredClone(REAL_SOURCE);
  combined.data.models.image.push(...NEW_IMAGES_SOURCE.data.models.image);
  const parsed = apimart.parseApimartPricing(combined);
  assert.equal(Object.values(REAL_SOURCE.data.models).flat().length, 293);
  assert.equal(Object.values(combined.data.models).flat().length, 295);
  assert.equal(parsed.models.length, 251); assert.equal(parsed.unavailable.length, 44);
  assert.equal(parsed.models.filter(model => model.kind === "image").length, 34);
  for (const [model, tiers, defaultPrice, referenceCount] of [
    ["flux-3-image-klein", { "768sq": 7680, "1k": 8640, "1.5k": 10560, "2k": 13440, "4k": 34560 }, 8640, 10],
    ["hy-image-v3.5-preview", { "1K": 23040, "2K": 23040, "4K": 30720 }, 23040, 5],
  ]) {
    const quote = body => apimart.quoteApimartRequest({ model, prompt: "Tree", ...body }, IMAGE_PATH, NEW_IMAGES_CATALOG).amountMicrousd;
    assert.equal(quote({}), defaultPrice);
    for (const [resolution, amount] of Object.entries(tiers)) {
      assert.equal(quote({ resolution }), amount);
      assert.equal(quote({ resolution, image_urls: Array.from({ length: referenceCount }, (_, i) => `https://example.com/${i}.png`) }), amount, "reference count does not change the documented resolution price");
    }
    const normalized = requestTools.normalizeApimartRequest({ model, prompt: "Tree" }, IMAGE_PATH);
    assert.equal(normalized.size, "auto"); assert.equal(normalized.n, 1);
    assert.deepEqual(requestTools.normalizeApimartRequest(normalized, IMAGE_PATH), normalized);
  }
  const normalized = requestTools.normalizeApimartRequest({ model: "flux-3-image-klein", prompt: "Tree", aspect_ratio: "16x9", resolution: "768" }, IMAGE_PATH);
  assert.equal(normalized.size, "16:9"); assert.equal(normalized.aspect_ratio, undefined); assert.equal(normalized.resolution, "768sq");
});

test("new image parameter violations never reserve a balance or call the provider", async t => {
  for (const model of ["flux-3-image-klein", "hy-image-v3.5-preview"]) {
    const maxReferences = model.startsWith("flux") ? 10 : 5;
    const invalid = [{ width: 1024, height: 1024 }, { size: "1024x1024" }, { resolution: "3k" }, { size: "17:3" },
      { resolution: null }, { size: null }, { n: 2 }, { n: "1" }, { quality: "high" }, { version: "flare" },
      { image_urls: Array.from({ length: maxReferences + 1 }, (_, i) => `https://example.com/${i}.png`) },
      { image_urls: ["http://example.com/image.png"] }, { grounding: true }, { callback_url: "https://example.com/callback" },
      { aspect_ratio: "16:9", size: "16:9" }, { resolution: ["1k"] }];
    if (model.startsWith("hy")) invalid.push({ aspect_ratio: "16:9" }, { resolution: "1.5k" }, { resolution: "768sq" }, { size: "2:1" });
    for (const params of invalid) {
      const f = await fixture(t, { pricingCatalog: NEW_IMAGES_CATALOG });
      const body = { model, prompt: "Tree", ...params };
      assert.throws(() => apimart.quoteApimartRequest(body, IMAGE_PATH, NEW_IMAGES_CATALOG));
      await expect(f, request(IMAGE_PATH, { body: JSON.stringify(body) }), 400);
      assert.equal(f.calls.length, 0);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM wallet_reservations").get().n, 0);
      assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 1000000);
    }
  }
});

for (const [model, cost, reserved] of [["flux-3-image-klein", 0.0112, 13440], ["hy-image-v3.5-preview", 0.0192, 23040]]) {
  test(`${model} uses the unified task route, replays normalized requests and settles exactly once`, async t => {
    const f = await fixture(t, { pricingCatalog: NEW_IMAGES_CATALOG, fetcher: async (_url, init) => init.method === "POST"
      ? Response.json({ data: [{ task_id: "new_image", status: "submitted" }] })
      : Response.json({ data: { id: "new_image", model, status: "completed", cost, result: { images: [{ url: ["https://cdn.apimart.ai/result.png"] }] } } }) });
    const firstBody = { model, prompt: "Tree", resolution: "2k", ...(model.startsWith("flux") ? { aspect_ratio: "16x9" } : { size: "16:9" }) };
    const first = await expect(f, request(IMAGE_PATH, { body: JSON.stringify(firstBody) }), 200);
    assert.equal(first.tokvilo_billing.reservedMicrousd, reserved);
    const normalized = requestTools.normalizeApimartRequest(firstBody, IMAGE_PATH);
    assert.deepEqual(JSON.parse(f.calls[0].init.body), JSON.parse(JSON.stringify(normalized)));
    assert.equal(f.calls[0].url, "https://api.apimart.ai/v1/images/generations");
    await expect(f, request(IMAGE_PATH, { body: JSON.stringify(normalized) }), 200);
    assert.equal(f.calls.length, 1);
    const done = await expect(f, request("/v1/tasks/new_image", { method: "GET" }), 200);
    assert.equal(f.calls[1].url, "https://api.apimart.ai/v1/tasks/new_image");
    assert.equal(done.tokvilo_billing.status, "settled"); assert.equal(done.tokvilo_billing.chargedMicrousd, reserved);
    await expect(f, request("/v1/tasks/new_image", { method: "GET" }), 200);
    assert.equal((await f.wallet.getWallet(MEMBER.id)).balanceMicrousd, 1000000 - reserved);
    assert.equal((await f.wallet.getWallet(MEMBER.id)).reservedMicrousd, 0);
  });
}
