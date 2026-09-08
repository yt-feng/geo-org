import assert from "node:assert/strict";
import test from "node:test";
import worker from "../contact-service/worker.mjs";

const VALID = {
  name: "示例访客",
  email: "visitor@example.net",
  company: "Example Brand",
  website: "https://example.net/project",
  message: "We would like to discuss our brand and AI search visibility.",
  locale: "zh",
  website_confirm: "",
};

function setup(overrides = {}) {
  const sends = [];
  const limits = [];
  return {
    sends,
    limits,
    env: {
      CONTACT_FROM_EMAIL: "info@eco-geo.com",
      CONTACT_NOTIFY_TO: "owner@example.org",
      CONTACT_RATE_LIMIT: { async limit(value) { limits.push(value); return { success: true }; } },
      EMAIL: { async send(value) { sends.push(value); return { messageId: "provider-id" }; } },
      ...overrides,
    },
  };
}

function request(payload = VALID, options = {}) {
  return new Request("https://contact.example.org/api/contact", {
    method: "POST",
    headers: {
      Origin: "https://eco-geo.org",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.1",
      ...options.headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

test("both site origins can preflight without sending a message", async () => {
  for (const origin of ["https://eco-geo.org", "https://www.eco-geo.org"]) {
    const { env, sends, limits } = setup();
    const response = await worker.fetch(new Request("https://contact.example.org/api/contact", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    }), env);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(sends.length, 0);
    assert.equal(limits.length, 0);
  }
});

test("unapproved, deceptive, and missing origins cannot send", async () => {
  for (const origin of ["https://evil.example", "https://eco-geo.org.evil.example", "http://eco-geo.org", "null", ""]) {
    const { env, sends, limits } = setup();
    const response = await worker.fetch(request(VALID, { headers: { Origin: origin } }), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(sends.length, 0);
    assert.equal(limits.length, 0);
  }
});

test("preflight does not authorize unrelated methods or headers", async () => {
  for (const headers of [{ "Access-Control-Request-Method": "DELETE" }, { "Access-Control-Request-Headers": "authorization" }]) {
    const { env, sends } = setup();
    const response = await worker.fetch(new Request("https://contact.example.org/api/contact", {
      method: "OPTIONS", headers: { Origin: "https://eco-geo.org", ...headers },
    }), env);
    assert.equal(response.status, 403);
    assert.equal(sends.length, 0);
  }
});

test("health reports binding readiness without contacting the provider", async () => {
  const { env, sends } = setup();
  const healthy = await worker.fetch(new Request("https://contact.example.org/health"), env);
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), { ok: true, service: "eco-geo-contact" });
  const unavailable = await worker.fetch(new Request("https://contact.example.org/health"), {});
  assert.equal(unavailable.status, 503);
  assert.equal(sends.length, 0);
});

test("non-JSON, invalid JSON, and array payloads cannot send", async () => {
  for (const candidate of [
    request(VALID, { headers: { "Content-Type": "text/plain" } }),
    request("not JSON"), request("[]"), request("null"),
  ]) {
    const { env, sends } = setup();
    const response = await worker.fetch(candidate, env);
    assert.ok([400, 415].includes(response.status));
    assert.equal(sends.length, 0);
  }
});

test("field bounds, types, email headers, and URL schemes are enforced", async () => {
  const bad = [
    { name: "A" }, { name: "A".repeat(101) }, { name: "Name\nBcc: injected@example.org" },
    { email: "visitor@example.net\r\nBcc: injected@example.org" },
    { email: "not-an-email" }, { email: "a".repeat(65) + "@example.net" },
    { email: "a".repeat(64) + "@" + "a".repeat(63) + "." + "a".repeat(63) + "." + "a".repeat(63) + ".com" },
    { company: "C".repeat(161) }, { company: "Brand\r\nBcc: injected@example.org" },
    { company: {} }, { website: "javascript:alert(1)" }, { website: "ftp://example.net/file" },
    { website: "https://user:password@example.net" }, { website: "https://example.net/" + "x".repeat(2048) },
    { message: "short" }, { message: "x".repeat(5001) }, { message: "Long text\u0000control" },
    { locale: "fr" }, { locale: null }, { website_confirm: "autofilled bot" },
  ];
  for (const fields of bad) {
    const { env, sends } = setup();
    const response = await worker.fetch(request({ ...VALID, ...fields }), env);
    assert.equal(response.status, 400, `accepted invalid field ${Object.keys(fields)[0]}`);
    assert.equal(sends.length, 0);
    const body = await response.text();
    assert.ok(!body.includes(VALID.email));
    assert.ok(!body.includes("injected@example.org"));
  }
});

test("client sender, recipients, reply-to, and header overrides are rejected", async () => {
  for (const field of ["to", "from", "replyTo", "cc", "bcc", "headers"]) {
    const { env, sends } = setup();
    const response = await worker.fetch(request({ ...VALID, [field]: "other@example.net" }), env);
    assert.equal(response.status, 400);
    assert.equal(sends.length, 0);
  }
});

test("the byte limit applies to actual UTF-8 bytes and misleading Content-Length", async () => {
  const oversized = { ...VALID, message: "中".repeat(4100) };
  for (const headers of [{}, { "Content-Length": "10" }, { "Content-Length": "12001" }]) {
    const { env, sends } = setup();
    const response = await worker.fetch(request(oversized, { headers }), env);
    assert.equal(response.status, 413);
    assert.equal(sends.length, 0);
  }
});

test("chunked request streams stop at the byte limit", async () => {
  let cancelled = false;
  const source = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(12001)); },
    cancel() { cancelled = true; },
  });
  const { env, sends } = setup();
  const response = await worker.fetch(new Request("https://contact.example.org/api/contact", {
    method: "POST", duplex: "half", body: source,
    headers: { Origin: "https://eco-geo.org", "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
  }), env);
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(sends.length, 0);
});

test("missing bindings or invalid server email configuration fail closed", async () => {
  for (const overrides of [
    { EMAIL: undefined }, { CONTACT_RATE_LIMIT: undefined },
    { CONTACT_FROM_EMAIL: "" }, { CONTACT_NOTIFY_TO: "" },
    { CONTACT_NOTIFY_TO: "owner@example.org\r\nBcc: other@example.org" },
  ]) {
    const { env, sends } = setup(overrides);
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 503);
    assert.equal(sends.length, 0);
  }
});

test("rate limiting uses the Cloudflare client IP and blocks excess requests", async () => {
  const keys = [];
  const { env, sends } = setup({ CONTACT_RATE_LIMIT: { async limit(value) { keys.push(value); return { success: false }; } } });
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 429);
  assert.deepEqual(keys, [{ key: "192.0.2.1" }]);
  assert.equal(sends.length, 0);
});

test("missing client IP or an unavailable limiter cannot bypass limiting", async () => {
  for (const limiter of [
    { async limit() { throw new Error("private diagnostic"); } },
    { async limit() { return {}; } },
  ]) {
    const { env, sends } = setup({ CONTACT_RATE_LIMIT: limiter });
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 503);
    assert.equal(sends.length, 0);
    assert.ok(!(await response.text()).includes("private diagnostic"));
  }
  const { env, sends } = setup();
  const response = await worker.fetch(request(VALID, { headers: { "CF-Connecting-IP": "" } }), env);
  assert.equal(response.status, 503);
  assert.equal(sends.length, 0);
});

test("provider failure and missing acceptance IDs are never reported as success", async () => {
  const senders = [
    async () => { throw new Error("visitor@example.net provider diagnostic"); },
    async () => undefined, async () => ({}), async () => ({ messageId: "" }),
    async () => ({ messageId: "   " }), async () => ({ messageId: 123 }),
  ];
  for (const send of senders) {
    const { env } = setup({ EMAIL: { send } });
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: "service_unavailable" });
  }
});

test("permanent bounces, suppressed recipients, and unaccepted targets fail despite a message ID", async () => {
  const failed = [
    { permanentBounces: ["owner@example.org"] },
    { suppressedRecipients: ["owner@example.org"] },
    { permanent_bounces: ["owner@example.org"] },
    { suppressed_recipients: ["owner@example.org"] },
    { permanentBounces: "owner@example.org" },
    { suppressedRecipients: null },
    { delivered: [], queued: [] },
    { delivered: ["other@example.org"] },
    { queued: "owner@example.org" },
    { queued: ["owner@example.org"], permanentBounces: ["owner@example.org"] },
  ];
  for (const outcomes of failed) {
    const { env } = setup({ EMAIL: { async send() { return { messageId: "provider-id", ...outcomes }; } } });
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: "service_unavailable" });
  }
});

test("an accepted recipient with no adverse outcome succeeds for queued or delivered mail", async () => {
  for (const outcomes of [
    { permanentBounces: [], suppressedRecipients: [] },
    { delivered: ["owner@example.org"], queued: [], permanentBounces: [], suppressedRecipients: [] },
    { delivered: [], queued: ["owner@example.org"], permanentBounces: [], suppressedRecipients: [] },
  ]) {
    const { env } = setup({ EMAIL: { async send() { return { messageId: "provider-id", ...outcomes }; } } });
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  }
});

test("successful requests use only server addresses and return a traceable request ID", async () => {
  for (const locale of ["zh", "en", "ar"]) {
    const { env, sends, limits } = setup();
    const response = await worker.fetch(request({ ...VALID, locale }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://eco-geo.org");
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.match(result.requestId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(Object.keys(result).sort(), ["ok", "requestId"]);
    assert.deepEqual(limits, [{ key: "192.0.2.1" }]);
    assert.equal(sends.length, 1);
    const message = sends[0];
    assert.equal(message.to, env.CONTACT_NOTIFY_TO);
    assert.deepEqual(message.from, { email: env.CONTACT_FROM_EMAIL, name: "Eco GEO" });
    assert.equal(message.replyTo, VALID.email);
    assert.equal(message.subject, "Eco GEO 官网咨询 · Example Brand");
    assert.ok(message.text.includes(result.requestId));
    assert.ok(message.text.includes(VALID.name));
    assert.ok(message.text.includes(VALID.email));
    assert.ok(message.text.includes(VALID.message));
    assert.match(message.text, /提交时间：\d{4}-\d\d-\d\dT/);
    assert.ok(message.text.includes(`页面语言：${locale}`));
  }
});

test("optional company, website, and honeypot fields may be omitted", async () => {
  const { company, website, website_confirm, ...payload } = VALID;
  const { env, sends } = setup();
  const response = await worker.fetch(request(payload), env);
  assert.equal(response.status, 200);
  assert.equal(sends[0].subject, "Eco GEO 官网咨询");
  assert.ok(sends[0].text.includes("网站：未填写"));
});

test("unrelated paths and unsupported methods never send", async () => {
  const { env, sends } = setup();
  for (const [url, status] of [["https://contact.example.org/", 404], ["https://contact.example.org/api/contact", 405]]) {
    const response = await worker.fetch(new Request(url, { headers: { Origin: "https://eco-geo.org" } }), env);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(sends.length, 0);
});
