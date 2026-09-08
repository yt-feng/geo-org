// Public contact endpoint. Message contents go only to the configured mailbox.
const ALLOWED_ORIGINS = new Set([
  "https://eco-geo.org",
  "https://www.eco-geo.org",
]);
const MAX_BODY_BYTES = 12000;
const FIELDS = new Set([
  "name", "email", "company", "website", "message", "locale", "website_confirm",
]);
const HEADER_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const TEXT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

function response(value, status, origin, extraHeaders = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
    ...extraHeaders,
  });
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return status === 204
    ? new Response(null, { status, headers })
    : Response.json(value, { status, headers });
}

function failure(code, status, origin, extraHeaders) {
  return response({ ok: false, error: code }, status, origin, extraHeaders);
}

function length(value) {
  return Array.from(value).length;
}

function validEmail(value) {
  if (typeof value !== "string" || value.length > 254 || HEADER_CONTROLS.test(value)) return false;
  if (!/^[^\s@<>(),;:\\"\[\]]+@[^\s@<>(),;:\\"\[\]]+\.[^\s@<>(),;:\\"\[\]]+$/u.test(value)) return false;
  const [local, domain] = value.split("@");
  return local.length <= 64 && !local.startsWith(".") && !local.endsWith(".")
    && !local.includes("..") && domain.split(".").every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function configuration(env) {
  const to = typeof env.CONTACT_NOTIFY_TO === "string" ? env.CONTACT_NOTIFY_TO.trim() : "";
  const from = typeof env.CONTACT_FROM_EMAIL === "string" ? env.CONTACT_FROM_EMAIL.trim() : "";
  if (typeof env.EMAIL?.send !== "function" || typeof env.CONTACT_RATE_LIMIT?.limit !== "function"
      || !validEmail(to) || !validEmail(from)) return null;
  return { to, from };
}

function singleLine(value, minimum, maximum, optional = false) {
  if (value === undefined && optional) return "";
  if (typeof value !== "string" || HEADER_CONTROLS.test(value)) throw new Error("invalid_request");
  const clean = value.trim();
  if (length(clean) < minimum || length(clean) > maximum) throw new Error("invalid_request");
  return clean;
}

function validatePayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || Object.keys(raw).some((key) => !FIELDS.has(key))) throw new Error("invalid_request");
  const name = singleLine(raw.name, 2, 100);
  const email = singleLine(raw.email, 1, 254);
  const company = singleLine(raw.company, 0, 160, true);
  const website = singleLine(raw.website, 0, 2048, true);
  const honeypot = singleLine(raw.website_confirm, 0, 0, true);
  if (honeypot || !validEmail(email) || !["zh", "en", "ar"].includes(raw.locale)) {
    throw new Error("invalid_request");
  }
  if (website) {
    let url;
    try { url = new URL(website); } catch { throw new Error("invalid_request"); }
    if (!new Set(["http:", "https:"]).has(url.protocol) || !url.hostname
        || url.username || url.password || /\s/u.test(website)) throw new Error("invalid_request");
  }
  if (typeof raw.message !== "string" || TEXT_CONTROLS.test(raw.message)) throw new Error("invalid_request");
  const message = raw.message.trim();
  if (length(message) < 10 || length(message) > 5000) throw new Error("invalid_request");
  return { name, email, company, website, message, locale: raw.locale };
}

function acceptedEmail(result, recipient) {
  if (typeof result?.messageId !== "string" || !result.messageId.trim()) return false;
  // Do not equate a provider message ID with acceptance when recipient outcomes
  // are supplied. Optional fields preserve compatibility with ID-only bindings.
  for (const key of ["permanentBounces", "suppressedRecipients", "permanent_bounces", "suppressed_recipients"]) {
    if (result[key] !== undefined && (!Array.isArray(result[key]) || result[key].length > 0)) return false;
  }
  if (result.delivered !== undefined || result.queued !== undefined) {
    const accepted = [];
    for (const key of ["delivered", "queued"]) {
      if (result[key] === undefined) continue;
      if (!Array.isArray(result[key]) || result[key].some((address) => typeof address !== "string")) return false;
      accepted.push(...result[key]);
    }
    if (!accepted.some((address) => address.trim().toLowerCase() === recipient.toLowerCase())) return false;
  }
  return true;
}

async function readPayload(request) {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && !/^\d+$/.test(declaredLength)) throw new Error("invalid_request");
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) throw new Error("payload_too_large");
  if (!request.body) throw new Error("invalid_json");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("payload_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("invalid_json");
  }
}

export default {
  async fetch(request, env = {}) {
    const pathname = new URL(request.url).pathname;
    const origin = request.headers.get("Origin");
    if (pathname === "/health" && request.method === "GET") {
      const ready = Boolean(configuration(env));
      return response({ ok: ready, service: "eco-geo-contact" }, ready ? 200 : 503, origin);
    }
    if (pathname !== "/api/contact") return failure("not_found", 404, origin);
    if (!ALLOWED_ORIGINS.has(origin)) return failure("origin_not_allowed", 403, null);
    if (request.method === "OPTIONS") {
      const method = request.headers.get("Access-Control-Request-Method");
      const headers = (request.headers.get("Access-Control-Request-Headers") || "")
        .split(",").map((header) => header.trim().toLowerCase()).filter(Boolean);
      if ((method && method !== "POST") || headers.some((header) => header !== "content-type")) {
        return failure("preflight_not_allowed", 403, origin);
      }
      return response(null, 204, origin, {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
      });
    }
    if (request.method !== "POST") return failure("method_not_allowed", 405, origin, { Allow: "POST, OPTIONS" });
    if ((request.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return failure("unsupported_content_type", 415, origin);
    }
    const config = configuration(env);
    if (!config) return failure("service_unavailable", 503, origin);
    const ip = request.headers.get("CF-Connecting-IP")?.trim();
    if (!ip || ip.length > 64 || !/^[0-9a-f:.]+$/i.test(ip)) return failure("service_unavailable", 503, origin);
    try {
      const limited = await env.CONTACT_RATE_LIMIT.limit({ key: ip });
      if (limited?.success === false) return failure("rate_limited", 429, origin);
      if (limited?.success !== true) return failure("service_unavailable", 503, origin);
    } catch {
      return failure("service_unavailable", 503, origin);
    }
    let payload;
    try {
      payload = validatePayload(await readPayload(request));
    } catch (error) {
      const code = ["payload_too_large", "invalid_json"].includes(error?.message)
        ? error.message : "invalid_request";
      return failure(code, code === "payload_too_large" ? 413 : 400, origin);
    }
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    try {
      const sent = await env.EMAIL.send({
        to: config.to,
        from: { email: config.from, name: "Eco GEO" },
        replyTo: payload.email,
        subject: `Eco GEO 官网咨询${payload.company ? ` · ${payload.company}` : ""}`,
        text: [
          "新的 Eco GEO 官网咨询",
          `咨询编号：${requestId}`,
          `提交时间：${timestamp}`,
          `姓名：${payload.name}`,
          `公司 / 品牌：${payload.company || "未填写"}`,
          `联系方式：${payload.email}`,
          `网站：${payload.website || "未填写"}`,
          `页面语言：${payload.locale}`,
          "", "咨询需求：", payload.message,
          "", "直接回复本邮件即可联系咨询者。",
        ].join("\n"),
      });
      if (!acceptedEmail(sent, config.to)) {
        return failure("service_unavailable", 503, origin);
      }
      return response({ ok: true, requestId }, 200, origin);
    } catch {
      // Provider exceptions can include recipient addresses or message content.
      return failure("service_unavailable", 503, origin);
    }
  },
};
