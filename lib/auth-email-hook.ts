import { EmailMessage } from "cloudflare:email";
import { runtimeEnv, type RuntimeEnv } from "./config";
import { sha256Hex } from "./crypto";

const FROM = "auth@tokvilo.com";
const REDIRECT = "https://tokvilo.com/login?verified=1";
const MAX_BODY = 65_536;
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
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
  if (data.email_action_type !== "signup") {
    fail(422, "unsupported_email_action", "This email hook currently supports signup confirmation only.");
  }
  const email = user.email, userId = user.id, tokenHash = data.token_hash;
  if (typeof email !== "string" || email.length > 254 || email.split("@")[0].length > 64 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(email) ||
    email.includes("..") || typeof userId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(userId) ||
    typeof tokenHash !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash)) {
    fail(400, "invalid_signup_email", "Signup email data is invalid.");
  }
  return { email, userId, tokenHash };
}
function confirmationEmail(origin: string, input: ReturnType<typeof payload>, deliveryId: string) {
  const link = new URL("/auth/v1/verify", origin);
  link.searchParams.set("token", input.tokenHash);
  link.searchParams.set("type", "signup");
  link.searchParams.set("redirect_to", REDIRECT);
  // Deliberately ignore payload site_url, redirect_to, token and user metadata.
  const text = [
    "欢迎注册 tokvilo。", "", "请打开以下链接确认邮箱，然后返回 tokvilo 使用邮箱和密码登录：",
    link.href, "", "如果你没有注册 tokvilo，请忽略此邮件。",
  ].join("\n");
  const encoded = btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join(""));
  return new EmailMessage(FROM, input.email, [
    `From: tokvilo <${FROM}>`, `To: ${input.email}`, "Subject: Confirm your tokvilo account",
    `Message-ID: <auth.${deliveryId}@tokvilo.com>`, `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "",
    encoded.match(/.{1,76}/g)!.join("\r\n"), "",
  ].join("\r\n"));
}

/** Only a valid, recent Supabase-signed signup event can reach the email binding. */
export async function handleAuthEmailHook(request: Request): Promise<Response> {
  const deadline = Date.now() + 4_500;
  try {
    if (request.method !== "POST") fail(405, "method_not_allowed", "Only POST is supported.");
    const { origin, key, db, email } = configuration(runtimeEnv());
    const body = await boundedBody(request);
    const webhookId = await verify(request, body, key);
    const input = payload(body);
    const [messageId, bodyHash, deliveryId] = await Promise.all([
      sha256Hex(JSON.stringify([origin, webhookId])),
      sha256Hex(new TextDecoder("utf-8", { fatal: true }).decode(body)),
      sha256Hex(JSON.stringify([origin, "signup", input.userId, input.email.toLowerCase(), input.tokenHash])),
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
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("deadline");
      await Promise.race([
        email.send(confirmationEmail(origin, input, deliveryId)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("send_timeout")), Math.min(3_000, remaining));
        }),
      ]);
      const updated = await db.prepare(`UPDATE auth_email_deliveries SET status='sent',sent_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending' RETURNING id`).bind(deliveryId).first();
      if (!updated) throw new Error("receipt_unavailable");
      return reply({});
    } catch {
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
