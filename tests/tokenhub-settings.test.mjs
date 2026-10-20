import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function loadModule(path, mocks = {}) {
  const filename = new URL(path, import.meta.url).pathname;
  const source = await readFile(filename, "utf8");
  const { outputText } = ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const compiledModule = { exports: {} };
  vm.runInNewContext(outputText, {
    module: compiledModule, exports: compiledModule.exports,
    require(specifier) { if (Object.hasOwn(mocks, specifier)) return mocks[specifier]; throw new Error(`Unexpected dependency ${specifier}`); },
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Request, Response, Headers, AbortSignal, btoa, atob,
    fetch() { throw new Error("Unexpected network request in TokenHub test"); },
  }, { filename });
  return compiledModule.exports;
}

const SECRET = "test-encryption-secret-at-least-32-characters";
const KEY = "sk-tokenhub-test-never-send-to-network";
const ENV_KEY = "sk-tokenhub-environment-fallback";
const CONTEXT = "eco-geo/provider/tokenhub/v1";
const BASE = "https://api.eco-geo.org";
const cryptoHelpers = await loadModule("../lib/provider-settings.ts");
const catalog = await loadModule("../lib/tokenhub-catalog.ts");
const tokenhub = await loadModule("../lib/tokenhub-settings.ts", { "./provider-settings": cryptoHelpers, "./tokenhub-catalog": catalog });
const schema = (await Promise.all((await readdir(new URL("../drizzle/", import.meta.url))).filter(name => name.endsWith(".sql")).sort().map(name => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")))).join("\n");

function fixture(t, overrides = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  t.after(() => sqlite.close());
  const DB = { prepare(query) {
    const statement = sqlite.prepare(query);
    const execute = (args = []) => ({
      bind(...next) { return execute(next); },
      async first() { return statement.get(...args) || null; },
      async run() { return { success: true, meta: { changes: statement.run(...args).changes } }; },
    });
    return execute();
  } };
  return { env: { DB, ADMIN_SESSION_SECRET: SECRET, ...overrides }, sqlite };
}
function modelsResponse(data = [{ id: "doubao-seedance-2-0", provider: "ByteDance", capabilities: ["video"] }]) { return Response.json({ object: "list", data }); }
function assertRedacted(value, ...secrets) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) assert.ok(!text.includes(secret), "must not expose provider credentials");
}
function request(action, options = {}) {
  return new Request(`${BASE}/api/admin/providers/tokenhub/${action}`, {
    method: action === "save" || action === "test" ? "POST" : "GET",
    headers: { Origin: BASE, "Content-Type": "application/json" },
    ...(action === "save" ? { body: JSON.stringify({ apiKey: KEY }) } : {}), ...options,
  });
}
async function handler(env, options = {}) {
  return (await loadModule("../lib/tokenhub-api.ts", {
    "./auth": { getPortalUser: async () => options.user === undefined ? { id: "admin", isAdmin: true } : options.user },
    "./config": { runtimeEnv: () => { options.onAccess?.(); return env; }, getD1: () => { options.onAccess?.(); return env.DB; } },
    "./crypto": { sha256Hex: async value => createHash("sha256").update(value).digest("hex") },
    "./provider-settings": cryptoHelpers,
    "./tokenhub-settings": { createTokenHubSettings: current => tokenhub.createTokenHubSettings(current, options.fetcher) },
  })).handleTokenHubProviderRequest;
}

test("TokenHub encryption is isolated while existing APIMart ciphertext remains readable", async () => {
  const context = new TextEncoder().encode("eco-geo/provider/apimart/v1");
  const material = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), "HKDF", false, ["deriveKey"]);
  const legacyKey = await webcrypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: context, info: context }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: context }, legacyKey, new TextEncoder().encode(KEY));
  const legacy = `v1.${Buffer.from(iv).toString("base64")}.${Buffer.from(ciphertext).toString("base64")}`;
  assert.equal(await cryptoHelpers.decryptProviderKey(legacy, SECRET), KEY);
  await assert.rejects(cryptoHelpers.decryptProviderKey(legacy, SECRET, CONTEXT));
  const encrypted = await cryptoHelpers.encryptProviderKey(KEY, SECRET, CONTEXT);
  assert.equal(await cryptoHelpers.decryptProviderKey(encrypted, SECRET, CONTEXT), KEY);
  await assert.rejects(cryptoHelpers.decryptProviderKey(encrypted, SECRET));
});

test("saving uses the official free catalog with an explicit Bearer credential and stores only ciphertext", async t => {
  const { env, sqlite } = fixture(t);
  const calls = [];
  const service = tokenhub.createTokenHubSettings(env, async (url, init) => { calls.push({ url, init }); return modelsResponse(); });
  const result = await service.save(` ${KEY} `);
  assert.equal(result.ok, true);
  assert.equal(result.tokenhub.source, "saved");
  assert.equal(result.modelCount, 1);
  const row = sqlite.prepare("SELECT * FROM provider_settings WHERE provider='tokenhub'").get();
  assert.equal(await cryptoHelpers.decryptProviderKey(row.encrypted_key, SECRET, CONTEXT), KEY);
  assertRedacted(result, KEY, SECRET, row.encrypted_key);
  assertRedacted(row, KEY);
  assert.ok(row.verified_at);
  assert.equal(await service.credential(), KEY);
  assert.equal((await service.test()).modelCount, 1);
  for (const { url, init } of calls) {
    assert.ok(["https://ai-tokenhub.ai/api/v1/models", "https://ai-tokenhub.ai/api/pricing"].includes(url));
    assert.equal(init.method, "GET");
    assert.equal(new Headers(init.headers).get("Authorization"), url.endsWith("/models") ? `Bearer ${KEY}` : null);
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test("invalid replacements never overwrite the saved key and provider failures are sanitized", async t => {
  const { env, sqlite } = fixture(t);
  await tokenhub.createTokenHubSettings(env, async () => modelsResponse()).save(KEY);
  const before = sqlite.prepare("SELECT * FROM provider_settings").get();
  const cases = [
    [() => new Response(KEY, { status: 401 }), 422],
    [() => new Response(KEY, { status: 403 }), 422],
    [() => new Response(KEY, { status: 429 }), 429],
    [() => new Response(null, { status: 302, headers: { Location: "https://unexpected.example/capture" } }), 502],
    [() => new Response(KEY, { status: 503 }), 502],
    [() => Response.json({ object: "list", data: [], error: KEY }), 502],
    [() => Response.json({ object: "list", data: [], success: false }), 502],
    [() => Response.json({ data: [] }), 502],
    [() => new Response("x".repeat(2_000_001)), 502],
    [() => new Response(`<html>${KEY}</html>`), 502],
    [() => { throw new TypeError(KEY); }, 502],
  ];
  for (const [response, status] of cases) {
    await assert.rejects(tokenhub.createTokenHubSettings(env, async () => response()).save("sk-replacement-tokenhub-key"), error => { assert.equal(error.status, status); assertRedacted(error.message, KEY); return true; });
    assert.deepEqual(sqlite.prepare("SELECT * FROM provider_settings").get(), before);
  }
});

test("validation and encryption setup fail before any upstream request", async t => {
  const { env } = fixture(t);
  const fetcher = async () => assert.fail("Invalid configuration must not reach upstream");
  for (const value of [null, {}, "", "short", "bad key with spaces", "x".repeat(513), "a".repeat(20) + "\nheader:value"]) {
    await assert.rejects(tokenhub.createTokenHubSettings(env, fetcher).save(value), error => error.status === 400);
  }
  await assert.rejects(tokenhub.createTokenHubSettings({ ...env, ADMIN_SESSION_SECRET: "short" }, fetcher).save(KEY));
});

test("status is masked and saved credentials take priority without falling back after corruption", async t => {
  const { env, sqlite } = fixture(t, { TOKENHUB_API_KEY: ENV_KEY });
  const service = tokenhub.createTokenHubSettings(env, async () => modelsResponse());
  const status = await service.status();
  assert.equal(status.source, "environment");
  assert.equal(status.keyHint, `••••${ENV_KEY.slice(-4)}`);
  assert.equal(await service.credential(), ENV_KEY);
  assertRedacted(status, ENV_KEY, SECRET);
  assert.equal((await tokenhub.createTokenHubSettings({ ...env, TOKENHUB_API_KEY: undefined }).status()).configured, false);
  await service.save(KEY);
  sqlite.prepare("UPDATE provider_settings SET encrypted_key = 'corrupt' WHERE provider = 'tokenhub'").run();
  await assert.rejects(service.credential());
  await assert.rejects(service.test());
});

test("catalog normalization supports documented and observed schemas without exposing arbitrary fields", async t => {
  const { env } = fixture(t, { TOKENHUB_API_KEY: ENV_KEY });
  const service = tokenhub.createTokenHubSettings(env, async () => modelsResponse([
    { id: "documented", name: "Documented model", provider: "Vendor", capabilities: ["video", 42], secret: KEY },
    { id: "observed", owned_by: "Vendor 2", modelType: "chat", iconSlug: "hidden" },
    { id: "tokenhub-exact-id", name: "TokenHub Seedance", owned_by: "TOKENHUB", modelType: "video" },
    { id: 123 }, null,
  ]));
  const result = await service.models();
  assert.equal(result.models.length, 3);
  assert.equal(result.models[0].category.join(","), "video");
  assert.equal(result.models[1].provider, "Vendor 2");
  assert.equal(result.models[1].category.join(","), "chat");
  assert.equal(result.models[2].id, "tokenhub-exact-id");
  assert.equal(result.models[2].name, "tokvilo 多模态 Seedance");
  assert.equal(result.models[2].provider, "tokvilo 多模态");
  assertRedacted(result, KEY, ENV_KEY, "hidden");
});

test("TokenHub admin routes reject unauthorized users and CSRF before accessing settings", async () => {
  for (const [user, expected] of [[null, 401], [{ id: "member", isAdmin: false }, 403]]) {
    const handle = await handler({}, { user, onAccess: () => assert.fail("Unauthorized settings access") });
    for (const action of ["status", "save", "test", "models"]) assert.equal((await handle(request(action), action)).status, expected);
  }
  const handle = await handler({}, { onAccess: () => assert.fail("Rejected settings access") });
  assert.equal((await handle(request("save", { headers: { Origin: "https://elsewhere.example" } }), "save")).status, 403);
  assert.equal((await handle(request("test", { headers: {} }), "test")).status, 403);
  assert.equal((await handle(request("status"), "save")).status, 405);
});

test("TokenHub admin routes bound JSON input, preserve no-store headers and rate-limit upstream checks", async t => {
  const { env, sqlite } = fixture(t);
  let calls = 0;
  const handle = await handler(env, { fetcher: async () => { calls++; return modelsResponse(); } });
  const cases = [
    [{ headers: { Origin: BASE, "Content-Type": "text/plain" }, body: KEY }, 415],
    [{ body: "{" }, 400],
    [{ body: "[]" }, 400],
    [{ body: JSON.stringify({ apiKey: KEY, baseUrl: "https://arbitrary.example" }) }, 400],
    [{ body: JSON.stringify({ apiKey: "x".repeat(2050) }) }, 413],
  ];
  for (const [options, status] of cases) assert.equal((await handle(request("save", options), "save")).status, status);
  assert.equal(calls, 0);
  const saved = await handle(request("save"), "save");
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("cache-control"), "private, no-store");
  assert.equal(saved.headers.get("x-content-type-options"), "nosniff");
  assertRedacted(await saved.text(), KEY, SECRET);
  for (let index = 0; index < 4; index++) assert.equal((await handle(request("test"), "test")).status, 200);
  assert.equal((await handle(request("models"), "models")).status, 429);
  const statusResponse = await handle(request("status"), "status");
  assert.equal((await statusResponse.json()).tokenhub.source, "saved");
  sqlite.prepare("UPDATE login_rate_limits SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await handle(request("models"), "models")).status, 200);
  assert.equal(calls, 12);
});

const CHAT_MODELS = ["glm-5-3-flash-260828", "glm-5-2-260617", "deepseek-v4-pro-ga-260813", "deepseek-v4-flash-ga-260731"];
const VIDEO_MODELS = ["dreamina-seedance-2-0-260128", "dreamina-seedance-2-0-fast-260128", "dreamina-seedance-2-0-mini-260615", "dreamina-seedance-2-5-260628"];
function fullPricing() {
  return { currencyCode: "USD", data: [
    ...CHAT_MODELS.map(id => ({ id, providerName: "chat-provider", baseProviderTypes: ["openai"], deployments: [{ enabled: true, pricing: { input: {}, output: {} } }] })),
    { id: "dola-seedream-5-0-pro-260628", providerName: "doubao", deployments: [{ enabled: true, pricing: { fixed: { priceUnit: "image" } } }] },
    ...VIDEO_MODELS.map(id => ({ id, providerName: "doubao", deployments: [{ enabled: true, pricing: { video: { withoutVideo480p: {} } } }] })),
  ] };
}
test("authenticated discovery merges all nine models with exact ECO endpoints and distinguishes public catalog from account access", async t => {
  const { env } = fixture(t, { TOKENHUB_API_KEY: ENV_KEY }), calls = [];
  const service = tokenhub.createTokenHubSettings(env, async (url, init) => {
    calls.push({ url, init });
    return url.endsWith("/models") ? modelsResponse(CHAT_MODELS.map(id => ({ id, modelType: "chat", owned_by: "official-chat" }))) : Response.json(fullPricing());
  });
  const result = await service.models();
  assert.equal(result.models.length, 9); assert.equal(result.catalog.complete, true);
  assert.equal(result.catalog.sources[0].modelCount, 4); assert.equal(result.catalog.sources[1].modelCount, 9);
  for (const model of result.models) {
    assert.equal(model.integrationStatus, "ready");
    assert.equal(model.accountAccess, CHAT_MODELS.includes(model.id) ? "listed_by_authenticated_model_api" : "unverified_public_catalog");
    const path = CHAT_MODELS.includes(model.id) ? "/v1/chat/completions" : VIDEO_MODELS.includes(model.id) ? "/v3/contents/generations/tasks" : "/v3/images/generations";
    assert.equal(model.endpoint, `/api/studio${path}`);
    assert.ok(model.limitations.includes("non_streaming_json_only"));
  }
  assert.equal(result.models.find(model => model.id === VIDEO_MODELS[3]).taskEndpoint, "/api/studio/v3/contents/generations/tasks/{task_id}");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${ENV_KEY}`); assert.equal(calls[1].init.headers.Authorization, undefined);
  assertRedacted(result, ENV_KEY, SECRET);
});

test("catalog discovers future model IDs without pretending unsupported media protocols are integrated", async t => {
  const { env } = fixture(t, { TOKENHUB_API_KEY: ENV_KEY });
  const service = tokenhub.createTokenHubSettings(env, async url => {
    if (url.endsWith("/models")) return modelsResponse(CHAT_MODELS.map(id => ({ id, modelType: "chat" })));
    const pricing = fullPricing();
    pricing.data.push({ id: "vendor-future-video", name: `Future ${ENV_KEY}`, deployments: [{ pricing: { video: {} } }] }, { id: "future-audio", modelType: "audio", deployments: [] });
    return Response.json(pricing);
  });
  const result = await service.models(); assert.equal(result.models.length, 11);
  const extra = result.models.find(model => model.id === "vendor-future-video");
  assert.equal(extra.modelType, "video"); assert.equal(extra.integrationStatus, "catalog_only"); assert.equal(extra.endpoint, null);
  assert.ok(extra.limitations.includes("adapter_not_verified")); assertRedacted(result, ENV_KEY);
  assert.equal(result.models.find(model => model.id === "future-audio").modelType, "unknown");
});

test("invalid credentials never fall through to public prices and unavailable pricing returns an explicitly incomplete catalog", async t => {
  const { env } = fixture(t, { TOKENHUB_API_KEY: ENV_KEY }), calls = [];
  const rejected = tokenhub.createTokenHubSettings(env, async url => { calls.push(url); return new Response(null, { status: 401 }); });
  await assert.rejects(rejected.models(), error => error.status === 422);
  assert.equal(calls.length, 1); assert.ok(calls[0].endsWith("/models"));
  for (const pricing of [new Response(null, { status: 503 }), Response.json({ currencyCode: "USD", data: [{ id: null }] }), Response.json({ currencyCode: "USD", data: [] })]) {
    const service = tokenhub.createTokenHubSettings(env, async url => url.endsWith("/models") ? modelsResponse(CHAT_MODELS.map(id => ({ id, modelType: "chat" }))) : pricing);
    const result = await service.models(); assert.equal(result.models.length, 4); assert.equal(result.catalog.complete, false); assert.equal(result.catalog.sources[1].status, "unavailable"); assert.equal(result.catalog.warnings.length, 1);
  }
});
