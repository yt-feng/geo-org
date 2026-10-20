import { getPortalUser, type PortalUser } from "./auth";
import { getD1, runtimeEnv, type RuntimeEnv } from "./config";
import { sha256Hex } from "./crypto";
import { ensureUser } from "./store";
import { getWallet, WalletError } from "./wallet";

const PACKAGES = [30, 90, 300] as const;
const STORE_HOSTS = new Set(["wzyp.cn", "www.ldxp.cn", "pay.ldxp.cn"]);
const JIANONG_PRODUCTS = new Set(["/item/fb86dz", "/item/rg29py", "/item/wpk4c4"]);
const QUERY_KEYS = new Set(["id", "goods_id", "product_id", "shop_id", "sku", "sku_id", "channel", "from", "ref"]);
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: HEADERS });
const fail = (message: string, status = 400, code = "redemption_invalid"): never => { throw new WalletError(message, status, code); };
type CodeRow = { id: string; status: string; redeemed_by: string | null };
type BatchRow = { id: string; request_id: string; fingerprint: string; created_by: string };
type RedemptionRow = { code_id: string; amount_cny: number; credit_microusd: number; created_at: string; code_suffix: string; status: string; credit_reversed_microusd: number | null };
type Payload = Record<string, unknown>;

export function purchaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !STORE_HOSTS.has(url.hostname) || url.port || url.username || url.password || url.hash || value.includes("#") || /[\\\r\n\x00]/.test(value)) return null;
    if (/%(?:2f|5c|2e)/i.test(url.pathname) || url.pathname.includes("//") || JIANONG_PRODUCTS.has(url.pathname.replace(/\/$/, ""))) return null;
    const seen = new Set<string>();
    for (const [key, entry] of url.searchParams) {
      if (!QUERY_KEYS.has(key) || seen.has(key) || !/^[a-zA-Z0-9_-]{1,100}$/.test(entry)) return null;
      seen.add(key);
    }
    return url.href;
  } catch { return null; }
}

export function getBillingConfig(env: RuntimeEnv = runtimeEnv()) {
  const rate = Number(env.USD_CNY);
  const validRate = Number.isFinite(rate) && rate >= 0.01 && rate <= 1000;
  const packages = PACKAGES.map(amount => ({
    id: String(amount), amountCny: amount,
    creditMicrousd: validRate ? Math.floor(amount * 1_000_000 / rate) : null,
    purchaseUrl: purchaseUrl(env[`LIANDONG_PRODUCT_${amount}_URL`]),
  }));
  return {
    provider: "liandong" as const, brand: "tokvilo", deliveryMode: "redemption_code",
    enabled: env.LIANDONG_SALES_ENABLED === "true" && env.REDEMPTION_ENABLED === "true" && validRate && packages.every(pack => pack.purchaseUrl),
    redemptionEnabled: env.REDEMPTION_ENABLED === "true", issuanceEnabled: env.REDEMPTION_ISSUANCE_ENABLED === "true" && validRate,
    usdCny: validRate ? rate : null, storeUrl: purchaseUrl(env.LIANDONG_STORE_URL), packages,
  };
}
export type BillingConfig = ReturnType<typeof getBillingConfig>;

function normalizeCode(value: unknown) {
  if (typeof value !== "string" || value.length > 128) return fail("请填写完整的 Tokvilo 兑换码。");
  const code = value.trim().replace(/[-\t\r\n ]/g, "").toUpperCase();
  if (!/^TK[A-HJ-NP-Z2-9]{32}$/.test(code)) return fail("请使用以 TK 开头的 Tokvilo 专属兑换码。");
  return code;
}
function generateCode() {
  const value = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => ALPHABET[byte & 31]).join("");
  return `TK-${value.match(/.{4}/g)!.join("-")}`;
}
async function body(request: Request): Promise<Payload> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return fail("请提交 JSON。", 415);
  if (!request.body || Number(request.headers.get("content-length")) > 8000) return fail("请求内容过长。", 413);
  const reader = request.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > 8000) { await reader.cancel(); return fail("请求内容过长。", 413); }
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
async function limit(userId: string, kind: string, maximum: number, seconds: number) {
  const now = new Date().toISOString(), expires = new Date(Date.now() + seconds * 1000).toISOString();
  const row = await getD1().prepare(`INSERT INTO login_rate_limits(id,attempts,expires_at) VALUES(?,1,?)
    ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
    WHERE expires_at<=? OR attempts<? RETURNING id`).bind(`redemption:${kind}:${userId}`, expires, now, now, now, maximum).first();
  if (!row) fail("操作较频繁，请稍后再试。", 429, "redemption_rate_limited");
}
const REDEMPTION_QUERY = `SELECT r.code_id,r.amount_cny,r.credit_microusd,r.created_at,c.code_suffix,c.status,v.credit_reversed_microusd
 FROM tokvilo_redemptions r JOIN tokvilo_redemption_codes c ON c.id=r.code_id
 LEFT JOIN tokvilo_redemption_revocations v ON v.code_id=c.id`;
const BATCH_QUERY = `SELECT b.id,b.package_id,b.amount_cny,b.credit_microusd,b.usd_cny,b.count,b.note,b.created_by,b.created_at,b.expires_at,
 (SELECT COUNT(*) FROM tokvilo_redemption_codes c WHERE c.batch_id=b.id) AS issued_count,
 (SELECT COUNT(*) FROM tokvilo_redemption_codes c WHERE c.batch_id=b.id AND c.status='redeemed') AS redeemed_count,
 (SELECT COUNT(*) FROM tokvilo_redemption_codes c WHERE c.batch_id=b.id AND c.status='revoked') AS revoked_count FROM tokvilo_redemption_batches b`;

async function redeem(request: Request, user: PortalUser) {
  if (!getBillingConfig().redemptionEnabled) return fail("兑换服务暂未开启，请保留兑换码。", 503, "redemption_unavailable");
  await limit(user.id, "claim", 12, 600);
  const input = await body(request), hash = await sha256Hex(normalizeCode(input.code)), at = new Date().toISOString(), db = getD1();
  const results = await db.batch([
    db.prepare(`UPDATE tokvilo_redemption_codes SET status='redeemed',redeemed_by=?,redeemed_at=?
      WHERE code_hash=? AND status='available' AND EXISTS(SELECT 1 FROM tokvilo_redemption_batches b WHERE b.id=batch_id AND (b.expires_at IS NULL OR b.expires_at>?))`).bind(user.id, at, hash, at),
    db.prepare(`INSERT OR IGNORE INTO tokvilo_redemptions(code_id,user_id,amount_cny,credit_microusd,created_at)
      SELECT c.id,c.redeemed_by,b.amount_cny,b.credit_microusd,c.redeemed_at FROM tokvilo_redemption_codes c
      JOIN tokvilo_redemption_batches b ON b.id=c.batch_id WHERE c.code_hash=? AND c.status='redeemed' AND c.redeemed_by=?`).bind(hash, user.id),
    db.prepare(`INSERT OR IGNORE INTO wallet_ledger(id,user_id,kind,amount_microusd,reference_id,description)
      SELECT 'redeem:'||r.code_id,r.user_id,'redemption',r.credit_microusd,r.code_id,'链动小铺 Tokvilo 兑换码，面值 ¥'||r.amount_cny
      FROM tokvilo_redemptions r JOIN tokvilo_redemption_codes c ON c.id=r.code_id WHERE c.code_hash=? AND c.status='redeemed' AND r.user_id=?`).bind(hash, user.id),
  ]);
  const record = await db.prepare(REDEMPTION_QUERY + " WHERE c.code_hash=? AND r.user_id=?").bind(hash, user.id).first<RedemptionRow>();
  if (!record || record.status !== "redeemed") return fail("此码暂不可兑换，请核对是否已使用、过期或停用。", 400, "redemption_code_unavailable");
  return reply({ redemption: record, alreadyRedeemed: results[0].meta.changes !== 1, wallet: await getWallet(user.id) });
}

function note(value: unknown) {
  if (typeof value !== "string" || value.trim().length < 2 || value.length > 500) return fail("请填写 2–500 字的操作备注。");
  return value.trim();
}
async function createBatch(request: Request, user: PortalUser) {
  const config = getBillingConfig();
  if (!config.issuanceEnabled) return fail("兑换码发行尚未开启或汇率未配置。", 503, "redemption_issuance_paused");
  await limit(user.id, "issue", 20, 3600);
  const input = await body(request), pack = config.packages.find(pack => pack.id === input.packageId);
  if (!pack || !pack.creditMicrousd) return fail("请选择有效的充值面值。");
  const count = input.count ?? 20;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 1000) return fail("每批可生成 1–1,000 个兑换码。");
  const memo = note(input.note), requestId = input.requestId;
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{12,80}$/.test(requestId)) return fail("请使用有效的发行请求编号。");
  const expires = input.expiresAt ?? null;
  if (expires !== null && (typeof expires !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expires) || !Number.isFinite(Date.parse(expires)) || new Date(expires).toISOString() !== expires || expires <= new Date().toISOString())) return fail("请填写有效的未来到期时间。");
  // A retry keeps the original exchange-rate snapshot, even after the public
  // exchange rate changes. The request fingerprint represents caller intent.
  const fingerprint = await sha256Hex(JSON.stringify({ packageId: pack.id, count, note: memo, expiresAt: expires }));
  const db = getD1();
  async function repeated(existing: BatchRow | null) {
    if (!existing || existing.created_by !== user.id || existing.fingerprint !== fingerprint) return fail("此发行编号已用于不同内容。", 409, "redemption_request_conflict");
    return reply({ batch: await db.prepare(BATCH_QUERY + " WHERE b.id=?").bind(existing.id).first(), codes: [], codesAvailable: false, reused: true });
  }
  const existing = await db.prepare("SELECT * FROM tokvilo_redemption_batches WHERE request_id=?").bind(requestId).first<BatchRow>();
  if (existing) return repeated(existing);
  const id = crypto.randomUUID(), at = new Date().toISOString(), codes = Array.from({ length: count }, generateCode);
  const rows = await Promise.all(codes.map(async code => ({ id: crypto.randomUUID(), hash: await sha256Hex(normalizeCode(code)), suffix: normalizeCode(code).slice(-6) })));
  const inserts = [db.prepare(`INSERT OR IGNORE INTO tokvilo_redemption_batches(id,request_id,fingerprint,package_id,amount_cny,credit_microusd,usd_cny,count,note,created_by,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, requestId, fingerprint, pack.id, pack.amountCny, pack.creditMicrousd, String(config.usdCny), count, memo, user.id, at, expires)];
  for (let start = 0; start < rows.length; start += 10) {
    const chunk = rows.slice(start, start + 10);
    inserts.push(db.prepare(`INSERT INTO tokvilo_redemption_codes(id,batch_id,code_hash,code_suffix,created_at)
      SELECT column1,?,column2,column3,? FROM (VALUES ${chunk.map(() => "(?,?,?)").join(",")})
      WHERE EXISTS(SELECT 1 FROM tokvilo_redemption_batches WHERE id=? AND request_id=?)`).bind(id, at, ...chunk.flatMap(row => [row.id, row.hash, row.suffix]), id, requestId));
  }
  const results = await db.batch(inserts);
  if (results[0].meta.changes !== 1) return repeated(await db.prepare("SELECT * FROM tokvilo_redemption_batches WHERE request_id=?").bind(requestId).first<BatchRow>());
  return reply({ batch: await db.prepare(BATCH_QUERY + " WHERE b.id=?").bind(id).first(), codes, codesAvailable: true, reused: false }, 201);
}

async function revoke(request: Request, user: PortalUser) {
  await limit(user.id, "revoke", 30, 600);
  const input = await body(request), codeHash = await sha256Hex(normalizeCode(input.code)), memo = note(input.note), at = new Date().toISOString(), db = getD1();
  const code = await db.prepare("SELECT * FROM tokvilo_redemption_codes WHERE code_hash=?").bind(codeHash).first<CodeRow>();
  if (!code) return fail("没有找到此兑换码。", 404);
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tokvilo_redemption_revocations(code_id,actor_id,note,credit_reversed_microusd,created_at)
      SELECT c.id,?,?,COALESCE(r.credit_microusd,0),? FROM tokvilo_redemption_codes c LEFT JOIN tokvilo_redemptions r ON r.code_id=c.id WHERE c.id=?`).bind(user.id, memo, at, code.id),
    db.prepare("UPDATE tokvilo_redemption_codes SET status='revoked' WHERE id=? AND EXISTS(SELECT 1 FROM tokvilo_redemption_revocations WHERE code_id=?)").bind(code.id, code.id),
    db.prepare(`INSERT OR IGNORE INTO wallet_ledger(id,user_id,kind,amount_microusd,reference_id,description)
      SELECT 'revoke:'||r.code_id,r.user_id,'redemption_reversal',-v.credit_reversed_microusd,r.code_id,'兑换码撤销（现金退款由店铺处理）：'||v.note
      FROM tokvilo_redemptions r JOIN tokvilo_redemption_revocations v ON v.code_id=r.code_id WHERE r.code_id=? AND v.credit_reversed_microusd>0`).bind(code.id),
  ]);
  const record = await db.prepare("SELECT credit_reversed_microusd FROM tokvilo_redemption_revocations WHERE code_id=?").bind(code.id).first<{ credit_reversed_microusd: number }>();
  return reply({ revoked: true, alreadyRevoked: results[0].meta.changes !== 1, creditReversedMicrousd: record?.credit_reversed_microusd ?? 0, refundProcessed: false });
}

export async function handleWalletRequest(request: Request, action: "wallet" | "redeem" | "batches" | "revoke"): Promise<Response> {
  try {
    const user = await getPortalUser();
    if (!user) return fail("请先登录。", 401, "login_required");
    if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) return fail("请从 Tokvilo 工作台提交请求。", 403, "origin_invalid");
    if (["batches", "revoke"].includes(action) && !user.isAdmin) return fail("仅管理员可管理兑换码。", 403, "admin_required");
    await ensureUser(user);
    const account = await getD1().prepare("SELECT status FROM users WHERE id=?").bind(user.id).first<{ status: string }>();
    if (account?.status !== "active") return fail("账户已停用。", 403, "account_disabled");
    if (action === "wallet" && request.method === "GET") return reply({ wallet: await getWallet(user.id), billing: getBillingConfig(), redemptions: (await getD1().prepare(REDEMPTION_QUERY + " WHERE r.user_id=? ORDER BY r.created_at DESC,r.code_id LIMIT 100").bind(user.id).all<RedemptionRow>()).results || [] });
    if (action === "redeem" && request.method === "POST") return await redeem(request, user);
    if (action === "batches" && request.method === "GET") return reply({ batches: (await getD1().prepare(BATCH_QUERY + " ORDER BY b.created_at DESC,b.id LIMIT 100").all()).results || [] });
    if (action === "batches" && request.method === "POST") return await createBatch(request, user);
    if (action === "revoke" && request.method === "POST") return await revoke(request, user);
    return fail("不支持此请求方法。", 405);
  } catch (cause) {
    return reply({ error: { message: cause instanceof WalletError ? cause.message : "账务服务暂不可用，请稍后重试。", code: cause instanceof WalletError ? cause.code : "wallet_unavailable" } }, cause instanceof WalletError ? cause.status : 503);
  }
}
