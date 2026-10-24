import { randomBytes } from "node:crypto";
import { mkdir, lstat, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = "https://tokvilo.com";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE_APIS = [
  "/api/auth/session", "/api/wallet", "/api/orders", "/api/keys",
  "/api/private/studio-openapi", "/api/private/gateway-openapi", "/api/private/openapi",
];
const MEMBER_PAGES = [
  "/dashboard", "/dashboard/docs", "/dashboard/wallet", "/dashboard/orders",
  "/dashboard/keys", "/studio", "/playground",
];
const WRITE_PATHS = new Set(["/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/orders"]);
const READ_PATHS = new Set([
  "/api/auth/status", "/api/billing/config", "/login", "/register", "/admin",
  "/api/admin/orders", "/api/admin/providers", ...PRIVATE_APIS, ...MEMBER_PAGES,
]);

function requireThat(value, message) { if (!value) throw new Error(message); }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }

export function validateQaIdentity(email, runId) {
  requireThat(typeof email === "string" && email.length <= 254 &&
    /^(?:(?:qa|tokvilo-qa)[+._-][a-z0-9._+-]+|[a-z0-9][a-z0-9._-]*\+tokvilo-qa[+._-][a-z0-9._+-]+)@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(email) &&
    email.split("@")[0].length <= 64 && !email.includes(".."),
  "Provide a dedicated --qa-email with a qa-/tokvilo-qa- prefix or a +tokvilo-qa- marker.");
  requireThat(/^[a-zA-Z0-9_-]{8,60}$/.test(runId || ""), "Provide a stable 8–60 character --run-id.");
  return email.trim().toLowerCase();
}

export function assertVerifiedAccount(credentials) {
  const dates = ["signupAttemptedAt", "signupConfirmedAt", "emailVerifiedAt"].map(field => {
    const value = credentials[field];
    requireThat(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
      `Verified-account mode requires a private ${field} checkpoint.`);
    return Date.parse(value);
  });
  requireThat(dates[0] <= dates[1] && dates[1] <= dates[2],
    "Verified-account checkpoints must follow signup, confirmation and email verification order.");
}

export function assertNoEmailSignup(status) {
  requireThat(status.configured === true && status.available === true &&
    status.signupEnabled === true && status.emailEnabled === true,
  "Registration is unavailable; no registration request was sent.");
  // GoTrue's explicit auto-confirm setting, or a future local-auth contract.
  // A provider label alone never authorizes registration.
  requireThat(status.registrationSendsEmail === false ||
    (status.emailAutoConfirm === true && status.registrationSendsEmail !== true),
  "The service has not explicitly confirmed a no-email signup flow; no registration request was sent.");
}

export function checkedTarget(target, method = "GET", { verifiedAccount = false } = {}) {
  const url = new URL(target, ORIGIN);
  requireThat(url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash,
    "HTTP QA only supports exact https://tokvilo.com endpoints.");
  requireThat((method === "GET" && READ_PATHS.has(url.pathname)) ||
    (method === "POST" && WRITE_PATHS.has(url.pathname)), "This HTTP operation is outside the QA allowlist.");
  requireThat(!(verifiedAccount && method === "POST" && url.pathname === "/api/auth/register"),
    "Verified-account mode cannot submit a registration request.");
  return url.href;
}

export function redirectTarget(response, html = "") {
  if (response.status >= 300 && response.status < 400) return response.headers.get("location");
  // React can emit a navigation after streaming HTML has already begun.
  const meta = html.match(/<meta\b(?=[^>]*http-equiv=["']refresh["'])[^>]*content=["'][^"']*?url=([^"']+)["'][^>]*>/i);
  return meta?.[1]?.replaceAll("&amp;", "&") || null;
}

async function privateWrite(filename, data, exclusive = false) {
  const temp = exclusive ? filename : `${filename}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  if (!exclusive) await rename(temp, filename);
}

async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  requireThat(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0,
    "The QA artifact directory must be a private directory (0700).");
}

export async function credentialsAt(filename, email, runId, { verifiedAccount = false } = {}) {
  try {
    const info = await lstat(filename);
    requireThat(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o600 &&
      (typeof process.getuid !== "function" || info.uid === process.getuid()),
    "Existing QA credentials must be an owned regular file with mode 0600.");
    const value = JSON.parse(await readFile(filename, "utf8"));
    requireThat(value.email === email && value.runId === runId &&
      typeof value.password === "string" && value.password.length >= 24,
    "Existing QA credentials do not match this QA email/run.");
    if (verifiedAccount) assertVerifiedAccount(value);
    return value;
  } catch (cause) {
    if (cause.code !== "ENOENT") throw cause;
    requireThat(!verifiedAccount, "Verified-account mode requires an existing private credential checkpoint; no account was created.");
    const value = { email, runId, password: `Qa!${randomBytes(30).toString("base64url")}`,
      displayName: "Tokvilo HTTP QA — no purchases", createdAt: new Date().toISOString() };
    await privateWrite(filename, value, true);
    return value;
  }
}

/** Actual HTTP with a memory-only cookie jar. fetchImpl is injectable for offline tests. */
export async function runHttpVerification({ credentials, saveCredentials, verifiedAccount = false, fetchImpl = fetch, onStep = () => {} }) {
  validateQaIdentity(credentials.email, credentials.runId);
  requireThat(typeof verifiedAccount === "boolean", "Select verified-account mode explicitly.");
  if (verifiedAccount) assertVerifiedAccount(credentials);
  const jar = new Map();
  const steps = [];
  let attemptedLogin = false;
  const step = (name, details = {}) => { const entry = { name, ...details }; steps.push(entry); onStep(entry); };
  async function request(target, { method = "GET", body, authenticated = false } = {}) {
    const url = checkedTarget(target, method, { verifiedAccount });
    requireThat(!(method === "POST" && new URL(url).pathname === "/api/orders") ||
      body && Object.keys(body).length === 0,
    "The retired-order check permits only an empty rejection probe.");
    const headers = new Headers({ accept: "application/json, text/html", "cache-control": "no-cache" });
    if (method === "POST") { headers.set("content-type", "application/json"); headers.set("origin", ORIGIN); }
    if (authenticated && jar.size) headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
    let response;
    try {
      response = await fetchImpl(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new Error(`${method} ${target} did not return a response. No automatic retry was made.`);
    }
    if (authenticated) {
      for (const cookie of response.headers.getSetCookie()) {
        const first = cookie.split(";")[0], separator = first.indexOf("=");
        requireThat(separator > 0, `${target} returned an invalid session cookie.`);
        const name = first.slice(0, separator), value = first.slice(separator + 1);
        if (!value || /;\s*max-age=0(?:;|$)/i.test(cookie)) jar.delete(name);
        else {
          requireThat(/;\s*secure(?:;|$)/i.test(cookie) && /;\s*httponly(?:;|$)/i.test(cookie) &&
            /;\s*samesite=(?:lax|strict)(?:;|$)/i.test(cookie),
          `${target} returned a session cookie without the required browser protections.`);
          jar.set(name, value);
        }
      }
    }
    const chunks = []; let length = 0;
    const reader = response.body?.getReader();
    if (reader) try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.length;
        if (length > 12 * 1024 * 1024) { await reader.cancel(); throw new Error(`${target} response exceeded the QA size limit.`); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const text = Buffer.concat(chunks).toString("utf8");
    let json = null; try { json = JSON.parse(text); } catch { /* HTML responses are expected. */ }
    return { response, text, json: object(json) };
  }
  async function expectedJson(target, expected, authenticated = false) {
    const result = await request(target, { authenticated });
    requireThat(result.response.status === expected, `${target}: expected HTTP ${expected}, received ${result.response.status}.`);
    requireThat(result.response.headers.get("content-type")?.includes("application/json"), `${target}: expected JSON.`);
    step(`${authenticated ? "member" : "anonymous"} ${target}`, { status: expected });
    return result.json;
  }
  async function expectedRedirect(target, destination, authenticated = false) {
    const result = await request(target, { authenticated });
    const location = redirectTarget(result.response, result.text);
    requireThat(location && new URL(location, ORIGIN).href === `${ORIGIN}${destination}`,
      `${target}: expected a same-origin redirect to ${destination}.`);
    step(`${authenticated ? "member" : "anonymous"} ${target}`, {
      status: result.response.status, redirect: destination,
      transport: result.response.status === 200 ? "streamed_html_redirect" : "http_redirect",
    });
  }
  async function expectedPage(target, authenticated = false) {
    const result = await request(target, { authenticated });
    requireThat(result.response.status === 200 && result.response.headers.get("content-type")?.includes("text/html") &&
      !redirectTarget(result.response, result.text) && /tokvilo/i.test(result.text),
    `${target}: expected a rendered tokvilo page without a redirect.`);
    step(`${authenticated ? "member" : "anonymous"} ${target}`, { status: 200 });
  }
  let failure = null;
  try {
    const status = await expectedJson("/api/auth/status", 200);
    if (verifiedAccount) {
      requireThat(status.configured === true && status.available === true,
        "Authentication is unavailable; no login request was sent.");
      step("verified QA account checkpoint confirmed", { registrationAllowed: false });
    } else {
      assertNoEmailSignup(status);
      step("no-email signup contract confirmed", { emailAutoConfirm: status.emailAutoConfirm === true,
        registrationSendsEmail: status.registrationSendsEmail === false ? false : null });
    }
    for (const target of PRIVATE_APIS) await expectedJson(target, 401);
    for (const target of [...MEMBER_PAGES, "/admin"]) await expectedRedirect(target, "/login");
    await expectedPage("/login"); await expectedPage("/register");
    if (!verifiedAccount && !credentials.signupAttemptedAt) {
      credentials.signupAttemptedAt = new Date().toISOString();
      await saveCredentials(credentials); // Persist before the only signup attempt.
      const result = await request("/api/auth/register", { method: "POST", body: {
        email: credentials.email, password: credentials.password, displayName: credentials.displayName,
      } });
      requireThat(result.response.ok && result.json.ok === true && result.json.requiresEmailVerification === false,
        `Signup did not confirm a no-email account (HTTP ${result.response.status}). Keep the private checkpoint; a later run only attempts login.`);
      credentials.signupConfirmedAt = new Date().toISOString();
      await saveCredentials(credentials);
      step("QA account signup", { status: result.response.status });
    } else step("signup not repeated", { reason: verifiedAccount ? "verified-account mode; registration disabled" : "existing private checkpoint; login only" });
    attemptedLogin = true;
    const login = await request("/api/auth/login", { method: "POST", authenticated: true,
      body: { email: credentials.email, password: credentials.password } });
    requireThat(login.response.ok && login.json.ok === true && jar.size > 0,
      `Login failed (HTTP ${login.response.status}); no credentials or upstream response were printed.`);
    step("QA account login", { status: login.response.status, sessionCookiePresent: true });
    const session = await expectedJson("/api/auth/session", 200, true);
    requireThat(session.user?.email?.toLowerCase() === credentials.email && session.user.isAdmin === false &&
      typeof session.user.id === "string" && session.user.id.length > 0,
    "Session is not the expected ordinary QA account.");
    credentials.userId = session.user.id; await saveCredentials(credentials);
    const wallet = await expectedJson("/api/wallet", 200, true);
    requireThat(wallet.wallet?.currency === "USD" && wallet.wallet.balanceMicrousd === 0 &&
      wallet.wallet.reservedMicrousd === 0 && Array.isArray(wallet.wallet.ledger) && wallet.wallet.ledger.length === 0 &&
      Array.isArray(wallet.redemptions) && wallet.redemptions.length === 0, "QA wallet is not empty; this is not an unused QA account.");
    const orders = await expectedJson("/api/orders", 200, true);
    requireThat(Array.isArray(orders.orders) && orders.orders.length === 0, "QA account has existing orders.");
    const retiredOrder = await request("/api/orders", { method: "POST", authenticated: true, body: {} });
    requireThat(retiredOrder.response.status === 410 && retiredOrder.json.inquiryUrl === "/products",
      "New wallet-funded product orders were not rejected with HTTP 410.");
    step("retired product checkout rejected", { status: 410, body: "empty rejection probe" });
    const walletAfterProbe = await expectedJson("/api/wallet", 200, true);
    requireThat(walletAfterProbe.wallet?.balanceMicrousd === 0 && walletAfterProbe.wallet?.reservedMicrousd === 0 &&
      Array.isArray(walletAfterProbe.wallet?.ledger) && walletAfterProbe.wallet.ledger.length === 0,
    "The retired-order probe changed the empty QA wallet.");
    const ordersAfterProbe = await expectedJson("/api/orders", 200, true);
    requireThat(Array.isArray(ordersAfterProbe.orders) && ordersAfterProbe.orders.length === 0,
      "The retired-order probe created an order.");
    const keys = await expectedJson("/api/keys", 200, true);
    requireThat(Array.isArray(keys.keys) && keys.keys.length === 0, "QA account has existing API keys.");
    for (const target of PRIVATE_APIS.filter(target => target.startsWith("/api/private/"))) {
      const doc = await expectedJson(target, 200, true);
      requireThat(typeof doc.openapi === "string" && Object.keys(object(doc.paths)).length > 0,
        `${target}: OpenAPI document is empty or invalid.`);
    }
    for (const target of MEMBER_PAGES) await expectedPage(target, true);
    await expectedRedirect("/admin", "/dashboard", true);
    await expectedJson("/api/admin/orders", 403, true);
    await expectedJson("/api/admin/providers", 403, true);
  } catch (cause) {
    failure = cause instanceof Error ? cause.message : "HTTP QA failed.";
  } finally {
    if (attemptedLogin) {
      try {
        const logout = await request("/api/auth/logout", { method: "POST", authenticated: true, body: {} });
        requireThat(logout.response.ok && logout.json.ok === true && jar.size === 0, "Logout did not clear all QA cookies.");
        step("QA account logout", { status: logout.response.status, sessionCookiesCleared: true });
        await expectedJson("/api/auth/session", 401, true);
        await expectedRedirect("/dashboard", "/login", true);
      } catch (cause) {
        failure ||= cause instanceof Error ? cause.message : "HTTP QA logout failed.";
      }
    }
    jar.clear();
  }
  return { completed: !failure, ...(failure ? { failure } : {}), origin: ORIGIN, scope: "actual_HTTP_QA_account",
    accountMode: verifiedAccount ? "verified_account_login_only" : "no_email_signup",
    realPayments: 0, paidGeneration: 0, ordersCreated: 0, keysCreated: 0,
    sessionsPersisted: false, accountRetained: true, steps };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (["--execute", "--plan", "--verified-account"].includes(args[i])) options[args[i].slice(2)] = true;
    else if (["--qa-email", "--run-id"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("--")) options[args[i].slice(2)] = args[++i];
    else throw new Error("Usage: node scripts/verify-tokvilo-http.mjs [--plan | --execute --qa-email QA_EMAIL --run-id RUN_ID] [--verified-account]");
  }
  requireThat(!(options.plan && options.execute), "Choose either --plan or --execute.");
  const verifiedAccount = options["verified-account"] === true;
  if (!options.execute) {
    process.stdout.write(JSON.stringify({
      mode: "plan_only_no_credentials_read_no_remote_requests", origin: ORIGIN,
      accountMode: verifiedAccount ? "verified_account_login_only" : "no_email_signup",
      requiredArguments: ["--execute", ...(verifiedAccount ? ["--verified-account"] : []), "--qa-email qa-UNIQUE@YOUR-DOMAIN", "--run-id qa-http-UNIQUE"],
      credentials: ".artifacts/tokvilo-private/http/<run-id>/credentials.json (0600); report.json contains no credentials",
      steps: [verifiedAccount ? "Require private signupAttemptedAt/signupConfirmedAt/emailVerifiedAt checkpoints and available authentication" : "Check explicit no-email registration configuration", "Verify anonymous 401s and redirects",
        verifiedAccount ? "Login only; registration transport is disabled" : "Register one QA account, or login only on a checkpoint retry", "Verify login cookies and the expected non-admin session",
        "Verify zero wallet/ledger, empty orders and API keys", "Read three protected OpenAPI sources and member pages",
        "Verify empty POST /api/orders returns 410 without changing wallet or orders",
        "Verify member cannot access admin pages/APIs", "Logout, verify 401 and login redirect"],
      allowedWrites: [...WRITE_PATHS].filter(endpoint => !verifiedAccount || endpoint !== "/api/auth/register"),
      orderProbe: { endpoint: "/api/orders", method: "POST", body: {}, expectedStatus: 410 },
      realPayments: 0, paidGeneration: 0, ordersCreated: 0, keysCreated: 0,
      accountLifecycle: "QA account remains with zero balance and no keys; user ID is retained only in the private credentials file.",
      limitations: "HTTP checks do not exercise browser hydration or prove SMTP delivery behavior beyond the explicit service configuration.",
    }, null, 2) + "\n"); return;
  }
  const email = validateQaIdentity(options["qa-email"], options["run-id"]);
  const directory = path.join(ROOT, ".artifacts", "tokvilo-private", "http", options["run-id"]);
  await privateDirectory(directory);
  const credentialPath = path.join(directory, "credentials.json");
  const credentials = await credentialsAt(credentialPath, email, options["run-id"], { verifiedAccount });
  const report = await runHttpVerification({ credentials, verifiedAccount,
    saveCredentials: value => privateWrite(credentialPath, value),
    onStep: entry => process.stdout.write(`PASS ${entry.name}${entry.status ? ` HTTP ${entry.status}` : ""}\n`),
  });
  const reportPath = path.join(directory, "report.json");
  await privateWrite(reportPath, { ...report, checkedAt: new Date().toISOString() });
  process.stdout.write(JSON.stringify({ completed: report.completed, reportPath,
    ...(report.failure ? { failure: report.failure } : {}) }) + "\n");
  if (!report.completed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  // Avoid exposing credentials/response bodies through filesystem or fetch errors.
  process.stderr.write("HTTP QA could not start. Check the explicit QA email/run ID and private artifact permissions; no credentials were printed.\n");
  process.exitCode = 1;
});
