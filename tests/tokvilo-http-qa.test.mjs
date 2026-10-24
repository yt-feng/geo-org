import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { assertNoEmailSignup, assertVerifiedAccount, checkedTarget, credentialsAt, redirectTarget, runHttpVerification, validateQaIdentity } from "../scripts/verify-tokvilo-http.mjs";

const verifiedCheckpoints = { signupAttemptedAt: "2026-10-20T01:00:00.000Z", signupConfirmedAt: "2026-10-20T01:00:01.000Z", emailVerifiedAt: "2026-10-20T01:02:00.000Z" };

test("HTTP QA refuses unconfirmed email behavior and non-QA identities", () => {
  const ready = { configured: true, available: true, signupEnabled: true, emailEnabled: true };
  assert.throws(() => assertNoEmailSignup(ready));
  assert.throws(() => assertNoEmailSignup({ ...ready, emailAutoConfirm: false }));
  assert.throws(() => assertNoEmailSignup({ ...ready, emailAutoConfirm: true, registrationSendsEmail: true }));
  assert.doesNotThrow(() => assertNoEmailSignup({ ...ready, emailAutoConfirm: true }));
  assert.doesNotThrow(() => assertNoEmailSignup({ ...ready, registrationSendsEmail: false }));
  assert.throws(() => validateQaIdentity("admin@example.invalid", "qa-http-test"));
  assert.equal(validateQaIdentity("qa-http-1@example.invalid", "qa-http-test"), "qa-http-1@example.invalid");
  assert.equal(validateQaIdentity("3000yf+tokvilo-qa-20261020@gmail.com", "qa-http-test"), "3000yf+tokvilo-qa-20261020@gmail.com");
  for (const address of ["3000yf@gmail.com", "3000yf+ordinary@gmail.com", "tokvilo@gmail.com", "qa-test..bad@example.invalid"]) {
    assert.throws(() => validateQaIdentity(address, "qa-http-test"));
  }
});

test("HTTP QA transport permits only exact production reads and auth writes", () => {
  assert.equal(checkedTarget("/api/auth/login", "POST"), "https://tokvilo.com/api/auth/login");
  for (const [target, method] of [
    ["https://evil.invalid/api/auth/login", "POST"], ["http://tokvilo.com/api/auth/login", "POST"],
    ["/api/keys", "POST"], ["/api/wallet/redeem", "POST"],
    ["/api/tokenhub/v1/chat/completions", "POST"], ["/api/private/openapi?x=1", "GET"],
  ]) assert.throws(() => checkedTarget(target, method));
  assert.equal(checkedTarget("/api/orders", "POST"), "https://tokvilo.com/api/orders");
  assert.throws(() => checkedTarget("/api/auth/register", "POST", { verifiedAccount: true }), /cannot submit a registration/);
  assert.equal(checkedTarget("/api/auth/login", "POST", { verifiedAccount: true }), "https://tokvilo.com/api/auth/login");
});

test("HTTP QA recognizes direct and streamed redirects", () => {
  assert.equal(redirectTarget(new Response(null, { status: 307, headers: { location: "/login" } })), "/login");
  assert.equal(redirectTarget(new Response(""), '<meta http-equiv="refresh" content="0;url=/login"/>'), "/login");
  assert.equal(redirectTarget(new Response(""), "<html>rendered tokvilo</html>"), null);
});

function fixture({ requireEmail = false, resume = false, verifiedAccount = false, checkpoints = verifiedCheckpoints, available = true, orderProbeStatus = 410 } = {}) {
  const calls = [], snapshots = [];
  const credentials = { email: "qa-http-1@example.invalid", password: "private-qa-password-only", runId: "qa-http-test",
    displayName: "QA", ...(resume ? { signupAttemptedAt: "previous-attempt" } : {}), ...(verifiedAccount ? checkpoints : {}) };
  const fetchImpl = async (url, init) => {
    const endpoint = new URL(url).pathname;
    calls.push({ endpoint, method: init.method, authenticated: init.headers.has("cookie"), body: init.body });
    const authenticated = init.headers.get("cookie") === "eco_geo_access=private-session-do-not-print";
    if (endpoint === "/api/auth/status") return Response.json({ configured: true, available,
      signupEnabled: true, emailEnabled: true, emailAutoConfirm: !requireEmail });
    if (endpoint === "/api/auth/register") return Response.json({ ok: true, requiresEmailVerification: false });
    if (endpoint === "/api/auth/login") return Response.json({ ok: true }, { headers: {
      "set-cookie": "eco_geo_access=private-session-do-not-print; Secure; HttpOnly; SameSite=Lax; Path=/",
    } });
    if (endpoint === "/api/auth/logout") return Response.json({ ok: true }, { headers: {
      "set-cookie": "eco_geo_access=; Max-Age=0; Secure; HttpOnly; SameSite=Lax; Path=/",
    } });
    if (endpoint === "/login" || endpoint === "/register") return new Response("<html>tokvilo</html>", { headers: { "content-type": "text/html" } });
    if (!authenticated) return endpoint.startsWith("/api/") ? Response.json({ error: "Unauthorized" }, { status: 401 })
      : new Response(null, { status: 307, headers: { location: "/login" } });
    if (endpoint === "/api/auth/session") return Response.json({ user: { id: "private-qa-user", email: credentials.email, isAdmin: false } });
    if (endpoint === "/api/wallet") return Response.json({ wallet: { currency: "USD", balanceMicrousd: 0,
      reservedMicrousd: 0, ledger: [] }, redemptions: [] });
    if (endpoint === "/api/orders" && init.method === "POST") return Response.json({ error: "Inquiries only.", inquiryUrl: "/products" }, { status: orderProbeStatus });
    if (endpoint === "/api/orders") return Response.json({ orders: [] });
    if (endpoint === "/api/keys") return Response.json({ keys: [] });
    if (endpoint.startsWith("/api/private/")) return Response.json({ openapi: "3.1.0", paths: { "/example": {} } });
    if (endpoint.startsWith("/api/admin/")) return Response.json({ error: "Forbidden" }, { status: 403 });
    if (endpoint === "/admin") return new Response(null, { status: 307, headers: { location: "/dashboard" } });
    return new Response("<html>tokvilo</html>", { headers: { "content-type": "text/html" } });
  };
  return { calls, snapshots, run: () => runHttpVerification({ credentials, verifiedAccount, fetchImpl,
    saveCredentials: async value => snapshots.push(structuredClone(value)) }) };
}

test("HTTP QA covers actual request sequence with memory cookies, no purchases, and logout", async () => {
  const f = fixture(), report = await f.run();
  assert.equal(report.completed, true, report.failure);
  assert.deepEqual(f.calls.filter(call => call.method === "POST").map(call => call.endpoint),
    ["/api/auth/register", "/api/auth/login", "/api/orders", "/api/auth/logout"]);
  assert.equal(f.snapshots[0].signupAttemptedAt !== undefined, true);
  assert.equal(f.snapshots[0].signupConfirmedAt, undefined);
  assert.doesNotMatch(JSON.stringify(report), /private-session|private-qa-password|qa-http-1@example|private-qa-user/);
  assert.equal(f.calls.at(-1).endpoint, "/dashboard");
  assert.equal(f.calls.at(-1).authenticated, false);
});

test("HTTP QA sends no signup/login when registration could send email", async () => {
  const f = fixture({ requireEmail: true }), report = await f.run();
  assert.equal(report.completed, false);
  assert.deepEqual(f.calls.map(call => call.endpoint), ["/api/auth/status"]);
  assert.equal(f.snapshots.length, 0);
});

test("HTTP QA resumes an uncertain signup by login without another registration", async () => {
  const f = fixture({ resume: true }), report = await f.run();
  assert.equal(report.completed, true, report.failure);
  assert.deepEqual(f.calls.filter(call => call.method === "POST").map(call => call.endpoint),
    ["/api/auth/login", "/api/orders", "/api/auth/logout"]);
});

test("verified-account mode accepts email confirmation flows but never registers or sends email", async () => {
  const f = fixture({ requireEmail: true, verifiedAccount: true }), report = await f.run();
  assert.equal(report.completed, true, report.failure);
  assert.equal(report.accountMode, "verified_account_login_only");
  assert.deepEqual(f.calls.filter(call => call.method === "POST").map(call => call.endpoint),
    ["/api/auth/login", "/api/orders", "/api/auth/logout"]);
  assert.equal(f.calls.some(call => call.endpoint === "/api/auth/register"), false);
  assert.deepEqual(JSON.parse(f.calls.find(call => call.endpoint === "/api/orders" && call.method === "POST").body), {});
  assert.equal(f.calls.filter(call => call.endpoint === "/api/wallet" && call.authenticated).length, 2);
  assert.equal(f.calls.filter(call => call.endpoint === "/api/orders" && call.method === "GET" && call.authenticated).length, 2);
  assert.doesNotMatch(JSON.stringify(report), /private-session|private-qa-password|qa-http-1@example|private-qa-user/);
});

test("verified-account mode requires all private verification checkpoints before any HTTP request", async () => {
  for (const missing of Object.keys(verifiedCheckpoints)) {
    const checkpoints = { ...verifiedCheckpoints }; delete checkpoints[missing];
    const f = fixture({ verifiedAccount: true, checkpoints });
    await assert.rejects(() => f.run(), new RegExp(missing));
    assert.equal(f.calls.length, 0);
  }
  assert.throws(() => assertVerifiedAccount({ ...verifiedCheckpoints, emailVerifiedAt: "unverified" }));
  assert.throws(() => assertVerifiedAccount({ ...verifiedCheckpoints, emailVerifiedAt: "2026-10-19T00:00:00.000Z" }), /order/);
  const f = fixture({ verifiedAccount: true, available: false }), report = await f.run();
  assert.equal(report.completed, false);
  assert.deepEqual(f.calls.map(call => call.endpoint), ["/api/auth/status"]);
});

test("verified-account credentials are existing private files and never generated", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "tokvilo-verified-qa-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "credentials.json");
  const email = "3000yf+tokvilo-qa-20261020@gmail.com", runId = "qa-http-test";
  await assert.rejects(() => credentialsAt(filename, email, runId, { verifiedAccount: true }), /existing private credential checkpoint/);
  await assert.rejects(() => readFile(filename), { code: "ENOENT" });
  const value = { email, runId, password: "private-test-password-only-123", ...verifiedCheckpoints };
  await writeFile(filename, JSON.stringify(value), { mode: 0o600 });
  assert.deepEqual(await credentialsAt(filename, email, runId, { verifiedAccount: true }), value);
  await writeFile(filename, JSON.stringify({ ...value, emailVerifiedAt: null }));
  await assert.rejects(() => credentialsAt(filename, email, runId, { verifiedAccount: true }), /emailVerifiedAt/);
});

test("the retired-order rejection probe must return 410 and runs logout after a failed check", async () => {
  const f = fixture({ verifiedAccount: true, orderProbeStatus: 200 }), report = await f.run();
  assert.equal(report.completed, false);
  assert.match(report.failure, /not rejected with HTTP 410/);
  assert.equal(f.calls.some(call => call.endpoint === "/api/auth/logout"), true);
  assert.deepEqual(JSON.parse(f.calls.find(call => call.endpoint === "/api/orders" && call.method === "POST").body), {});
});

test("public product POST returns 410 without entering the legacy wallet order module", async () => {
  const filename = new URL("../app/api/orders/route.ts", import.meta.url).pathname;
  const code = ts.transpileModule(await readFile(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} }; let legacyCalls = 0;
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, Response,
    require(name) { assert.equal(name, "@/lib/orders"); return { handleOrders() { legacyCalls++; throw new Error("Unexpected legacy mutation"); } }; },
  });
  const response = compiledModule.exports.POST(new Request("https://tokvilo.com/api/orders", { method: "POST", body: JSON.stringify({ confirmed: true }) }));
  assert.equal(response.status, 410);
  assert.equal((await response.json()).inquiryUrl, "/products");
  assert.equal(legacyCalls, 0);
  assert.equal(typeof compiledModule.exports.GET, "function");
  assert.equal(typeof compiledModule.exports.PATCH, "function");
});
