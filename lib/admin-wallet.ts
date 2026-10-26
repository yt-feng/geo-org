import { getPortalUser } from "./auth";
import { getD1 } from "./config";
import { ensureUser } from "./store";
import { getWallet, WalletError } from "./wallet";

type Payload = Record<string, unknown>;
export type ManualCreditReason = "bank_transfer" | "test_credit" | "correction";
export type ManualCreditEntry = {
  id: string; request_id: string; payment_reference: string; user_id: string; customer_email: string;
  actor_id: string; actor_email: string; amount_microusd: number; reason: ManualCreditReason;
  receipt_confirmed: number; note: string; created_at: string;
};
type Customer = { id: string; email: string; display_name: string; status: string };
type StoredEntry = ManualCreditEntry & { fingerprint: string };
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: HEADERS });
const fail = (message: string, status = 400, code = "manual_credit_invalid"): never => { throw new WalletError(message, status, code); };

function email(value: unknown): string {
  if (typeof value !== "string") return fail("请填写客户的完整注册邮箱。");
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return fail("请填写客户的完整注册邮箱。");
  return normalized;
}
function boundedText(value: unknown, minimum: number, maximum: number, message: string): string {
  if (typeof value !== "string" || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) return fail(message);
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) return fail(message);
  return trimmed;
}
/** Parse decimal dollars without floating-point rounding or exponential notation. */
export function manualCreditMicrousd(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return fail("金额须为 $0.01 至 $100,000，最多两位小数。");
  const decimal = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(decimal)) return fail("金额须为 $0.01 至 $100,000，最多两位小数。");
  const [dollars, cents = ""] = decimal.split(".");
  const amount = Number(dollars) * 1_000_000 + Number(cents.padEnd(2, "0")) * 10_000;
  if (!Number.isSafeInteger(amount) || amount < 10_000 || amount > 100_000_000_000) return fail("金额须为 $0.01 至 $100,000，最多两位小数。");
  return amount;
}
async function body(request: Request): Promise<Payload> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return fail("请提交 JSON。", 415);
  if (!request.body || Number(request.headers.get("content-length")) > 8000) return fail("请求内容过长。", 413);
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 8000) { await reader.cancel(); return fail("请求内容过长。", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data)) return fail("请求内容无效。");
    return data;
  } catch (cause) { if (cause instanceof WalletError) throw cause; return fail("请求内容无效。"); }
  finally { reader.releaseLock(); }
}
async function customerByEmail(normalized: string): Promise<Customer> {
  const found = (await getD1().prepare("SELECT id,email,display_name,status FROM users WHERE lower(trim(email))=? LIMIT 2").bind(normalized).all<Customer>()).results || [];
  if (!found.length) return fail("未找到该邮箱的账户。请客户先注册并登录一次。", 404, "customer_missing");
  if (found.length !== 1) return fail("该邮箱对应多个账户，请先核对账户资料。", 409, "customer_ambiguous");
  if (found[0].status !== "active") return fail("客户账户已停用。", 409, "customer_disabled");
  return found[0];
}
const ENTRIES_SQL = `SELECT id,request_id,payment_reference,user_id,customer_email,actor_id,actor_email,amount_microusd,reason,receipt_confirmed,note,created_at
 FROM tokvilo_manual_wallet_adjustments`;
async function snapshot(customer: Customer) {
  const [wallet, entries] = await Promise.all([
    getWallet(customer.id),
    getD1().prepare(`${ENTRIES_SQL} WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100`).bind(customer.id).all<ManualCreditEntry>(),
  ]);
  return { customer: { id: customer.id, email: customer.email, displayName: customer.display_name }, wallet, entries: entries.results || [] };
}

export async function handleAdminWallet(request: Request): Promise<Response> {
  try {
    const actor = await getPortalUser();
    if (!actor) return fail("请先登录。", 401, "login_required");
    if (!actor.isAdmin) return fail("仅管理员可管理企业转账入账。", 403, "admin_required");
    const origin = request.headers.get("origin"), expected = new URL(request.url).origin;
    if ((request.method !== "GET" && origin !== expected) || (origin && origin !== expected) || request.headers.get("sec-fetch-site") === "cross-site") return fail("请从 tokvilo 管理后台提交请求。", 403, "origin_invalid");
    if (request.method !== "GET" && request.method !== "POST") return fail("不支持此请求方法。", 405, "method_invalid");
    await ensureUser(actor);
    const db = getD1();
    if ((await db.prepare("SELECT status FROM users WHERE id=?").bind(actor.id).first<{ status: string }>())?.status !== "active") return fail("管理员账户已停用。", 403, "account_disabled");
    if (request.method === "GET") return reply(await snapshot(await customerByEmail(email(new URL(request.url).searchParams.get("email")))));

    const input = await body(request), normalizedEmail = email(input.email), customer = await customerByEmail(normalizedEmail);
    if (input.customerId !== customer.id) return fail("客户账户资料已变化，请重新查询并确认。", 409, "customer_changed");
    const requestId = boundedText(input.requestId, 8, 200, "入账请求编号无效。");
    if (!/^[a-zA-Z0-9._:-]+$/.test(requestId)) return fail("入账请求编号无效。");
    const paymentReference = boundedText(input.paymentReference, 6, 160, "请填写 6–160 字的唯一银行流水或调整编号。").replace(/\s+/g, " ").toUpperCase();
    const note = boundedText(input.note, 2, 1000, "请填写 2–1,000 字的入账备注。");
    const amountMicrousd = manualCreditMicrousd(input.amountUSD);
    if (!["bank_transfer", "test_credit", "correction"].includes(String(input.reason))) return fail("请选择入账类型。");
    const reason = input.reason as ManualCreditReason;
    if (input.confirmed !== true) return fail("请确认入账邮箱和金额。");
    if (reason === "bank_transfer" && input.receiptConfirmed !== true) return fail("请先核实银行实际到账，再确认入账。", 400, "receipt_confirmation_required");
    const receiptConfirmed = reason === "bank_transfer" ? 1 : 0;
    const fingerprint = JSON.stringify([customer.id, normalizedEmail, amountMicrousd, reason, paymentReference, note, receiptConfirmed]);
    let inserted: { id: string } | null;
    try {
      inserted = await db.prepare(`INSERT INTO tokvilo_manual_wallet_adjustments
        (id,request_id,payment_reference,fingerprint,user_id,customer_email,actor_id,actor_email,amount_microusd,reason,receipt_confirmed,note)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id`)
        .bind(crypto.randomUUID(), requestId, paymentReference, fingerprint, customer.id, normalizedEmail, actor.id, actor.email, amountMicrousd, reason, receiptConfirmed, note).first<{ id: string }>();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes("manual_credit_conflict")) return fail("该流水或请求编号已用于另一笔入账，请核对历史记录。", 409, "manual_credit_conflict");
      if (message.includes("manual_customer_changed")) return fail("客户账户资料已变化，请重新查询并确认。", 409, "customer_changed");
      if (message.includes("manual_actor_disabled")) return fail("管理员账户已停用。", 403, "account_disabled");
      throw cause;
    }
    const entry = await db.prepare("SELECT * FROM tokvilo_manual_wallet_adjustments WHERE request_id=? OR payment_reference=? ORDER BY created_at LIMIT 1").bind(requestId, paymentReference).first<StoredEntry>();
    if (!entry) return fail("入账结果尚未确认，请使用同一请求重试并核对记录。", 503, "manual_credit_unknown");
    if (entry.fingerprint !== fingerprint) return fail("该流水或请求编号已用于另一笔入账，请核对历史记录。", 409, "manual_credit_conflict");
    const { fingerprint: _fingerprint, ...publicEntry } = entry;
    void _fingerprint;
    return reply({ ...await snapshot(customer), entry: publicEntry, reused: !inserted }, inserted ? 201 : 200);
  } catch (cause) {
    return reply({ error: { message: cause instanceof WalletError ? cause.message : "入账结果尚未确认，请使用同一请求重试并核对记录。", code: cause instanceof WalletError ? cause.code : "manual_credit_unknown" } }, cause instanceof WalletError ? cause.status : 503);
  }
}
