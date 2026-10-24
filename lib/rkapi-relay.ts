import { getPortalUser } from "./auth";
import { getD1, runtimeEnv } from "./config";
import { sha256Hex } from "./crypto";
import { ensureUser } from "./store";
import { ProviderError } from "./provider-settings";
import { PricingError } from "./pricing";
import { WalletError, reserveWallet, settleWallet, refundWallet } from "./wallet";
import { RKAPI_ORIGIN } from "./rkapi-settings";
import { RKAPI_PATHS, normalizeRkapiRequest } from "./rkapi-request";
import { getRkapiDisplayPricing, prepareRkapiRequest, settleRkapiResponse } from "./rkapi-pricing";

const BASE = "/api/selected";
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
type Json = Record<string, unknown>;
type Actor = { userId: string; keyId: string | null };
type Receipt = { request_hash: string; wallet_request_id: string; response_json: string | null; status_code: number | null; state: string };
const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
function reply(data: unknown, status = 200) { return Response.json(data, { status, headers: HEADERS }); }
function failure(message: string, status = 503) { return reply({ error: { message } }, status); }

/** Explicit projection strips supplier costs, routing diagnostics and future
 * pricing fields while preserving the actual generated content. */
export function publicRkapiResponse(data: Json): Json {
  const output: Json = {};
  for (const name of ["id", "object", "created", "model"]) if (["string", "number"].includes(typeof data[name])) output[name] = data[name];
  if (Array.isArray(data.choices)) output.choices = data.choices.filter(object).map(choice => ({ index: choice.index, finish_reason: choice.finish_reason,
    message: object(choice.message) ? { role: choice.message.role, content: choice.message.content, ...(typeof choice.message.reasoning_content === "string" ? { reasoning_content: choice.message.reasoning_content } : {}) } : undefined }));
  if (Array.isArray(data.data)) output.data = data.data.filter(object).map(image => ({ ...(typeof image.url === "string" ? { url: image.url } : {}),
    ...(typeof image.revised_prompt === "string" ? { revised_prompt: image.revised_prompt } : {}) }));
  if (object(data.usage)) {
    const usage: Json = {};
    for (const name of ["prompt_tokens", "completion_tokens", "total_tokens"]) if (Number.isSafeInteger(data.usage[name])) usage[name] = data.usage[name];
    for (const name of ["prompt_tokens_details", "completion_tokens_details"]) if (object(data.usage[name])) usage[name] = Object.fromEntries(Object.entries(data.usage[name]).filter(([key, value]) => ["cached_tokens", "cache_write_tokens", "cache_creation_tokens", "reasoning_tokens"].includes(key) && Number.isSafeInteger(value)));
    output.usage = usage;
  }
  return output;
}
async function actor(request: Request): Promise<Actor> {
  const authorization = request.headers.get("authorization"), rawKey = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] || request.headers.get("x-api-key");
  if (authorization || rawKey) {
    if (!rawKey || !/^(tk_live_|eco_live_)[A-Za-z0-9_-]{24,}$/.test(rawKey)) throw new ProviderError("请使用 tokvilo API Key。", 401);
    const row = await getD1().prepare("SELECT k.id AS key_id,u.id AS user_id FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.key_hash=? AND k.revoked_at IS NULL AND u.status='active'")
      .bind(await sha256Hex(rawKey)).first<{ key_id: string; user_id: string }>();
    if (!row) throw new ProviderError("API Key 无效或已停用。", 401);
    return { userId: row.user_id, keyId: row.key_id };
  }
  const user = await getPortalUser();
  if (!user) throw new ProviderError("请先登录或提供 tokvilo API Key。", 401);
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) throw new ProviderError("请从 tokvilo 工作台提交请求。", 403);
  await ensureUser(user);
  const row = await getD1().prepare("SELECT status FROM users WHERE id=?").bind(user.id).first<{ status: string }>();
  if (row?.status !== "active") throw new ProviderError("账户已停用。", 403);
  return { userId: user.id, keyId: null };
}
async function readObject(body: ReadableStream<Uint8Array> | null, limit: number, timeoutMs = 10_000): Promise<Json> {
  if (!body) throw new ProviderError("请求或响应内容为空。", 400);
  const reader = body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new ProviderError("内容接收超时，请保留原请求编号。", 408)); void reader.cancel().catch(() => undefined); }, timeoutMs); });
  try { for (;;) { const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break; length += value.length; if (length > limit) { await reader.cancel(); throw new ProviderError("内容超过大小限制。", 413); } chunks.push(value); } }
  finally { if (timer) clearTimeout(timer); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const result = JSON.parse(new TextDecoder().decode(bytes)); if (!object(result)) throw new Error(); return result; }
  catch { throw new ProviderError("内容必须是完整 JSON 对象。", 400); }
}
async function rateLimit(userId: string, read: boolean) {
  const now = new Date().toISOString(), expires = new Date(Date.now() + 60_000).toISOString();
  const result = await getD1().prepare(`INSERT INTO login_rate_limits(id,attempts,expires_at,updated_at) VALUES(?,1,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END,updated_at=CURRENT_TIMESTAMP
    WHERE expires_at<=? OR attempts<? RETURNING attempts`).bind(`selected:${read ? "read" : "write"}:${userId}`, expires, now, now, now, read ? 60 : 5).first();
  if (!result) throw new ProviderError("请求较频繁，请一分钟后重试。", 429);
}
async function usage(who: Actor, path: string, status: number, started: number) {
  const db = getD1();
  await db.prepare(`INSERT INTO usage_daily(user_id,day,calls,successes,errors) VALUES(?,?,1,?,?) ON CONFLICT(user_id,day)
    DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,updated_at=CURRENT_TIMESTAMP`)
    .bind(who.userId, new Date().toISOString().slice(0, 10), status < 400 ? 1 : 0, status >= 400 ? 1 : 0).run();
  await db.prepare("INSERT INTO usage_events(request_id,user_id,api_key_id,method,path,status,latency_ms) VALUES(?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), who.userId, who.keyId, "POST", BASE + path, status, Date.now() - started).run();
  if (who.keyId) await db.prepare("UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?").bind(who.keyId).run();
}
async function billing(userId: string, walletId: string, fallback: Json = {}) {
  const row = await getD1().prepare("SELECT status,reserved_microusd,charged_microusd FROM wallet_reservations WHERE user_id=? AND request_id=?")
    .bind(userId, walletId).first<{ status: string; reserved_microusd: number; charged_microusd: number | null }>();
  return row ? { ...fallback, status: row.status === "reserved" ? "awaiting_reconciliation" : row.status, reservedMicrousd: row.reserved_microusd, chargedMicrousd: row.charged_microusd, currency: "USD" } : fallback;
}
async function receiptResponse(userId: string, receipt: Receipt): Promise<Response> {
  if (receipt.response_json && receipt.status_code) {
    const data = JSON.parse(receipt.response_json);
    data.tokvilo_billing = await billing(userId, receipt.wallet_request_id, object(data.tokvilo_billing) ? data.tokvilo_billing : {});
    return reply(data, receipt.status_code);
  }
  return reply({ error: { message: "此请求已受理，结果尚未确认；请保留原请求编号，不要重复提交。" }, tokvilo_billing: await billing(userId, receipt.wallet_request_id) }, 409);
}

export async function handleRkapiRelay(request: Request): Promise<Response> {
  let claimed: { userId: string; id: string; walletId: string } | null = null;
  let sent = false, reusedReservation = false, started = 0;
  let who: Actor | undefined, path = "";
  let recoverableOutput: Json | null = null;
  try {
    who = await actor(request);
    const db = getD1(), env = runtimeEnv(), url = new URL(request.url);
    if (env.SERVICE_ENABLED?.toLowerCase() !== "true") return failure("生成服务当前未启用。", 503);
    if (!url.pathname.startsWith(BASE + "/") || url.search) return failure("精选接口不存在或参数不受支持。", 404);
    path = url.pathname.slice(BASE.length);
    const receiptId = path.startsWith("/v1/requests/") ? path.slice("/v1/requests/".length) : null;
    const read = path === "/v1/models" || path === "/v1/requests" || receiptId && /^[A-Za-z0-9_-]{8,128}$/.test(receiptId);
    if (!read && !(Object.values(RKAPI_PATHS) as string[]).includes(path)) return failure("精选接口不存在。", 404);
    if (request.method !== (read ? "GET" : "POST")) return failure("不支持此请求方法。", 405);
    await rateLimit(who.userId, !!read);
    if (path === "/v1/models") { const pricing = await getRkapiDisplayPricing(); return reply({ object: "list", data: pricing.models.map(model => ({ id: model.model, object: "model", owned_by: "tokvilo", pricing: model })), observedAt: pricing.observedAt }); }
    if (path === "/v1/requests") {
      const rows = await db.prepare("SELECT idempotency_key AS id,model,state,created_at,updated_at FROM rkapi_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(who.userId).all();
      return reply({ data: rows.results || [] });
    }
    if (receiptId) {
      const receipt = await db.prepare("SELECT * FROM rkapi_requests WHERE user_id=? AND idempotency_key=?").bind(who.userId, receiptId).first<Receipt>();
      return receipt ? receiptResponse(who.userId, receipt) : failure("未找到此账户的请求。", 404);
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return failure("请提交 application/json。", 415);
    const body = normalizeRkapiRequest(await readObject(request.body, 40_000), path), id = request.headers.get("Idempotency-Key") || "";
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) return failure("需要 8–128 位 Idempotency-Key，重试请使用相同编号。", 400);
    const hash = await sha256Hex(path + "\n" + JSON.stringify(body));
    const existing = await db.prepare("SELECT * FROM rkapi_requests WHERE user_id=? AND idempotency_key=?").bind(who.userId, id).first<Receipt>();
    if (existing) return existing.request_hash === hash ? receiptResponse(who.userId, existing) : failure("相同请求编号不能用于不同内容。", 409);
    const maximum = request.headers.get("X-Tokvilo-Max-Reserve-Microusd");
    if (maximum !== null && (!/^\d{1,13}$/.test(maximum) || !Number.isSafeInteger(Number(maximum)) || Number(maximum) < 1 || Number(maximum) > 1_000_000_000_000)) return failure("预留金额上限必须为有效的正整数 micro-USD。", 400);
    const prepared = await prepareRkapiRequest(body, env), { quote, basis, route } = prepared, walletId = `selected:${id}`;
    if (maximum !== null && quote.reservedMicrousd > Number(maximum)) return reply({ error: { message: "最新预留金额高于已确认报价，请重新获取报价后确认。", code: "reservation_limit_exceeded" }, reservedMicrousd: quote.reservedMicrousd }, 409);
    const inserted = await db.prepare("INSERT INTO rkapi_requests(user_id,idempotency_key,request_hash,wallet_request_id,model,quote_json,state) VALUES(?,?,?,?,?,?,'pending') ON CONFLICT DO NOTHING RETURNING user_id")
      .bind(who.userId, id, hash, walletId, body.model, JSON.stringify({ quote, basis })).first();
    if (!inserted) return failure("此请求正在处理，请保留相同请求编号。", 409);
    claimed = { userId: who.userId, id, walletId };
    const wallet = await reserveWallet({ userId: who.userId, requestId: walletId, amountMicrousd: quote.reservedMicrousd, metadata: { provider: "selected", model: body.model, hash } });
    if (wallet.reused) { reusedReservation = true; throw new ProviderError("此账务请求已受理，请查询原请求结果。", 409); }
    started = Date.now(); sent = true;
    const upstream = await fetch(RKAPI_ORIGIN + path, { method: "POST", headers: { Authorization: `Bearer ${route.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(prepared.body), redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(body.prompt ? 110_000 : 90_000) });
    if (upstream.status >= 300 && upstream.status < 400) throw new ProviderError("精选响应地址异常，结果等待核对。", 502);
    const original = await readObject(upstream.body, 1_500_000, 30_000);
    const raw = JSON.parse(JSON.stringify(original).replaceAll(route.apiKey, "[redacted]")) as Json;
    const okay = upstream.ok && !raw.error && raw.success !== false;
    const status = okay ? 200 : upstream.status >= 400 ? upstream.status : 502;
    let bill: Json = { status: "awaiting_reconciliation", reservedMicrousd: quote.reservedMicrousd, chargedMicrousd: null, currency: "USD" };
    let state = "unknown";
    if (okay) {
      // Persist generated content before releasing the hold into a charge. If a
      // later settlement/state write fails, GET/replay can still return the paid
      // output and overlay the authoritative wallet row.
      recoverableOutput = { ...publicRkapiResponse(raw), tokvilo_billing: bill };
      await db.prepare("UPDATE rkapi_requests SET response_json=?,status_code=200,state='unknown',updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND idempotency_key=?")
        .bind(JSON.stringify(recoverableOutput), who.userId, id).run();
      try { const settled = await settleWallet({ userId: who.userId, requestId: walletId, amountMicrousd: settleRkapiResponse(basis, raw) }); bill = { ...bill, status: settled.status, chargedMicrousd: settled.chargedMicrousd }; state = "completed"; }
      catch {
        // The UPDATE may have committed before finishWallet's readback failed.
        // Report the durable wallet state when it can be read; never charge again.
        bill = await billing(who.userId, walletId, bill).catch(() => bill);
        if (bill.status === "settled") state = "completed";
      }
    } else if ([400, 401, 402, 403, 404, 422, 429].includes(upstream.status)) {
      const refunded = await refundWallet({ userId: who.userId, requestId: walletId }); bill = { ...bill, status: refunded.status, chargedMicrousd: 0 }; state = "failed";
    }
    const output = { ...(okay ? publicRkapiResponse(raw) : { error: { message: state === "failed" ? "精选服务未接受此请求，预留余额已退回。" : "精选请求结果尚未确认，请保留请求编号。" } }), tokvilo_billing: bill };
    await db.prepare("UPDATE rkapi_requests SET response_json=?,status_code=?,state=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND idempotency_key=?")
      .bind(JSON.stringify(output), status, state, who.userId, id).run();
    await usage(who, path, status, started).catch(() => undefined);
    return reply(output, status);
  } catch (cause) {
    if (claimed && !sent && !reusedReservation) {
      // reserveWallet can commit its INSERT before a following read fails. Read
      // back the actual reservation before deciding that no money was held.
      try {
        const held = await getD1().prepare("SELECT status FROM wallet_reservations WHERE user_id=? AND request_id=?").bind(claimed.userId, claimed.walletId).first<{ status: string }>();
        if (held) {
          if (held.status === "reserved" || held.status === "refunded") await refundWallet({ userId: claimed.userId, requestId: claimed.walletId });
          const output = { error: { message: "此请求未发出，账务状态已记录，请使用新的请求编号重试。" }, tokvilo_billing: await billing(claimed.userId, claimed.walletId) };
          await getD1().prepare("UPDATE rkapi_requests SET response_json=?,status_code=503,state='failed',updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND idempotency_key=?")
            .bind(JSON.stringify(output), claimed.userId, claimed.id).run();
          return reply(output, 503);
        }
        await getD1().prepare("DELETE FROM rkapi_requests WHERE user_id=? AND idempotency_key=?").bind(claimed.userId, claimed.id).run();
      } catch {
        // Unreadable is not absent. Retain the receipt so a retry cannot create a
        // second reservation or dispatch while the first balance is uncertain.
        await getD1().prepare("UPDATE rkapi_requests SET state='unknown',updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND idempotency_key=?")
          .bind(claimed.userId, claimed.id).run().catch(() => undefined);
        return failure("精选账务状态正在核对，请保留原请求编号。", 503);
      }
    }
    if (claimed && (sent || reusedReservation)) {
      const output = { ...(recoverableOutput || { error: { message: "精选请求结果尚未确认，已保留原请求编号；请勿重复生成。" } }), tokvilo_billing: await billing(claimed.userId, claimed.walletId).catch(() => ({ status: "awaiting_reconciliation", currency: "USD" })) };
      const status = recoverableOutput ? 200 : 502;
      await getD1().prepare("UPDATE rkapi_requests SET response_json=?,status_code=?,state='unknown',updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND idempotency_key=? AND response_json IS NULL")
        .bind(JSON.stringify(output), status, claimed.userId, claimed.id).run().catch(() => undefined);
      if (who) await usage(who, path, status, started).catch(() => undefined);
      return reply(output, status);
    }
    const known = cause instanceof ProviderError || cause instanceof PricingError || cause instanceof WalletError;
    return failure(known ? cause.message : "tokvilo 精选服务暂不可用，请稍后重试。", known ? cause.status : 503);
  }
}
