import { getPortalUser } from "./auth";
import { getD1, runtimeEnv, type RuntimeEnv } from "./config";
import { sha256Hex } from "./crypto";
import { ensureUser } from "./store";
import { createProviderSettings, ProviderError } from "./provider-settings";
import { PricingError, publicServiceText, publicRelayResponse, publicModelPrice } from "./pricing";
import { apimartChatCharge, apimartTaskCharge, getApimartPricing, quoteApimartRequest } from "./apimart-pricing";
import { normalizeApimartRequest, APIMART_PATHS, isMusicModel } from "./apimart-request";
import { publicModelId, upstreamModelId } from "./model-id";
import { reserveWallet, settleWallet, refundWallet, WalletError } from "./wallet";

const BASE = "/api/gateway";
const COMPAT_BASE = "/api/apimart";
const ORIGIN = "https://api.apimart.ai";
const TASK_ID = /^[A-Za-z0-9_-]{1,160}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
type Json = Record<string, unknown>;
type Actor = { userId: string; keyId: string | null };
type StoredRequest = { request_hash: string; wallet_request_id: string; response_json: string | null; status_code: number | null };
type Task = { id: string; user_id: string; model: string; status: string; wallet_request_id: string; response_json: string | null };
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
function publicMetadata(value: unknown): unknown {
  if (!object(value)) return value;
  const result = { ...value };
  // Only service metadata is aliased. Generated text, prompts and media URLs stay intact.
  if (typeof result.model === "string") result.model = publicModelId(result.model);
  if (Array.isArray(result.data)) result.data = result.data.map(item => {
    if (!object(item)) return item;
    return { ...item, ...(typeof item.model === "string" ? { model: publicModelId(item.model) } : {}),
      ...(item.object === "model" && typeof item.id === "string" ? { id: publicModelId(item.id) } : {}) };
  });
  else if (object(result.data) && typeof result.data.model === "string") result.data = { ...result.data, model: publicModelId(result.data.model) };
  return result;
}
function reply(data: unknown, status = 200) { return Response.json(publicRelayResponse(publicMetadata(data)), { status, headers: HEADERS }); }
function error(message: string, status: number, code?: string) { return reply({ error: { message: publicServiceText(message), ...(code ? { code } : {}) } }, status); }

/** Supplier-account failures are service failures, never a customer's wallet
 * error. Explicitly project them so balances, token IDs and diagnostics cannot
 * escape through either a fresh response or an older persisted receipt. */
function publicServiceFailure(status: number, billing: Json): { data: Json; status: number } | null {
  if (![401, 402, 403].includes(status)) return null;
  const refunded = billing.status === "refunded" && billing.chargedMicrousd === 0;
  return { status: 503, data: {
    error: {
      code: status === 402 ? "service_balance_unavailable" : "service_authentication_unavailable",
      message: refunded ? "生成服务暂不可用，本次未扣费。请稍后重试或联系支持。" : "生成服务暂不可用，请稍后重试或联系支持。",
    },
    tokvilo_billing: billing,
  } };
}

async function actor(request: Request): Promise<Actor> {
  const authorization = request.headers.get("authorization");
  const rawKey = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] || request.headers.get("x-api-key");
  if (authorization || rawKey) {
    if (!rawKey || !/^(tk_live_|eco_live_)[A-Za-z0-9_-]{24,}$/.test(rawKey)) throw new ProviderError("请使用 tokvilo API Key。", 401);
    const row = await getD1().prepare(`SELECT k.id AS key_id,u.id AS user_id FROM api_keys k JOIN users u ON u.id=k.user_id
      WHERE k.key_hash=? AND k.revoked_at IS NULL AND u.status='active'`).bind(await sha256Hex(rawKey)).first<{ key_id: string; user_id: string }>();
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

async function readObject(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Json> {
  if (!body) throw new ProviderError("请求或响应内容为空。", 400);
  const reader = body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new ProviderError("内容超过大小限制。", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ProviderError("内容必须是 JSON 对象。", 400); }
  if (!object(data)) throw new ProviderError("内容必须是 JSON 对象。", 400);
  return data;
}

async function limitRequests(userId: string, mutation: boolean) {
  const now = new Date().toISOString(), expires = new Date(Date.now() + 60_000).toISOString();
  const allowed = await getD1().prepare(`INSERT INTO login_rate_limits (id,attempts,expires_at,updated_at) VALUES (?,1,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END,updated_at=CURRENT_TIMESTAMP
    WHERE expires_at<=? OR attempts<? RETURNING attempts`).bind(`apimart:${mutation ? "write" : "read"}:${userId}`, expires, now, now, now, mutation ? 5 : 60).first();
  if (!allowed) throw new ProviderError("请求较频繁，请一分钟后重试。", 429);
}
function redact(value: unknown, key: string): unknown {
  if (typeof value === "string") return value.replaceAll(key, "[redacted]");
  if (Array.isArray(value)) return value.map(item => redact(item, key));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([name, item]) => [name.replaceAll(key, "[redacted]"), redact(item, key)]));
  return value;
}
async function upstream(path: string, key: string, body?: Json): Promise<{ data: Json; status: number; ok: boolean }> {
  let response: Response;
  const providerPath = body?.model === "midjourney" ? "/v1/midjourney/generations" : path;
  const providerBody = body?.model === "midjourney" ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== "model")) : body;
  try {
    response = await fetch(ORIGIN + (path === "/v1/chat/completions" ? "/api" : "") + providerPath, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(providerBody) } : {}), cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(body ? 110_000 : 20_000),
    });
  } catch { throw new ProviderError(body ? "上游结果尚未确认，请保留原请求编号查询，不要重复生成。" : "暂时无法查询任务，请稍后刷新。", 502); }
  if (response.status >= 300 && response.status < 400) throw new ProviderError("上游返回意外重定向。", 502);
  let data: Json;
  try { data = redact(await readObject(response.body, 8_000_000), key) as Json; }
  catch { throw new ProviderError("上游响应不完整，结果等待核对。", 502); }
  const code = typeof data.code === "number" && data.code >= 400 && data.code <= 599 ? data.code : response.status;
  return { data, status: code, ok: response.ok && !data.error && data.success !== false && code < 400 };
}
async function recordUsage(who: Actor, path: string, status: number, started: number) {
  const db = getD1();
  await db.prepare(`INSERT INTO usage_daily(user_id,day,calls,successes,errors) VALUES(?,?,1,?,?)
    ON CONFLICT(user_id,day) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,updated_at=CURRENT_TIMESTAMP`)
    .bind(who.userId, new Date().toISOString().slice(0, 10), status < 400 ? 1 : 0, status >= 400 ? 1 : 0).run();
  await db.prepare("INSERT INTO usage_events(request_id,user_id,api_key_id,method,path,status,latency_ms) VALUES(?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), who.userId, who.keyId, "POST", BASE + path, status, Date.now() - started).run();
  if (who.keyId) await db.prepare("UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?").bind(who.keyId).run();
}

async function persistedBilling(db: D1Database, userId: string, requestId: string, fallback: Json): Promise<Json> {
  const row = await db.prepare("SELECT status,reserved_microusd,charged_microusd FROM wallet_reservations WHERE user_id=? AND request_id=?")
    .bind(userId, requestId).first<{ status: string; reserved_microusd: number; charged_microusd: number | null }>();
  if (!row) return fallback;
  return { ...fallback, status: row.status === "reserved" && fallback.status === "awaiting_reconciliation" ? fallback.status : row.status, reservedMicrousd: row.reserved_microusd, chargedMicrousd: row.charged_microusd, currency: "USD" };
}

async function requestReceipt(db: D1Database, userId: string, stored: StoredRequest): Promise<Response> {
  if (stored.response_json && stored.status_code) {
    const output = JSON.parse(stored.response_json);
    output.tokvilo_billing = await persistedBilling(db, userId, stored.wallet_request_id, object(output.tokvilo_billing) ? output.tokvilo_billing : {});
    const failure = publicServiceFailure(stored.status_code, output.tokvilo_billing);
    return failure ? reply(failure.data, failure.status) : reply(output, stored.status_code);
  }
  return reply({
    error: { code: "outcome_pending", message: "此请求已受理，结果尚未确认。请保留原请求编号，稍后查询。" },
    tokvilo_billing: await persistedBilling(db, userId, stored.wallet_request_id, { status: "awaiting_reconciliation", currency: "USD" }),
  }, 409);
}

async function pollApimartTask(task: Task, key: string, db: D1Database): Promise<Json> {
  const cached = await db.prepare("SELECT response_json FROM apimart_tasks WHERE id=? AND user_id=?").bind(task.id, task.user_id).first<{ response_json: string | null }>();
  if (cached?.response_json) return JSON.parse(cached.response_json);
  const result = await upstream(`${isMusicModel(task.model) ? "/v1/music/tasks" : "/v1/tasks"}/${task.id}`, key);
  if (!result.ok) throw new ProviderError("暂时无法查询任务，请稍后刷新。", [401, 402, 403].includes(result.status) ? 503 : result.status >= 400 ? result.status : 502);
  const data = object(result.data.data) ? result.data.data : result.data;
  if (data.id !== task.id || typeof data.status !== "string" || typeof data.model === "string" && upstreamModelId(data.model) !== task.model) throw new ProviderError("任务响应与请求编号不符。", 502);
  const terminal = ["completed", "failed", "cancelled"].includes(data.status);
  let billing: Json = { status: "reserved", currency: "USD" };
  let settled = false;
  if (terminal) {
    try {
      const amount = data.status === "completed" ? apimartTaskCharge(data) : 0;
      const wallet = amount || data.status === "completed"
        ? await settleWallet({ userId: task.user_id, requestId: task.wallet_request_id, amountMicrousd: amount })
        : await refundWallet({ userId: task.user_id, requestId: task.wallet_request_id });
      billing = { ...billing, status: wallet.status, chargedMicrousd: wallet.chargedMicrousd }; settled = true;
    } catch {
      billing = await persistedBilling(db, task.user_id, task.wallet_request_id, { ...billing, status: "awaiting_reconciliation" });
      settled = ["settled", "refunded"].includes(String(billing.status));
    }
  }
  const output = { ...result.data, tokvilo_billing: billing };
  await db.prepare("UPDATE apimart_tasks SET status=?,response_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND response_json IS NULL")
    .bind(data.status, settled ? JSON.stringify(output) : null, task.id, task.user_id).run();
  const final = await db.prepare("SELECT response_json FROM apimart_tasks WHERE id=? AND user_id=?").bind(task.id, task.user_id).first<{ response_json: string | null }>();
  if (final?.response_json) return JSON.parse(final.response_json);
  return output;
}

/** Scheduled reconciliation only polls tasks previously created and bound to an owner. */
export async function reconcileApimartTasks(env: RuntimeEnv, options: { maxTasks?: number } = {}) {
  if (!env.DB || env.SERVICE_ENABLED?.toLowerCase() !== "true") return { checked: 0, completed: 0 };
  const limit = Math.min(20, Math.max(1, options.maxTasks || 10));
  const rows = await env.DB.prepare("SELECT * FROM apimart_tasks WHERE response_json IS NULL AND poll_count<288 AND next_poll_at<=CURRENT_TIMESTAMP ORDER BY next_poll_at ASC,created_at ASC LIMIT ?").bind(limit).all<Task>();
  if (!rows.results?.length) return { checked: 0, completed: 0 };
  const key = await createProviderSettings(env).credential();
  let completed = 0;
  for (const task of rows.results) {
    const claimed = await env.DB.prepare("UPDATE apimart_tasks SET poll_count=poll_count+1,next_poll_at=datetime('now','+5 minutes') WHERE id=? AND user_id=? AND response_json IS NULL AND poll_count<288 AND next_poll_at<=CURRENT_TIMESTAMP RETURNING id")
      .bind(task.id, task.user_id).first();
    if (!claimed) continue;
    try {
      const result = await pollApimartTask(task, key, env.DB);
      const billing = result.tokvilo_billing;
      if (object(billing) && ["settled", "refunded"].includes(String(billing.status))) completed++;
    } catch {
      // Advance the cursor so one failing task cannot starve other owners.
      await env.DB.prepare("UPDATE apimart_tasks SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(task.id, task.user_id).run();
    }
  }
  return { checked: rows.results.length, completed };
}

export async function handleApimartRelay(request: Request): Promise<Response> {
  let claimed: { userId: string; id: string; walletId: string } | null = null;
  let reserved = false, sent = false;
  try {
    const who = await actor(request), db = getD1(), env = runtimeEnv(), url = new URL(request.url);
    const prefix = [BASE, COMPAT_BASE].find(base => url.pathname.startsWith(base + "/"));
    if (!prefix) return error("tokvilo 模型服务接口不存在。", 404);
    const path = url.pathname.slice(prefix.length);
    if (url.search) return error("此接口不接受查询参数。", 400);
    const taskPrefix = ["/v1/tasks/", "/v1/music/tasks/"].find(prefix => path.startsWith(prefix));
    const taskId = taskPrefix ? path.slice(taskPrefix.length) : null;
    const requestId = path.startsWith("/v1/requests/") ? path.slice("/v1/requests/".length) : null;
    const receiptRead = requestId !== null && REQUEST_ID.test(requestId) && request.method === "GET";
    // Existing receipts remain readable during a service pause. Reading them
    // never needs current pricing, provider credentials or a new wallet hold.
    if (env.SERVICE_ENABLED?.toLowerCase() !== "true" && !receiptRead) return error("生成服务当前未启用。", 503);
    const methods = ["/v1/models", "/v1/tasks"].includes(path) || (taskId && TASK_ID.test(taskId)) || (requestId && REQUEST_ID.test(requestId)) ? ["GET"] : (Object.values(APIMART_PATHS) as string[]).includes(path) ? ["POST"] : [];
    if (!methods.length) return error("tokvilo 模型服务 接口不存在。", 404);
    if (!methods.includes(request.method)) return error("不支持此请求方法。", 405);
    await limitRequests(who.userId, request.method !== "GET");
    if (requestId) {
      const receipt = await db.prepare("SELECT request_hash,wallet_request_id,response_json,status_code FROM apimart_requests WHERE user_id=? AND idempotency_key=?").bind(who.userId, requestId).first<StoredRequest>();
      return receipt ? await requestReceipt(db, who.userId, receipt) : error("未找到此账户的请求。", 404, "request_not_found");
    }
    if (path === "/v1/tasks") {
      const rows = await db.prepare("SELECT id,model,status,created_at,updated_at FROM apimart_tasks WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(who.userId).all();
      return reply({ data: rows.results || [] });
    }
    const service = createProviderSettings(env);
    if (path === "/v1/models") {
      const [discovered, pricing] = await Promise.all([service.models(), getApimartPricing()]);
      return reply({ object: "list", data: discovered.models.map(model => {
        const price = pricing.models.find(item => item.model === model.id);
        return { ...model, name: publicServiceText(publicModelId(model.id)), provider: publicServiceText(model.provider || "tokvilo"), object: "model", owned_by: publicServiceText(model.provider || "tokvilo"), pricing: price ? publicModelPrice(price) : null };
      }), pricing_observed_at: pricing.observedAt });
    }
    if (taskId) {
      const task = await db.prepare("SELECT * FROM apimart_tasks WHERE id=? AND user_id=?").bind(taskId, who.userId).first<Task>();
      if (!task) return error("未找到此账户的任务。", 404);
      if (task.response_json && ["completed", "failed", "cancelled"].includes(task.status)) return reply(JSON.parse(task.response_json));
      return reply(await pollApimartTask(task, await service.credential(), db));
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return error("请提交 application/json。", 415);
    const body = normalizeApimartRequest(await readObject(request.body, 64_000), path);
    const id = request.headers.get("Idempotency-Key") || "";
    if (!REQUEST_ID.test(id)) return error("需要 8–128 位 Idempotency-Key，重试请使用相同编号。", 400);
    const hash = await sha256Hex(path + "\n" + JSON.stringify(body));
    const existing = await db.prepare("SELECT request_hash,wallet_request_id,response_json,status_code FROM apimart_requests WHERE user_id=? AND idempotency_key=?").bind(who.userId, id).first<StoredRequest>();
    if (existing) {
      if (existing.request_hash !== hash) return error("相同请求编号不能用于不同内容。", 409);
      return await requestReceipt(db, who.userId, existing);
    }
    const rawMaximum = request.headers.get("X-Tokvilo-Max-Reserve-Microusd");
    const maximum = rawMaximum === null ? null : Number(rawMaximum);
    if (rawMaximum !== null && (!/^\d{1,13}$/.test(rawMaximum) || !Number.isSafeInteger(maximum) || Number(maximum) < 1 || Number(maximum) > 1_000_000_000_000)) return error("预留金额上限必须为有效的正整数 micro-USD。", 400);
    const [pricing, key] = await Promise.all([getApimartPricing(), service.credential()]);
    const quote = quoteApimartRequest(body, path, pricing), walletId = `apimart:${id}`;
    if (maximum !== null && quote.amountMicrousd > maximum) return reply({ error: { message: "最新预留金额高于已确认报价，请重新获取报价后确认。", code: "reservation_limit_exceeded", requiredReserveMicrousd: quote.amountMicrousd }, reservedMicrousd: quote.amountMicrousd }, 409);
    const inserted = await db.prepare("INSERT INTO apimart_requests(user_id,idempotency_key,request_hash,wallet_request_id,quote_json) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING user_id")
      .bind(who.userId, id, hash, walletId, JSON.stringify(quote)).first();
    if (!inserted) return error("此请求正在处理，请使用相同编号查询结果。", 409);
    claimed = { userId: who.userId, id, walletId };
    const wallet = await reserveWallet({ userId: who.userId, requestId: walletId, amountMicrousd: quote.amountMicrousd, metadata: { provider: "apimart", model: body.model, hash } });
    if (wallet.reused) return error("此账务请求已受理，请查询原请求结果。", 409);
    reserved = true;
    const started = Date.now(); sent = true;
    const result = await upstream(path, key, body);
    let billing: Json = { status: "reserved", reservedMicrousd: quote.amountMicrousd, chargedMicrousd: null, currency: "USD" };
    if (!result.ok) {
      if ([400, 401, 402, 403, 404, 422, 429].includes(result.status)) {
        const refund = await refundWallet({ userId: who.userId, requestId: walletId });
        billing = { ...billing, status: refund.status, chargedMicrousd: 0 };
      } else billing = { ...billing, status: "awaiting_reconciliation" };
    } else if (path !== "/v1/chat/completions") {
      const tasks = result.data.data;
      if (!Array.isArray(tasks) || tasks.length !== 1 || !object(tasks[0]) || typeof tasks[0].task_id !== "string" || !TASK_ID.test(tasks[0].task_id)) throw new ProviderError("上游未返回可查询任务编号，结果等待核对。", 502);
      await db.prepare("INSERT INTO apimart_tasks(id,user_id,model,status,wallet_request_id) VALUES(?,?,?,?,?)")
        .bind(tasks[0].task_id, who.userId, String(body.model), String(tasks[0].status || "submitted"), walletId).run();
    } else {
      try {
        const amountMicrousd = apimartChatCharge(quote, result.data);
        const settlement = await settleWallet({ userId: who.userId, requestId: walletId, amountMicrousd });
        billing = { ...billing, status: settlement.status, chargedMicrousd: settlement.chargedMicrousd };
      } catch { billing = { ...billing, status: "awaiting_reconciliation" }; }
    }
    const failure = result.ok ? null : publicServiceFailure(result.status, billing);
    const output = failure?.data || { ...result.data, tokvilo_billing: billing };
    const status = failure?.status || (result.ok ? result.status : result.status >= 400 ? result.status : 502);
    await db.prepare("UPDATE apimart_requests SET response_json=?,status_code=? WHERE user_id=? AND idempotency_key=?").bind(JSON.stringify(output), status, who.userId, id).run();
    await recordUsage(who, path, status, started).catch(() => undefined);
    return reply(output, status);
  } catch (cause) {
    if (claimed && !sent) {
      if (reserved) await refundWallet({ userId: claimed.userId, requestId: claimed.walletId }).catch(() => undefined);
      else await getD1().prepare("DELETE FROM apimart_requests WHERE user_id=? AND idempotency_key=?").bind(claimed.userId, claimed.id).run().catch(() => undefined);
    }
    const known = cause instanceof ProviderError || cause instanceof PricingError || cause instanceof WalletError;
    return error(known ? cause.message : "tokvilo 模型服务 服务暂不可用，请稍后重试。", known ? cause.status : 503, cause instanceof WalletError ? cause.code : undefined);
  }
}
