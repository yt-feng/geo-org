import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(file, mocks = {}) {
  const filename = new URL(file, import.meta.url).pathname;
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, { module: mod, exports: mod.exports,
    require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; throw new Error(`Unexpected dependency ${name}`); },
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Request, Response, URL,
    btoa, setTimeout, clearTimeout,
  }, { filename });
  return mod.exports;
}
const products = await load("../lib/products.ts");
const sql = (await Promise.all((await readdir(new URL("../drizzle/", import.meta.url)))
  .filter(name => name.endsWith(".sql")).sort().map(name => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")))).join("\n");
const INPUT = { productId: "plus-ios", email: "qa-inquiry@example.invalid", name: "QA", message: "希望了解具体交付时间。" };
function request(input = INPUT, { key = "inquiry-test-001", origin = "https://tokvilo.com", ip = "192.0.2.10", method = "POST" } = {}) {
  return new Request("https://tokvilo.com/api/product-inquiries", { method,
    headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": key, "cf-connecting-ip": ip },
    ...(method === "POST" ? { body: typeof input === "string" ? input : JSON.stringify(input) } : {}),
  });
}
async function fixture(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec(sql); t.after(() => sqlite.close());
  const DB = { prepare(query) {
    const statement = sqlite.prepare(query);
    const bound = (args = []) => ({ bind: (...next) => bound(next),
      first: async () => statement.get(...args) || null,
      all: async () => ({ success: true, results: statement.all(...args) }),
      run: async () => ({ success: true, meta: { changes: statement.run(...args).changes } }),
    });
    return bound();
  } };
  const sent = [];
  const env = { DB, ...(options.configured ? {
    PRODUCT_INQUIRY_EMAIL_ENABLED: "true", PRODUCT_INQUIRY_FROM: "orders@tokvilo.com",
    PRODUCT_INQUIRY_EMAIL: { send: async message => { sent.push(message); if (options.send) return options.send(message); } },
  } : {}), ...options.env };
  const inquiryModule = await load("../lib/product-inquiries.ts", {
    "cloudflare:email": { EmailMessage: class { constructor(from, to, raw) { Object.assign(this, { from, to, raw }); } } },
    "./config": { runtimeEnv: () => env, getD1: () => DB },
    "./crypto": { sha256Hex: async value => createHash("sha256").update(value).digest("hex") },
    "./products": products,
  });
  return { ...inquiryModule, sqlite, env, sent };
}
async function expect(f, req, status) {
  const response = await f.handleProductInquiry(req);
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response.json();
}

test("public inquiries persist exact product price snapshots without touching wallet or orders", async t => {
  const f = await fixture(t), result = await expect(f, request(), 201);
  assert.equal(result.ok, true); assert.equal(result.emailStatus, "pending");
  const row = f.sqlite.prepare("SELECT * FROM product_inquiries WHERE id=?").get(result.inquiryId);
  const product = products.digitalProducts.find(item => item.id === INPUT.productId);
  assert.equal(row.retail_cents, product.retailCents);
  assert.equal(row.upstream_cents, product.upstreamCents);
  assert.equal(row.source_url, products.productSourceAudit[product.id].sourceUrl);
  assert.equal(row.customer_email, INPUT.email);
  assert.equal(row.email_attempts, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM wallet_reservations").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM digital_orders").get().n, 0);
  assert.equal(f.sent.length, 0);
});

test("idempotent replays return one inquiry while changed content conflicts", async t => {
  const f = await fixture(t, { configured: true });
  const first = await expect(f, request(), 201), second = await expect(f, request(), 200);
  assert.deepEqual(second, first); assert.equal(first.emailStatus, "sent");
  await expect(f, request({ ...INPUT, message: "另一份需求。" }), 409);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM product_inquiries").get().n, 1);
  assert.equal(f.sent.length, 1);
});

test("sender and recipient are fixed, reply-to is validated and customer text stays in the MIME body", async t => {
  const f = await fixture(t, { configured: true });
  const message = "特殊需求\nBcc: attacker@example.invalid\n<script>alert(1)</script>";
  await expect(f, request({ ...INPUT, message }), 201);
  const email = f.sent[0];
  assert.equal(email.from, "orders@tokvilo.com");
  assert.equal(email.to, "yt.feng@foxmail.com");
  const [headers, body] = email.raw.split("\r\n\r\n");
  assert.match(headers, /Reply-To: qa-inquiry@example.invalid/);
  assert.doesNotMatch(headers, /Bcc:|<script>|特殊需求/);
  assert.match(Buffer.from(body.replaceAll("\r\n", ""), "base64").toString("utf8"), /特殊需求\nBcc: attacker@example.invalid/);
  assert.match(headers, /Message-ID: <inquiry\.[a-f0-9-]+@tokvilo\.com>/);
});

test("invalid input, origin, method, oversized JSON and email header injection are rejected without persistence", async t => {
  const f = await fixture(t, { configured: true });
  for (const [req, status] of [
    [request(INPUT, { origin: "https://another.invalid" }), 403], [request(INPUT, { method: "GET" }), 405],
    [request(INPUT, { key: "" }), 400], [request({ ...INPUT, email: "a@example.com\r\nBcc: b@example.com" }), 400],
    [request({ ...INPUT, name: "person\nBcc: a@example.com" }), 400], [request({ ...INPUT, message: "" }), 400],
    [request({ ...INPUT, message: "x".repeat(4001) }), 400], [request({ ...INPUT, message: "中".repeat(6000) }), 413],
    [request({ ...INPUT, recipient: "attacker@example.invalid" }), 400], [request({ ...INPUT, retailCents: 1 }), 400],
    [request({ ...INPUT, productId: "not-a-product" }), 404], [request("not-json"), 400],
  ]) await expect(f, req, status);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM product_inquiries").get().n, 0);
  assert.equal(f.sent.length, 0);
});

test("five new inquiries per IP per hour, with receipt replays outside the quota", async t => {
  const f = await fixture(t);
  for (let index = 0; index < 5; index++) await expect(f, request(INPUT, { key: `inquiry-key-${index}` }), 201);
  await expect(f, request(INPUT, { key: "inquiry-key-5" }), 429);
  await expect(f, request(INPUT, { key: "inquiry-key-0" }), 200);
  await expect(f, request(INPUT, { key: "inquiry-other-ip", ip: "192.0.2.11" }), 201);
});

test("failed email remains pending, cron respects leases and settles only existing queue entries", async t => {
  let fail = true;
  const f = await fixture(t, { configured: true, send: async () => { if (fail) throw Error("private SMTP diagnostic"); } });
  const first = await expect(f, request(), 201);
  assert.equal(first.emailStatus, "pending"); assert.equal(f.sent.length, 1);
  assert.equal((await f.reconcileProductInquiries(f.env)).examined, 0);
  f.sqlite.prepare("UPDATE product_inquiries SET next_attempt_at=datetime('now','-1 minute')").run();
  fail = false;
  const reconciled = await f.reconcileProductInquiries(f.env);
  assert.equal(reconciled.sent, 1); assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].raw.match(/Message-ID: (.*)/)[1], f.sent[1].raw.match(/Message-ID: (.*)/)[1]);
  assert.equal((await expect(f, request(), 200)).emailStatus, "sent");
  assert.equal((await f.reconcileProductInquiries(f.env)).examined, 0);
  assert.equal(f.sqlite.prepare("SELECT last_email_error FROM product_inquiries").get().last_email_error, null);
});

test("simultaneous submission sends once and retry bounds retain unresolved inquiries", async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = await fixture(t, { configured: true, send: () => pending });
  const first = f.handleProductInquiry(request());
  while (f.sent.length === 0) await new Promise(resolve => setImmediate(resolve));
  const second = await expect(f, request(), 200);
  assert.equal(second.emailStatus, "pending"); assert.equal(f.sent.length, 1);
  finish(); assert.equal((await (await first).json()).emailStatus, "sent");
  f.sqlite.prepare("UPDATE product_inquiries SET email_status='pending',email_attempts=12,next_attempt_at=datetime('now','-1 minute')").run();
  assert.equal((await f.reconcileProductInquiries(f.env)).examined, 0);
  assert.equal(f.sent.length, 1);
});
