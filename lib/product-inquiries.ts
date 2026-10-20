import { EmailMessage } from "cloudflare:email";
import { getD1, runtimeEnv, type RuntimeEnv } from "./config";
import { sha256Hex } from "./crypto";
import { digitalProducts, productSourceAudit, PRODUCT_SOURCE, PRODUCTS_OBSERVED_AT } from "./products";

const RECIPIENT = "yt.feng@foxmail.com";
const MAX_ATTEMPTS = 12;
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
type Inquiry = {
  id: string; request_hash: string; product_id: string; product_name: string; product_variant: string;
  upstream_cents: number; retail_cents: number; source_url: string; source_observed_at: string;
  customer_email: string; customer_name: string; customer_message: string;
  email_status: "pending" | "sending" | "sent"; email_attempts: number; created_at: string;
};
class InquiryError extends Error { constructor(message: string, public status = 400) { super(message); } }
function fail(message: string, status = 400): never { throw new InquiryError(message, status); }
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: HEADERS });
const receipt = (row: Pick<Inquiry, "id" | "email_status">) => ({
  ok: true, inquiryId: row.id, emailStatus: row.email_status === "sent" ? "sent" : "pending",
});
function validEmail(value: string) {
  return value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value) &&
    value.split("@")[0].length <= 64 && !value.includes("..");
}
async function readInput(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) fail("请提交 JSON 格式的需求。", 415);
  const reader = request.body?.getReader(); if (!reader) fail("请填写商品需求。");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 16_384) { await reader.cancel(); fail("需求内容过长。", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let input: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("需求格式不正确。");
    input = parsed;
  } catch { fail("需求格式不正确。"); }
  if (Object.keys(input).some(key => !["productId", "email", "name", "message"].includes(key))) fail("需求包含不支持的字段。");
  if (typeof input.productId !== "string" || !/^[a-z0-9_-]{1,100}$/.test(input.productId)) fail("请选择有效商品。");
  if (typeof input.email !== "string" || !validEmail(input.email.trim())) fail("请填写有效的联系邮箱。");
  if (input.name !== undefined && typeof input.name !== "string") fail("称呼格式不正确。");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) fail("称呼须为 100 字以内的单行文字。");
  if (typeof input.message !== "string") fail("请填写需求。");
  const message = input.message.trim().replace(/\r\n?/g, "\n");
  if (!message || message.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) fail("需求须为 1–4,000 字的文字。");
  return { productId: input.productId, email: input.email.trim().toLowerCase(), name, message };
}
async function consumeAttempt(request: Request, db: D1Database) {
  const window = Math.floor(Date.now() / 3_600_000);
  const ip = request.headers.get("cf-connecting-ip")?.trim().slice(0, 100) || "unknown";
  const id = await sha256Hex(`product-inquiry:${window}:${ip}`);
  const row = await db.prepare(`INSERT INTO product_inquiry_rate_limits(id,attempts,expires_at)
    VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
    WHERE attempts<5 RETURNING attempts`).bind(id, new Date((window + 1) * 3_600_000).toISOString()).first();
  if (!row) fail("每小时最多提交 5 次商品需求，请稍后再试。", 429);
}
function sender(env: RuntimeEnv): string | null {
  const value = env.PRODUCT_INQUIRY_FROM?.trim().toLowerCase() || "";
  return env.PRODUCT_INQUIRY_EMAIL_ENABLED === "true" && env.PRODUCT_INQUIRY_EMAIL &&
    validEmail(value) && value.endsWith("@tokvilo.com") ? value : null;
}
function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function emailFor(row: Inquiry, from: string) {
  const text = [
    "tokvilo 商品需求", `需求编号：${row.id}`, `提交时间：${row.created_at}`,
    "", `商品：${row.product_name}`, `规格：${row.product_variant}`,
    `页面参考价：CNY ${(row.retail_cents / 100).toFixed(2)}`,
    `源头参考价：CNY ${(row.upstream_cents / 100).toFixed(2)}`,
    `价格观察日期：${row.source_observed_at}`, `价格来源：${row.source_url}`,
    "", `联系邮箱：${row.customer_email}`, `称呼：${row.customer_name || "未填写"}`,
    "", "客户需求：", row.customer_message,
    "", "请在 24 小时内通过联系邮箱回复。此询价未付款，未扣减账户余额，也未创建采购订单。",
  ].join("\n");
  // Fixed envelope recipient/sender and subject. Customer text is base64 body
  // data; only the strictly validated email is placed in Reply-To.
  const raw = [
    `From: tokvilo <${from}>`, `To: ${RECIPIENT}`, `Reply-To: ${row.customer_email}`,
    `Subject: tokvilo product inquiry ${row.id}`, `Message-ID: <inquiry.${row.id}@tokvilo.com>`,
    `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "",
    base64(text).match(/.{1,76}/g)!.join("\r\n"), "",
  ].join("\r\n");
  return new EmailMessage(from, RECIPIENT, raw);
}

/** Sends a persisted inquiry only. Stable Message-ID supports duplicate recognition after an ambiguous send. */
export async function sendProductInquiry(env: RuntimeEnv, inquiryId: string): Promise<"sent" | "pending"> {
  const db = env.DB, from = sender(env);
  if (!db || !from) return "pending";
  const claimed = await db.prepare(`UPDATE product_inquiries SET email_status='sending',email_attempts=email_attempts+1,
    next_attempt_at=datetime('now','+5 minutes'),last_email_error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND email_status!='sent' AND email_attempts<? AND next_attempt_at<=CURRENT_TIMESTAMP RETURNING *`)
    .bind(inquiryId, MAX_ATTEMPTS).first<Inquiry>();
  if (!claimed) {
    const row = await db.prepare("SELECT email_status FROM product_inquiries WHERE id=?").bind(inquiryId).first<Inquiry>();
    return row?.email_status === "sent" ? "sent" : "pending";
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      env.PRODUCT_INQUIRY_EMAIL!.send(emailFor(claimed, from)),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("send_timeout")), 10_000); }),
    ]);
    await db.prepare(`UPDATE product_inquiries SET email_status='sent',email_sent_at=CURRENT_TIMESTAMP,
      last_email_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND email_attempts=?`)
      .bind(inquiryId, claimed.email_attempts).run();
    return "sent";
  } catch {
    await db.prepare(`UPDATE product_inquiries SET email_status='pending',last_email_error='send_failed',
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND email_attempts=? AND email_status='sending'`)
      .bind(inquiryId, claimed.email_attempts).run().catch(() => undefined);
    return "pending";
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
}

export async function reconcileProductInquiries(env: RuntimeEnv, options: { maxInquiries?: number } = {}) {
  if (!env.DB || !sender(env)) return { examined: 0, sent: 0, pending: 0 };
  const maximum = Math.min(10, Math.max(1, Math.floor(options.maxInquiries || 10)));
  const rows = await env.DB.prepare(`SELECT id FROM product_inquiries WHERE email_status!='sent'
    AND email_attempts<? AND next_attempt_at<=CURRENT_TIMESTAMP ORDER BY created_at,id LIMIT ?`)
    .bind(MAX_ATTEMPTS, maximum).all<{ id: string }>();
  const outcomes = await Promise.allSettled((rows.results || []).map(row => sendProductInquiry(env, row.id)));
  const sent = outcomes.filter(result => result.status === "fulfilled" && result.value === "sent").length;
  return { examined: outcomes.length, sent, pending: outcomes.length - sent };
}

export async function handleProductInquiry(request: Request): Promise<Response> {
  try {
    if (request.method !== "POST") return reply({ error: "不支持此请求方法。" }, 405);
    if (request.headers.get("origin") !== new URL(request.url).origin) fail("请从 tokvilo 商品页面提交需求。", 403);
    const key = request.headers.get("Idempotency-Key") || "";
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) fail("缺少有效的需求请求编号。");
    const input = await readInput(request), db = getD1(), env = runtimeEnv();
    const idempotencyHash = await sha256Hex(key), requestHash = await sha256Hex(JSON.stringify(input));
    const previous = await db.prepare("SELECT id,request_hash,email_status FROM product_inquiries WHERE idempotency_hash=?")
      .bind(idempotencyHash).first<Inquiry>();
    if (previous) {
      if (previous.request_hash !== requestHash) fail("相同请求编号不能用于不同需求，请重新提交。", 409);
      return reply(receipt(previous));
    }
    const product = digitalProducts.find(item => item.id === input.productId);
    if (!product) fail("没有找到该商品。", 404);
    await consumeAttempt(request, db);
    const id = crypto.randomUUID();
    const inserted = await db.prepare(`INSERT INTO product_inquiries(id,idempotency_hash,request_hash,
      product_id,product_name,product_variant,upstream_cents,retail_cents,source_url,source_observed_at,
      customer_email,customer_name,customer_message) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(idempotency_hash) DO NOTHING RETURNING *`)
      .bind(id, idempotencyHash, requestHash, product.id, product.name, product.variant, product.upstreamCents,
        product.retailCents, productSourceAudit[product.id]?.sourceUrl || PRODUCT_SOURCE, PRODUCTS_OBSERVED_AT, input.email, input.name, input.message).first<Inquiry>();
    if (!inserted) {
      const existing = await db.prepare("SELECT id,request_hash,email_status FROM product_inquiries WHERE idempotency_hash=?")
        .bind(idempotencyHash).first<Inquiry>();
      if (!existing || existing.request_hash !== requestHash) fail("相同请求编号不能用于不同需求。", 409);
      return reply(receipt(existing));
    }
    // Persistence succeeds independently of email delivery. Never report failure
    // after acceptance merely because the notification service is unavailable.
    const emailStatus = await sendProductInquiry({ ...env, DB: db }, id).catch(() => "pending" as const);
    return reply({ ok: true, inquiryId: id, emailStatus }, 201);
  } catch (cause) {
    return reply({ error: cause instanceof InquiryError ? cause.message : "需求服务暂不可用，请稍后使用相同请求编号重试。" },
      cause instanceof InquiryError ? cause.status : 503);
  }
}
