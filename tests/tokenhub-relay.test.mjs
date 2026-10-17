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
  const calls = [];
  const env = { DB, SERVICE_ENABLED: "true", ...options.env };
  function insertUser(user = ADMIN, status = "active") {
    sqlite.prepare("INSERT INTO users (id,email,display_name,status) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING").run(user.id, user.email, user.displayName || "", status);
  }
  function insertKey(user, key, revoked = false, status = "active") {
    insertUser(user, status);
    sqlite.prepare("INSERT INTO api_keys (id,user_id,key_prefix,key_hash,revoked_at) VALUES (?,?,?,?,?)").run(`key-${user.id}`, user.id, key.slice(0, 12), hash(key), revoked ? new Date().toISOString() : null);
  }
  const { handleTokenHubRelay } = await loadModule("../lib/tokenhub-relay.ts", {
    "./auth": { getPortalUser: async () => { options.onSession?.(); return currentUser; }, isAdminEmail: email => email === "delegated-admin@example.com" },
    "./config": { runtimeEnv: () => env, getD1: () => DB },
    "./crypto": { sha256Hex: async value => hash(value) },
    "./store": { ensureUser: async user => insertUser(user) },
    "./provider-settings": { ProviderError },
    "./tokenhub-settings": { TOKENHUB_ORIGIN: "https://ai-tokenhub.ai", createTokenHubSettings: () => ({ credential: async () => { options.onCredential?.(); return options.key || PROVIDER_KEY; } }) },
  }, { fetch: async (url, init) => { calls.push({ url, init }); return options.fetcher ? options.fetcher(url, init) : Response.json({ id: "task-default", status: "queued" }); } });
  return { sqlite, calls, handle: handleTokenHubRelay, insertUser, insertKey, setUser: user => { currentUser = user; } };
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

test("relay requires an active administrator and same-origin browser mutations", async t => {
  for (const [user, status] of [[null, 401], [{ ...ADMIN, id: "member", isAdmin: false }, 403]]) {
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
});

test("ECO-GEO keys permit administrators only, reject revoked or inactive users, and never forward the client credential", async t => {
  const key = "eco_live_012345678901234567890123456789";
  for (const [user, revoked, status, expected] of [
    [{ ...ADMIN, id: "member", isAdmin: false }, false, "active", 403],
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
  assert.deepEqual((await list.json()).data.map(row => row.id), ["owned-task"]);
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
  assert.deepEqual(await retry.json(), await first.json());
  await expectStatus(f.handle, request(TASKS, { body: JSON.stringify({ ...VIDEO, duration: 5 }) }), 409);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://ai-tokenhub.ai/api/v3/contents/generations/tasks");
  assert.equal(f.calls[0].init.redirect, "error");
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

test("write throttling stops paid requests at five per minute while reads retain their separate allowance", async t => {
  const f = await fixture(t, { fetcher: async () => Response.json({ result: "ok" }) });
  for (let index = 0; index < 5; index++) await expectStatus(f.handle, request("/v3/images/generations", { body: JSON.stringify({ model: "image", prompt: "test" }) }), 200);
  await expectStatus(f.handle, request("/v3/images/generations", { body: JSON.stringify({ model: "image", prompt: "test" }) }), 429);
  await expectStatus(f.handle, request("/v1/models", { method: "GET" }), 200);
  assert.equal(f.calls.length, 6);
  f.sqlite.prepare("UPDATE login_rate_limits SET expires_at='2000-01-01T00:00:00.000Z'").run();
  await expectStatus(f.handle, request("/v3/images/generations", { body: JSON.stringify({ model: "image", prompt: "test" }) }), 200);
});
