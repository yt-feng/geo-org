import { getPortalUser } from "./auth";
import { getD1, runtimeEnv } from "./config";
import { ensureUser } from "./store";
import { digitalProducts } from "./products";
import { WalletError } from "./wallet";

const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
type OrderRow = { id: string; product_id: string; retail_cents: number; charge_microusd: number; status: string; delivery: string; processed_by: string | null };
function fail(message: string, status = 400): never { throw new WalletError(message, status); }
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) fail("请提交 JSON。", 415);
  const reader = request.body?.getReader(); if (!reader) fail("请求为空。");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 12000) { await reader.cancel(); fail("请求内容过长。", 413); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== "object" || Array.isArray(value)) fail("请求格式不正确。"); return value; } catch { return fail("请求格式不正确。"); }
}
export async function handleOrders(request: Request, admin = false) {
  try {
    const user = await getPortalUser(); if (!user) fail("请先登录。", 401);
    if (admin && !user.isAdmin) fail("仅管理员可处理商品订单。", 403);
    const db = getD1(); await ensureUser(user);
    if ((await db.prepare("SELECT status FROM users WHERE id=?").bind(user.id).first<{ status: string }>())?.status !== "active") fail("账户已停用。", 403);
    if (request.method === "GET") return reply({ orders: (await db.prepare(`SELECT * FROM digital_orders ${admin ? "" : "WHERE user_id=?"} ORDER BY created_at DESC,id DESC LIMIT 100`).bind(...(admin ? [] : [user.id])).all()).results || [] });
    if (request.headers.get("origin") !== new URL(request.url).origin) fail("请从 tokvilo 提交请求。", 403);
    const input = await readBody(request);
    if (request.method === "POST" && !admin) {
      const key = request.headers.get("Idempotency-Key") || "";
      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) fail("缺少订单请求编号。");
      if (input.confirmed !== true) fail("请先确认商品规格、价格与人工交付方式。");
      if (!Number.isSafeInteger(input.expectedRetailCents) || !Number.isSafeInteger(input.expectedChargeMicrousd)) fail("请刷新商品页，确认本次售价与预留金额。", 409);
      function matching(order: OrderRow) {
        if (order.product_id !== input.productId || order.retail_cents !== input.expectedRetailCents || order.charge_microusd !== input.expectedChargeMicrousd) fail("此请求编号已用于不同商品或金额。", 409);
      }
      const previous = await db.prepare("SELECT * FROM digital_orders WHERE user_id=? AND request_key=?").bind(user.id, key).first<OrderRow>();
      if (previous) { matching(previous); return reply({ order: previous, reused: true }); }
      const product = digitalProducts.find(item => item.id === input.productId);
      if (!product || product.soldOut) fail("该商品当前不可订购。", 409);
      const fx = Number(runtimeEnv().USD_CNY); if (!Number.isFinite(fx) || fx < 0.01 || fx > 1000) fail("充值换算尚未配置。", 503);
      const charge = Math.ceil(product.retailCents * 10000 / fx);
      if (input.expectedRetailCents !== product.retailCents || input.expectedChargeMicrousd !== charge) fail("商品价格或充值换算已更新，请刷新后重新确认金额。", 409);
      const id = crypto.randomUUID();
      let inserted;
      try {
        inserted = await db.prepare("INSERT INTO digital_orders(id,user_id,request_key,product_id,product_name,retail_cents,charge_microusd,usd_cny) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,request_key) DO NOTHING RETURNING id")
          .bind(id, user.id, key, product.id, `${product.name} · ${product.variant}`, product.retailCents, charge, String(fx)).first();
      } catch (cause) { if (String(cause).includes("insufficient_balance")) fail("可用余额不足，请先充值。", 402); throw cause; }
      const order = await db.prepare("SELECT * FROM digital_orders WHERE user_id=? AND request_key=?").bind(user.id, key).first<OrderRow>();
      if (!order) fail("订单尚未确认，请使用相同编号重试。", 503);
      matching(order);
      return reply({ order, reused: !inserted }, inserted ? 201 : 200);
    }
    if (request.method === "PATCH") {
      if (typeof input.id !== "string" || input.id.length > 80) fail("订单编号无效。");
      const status = input.action === "process" && admin ? "processing" : input.action === "complete" && admin ? "completed" : input.action === "cancel" ? "cancelled" : null;
      if (!status) fail("不支持此操作。");
      const delivery = typeof input.delivery === "string" ? input.delivery.trim() : "";
      if (status === "completed" && (delivery.length < 5 || delivery.length > 4000)) fail("请填写 5–4,000 字的交付信息。");
      let row;
      if (status === "processing") {
        row = await db.prepare("UPDATE digital_orders SET status='processing',processed_by=?,processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending' RETURNING *").bind(user.id, input.id).first();
      } else if (status === "completed") {
        row = await db.prepare("UPDATE digital_orders SET status='completed',delivery=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='processing' AND processed_by=? RETURNING *").bind(delivery, input.id, user.id).first();
      } else {
        row = await db.prepare(`UPDATE digital_orders SET status='cancelled',delivery='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${admin ? "status IN ('pending','processing')" : "status='pending' AND user_id=?"} RETURNING *`).bind(input.id, ...(admin ? [] : [user.id])).first();
      }
      if (row) return reply({ order: row, reused: false });
      const existing = await db.prepare(`SELECT * FROM digital_orders WHERE id=? ${admin ? "" : "AND user_id=?"}`).bind(input.id, ...(admin ? [] : [user.id])).first<OrderRow>();
      if (existing?.status === status && (status !== "completed" || existing.delivery === delivery) && (status === "cancelled" || existing.processed_by === user.id)) return reply({ order: existing, reused: true });
      fail(status === "completed" ? "请先认领订单；只有处理该订单的管理员可以交付。" : "订单已由其他操作处理或不属于当前账户。", 409);
    }
    return reply({ error: { message: "不支持此方法。" } }, 405);
  } catch (cause) { return reply({ error: { message: cause instanceof WalletError ? cause.message : "订单服务暂不可用，请稍后重试。" } }, cause instanceof WalletError ? cause.status : 503); }
}
