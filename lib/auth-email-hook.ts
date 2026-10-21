import { runtimeEnv, type AuthEmailMessage, type RuntimeEnv } from "./config";
import { sha256Hex } from "./crypto";

const FROM = "auth@tokvilo.com";
const REDIRECT = "https://tokvilo.com/login?verified=1";
const MAX_BODY = 65_536;
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
// Only documented provider codes may enter logs; error messages can contain recipients.
const EMAIL_ERROR_CODES = new Set([
  "E_VALIDATION_ERROR", "E_FIELD_MISSING", "E_TOO_MANY_RECIPIENTS", "E_TOO_MANY_ATTACHMENTS",
  "E_SENDER_NOT_VERIFIED", "E_RECIPIENT_NOT_ALLOWED", "E_RECIPIENT_SUPPRESSED", "E_ACCOUNT_SUSPENDED",
  "E_SENDER_DOMAIN_NOT_AVAILABLE", "E_CONTENT_TOO_LARGE", "E_DELIVERY_FAILED", "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED", "E_INTERNAL_SERVER_ERROR", "E_HEADER_NOT_ALLOWED", "E_HEADER_USE_API_FIELD",
  "E_HEADER_VALUE_INVALID", "E_HEADER_VALUE_TOO_LONG", "E_HEADER_NAME_INVALID", "E_HEADERS_TOO_LARGE",
  "E_HEADERS_TOO_MANY",
]);
class DeliveryError extends Error {
  constructor(public code: "SEND_TIMEOUT" | "HOOK_DEADLINE" | "INVALID_SEND_RESULT" | "RECEIPT_UNAVAILABLE") { super(code); }
}
function deliveryDiagnostic(cause: unknown, stage: "send" | "send_result" | "receipt", startedAt: number) {
  let code = "UNCLASSIFIED";
  if (cause instanceof DeliveryError) code = cause.code;
  else if (cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string" && EMAIL_ERROR_CODES.has(cause.code)) {
    code = cause.code;
  }
  console.warn("auth_email_delivery_failed", {
    code, stage, timedOut: code === "SEND_TIMEOUT" || code === "HOOK_DEADLINE",
    elapsedMs: Math.max(0, Date.now() - startedAt),
  });
}
class HookError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new HookError(status, code, message); }
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  try {
    const binary = atob(value);
    if (btoa(binary) !== value) return null;
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch { return null; }
}
function configuration(env: RuntimeEnv) {
  const key = decodeBase64((env.AUTH_EMAIL_HOOK_SECRET || "").trim().replace(/^(?:v1,)?whsec_/, ""));
  let origin = "";
  try {
    const url = new URL(env.AUTH_BASE_URL || "");
    if (url.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) &&
      !url.port && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) origin = url.origin;
  } catch { /* Report only the configuration name, never its value. */ }
  if (!origin || !key || key.length < 24 || key.length > 64 || !env.DB || !env.AUTH_EMAIL) {
    fail(503, "auth_email_not_configured", "Authentication email delivery is not configured.");
  }
  return { origin, key, db: env.DB, email: env.AUTH_EMAIL };
}
async function boundedBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) fail(413, "body_too_large", "Webhook body is too large.");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    fail(415, "invalid_content_type", "A JSON webhook body is required.");
  }
  const reader = request.body?.getReader();
  if (!reader) fail(400, "invalid_body", "A webhook body is required.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      reject(new HookError(408, "body_timeout", "Webhook body timed out."));
    }, 1_000);
  });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.length;
      if (size > MAX_BODY) {
        void reader.cancel().catch(() => undefined);
        fail(413, "body_too_large", "Webhook body is too large.");
      }
      chunks.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
async function verify(request: Request, body: Uint8Array<ArrayBuffer>, secret: Uint8Array<ArrayBuffer>) {
  const id = request.headers.get("webhook-id") || "";
  const timestamp = request.headers.get("webhook-timestamp") || "";
  const signatures = request.headers.get("webhook-signature") || "";
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !/^[1-9]\d{0,11}$/.test(timestamp) ||
    Math.abs(Date.now() / 1_000 - Number(timestamp)) > 300 || signatures.length > 2_048) {
    fail(401, "invalid_webhook_signature", "Webhook signature or timestamp is invalid.");
  }
  const candidates = signatures.split(" ");
  if (candidates.length > 16) fail(401, "invalid_webhook_signature", "Webhook signature is invalid.");
  // Standard Webhooks signs the original bytes, including JSON whitespace.
  const prefix = new TextEncoder().encode(`${id}.${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix); signed.set(body, prefix.length);
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  for (const candidate of candidates) {
    if (!candidate.startsWith("v1,")) continue;
    const signature = decodeBase64(candidate.slice(3));
    if (signature?.length === 32 && await crypto.subtle.verify("HMAC", key, signature, signed)) return id;
  }
  fail(401, "invalid_webhook_signature", "Webhook signature is invalid.");
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function payload(body: Uint8Array) {
  let parsed: Record<string, unknown> | null;
  try { parsed = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))); }
  catch { fail(400, "invalid_body", "Webhook body is invalid."); }
  const user = record(parsed?.user), data = record(parsed?.email_data);
  if (!user || !data) fail(400, "invalid_body", "Webhook user and email data are required.");
  if (data.email_action_type !== "signup" && data.email_action_type !== "recovery") {
    fail(422, "unsupported_email_action", "This email hook supports signup confirmation and password recovery only.");
  }
  const email = user.email, userId = user.id, tokenHash = data.token_hash;
  if (typeof email !== "string" || email.length > 254 || email.split("@")[0].length > 64 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(email) ||
    email.includes("..") || typeof userId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(userId) ||
    typeof tokenHash !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash)) {
    fail(400, "invalid_auth_email", "Authentication email data is invalid.");
  }
  return { email, userId, tokenHash, action: data.email_action_type as "signup" | "recovery" };
}
function confirmationEmail(origin: string, input: ReturnType<typeof payload>): AuthEmailMessage {
  const recovery = input.action === "recovery";
  const link = recovery ? new URL("https://tokvilo.com/reset-password") : new URL("/auth/v1/verify", origin);
  if (recovery) {
    link.hash = new URLSearchParams({ token_hash: input.tokenHash, type: input.action }).toString();
  } else {
    link.searchParams.set("token", input.tokenHash);
    link.searchParams.set("type", input.action);
    link.searchParams.set("redirect_to", REDIRECT);
  }
  // Deliberately ignore payload site_url, redirect_to, token and user metadata.
  const text = (recovery ? [
    "你申请了重置 tokvilo 账户密码。", "", "请打开以下链接，点击继续后设置新密码：",
    link.href, "", "链接仅供本次重置使用。如果链接已失效，请重新申请。",
    "如果你没有申请重置密码，请忽略此邮件，你的密码不会因此改变。",
  ] : [
    "欢迎注册 tokvilo。", "", "请打开以下链接确认邮箱，然后返回 tokvilo 使用邮箱和密码登录：",
    link.href, "", "如果你没有注册 tokvilo，请忽略此邮件。",
  ]).join("\n");
  return {
    to: input.email, from: { email: FROM, name: "tokvilo" },
    subject: recovery ? "Reset your tokvilo password" : "Confirm your tokvilo account",
    text,
  };
}

/** Only a valid, recent Supabase-signed authentication event can reach the email binding. */
export async function handleAuthEmailHook(request: Request): Promise<Response> {
  const startedAt = Date.now(), deadline = startedAt + 4_500;
  try {
    if (request.method !== "POST") fail(405, "method_not_allowed", "Only POST is supported.");
    const { origin, key, db, email } = configuration(runtimeEnv());
    const body = await boundedBody(request);
    const webhookId = await verify(request, body, key);
    const input = payload(body);
    const [messageId, bodyHash, deliveryId] = await Promise.all([
      sha256Hex(JSON.stringify([origin, webhookId])),
      sha256Hex(new TextDecoder("utf-8", { fatal: true }).decode(body)),
      sha256Hex(JSON.stringify([origin, input.action, input.userId, input.email.toLowerCase(), input.tokenHash])),
    ]);
    // Neither raw payload nor recipients, OTPs or confirmation links are stored.
    await db.prepare(`INSERT INTO auth_email_hook_messages(id,body_hash,delivery_id) VALUES(?,?,?)
      ON CONFLICT(id) DO NOTHING`).bind(messageId, bodyHash, deliveryId).run();
    const message = await db.prepare("SELECT body_hash,delivery_id FROM auth_email_hook_messages WHERE id=?")
      .bind(messageId).first<{ body_hash: string; delivery_id: string }>();
    if (!message) fail(503, "email_receipt_unavailable", "Email receipt is temporarily unavailable.");
    if (message.body_hash !== bodyHash || message.delivery_id !== deliveryId) {
      fail(409, "webhook_id_conflict", "Webhook identifier has already been used for different content.");
    }
    const claimed = await db.prepare(`INSERT INTO auth_email_deliveries(id,status) VALUES(?,'sending')
      ON CONFLICT(id) DO NOTHING RETURNING id`).bind(deliveryId).first();
    if (!claimed) {
      const previous = await db.prepare("SELECT status FROM auth_email_deliveries WHERE id=?")
        .bind(deliveryId).first<{ status: string }>();
      if (previous?.status === "sent") return reply({});
      fail(503, "email_delivery_unconfirmed", "Email delivery is already processing or requires confirmation.");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stage: "send" | "send_result" | "receipt" = "send";
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new DeliveryError("HOOK_DEADLINE");
      const result = await Promise.race([
        email.send(confirmationEmail(origin, input)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new DeliveryError("SEND_TIMEOUT")), Math.min(3_000, remaining));
        }),
      ]);
      stage = "send_result";
      if (typeof result?.messageId !== "string" || !result.messageId.trim()) throw new DeliveryError("INVALID_SEND_RESULT");
      stage = "receipt";
      const updated = await db.prepare(`UPDATE auth_email_deliveries SET status='sent',sent_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending' RETURNING id`).bind(deliveryId).first();
      if (!updated) throw new DeliveryError("RECEIPT_UNAVAILABLE");
      return reply({});
    } catch (cause) {
      deliveryDiagnostic(cause, stage, startedAt);
      // Sending may have been accepted. Never resubmit the same confirmation.
      await db.prepare(`UPDATE auth_email_deliveries SET status='unknown',updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='sending'`).bind(deliveryId).run().catch(() => undefined);
      fail(503, "email_delivery_unconfirmed", "Email delivery could not be confirmed.");
    } finally { clearTimeout(timer); }
  } catch (cause) {
    const error = cause instanceof HookError ? cause : new HookError(503, "auth_email_unavailable", "Authentication email is temporarily unavailable.");
    return reply({ error: { http_code: error.status, code: error.code, message: error.message } }, error.status);
  }
}
