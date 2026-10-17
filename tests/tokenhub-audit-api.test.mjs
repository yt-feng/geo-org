import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const BASE = "https://api.eco-geo.org";
const TEST_KEY = "sk-audit-test-not-a-real-key";
class AuditError extends Error { constructor(message, status = 503) { super(message); this.status = status; } }
function req(body, overrides = {}) {
  return new Request(`${BASE}/api/admin/tokenhub-audit`, { method: "POST", headers: { Origin: BASE, "Content-Type": "application/json" }, body: JSON.stringify(body), ...overrides });
}
async function fixture(options = {}) {
  const calls = [], env = { DB: {} }, safeStatus = { campaign: { id: "audit", state: "active", budgetMicros: 5_000_000 }, cases: [] };
  const source = await readFile(new URL("../app/api/admin/tokenhub-audit/route.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const compiled = { exports: {} };
  const service = {
    AuditError,
    async getAuditStatus(current, includeEvidence) { calls.push({ name: "status", current, includeEvidence }); return safeStatus; },
    async startAudit(current, input) { calls.push({ name: "start", current, input }); if (options.startError) throw options.startError; return safeStatus; },
    async runAuditTick(current, input) { calls.push({ name: "tick", current, input }); return safeStatus; },
    async pauseAudit(current) { calls.push({ name: "pause", current }); return safeStatus; },
  };
  const mocks = {
    "@/lib/auth": { getPortalUser: async () => options.user === undefined ? { id: "admin", isAdmin: true } : options.user },
    "@/lib/config": { runtimeEnv() { calls.push({ name: "env" }); return env; }, getD1() { return { prepare(sql) { calls.push({ name: "rate", sql }); return { bind(...args) { calls.push({ name: "rate-bind", args }); return { async first() { return options.rateDenied ? null : { attempts: 1 }; } }; } }; } }; } },
    "@/lib/crypto": { sha256Hex: async value => createHash("sha256").update(value).digest("hex") },
    "@/lib/tokenhub-audit": service,
  };
  vm.runInNewContext(outputText, { module: compiled, exports: compiled.exports, require(specifier) { assert.ok(Object.hasOwn(mocks, specifier)); return mocks[specifier]; }, Response, Request, URL, TextDecoder, Uint8Array, Date, Error }, { filename: "tokenhub-audit-route.ts" });
  return { ...compiled.exports, calls };
}

test("audit endpoints reject anonymous/member access before reading credentials or storage", async () => {
  for (const [user, status] of [[null, 401], [{ id: "member", isAdmin: false }, 403]]) {
    const handler = await fixture({ user });
    assert.equal((await handler.GET(new Request(`${BASE}/api/admin/tokenhub-audit?evidence=1`))).status, status);
    assert.equal((await handler.POST(req({ action: "start", apiKey: TEST_KEY }))).status, status);
    assert.equal(handler.calls.length, 0);
  }
});

test("audit mutation rejects cross-origin, wrong content type, oversized bodies, unknown fields and actions", async () => {
  const attempts = [
    [req({ action: "start", apiKey: TEST_KEY }, { headers: { Origin: "https://example.org", "Content-Type": "application/json" } }), 403],
    [req({ action: "pause" }, { headers: { Origin: BASE, "Content-Type": "text/plain" } }), 415],
    [req({ action: "start", apiKey: "a".repeat(2100) }), 413],
    [req({ action: "start", apiKey: TEST_KEY, budgetMicros: 100_000_000 }), 400],
    [req({ action: "tick", maxCases: 100 }), 400],
    [req({ action: "pause", apiKey: TEST_KEY }), 400],
    [req({ action: "delete" }), 400],
    [req({ action: "start", apiKey: "" }), 400],
    [req(["start"]), 400],
    [req(null), 400],
    [req({}, { body: "{broken" }), 400],
  ];
  for (const [request, status] of attempts) {
    const handler = await fixture();
    assert.equal((await handler.POST(request)).status, status);
    assert.equal(handler.calls.length, 0);
  }
});

test("audit start fixes five-dollar budget and tick performs at most one case", async () => {
  const handler = await fixture();
  const response = await handler.POST(req({ action: "start", apiKey: ` ${TEST_KEY} ` }));
  assert.equal(response.status, 200);
  const start = handler.calls.find(call => call.name === "start");
  assert.equal(start.input.budgetMicros, 5_000_000);
  assert.equal(start.input.apiKey, TEST_KEY);
  assert.equal((await response.text()).includes(TEST_KEY), false);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal((await handler.POST(req({ action: "tick" }))).status, 200);
  assert.equal(handler.calls.find(call => call.name === "tick").input.maxCases, 1);
  assert.equal((await handler.POST(req({ action: "pause" }))).status, 200);
  assert.ok(handler.calls.some(call => call.name === "pause"));
});

test("audit evidence download is private, authenticated and enables evidence only on explicit query", async () => {
  const handler = await fixture();
  const ordinary = await handler.GET(new Request(`${BASE}/api/admin/tokenhub-audit`));
  assert.equal(ordinary.headers.get("content-disposition"), null);
  const response = await handler.GET(new Request(`${BASE}/api/admin/tokenhub-audit?evidence=1`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /^attachment;/);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(handler.calls.filter(call => call.name === "status").map(call => call.includeEvidence), [false, true]);
});

test("audit rejects rate-limited mutations before accessing upstream and hides unexpected failures", async () => {
  const limited = await fixture({ rateDenied: true });
  assert.equal((await limited.POST(req({ action: "start", apiKey: TEST_KEY }))).status, 429);
  assert.equal(limited.calls.some(call => call.name === "start"), false);
  for (const [startError, status, exposed] of [[new Error(TEST_KEY), 503, false], [new AuditError("已有核验计划。", 409), 409, true]]) {
    const handler = await fixture({ startError });
    const response = await handler.POST(req({ action: "start", apiKey: TEST_KEY }));
    assert.equal(response.status, status);
    const body = await response.text();
    assert.equal(body.includes(TEST_KEY), false);
    assert.equal(body.includes("已有核验计划。"), exposed);
  }
});
