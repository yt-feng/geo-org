import {
  decimalEnv,
  getD1,
  isServiceEnabled,
  numericEnv,
  requiredEnv,
  runtimeEnv,
} from "./config";
import { randomId, sha256Hex } from "./crypto";
import { markupMicrousd } from "./pricing";
import { getWallet, reserveWallet, settleWallet, refundWallet, WalletError } from "./wallet";
import {
  buildReplacements,
  isTextualContentType,
  sanitizeLocation,
  sanitizeText,
  sanitizeTextStream,
} from "./sanitize";

type AuthorizedKey = {
  keyId: string;
  userId: string;
  email: string;
  dailyLimit: number;
};

const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "content-encoding",
  "content-language",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-unmodified-since",
  "range",
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-language",
  "content-range",
  "content-type",
  "expires",
  "last-modified",
  "retry-after",
  "vary",
]);

const KNOWN_ZERO_COST_ENDPOINTS = new Set([
  "/api/v1/demo/demo/cache_status",
  "/api/v1/demo/douyin/app/fetch_one_video",
  "/api/v1/demo/douyin/web/fetch_one_video",
  "/api/v1/demo/douyin_search/app/general_search",
  "/api/v1/demo/instagram/web/fetch_user_info",
  "/api/v1/demo/kuaishou/web/fetch_one_video",
  "/api/v1/demo/tiktok/app/fetch_one_video",
  "/api/v1/demo/tiktok/web/fetch_user_profile",
  "/api/v1/demo/wechat/article_extract",
  "/api/v1/health/check",
  "/api/v1/ios_shortcut/shortcut",
]);

const BLOCKED_UNBOUNDED_ENDPOINTS = new Set([
  "/api/v1/tiktok/web/tiktok_live_room",
  "/api/v1/douyin/web/douyin_live_room",
]);

const PER_ROOM_ENDPOINT = "/api/v1/tiktok/web/fetch_batch_check_live_alive";

const MAX_REQUEST_COST_MULTIPLIERS = new Map([
  ["/api/v1/linkedin/web/get_user_profile", 11],
  ["/api/v1/linkedin/web/get_company_profile", 2],
  ["/api/v1/linkedin/web/get_job_detail", 2],
]);

// The provider explicitly documents these read-only operations as per-request:
// https://tikhub.io/twitter-api . Expand only after checking the billing unit.
const FIXED_PRICE_MEMBER_ENDPOINTS = new Set([
  "/api/v1/twitter/web/fetch_tweet_detail",
  "/api/v1/twitter/web/fetch_user_profile",
  "/api/v1/twitter/web/fetch_user_post_tweet",
  "/api/v1/twitter/web/fetch_user_tweet_replies",
  "/api/v1/twitter/web/fetch_search_timeline",
  "/api/v1/twitter/web/fetch_post_comments",
  "/api/v1/twitter/web/fetch_retweet_user_list",
  "/api/v1/twitter/web/fetch_user_followers",
  "/api/v1/twitter/web/fetch_user_followings",
  "/api/v1/twitter/web/fetch_trending",
]);

function jsonError(
  status: number,
  code: string,
  message: string,
  requestId: string,
): Response {
  return Response.json(
    { error: { code, message, request_id: requestId } },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    },
  );
}

function extractClientKey(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || request.headers.get("x-api-key")?.trim() || "";
}

async function authorizeKey(request: Request): Promise<AuthorizedKey | null> {
  const rawKey = extractClientKey(request);
  if (!/^(?:eco|tk)_live_/.test(rawKey) || rawKey.length < 32) return null;
  const keyHash = await sha256Hex(rawKey);
  const row = await getD1()
    .prepare(
      `SELECT
         k.id AS key_id,
         k.user_id AS user_id,
         u.email AS email,
         u.daily_limit AS daily_limit
       FROM api_keys k
       JOIN users u ON u.id = k.user_id
       WHERE k.key_hash = ?
         AND k.revoked_at IS NULL
         AND u.status = 'active'
       LIMIT 1`,
    )
    .bind(keyHash)
    .first<{
      key_id: string;
      user_id: string;
      email: string;
      daily_limit: number;
    }>();
  if (!row) return null;
  return {
    keyId: row.key_id,
    userId: row.user_id,
    email: row.email,
    dailyLimit: Number(row.daily_limit || 0),
  };
}

function localEnvelope(
  requestId: string,
  path: string,
  data: unknown,
  message = "Request completed",
): Response {
  return Response.json(
    {
      code: 200,
      message,
      data,
      request_id: requestId,
      router: path,
    },
    {
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    },
  );
}

async function handleLocalGatewayEndpoint(
  request: Request,
  key: AuthorizedKey,
  requestId: string,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const base = "/api/v1/gateway";
  if (path !== base && !path.startsWith(`${base}/`)) return null;
  if (request.method !== "GET") {
    return jsonError(405, "method_not_allowed", "Method not allowed.", requestId);
  }

  const database = getD1();
  const day = new Date().toISOString().slice(0, 10);
  if (path === `${base}/user/get_user_info`) {
    const usage = await database
      .prepare(
        `SELECT calls, successes, errors
         FROM usage_daily WHERE user_id = ? AND day = ?`,
      )
      .bind(key.userId, day)
      .first<{ calls: number; successes: number; errors: number }>();
    return localEnvelope(requestId, path, {
      email: key.email,
      plan: "prepaid",
      status: "active",
      daily_limit: key.dailyLimit,
      calls_today: Number(usage?.calls || 0),
      successes_today: Number(usage?.successes || 0),
      errors_today: Number(usage?.errors || 0),
      wallet: await getWallet(key.userId),
    });
  }

  if (path === `${base}/user/get_user_daily_usage`) {
    const result = await database
      .prepare(
        `SELECT day, calls, successes, errors, bytes_in, bytes_out
         FROM usage_daily
         WHERE user_id = ?
         ORDER BY day DESC
         LIMIT 30`,
      )
      .bind(key.userId)
      .all();
    return localEnvelope(requestId, path, result.results || []);
  }

  if (
    path === `${base}/user/calculate_price` ||
    path === `${base}/user/get_tiered_discount_info` ||
    path === `${base}/user/get_endpoint_info` ||
    path === `${base}/user/get_all_endpoints_info`
  ) {
    return localEnvelope(requestId, path, {
      plan: "prepaid",
      markup_percent: 20,
      currency: "USD",
      daily_limit: key.dailyLimit,
      note: "Supported requests use the current upstream per-request price plus 20%. Available wallet balance is required; daily request limits are separate.",
    });
  }

  if (path === `${base}/downloader/version`) {
    return localEnvelope(requestId, path, {
      version: "1.0.0",
      download_url: null,
      homepage: runtimeEnv().PUBLIC_BASE_URL || "https://tokvilo.com",
    });
  }

  if (path === `${base}/downloader/redirect_download`) {
    return jsonError(404, "not_available", "Download is not available.", requestId);
  }
  return jsonError(404, "not_found", "Endpoint not found.", requestId);
}

async function reserveRequestQuota(
  key: AuthorizedKey,
  inputBytes: number,
): Promise<"ok" | "global" | "user"> {
  const database = getD1();
  const day = new Date().toISOString().slice(0, 10);
  const perUser = await database
    .prepare(
      `INSERT INTO usage_daily
         (user_id, day, calls, successes, errors, bytes_in, bytes_out, updated_at)
       SELECT ?, ?, 1, 0, 0, ?, 0, CURRENT_TIMESTAMP
       WHERE ? > 0
       ON CONFLICT(user_id, day) DO UPDATE SET
         calls = usage_daily.calls + 1,
         bytes_in = usage_daily.bytes_in + excluded.bytes_in,
         updated_at = CURRENT_TIMESTAMP
       WHERE usage_daily.calls < ?
       RETURNING calls`,
    )
    .bind(
      key.userId,
      day,
      Math.max(0, inputBytes),
      key.dailyLimit,
      key.dailyLimit,
    )
    .first<{ calls: number }>();
  if (!perUser) return "user";

  const globalLimit = numericEnv("GLOBAL_PROXY_DAILY_LIMIT", 5000);
  const global = await database
    .prepare(
      `INSERT INTO global_usage (day, calls, updated_at)
       SELECT ?, 1, CURRENT_TIMESTAMP
       WHERE ? > 0
       ON CONFLICT(day) DO UPDATE SET
         calls = global_usage.calls + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE global_usage.calls < ?
       RETURNING calls`,
    )
    .bind(day, globalLimit, globalLimit)
    .first<{ calls: number }>();
  return global ? "ok" : "global";
}

async function reserveSpend(estimatedCostMicrousd: number): Promise<boolean> {
  const database = getD1();
  const spendLimitMicrousd = Math.floor(
    decimalEnv("UPSTREAM_SPEND_LIMIT_USD", 1) * 1_000_000,
  );
  const cost = Math.max(0, Math.floor(estimatedCostMicrousd));
  const spend = await database
    .prepare(
      `INSERT INTO spend_guard (id, reserved_microusd, updated_at)
       SELECT 'relay', ?, CURRENT_TIMESTAMP
       WHERE ? <= ?
       ON CONFLICT(id) DO UPDATE SET
         reserved_microusd = spend_guard.reserved_microusd + excluded.reserved_microusd,
         updated_at = CURRENT_TIMESTAMP
       WHERE spend_guard.reserved_microusd + excluded.reserved_microusd <= ?
       RETURNING reserved_microusd`,
    )
    .bind(cost, cost, spendLimitMicrousd, spendLimitMicrousd)
    .first<{ reserved_microusd: number }>();
  return Boolean(spend);
}

async function endpointCostMicrousd(endpoint: string): Promise<number | null> {
  if (KNOWN_ZERO_COST_ENDPOINTS.has(endpoint)) return 0;
  const priceEndpoint = runtimeEnv().UPSTREAM_PRICE_ENDPOINT?.trim();
  if (!priceEndpoint) return null;

  try {
    const url = new URL(priceEndpoint);
    url.searchParams.set("endpoint", endpoint);
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: { endpoint_cost?: number };
    };
    const cost = payload.data?.endpoint_cost;
    if (
      typeof cost !== "number" ||
      !Number.isFinite(cost) ||
      cost <= 0 ||
      cost > Number.MAX_SAFE_INTEGER / 1_000_000
    ) {
      return null;
    }
    return Math.ceil(cost * 1_000_000);
  } catch {
    return null;
  }
}

function requestCostMicrousd(
  request: Request,
  upstreamPath: string,
  unitCostMicrousd: number,
): number {
  let multiplier = MAX_REQUEST_COST_MULTIPLIERS.get(upstreamPath) || 1;
  if (upstreamPath === PER_ROOM_ENDPOINT) {
    const roomIdValues = new URL(request.url).searchParams.getAll("room_ids");
    multiplier = Math.max(
      1,
      ...roomIdValues.map(
        (roomIds) => roomIds.split(",").filter((entry) => entry.trim()).length,
      ),
    );
  }
  const total = unitCostMicrousd * multiplier;
  return Number.isSafeInteger(total) ? total : Number.MAX_SAFE_INTEGER;
}

function buildUpstreamHeaders(request: Request): Headers {
  const output = new Headers();
  for (const [name, value] of request.headers) {
    if (REQUEST_HEADER_ALLOWLIST.has(name.toLowerCase())) output.set(name, value);
  }
  output.set("authorization", `Bearer ${requiredEnv("UPSTREAM_API_TOKEN")}`);
  output.set("user-agent", "EcoGeoGateway/1.0");
  return output;
}

function buildClientHeaders(upstream: Response, requestId: string): Headers {
  const output = new Headers({
    "cache-control": "no-store",
    "x-request-id": requestId,
  });
  for (const [name, value] of upstream.headers) {
    const normalized = name.toLowerCase();
    if (RESPONSE_HEADER_ALLOWLIST.has(normalized)) {
      output.set(name, sanitizeLocation(value));
    }
    if (normalized === "location") output.set("location", sanitizeLocation(value));
  }
  output.delete("content-length");
  output.delete("content-md5");
  output.delete("digest");
  output.delete("etag");
  return output;
}

async function recordUsage(
  key: AuthorizedKey,
  requestId: string,
  request: Request,
  status: number,
  latencyMs: number,
  outputBytes: number,
  estimatedCostMicrousd: number,
): Promise<void> {
  const database = getD1();
  const day = new Date().toISOString().slice(0, 10);
  const success = status >= 200 && status < 400 ? 1 : 0;
  const error = success ? 0 : 1;
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `UPDATE usage_daily
         SET successes = successes + ?,
             errors = errors + ?,
             bytes_out = bytes_out + ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND day = ?`,
      )
      .bind(success, error, Math.max(0, outputBytes), key.userId, day),
    database
      .prepare(
        `UPDATE api_keys
         SET last_used_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND (last_used_at IS NULL OR substr(last_used_at, 1, 10) <> ?)`,
      )
      .bind(key.keyId, day),
  ];
  if (error) {
    statements.push(
      database
      .prepare(
        `INSERT INTO usage_events
           (request_id, user_id, api_key_id, method, path, status, latency_ms,
            estimated_cost_microusd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        requestId,
        key.userId,
        key.keyId,
        request.method,
        new URL(request.url).pathname.slice(0, 500),
        status,
        latencyMs,
        Math.max(0, estimatedCostMicrousd),
      ),
    );
  }
  await database.batch(statements);
}

function isPathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function upstreamPathFor(request: Request): string | null {
  const originalPath = new URL(request.url).pathname;
  if (originalPath.includes("%")) return null;
  let upstreamPath = originalPath;
  const rawRewrites = runtimeEnv().UPSTREAM_PATH_REWRITES;
  if (rawRewrites) {
    try {
      const rewrites = Object.entries(
        JSON.parse(rawRewrites) as Record<string, string>,
      )
        .filter(([from, to]) => from.startsWith("/") && to.startsWith("/"))
        .sort(([left], [right]) => right.length - left.length);

      if (rewrites.some(([, target]) => isPathWithin(originalPath, target))) {
        return null;
      }
      for (const [from, to] of rewrites) {
        if (isPathWithin(upstreamPath, from)) {
          upstreamPath = `${to}${upstreamPath.slice(from.length)}`;
          break;
        }
      }
    } catch {
      throw new Error("Invalid upstream path rewrite configuration");
    }
  }
  return upstreamPath;
}

function upstreamUrlFor(request: Request, upstreamPath: string): string {
  const requestUrl = new URL(request.url);
  const base = requiredEnv("UPSTREAM_BASE_URL").replace(/\/+$/, "");
  return `${base}${upstreamPath}${requestUrl.search}`;
}

export async function handleApiProxy(request: Request): Promise<Response> {
  const requestId = randomId("req_");
  if (!isServiceEnabled()) {
    return jsonError(
      503,
      "service_locked",
      "The API relay is not enabled yet.",
      requestId,
    );
  }

  const key = await authorizeKey(request);
  if (!key) return jsonError(401, "invalid_api_key", "Invalid API key.", requestId);

  const inputBytes = Number(request.headers.get("content-length") || 0);
  const quota = await reserveRequestQuota(
    key,
    Number.isFinite(inputBytes) ? inputBytes : 0,
  );
  if (quota !== "ok") {
    return jsonError(
      429,
      quota === "global" ? "service_daily_limit" : "daily_limit",
      "Daily request limit reached.",
      requestId,
    );
  }

  const localResponse = await handleLocalGatewayEndpoint(request, key, requestId);
  if (localResponse) {
    await recordUsage(
      key,
      requestId,
      request,
      localResponse.status,
      0,
      0,
      0,
    ).catch(() => undefined);
    return localResponse;
  }

  const upstreamPath = upstreamPathFor(request);
  if (!upstreamPath || BLOCKED_UNBOUNDED_ENDPOINTS.has(upstreamPath)) {
    return jsonError(404, "not_found", "Endpoint not found.", requestId);
  }
  if (!KNOWN_ZERO_COST_ENDPOINTS.has(upstreamPath) &&
      (request.method !== "GET" || !FIXED_PRICE_MEMBER_ENDPOINTS.has(upstreamPath))) {
    return jsonError(503, "pricing_unavailable", "This endpoint does not yet have verified member billing. Choose an endpoint with published pricing.", requestId);
  }
  const idempotencyKey = request.headers.get("Idempotency-Key") || "";
  const requestHash = await sha256Hex(request.method + "\n" + request.url);
  if (idempotencyKey) {
    const receipt = await getD1().prepare("SELECT request_hash,status_code,response_json FROM data_relay_receipts WHERE user_id=? AND idempotency_key=?")
      .bind(key.userId, idempotencyKey).first<{ request_hash: string; status_code: number; response_json: string }>();
    if (receipt) {
      if (receipt.request_hash !== requestHash) return jsonError(409, "idempotency_conflict", "This Idempotency-Key belongs to a different request.", requestId);
      const wallet = await getD1().prepare("SELECT status,charged_microusd FROM wallet_reservations WHERE user_id=? AND request_id=?")
        .bind(key.userId, `data:${idempotencyKey}`).first<{ status: string; charged_microusd: number | null }>();
      return new Response(receipt.response_json, { status: receipt.status_code, headers: {
        "content-type": "application/json", "cache-control": "private, no-store", "x-request-id": requestId, "x-tokvilo-replayed": "true",
        "x-tokvilo-wallet-request-id": `data:${idempotencyKey}`, "x-tokvilo-billing-status": wallet?.status || "pending_confirmation",
        ...(wallet?.status === "settled" ? { "x-tokvilo-charge-microusd": String(wallet.charged_microusd) } : {}),
      } });
    }
  }

  const unitCostMicrousd = await endpointCostMicrousd(upstreamPath).catch(() => null);
  if (unitCostMicrousd === null) {
    return jsonError(
      503,
      "pricing_unavailable",
      "Service pricing is temporarily unavailable.",
      requestId,
    );
  }
  const estimatedCostMicrousd = requestCostMicrousd(
    request,
    upstreamPath,
    unitCostMicrousd,
  );
  let upstreamTarget: string, upstreamHeaders: Headers;
  try {
    upstreamTarget = upstreamUrlFor(request, upstreamPath);
    upstreamHeaders = buildUpstreamHeaders(request);
  } catch {
    return jsonError(503, "service_configuration_unavailable", "Service configuration is unavailable.", requestId);
  }
  let walletRequestId: string | null = null;
  let retailCostMicrousd = 0;
  if (estimatedCostMicrousd > 0) {
    const id = idempotencyKey;
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) return jsonError(400, "idempotency_key_required", "Paid requests require an 8–128 character Idempotency-Key.", requestId);
    walletRequestId = `data:${id}`;
    retailCostMicrousd = markupMicrousd(unitCostMicrousd);
    try {
      const held = await reserveWallet({ userId: key.userId, requestId: walletRequestId, amountMicrousd: retailCostMicrousd,
        description: `Data API ${upstreamPath}`, metadata: { requestHash, upstreamPath, unitCostMicrousd } });
      if (held.reused || held.status !== "reserved") return jsonError(409, "request_already_submitted", "This request was already submitted. Check its wallet record; use a new Idempotency-Key only for a new request.", requestId);
    } catch (cause) {
      return jsonError(cause instanceof WalletError ? cause.status : 503, cause instanceof WalletError ? cause.code : "wallet_unavailable", cause instanceof WalletError ? cause.message : "Wallet is temporarily unavailable.", requestId);
    }
  }
  let spendingAllowed = false;
  try { spendingAllowed = await reserveSpend(estimatedCostMicrousd); }
  catch {
    if (walletRequestId) await refundWallet({ userId: key.userId, requestId: walletRequestId, description: "Request was not forwarded." }).catch(() => undefined);
    return jsonError(503, "spend_guard_unavailable", "Service spending check is unavailable.", requestId);
  }
  if (!spendingAllowed) {
    if (walletRequestId) await refundWallet({ userId: key.userId, requestId: walletRequestId, description: "Service limit reached before forwarding." }).catch(() => undefined);
    return jsonError(
      429,
      "spend_limit",
      "Service spending limit reached.",
      requestId,
    );
  }

  const startedAt = Date.now();
  let upstream: Response;
  try {
    const timeoutMs = numericEnv("UPSTREAM_TIMEOUT_MS", 90_000, 1_000);
    upstream = await fetch(upstreamTarget, {
      method: request.method,
      headers: upstreamHeaders,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    const latency = Date.now() - startedAt;
    await recordUsage(
      key,
      requestId,
      request,
      502,
      latency,
      0,
      estimatedCostMicrousd,
    ).catch(() => undefined);
    return jsonError(502, "upstream_unavailable", "Service temporarily unavailable.", requestId);
  }

  const headers = buildClientHeaders(upstream, requestId);
  if (walletRequestId) {
    let billingStatus = "pending_confirmation";
    let receiptJson: string | null = null;
    try {
      let code: number | null = null;
      if (upstream.status === 200 && upstream.headers.get("content-type")?.includes("json")) {
        // Inspect a bounded clone, preserving the original response for the client.
        const reader = upstream.clone().body?.getReader();
        if (reader) {
          const chunks: Uint8Array[] = []; let length = 0;
          try {
            for (;;) {
              const { value, done } = await reader.read(); if (done) break;
              length += value.byteLength; if (length > 8_000_000) { void reader.cancel(); throw new Error("Response exceeds settlement inspection limit"); }
              chunks.push(value);
            }
            const bytes = new Uint8Array(length); let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            const raw = new TextDecoder().decode(bytes), data = JSON.parse(raw);
            if (data && typeof data === "object" && Number.isInteger(data.code)) code = data.code;
            if (length <= 256_000) {
              const secret = requiredEnv("UPSTREAM_API_TOKEN");
              const sanitized = sanitizeText(raw, buildReplacements(runtimeEnv()))
                .replaceAll(JSON.stringify(secret).slice(1, -1), "[redacted]").replaceAll(secret, "[redacted]").replaceAll(encodeURIComponent(secret), "[redacted]");
              JSON.parse(sanitized);
              receiptJson = sanitized;
            }
          } finally { reader.releaseLock(); }
        }
      }
      if (upstream.status === 200 && code === 200) {
        await settleWallet({ userId: key.userId, requestId: walletRequestId, amountMicrousd: retailCostMicrousd, description: `Data API ${upstreamPath}` });
        billingStatus = "settled";
      } else if ([400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(upstream.status) || code !== null && code >= 400 && code < 500) {
        await refundWallet({ userId: key.userId, requestId: walletRequestId, description: "Upstream rejected the request." });
        billingStatus = "refunded";
      }
    } catch { /* An incomplete response retains its hold for reconciliation. */ }
    headers.set("x-tokvilo-billing-status", billingStatus);
    headers.set("x-tokvilo-wallet-request-id", walletRequestId);
    if (billingStatus === "settled") headers.set("x-tokvilo-charge-microusd", String(retailCostMicrousd));
    if (receiptJson) await getD1().prepare("INSERT INTO data_relay_receipts(user_id,idempotency_key,request_hash,status_code,response_json) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING")
      .bind(key.userId, idempotencyKey, requestHash, upstream.status, receiptJson).run().catch(() => undefined);
  }
  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const outputBytes = Number(upstream.headers.get("content-length") || 0);
  const body =
    upstream.body && isTextualContentType(contentType)
      ? sanitizeTextStream(upstream.body, buildReplacements(runtimeEnv()))
      : upstream.body;

  const response = new Response(body, {
    status: upstream.status,
    headers,
  });
  await recordUsage(
    key,
    requestId,
    request,
    upstream.status,
    Date.now() - startedAt,
    Number.isFinite(outputBytes) ? outputBytes : 0,
    estimatedCostMicrousd,
  ).catch(() => undefined);
  return response;
}
