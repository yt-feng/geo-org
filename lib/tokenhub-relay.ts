import { getPortalUser, type PortalUser } from "./auth";
import { getD1, runtimeEnv, type RuntimeEnv } from "./config";
import { sha256Hex } from "./crypto";
import { ensureUser } from "./store";
import { ProviderError } from "./provider-settings";
import { createTokenHubSettings, TOKENHUB_ORIGIN } from "./tokenhub-settings";
import { getTokenHubPricing, quoteTokenHubRequest, tokenHubActualCost, PricingError, type TokenHubQuote } from "./pricing";
import { reserveWallet, settleWallet, refundWallet, WalletError } from "./wallet";

const BASE = "/api/tokenhub";
const TASKS = "/v3/contents/generations/tasks";
const JSON_HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const TASK_ID = /^[A-Za-z0-9_-]{1,160}$/;
type Actor = { userId: string; keyId: string | null };
type StoredRequest = { request_hash: string; response_json: string | null; status_code: number | null };
type Billing = { wallet_request_id: string; quote_json: string };
type Json = Record<string, unknown>;
class RepricingRequired extends ProviderError {
  constructor(public requiredReserveMicrousd: number) { super("当前价格所需预留金额超过您确认的上限，请重新获取报价后提交。", 409); }
}

function reply(data: unknown, status = 200) { return Response.json(data, { status, headers: JSON_HEADERS }); }
function error(message: string, status: number) { return reply({ error: { message } }, status); }
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }

async function actor(request: Request): Promise<Actor> {
  const authorization = request.headers.get("authorization");
  const rawKey = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] || request.headers.get("x-api-key");
  if (authorization || rawKey) {
    if (!rawKey || !/^(?:tk|eco)_live_/.test(rawKey) || rawKey.length < 32) throw new ProviderError("请使用 Tokvilo API Key。", 401);
    const row = await getD1().prepare(`SELECT k.id AS key_id, u.id AS user_id, u.email
      FROM api_keys k JOIN users u ON u.id=k.user_id
      WHERE k.key_hash=? AND k.revoked_at IS NULL AND u.status='active'`).bind(await sha256Hex(rawKey)).first<{ key_id: string; user_id: string; email: string }>();
    if (!row) throw new ProviderError("API Key 无效或已停用。", 401);
    return { userId: row.user_id, keyId: row.key_id };
  }
  const user: PortalUser | null = await getPortalUser();
  if (!user) throw new ProviderError("请先登录或提供 tokvilo API Key。", 401);
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) throw new ProviderError("请从 tokvilo 工作台提交请求。", 403);
  await ensureUser(user);
  const row = await getD1().prepare("SELECT status FROM users WHERE id=?").bind(user.id).first<{ status: string }>();
  if (row?.status !== "active") throw new ProviderError("账户已停用。", 403);
  return { userId: user.id, keyId: null };
}

async function readObject(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Json> {
  if (!body) throw new ProviderError("请求或响应内容为空。", 400);
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new ProviderError("内容超过大小限制，请使用公开媒体 URL。", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
    let result;
    try { result = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ProviderError("内容必须是 JSON 对象。", 400); }
    if (!object(result)) throw new ProviderError("内容必须是 JSON 对象。", 400);
    return result;
  } finally { reader.releaseLock(); }
}

function validateBody(body: Json, path: string) {
  if (typeof body.model !== "string" || !body.model.trim() || body.model.length > 200) throw new ProviderError("请填写有效的模型 ID。", 400);
  if (body.stream) throw new ProviderError("当前接口使用完整 JSON 返回，请设置 stream: false。", 400);
  if (path === TASKS) {
    if (!Array.isArray(body.content) || body.content.length < 1 || body.content.length > 32 || !body.content.every(object)) throw new ProviderError("视频请求需要 content 内容数组。", 400);
    if (body.duration !== undefined && (!Number.isInteger(body.duration) || (body.duration !== -1 && (Number(body.duration) < 4 || Number(body.duration) > 15)))) throw new ProviderError("视频时长应为 4–15 秒，或 -1 自动选择。", 400);
  } else if (path === "/v1/chat/completions") {
    if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 200 || !body.messages.every(object)) throw new ProviderError("对话请求需要 messages 数组。", 400);
  } else if (typeof body.prompt !== "string" || !body.prompt.trim()) throw new ProviderError("图片请求需要 prompt 提示词。", 400);
}

async function limitRequests(userId: string, mutation: boolean) {
  const now = new Date().toISOString(), expires = new Date(Date.now() + 60_000).toISOString();
  const limit = mutation ? 5 : 60;
  const allowed = await getD1().prepare(`INSERT INTO login_rate_limits (id, attempts, expires_at, updated_at) VALUES (?, 1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN expires_at <= ? THEN 1 ELSE attempts+1 END,
    expires_at=CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END, updated_at=CURRENT_TIMESTAMP
    WHERE expires_at <= ? OR attempts < ? RETURNING attempts`).bind(`tokenhub:${mutation ? "write" : "read"}:${userId}`, expires, now, now, now, limit).first();
  if (!allowed) throw new ProviderError("请求较频繁，请一分钟后重试。", 429);
}

function redacted(data: Json, key: string): Json {
  // Upstream diagnostics must never echo the server credential back to a caller.
  function visit(value: unknown): unknown {
    if (typeof value === "string") return value.replaceAll(key, "[redacted]");
    if (Array.isArray(value)) return value.map(visit);
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([name, item]) => [name.replaceAll(key, "[redacted]"), visit(item)]));
    return value;
  }
  return visit(data) as Json;
}
function taskData(data: Json): Json { return object(data.data) ? data.data : data; }
function taskStatus(data: Json) { const value = taskData(data).status; return typeof value === "string" ? value.slice(0, 60) : "submitted"; }

async function recordUsage(who: Actor, path: string, status: number, started: number) {
  const db = getD1(), day = new Date().toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO usage_daily (user_id,day,calls,successes,errors) VALUES (?,?,1,?,?)
    ON CONFLICT(user_id,day) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,updated_at=CURRENT_TIMESTAMP`)
    .bind(who.userId, day, status < 400 ? 1 : 0, status >= 400 ? 1 : 0).run();
  if (who.keyId) await db.prepare("UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?").bind(who.keyId).run();
  if (status >= 400) await db.prepare("INSERT INTO usage_events (request_id,user_id,api_key_id,method,path,status,latency_ms) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), who.userId, who.keyId, "POST", BASE + path, status, Date.now() - started).run();
}

export async function handleTokenHubRelay(request: Request): Promise<Response> {
  let reservation: { userId: string; id: string } | null = null;
  let billing: { userId: string; requestId: string; quote: TokenHubQuote } | null = null;
  let sent = false;
  try {
    const who = await actor(request), env = runtimeEnv(), db = getD1();
    if (env.SERVICE_ENABLED?.toLowerCase() !== "true") return error("生成服务当前未启用。", 503);
    const url = new URL(request.url), path = url.pathname.slice(BASE.length);
    if (url.search) return error("此接口不接受查询参数。", 400);
    const taskId = path.startsWith(TASKS + "/") ? path.slice(TASKS.length + 1) : null;
    const allowed = path === "/v1/models" ? ["GET"] : path === TASKS ? ["GET", "POST"] : taskId && TASK_ID.test(taskId) ? ["GET", "DELETE"] : ["/v1/chat/completions", "/v3/images/generations"].includes(path) ? ["POST"] : [];
    if (!allowed.length) return error("TokenHub 接口不存在。", 404);
    if (!allowed.includes(request.method)) return error("不支持此请求方法。", 405);
    await limitRequests(who.userId, request.method !== "GET");
    if (path === TASKS && request.method === "GET") {
      const rows = await db.prepare("SELECT id,model,status,strftime('%Y-%m-%dT%H:%M:%fZ',created_at) AS created_at,strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) AS updated_at FROM tokenhub_tasks WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(who.userId).all();
      return reply({ data: rows.results || [] });
    }
    if (taskId) {
      const owned = await db.prepare("SELECT id FROM tokenhub_tasks WHERE id=? AND user_id=?").bind(taskId, who.userId).first();
      if (!owned) return error("未找到此账户的任务。", 404);
    }
    let body: Json | undefined;
    let maxReserveMicrousd: number | null = null;
    if (request.method === "POST") {
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return error("请提交 application/json。", 415);
      body = await readObject(request.body, 1_000_000);
      validateBody(body, path);
      const ceiling = request.headers.get("X-Tokvilo-Max-Reserve-Microusd");
      if (ceiling !== null) {
        const parsed = Number(ceiling);
        if (!/^[1-9]\d{0,15}$/.test(ceiling) || !Number.isSafeInteger(parsed)) throw new ProviderError("X-Tokvilo-Max-Reserve-Microusd 必须是大于 0 的安全整数。", 400);
        maxReserveMicrousd = parsed;
      }
    }
    const service = createTokenHubSettings(env);
    if (path === "/v1/models") {
      const discovered = await service.models();
      return reply({ object: "list", data: discovered.models.map(model => ({ object: "model", owned_by: model.provider || "tokenhub", ...model })), catalog: discovered.catalog });
    }
    const key = await service.credential();
    if (request.method === "POST") {
      const id = request.headers.get("Idempotency-Key") || "";
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) return error("付费请求需要 8–128 位 Idempotency-Key；重试请使用相同编号。", 400);
      const hash = await sha256Hex(path + "\n" + JSON.stringify(body));
      const claimed = await db.prepare("INSERT INTO tokenhub_requests (user_id,idempotency_key,request_hash) VALUES (?,?,?) ON CONFLICT DO NOTHING RETURNING user_id").bind(who.userId, id, hash).first();
      if (!claimed) {
        const existing = await db.prepare("SELECT request_hash,response_json,status_code FROM tokenhub_requests WHERE user_id=? AND idempotency_key=?").bind(who.userId, id).first<StoredRequest>();
        const legacyVideoMatch = path === TASKS && existing?.request_hash === await sha256Hex(JSON.stringify(body));
        if (!existing || existing.request_hash !== hash && !legacyVideoMatch) return error("同一 Idempotency-Key 不能用于不同的请求。", 409);
        if (existing.response_json && existing.status_code) {
          const cached = JSON.parse(existing.response_json) as Json;
          const receipt = await db.prepare("SELECT status,reserved_microusd AS reservedMicrousd,charged_microusd AS chargedMicrousd FROM wallet_reservations WHERE user_id=? AND request_id=?")
            .bind(who.userId, `tokenhub:${id}`).first<{ status: string; reservedMicrousd: number; chargedMicrousd: number | null }>();
          return reply(receipt ? { ...cached, tokvilo_billing: { currency: "USD", markupPercent: 20, ...receipt } } : cached, existing.status_code);
        }
        return error("此请求已提交，结果尚未确认。请查看任务记录或 TokenHub 请求日志，不要更换编号重复生成。", 409);
      }
      reservation = { userId: who.userId, id };
      {
        const kind = path === TASKS ? "video" : path === "/v3/images/generations" ? "image" : "chat";
        const quote = quoteTokenHubRequest(await getTokenHubPricing(), kind, body!);
        if (maxReserveMicrousd !== null && quote.reservedMicrousd > maxReserveMicrousd) throw new RepricingRequired(quote.reservedMicrousd);
        const requestId = `tokenhub:${id}`;
        const held = await reserveWallet({ userId: who.userId, requestId, amountMicrousd: quote.reservedMicrousd, description: `TokenHub ${quote.model}`, metadata: { model: quote.model, kind, requestHash: hash } });
        if (held.status !== "reserved") throw new WalletError("此请求编号已经结算或退回，请为新请求使用新的 Idempotency-Key。", 409, "request_already_completed");
        billing = { userId: who.userId, requestId, quote };
        await db.prepare("INSERT INTO tokenhub_billing (user_id,idempotency_key,wallet_request_id,quote_json) VALUES (?,?,?,?)")
          .bind(who.userId, id, requestId, JSON.stringify(quote)).run();
      }
    }
    if (taskId) {
      const stored = await db.prepare("SELECT wallet_request_id,quote_json FROM tokenhub_billing WHERE user_id=? AND task_id=?")
        .bind(who.userId, taskId).first<Billing>();
      if (stored) billing = { userId: who.userId, requestId: stored.wallet_request_id, quote: JSON.parse(stored.quote_json) as TokenHubQuote };
    }
    let response: Response;
    const started = Date.now();
    try {
      sent = true;
      response = await fetch(TOKENHUB_ORIGIN + "/api" + path, {
        method: request.method, headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(request.method === "GET" ? 20_000 : 110_000),
      });
    } catch { throw new ProviderError(request.method === "POST" ? "TokenHub 尚未返回结果。请核对上游请求记录后再决定是否重试。" : "暂时无法连接 TokenHub，请稍后刷新。", 502); }
    if (response.status >= 300 && response.status < 400) throw new ProviderError("TokenHub 返回了意外重定向，请联系管理员。", 502);
    let data: Json;
    try { data = response.status === 204 ? { status: "cancelled_or_deleted", id: taskId } : redacted(await readObject(response.body, 8_000_000), key); }
    catch { throw new ProviderError("TokenHub 响应不完整，请在上游请求记录中核对结果。", 502); }
    const status = response.status;
    if (response.ok && taskId && taskData(data).id !== undefined && taskData(data).id !== taskId) throw new ProviderError("上游返回的任务编号不一致，预留金额等待核对。", 502);
    if (response.ok && path === TASKS && request.method === "POST") {
      const result = taskData(data), id = result.id;
      if (typeof id !== "string" || !TASK_ID.test(id)) throw new ProviderError("TokenHub 未返回可查询的任务编号，请核对上游记录。", 502);
      await db.prepare("INSERT INTO tokenhub_tasks (id,user_id,model,status) VALUES (?,?,?,?) ON CONFLICT(id,user_id) DO UPDATE SET status=excluded.status,updated_at=CURRENT_TIMESTAMP")
        .bind(id, who.userId, String(body!.model), taskStatus(data)).run();
      if (billing && reservation) await db.prepare("UPDATE tokenhub_billing SET task_id=? WHERE user_id=? AND idempotency_key=?")
        .bind(id, who.userId, reservation.id).run();
    } else if (response.ok && taskId) {
      await db.prepare("UPDATE tokenhub_tasks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
        .bind(request.method === "DELETE" && typeof taskData(data).status !== "string" ? "cancelled_or_deleted" : taskStatus(data), taskId, who.userId).run();
    }
    if (billing) {
      let billingResult: Record<string, unknown> = { status: "pending_confirmation", reservedMicrousd: billing.quote.reservedMicrousd };
      const actual = response.ok ? tokenHubActualCost(billing.quote, data) : null;
      // An explicit rejected request or a confirmed failed video has no billable
      // output. Transport failures and 5xx responses retain the hold.
      const rejected = request.method === "POST" && [400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(status);
      const failedVideo = billing.quote.kind === "video" && response.ok && ["failed", "cancelled", "expired"].includes(taskStatus(data));
      try {
        if (actual !== null) billingResult = { ...await settleWallet({ userId: billing.userId, requestId: billing.requestId, amountMicrousd: actual, description: `TokenHub ${billing.quote.model}` }) };
        else if (rejected || failedVideo) billingResult = { ...await refundWallet({ userId: billing.userId, requestId: billing.requestId, description: "上游未生成成功，退还预留金额。" }) };
      } catch {
        // Preserve successful output even if its settlement needs reconciliation.
        // A settlement above the hold must not be silently estimated or truncated.
        const recorded = await db.prepare("SELECT status,reserved_microusd AS reservedMicrousd,charged_microusd AS chargedMicrousd FROM wallet_reservations WHERE user_id=? AND request_id=?")
          .bind(billing.userId, billing.requestId).first<{ status: string; reservedMicrousd: number; chargedMicrousd: number | null }>().catch(() => null);
        if (recorded && recorded.status !== "reserved") billingResult = recorded;
      }
      data = { ...data, tokvilo_billing: { currency: "USD", markupPercent: 20, ...billingResult } };
    }
    if (reservation) await db.prepare("UPDATE tokenhub_requests SET status_code=?,response_json=? WHERE user_id=? AND idempotency_key=?")
      .bind(status, JSON.stringify(data), reservation.userId, reservation.id).run();
    if (request.method === "POST") await recordUsage(who, path, status, started).catch(() => undefined);
    return reply(data, status === 204 ? 200 : status);
  } catch (cause) {
    // Never release a reservation once a paid request may have reached the provider.
    if (reservation && !sent) {
      if (billing) await refundWallet({ userId: billing.userId, requestId: billing.requestId, description: "请求尚未发送，退还预留金额。" }).catch(() => undefined);
      await getD1().prepare("DELETE FROM tokenhub_requests WHERE user_id=? AND idempotency_key=?").bind(reservation.userId, reservation.id).run().catch(() => undefined);
      await getD1().prepare("DELETE FROM tokenhub_billing WHERE user_id=? AND idempotency_key=?").bind(reservation.userId, reservation.id).run().catch(() => undefined);
    }
    if (cause instanceof RepricingRequired) return reply({ error: { code: "reservation_limit_exceeded", message: cause.message, requiredReserveMicrousd: cause.requiredReserveMicrousd } }, 409);
    const known = cause instanceof ProviderError || cause instanceof PricingError || cause instanceof WalletError;
    return error(known ? cause.message : "TokenHub 服务暂不可用，请稍后重试。", known ? cause.status : 503);
  }
}

/** Poll only existing owner-bound paid tasks; this function never generates. */
export async function reconcileTokenHubTasks(env: RuntimeEnv, options: { maxTasks?: number } = {}) {
  if (!env.DB) return { examined: 0, settled: 0, refunded: 0 };
  const db = env.DB, now = new Date().toISOString();
  const limit = Math.max(1, Math.min(10, Math.floor(options.maxTasks || 5)));
  type Pending = Billing & { user_id: string; idempotency_key: string; task_id: string; poll_count: number };
  const rows = await db.prepare(`SELECT b.user_id,b.idempotency_key,b.wallet_request_id,b.quote_json,b.task_id,b.poll_count
    FROM tokenhub_billing b JOIN tokenhub_tasks t ON t.user_id=b.user_id AND t.id=b.task_id
    JOIN wallet_reservations w ON w.user_id=b.user_id AND w.request_id=b.wallet_request_id
    WHERE w.status='reserved' AND b.poll_count<288 AND (b.next_poll_at IS NULL OR b.next_poll_at<=?)
    ORDER BY COALESCE(b.next_poll_at,b.created_at),b.created_at LIMIT ?`).bind(now, limit).all<Pending>();
  if (!rows.results?.length) return { examined: 0, settled: 0, refunded: 0 };
  const key = await createTokenHubSettings(env).credential();
  let examined = 0, settled = 0, refunded = 0;
  for (const row of rows.results) {
    if (!TASK_ID.test(row.task_id)) continue;
    const claimed = await db.prepare(`UPDATE tokenhub_billing SET poll_count=poll_count+1,next_poll_at=?,last_polled_at=?
      WHERE user_id=? AND idempotency_key=? AND poll_count=? AND (next_poll_at IS NULL OR next_poll_at<=?) RETURNING user_id`)
      .bind(new Date(Date.now() + 5 * 60_000).toISOString(), now, row.user_id, row.idempotency_key, row.poll_count, now).first();
    if (!claimed) continue;
    examined++;
    try {
      const quote = JSON.parse(row.quote_json) as TokenHubQuote;
      if (quote.kind !== "video" || quote.provider !== "tokenhub") continue;
      const response = await fetch(TOKENHUB_ORIGIN + "/api" + TASKS + "/" + encodeURIComponent(row.task_id), {
        method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) continue;
      const data = redacted(await readObject(response.body, 8_000_000), key);
      const value = taskData(data);
      if (value.id !== undefined && value.id !== row.task_id) continue;
      await db.prepare("UPDATE tokenhub_tasks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?")
        .bind(taskStatus(data), row.user_id, row.task_id).run();
      const actual = tokenHubActualCost(quote, data);
      if (actual !== null) {
        await settleWallet({ userId: row.user_id, requestId: row.wallet_request_id, amountMicrousd: actual, description: `TokenHub ${quote.model}` });
        settled++;
      } else if (["failed", "cancelled", "expired"].includes(taskStatus(data))) {
        await refundWallet({ userId: row.user_id, requestId: row.wallet_request_id, description: "视频未生成成功，退还预留金额。" });
        refunded++;
      }
    } catch { /* Uncertain provider outcomes keep their reservation and poll lease. */ }
  }
  return { examined, settled, refunded };
}
