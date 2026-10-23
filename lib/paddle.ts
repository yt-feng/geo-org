import { getPortalUser, type PortalUser } from "./auth";
import { getD1, runtimeEnv, type RuntimeEnv } from "./config";
import { ensureUser } from "./store";
import { getWallet, WalletError } from "./wallet";

type PaddleEnv = RuntimeEnv & {
  PADDLE_ENVIRONMENT?: string; PADDLE_SALES_ENABLED?: string; PADDLE_APPROVED_DOMAIN?: string;
  PADDLE_APPROVED_PRODUCT_SCOPE?: string; PADDLE_CLIENT_TOKEN?: string; PADDLE_API_KEY?: string;
  PADDLE_WEBHOOK_SECRET?: string; PADDLE_PRICE_20_ID?: string; PADDLE_PRICE_50_ID?: string; PADDLE_PRICE_100_ID?: string;
};
type Json = Record<string, unknown>;
type Order = {
  id: string; user_id: string; request_id: string; package_id: string; environment: "sandbox" | "production";
  price_id: string; amount_cents: number; credit_microusd: number; binding_secret: string;
  transaction_id: string | null; status: string; applied_credit_microusd: number; reconciliation_version: number;
  lock_token: string | null; lock_until: number; last_checked_at: number; created_at: string; updated_at: string;
};
type PaddleEnvelope = { data: unknown; meta?: { pagination?: { next?: string; has_more?: boolean } } };
const PACKAGES = [20, 50, 100] as const;
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: HEADERS });
const fail = (message: string, status = 400, code = "paddle_invalid"): never => { throw new WalletError(message, status, code); };
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const idValid = (value: unknown, prefix: string): value is string => typeof value === "string" && new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(value);
const currentEnv = (): PaddleEnv => runtimeEnv();
const apiBase = (environment: string) => environment === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
const equal = (a: string, b: string) => {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
};

/** Log only fixed stage/category labels: never request data, SQL, tokens or raw errors. */
async function atPaddleStage<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (cause) {
    if (!(cause instanceof WalletError)) {
      const error = cause as { name?: unknown; message?: unknown } | null;
      const rawName = typeof error?.name === "string" ? error.name : "";
      const errorType = ["Error", "TypeError", "SyntaxError", "RangeError", "AbortError", "TimeoutError"].includes(rawName) ? rawName : "UnknownError";
      const message = typeof error?.message === "string" ? error.message : "";
      const category = /no such (table|column)/i.test(message) ? "database_schema"
        : /D1_TYPE_ERROR|D1_ERROR|SQLITE_|bind.*parameter|binding.*parameter/i.test(message) ? "database"
        : /invalid.*header|header.*invalid|header.*newline/i.test(message) ? "header_format"
        : /body.*(locked|used)|stream.*locked/i.test(message) ? "request_body"
        : ["AbortError", "TimeoutError"].includes(errorType) ? "timeout" : "unexpected";
      console.error(JSON.stringify({ component: "paddle", stage, errorType, category }));
    }
    throw cause;
  }
}

export function getPaddleConfig(env: PaddleEnv = currentEnv()) {
  const environment = env.PADDLE_ENVIRONMENT === "sandbox" ? "sandbox" as const : "production" as const;
  const token = env.PADDLE_CLIENT_TOKEN?.trim() || "";
  const packages = PACKAGES.map(amountUsd => ({ id: String(amountUsd), amountUsd, creditMicrousd: amountUsd * 1_000_000 }));
  let reason: string | null = null;
  let publicHost = "";
  try { const url = new URL(env.PUBLIC_BASE_URL || "https://tokvilo.com"); if (url.protocol === "https:" && !url.username && !url.password && !url.port) publicHost = url.hostname; } catch { /* Fail closed below. */ }
  if (env.PADDLE_SALES_ENABLED !== "true") reason = "Paddle checkout is not available yet. Enterprise bank transfer is available on request.";
  else if (environment === "production" && (!publicHost || env.PADDLE_APPROVED_DOMAIN !== publicHost || env.PADDLE_APPROVED_PRODUCT_SCOPE !== "tokvilo_api_usage")) reason = "Paddle checkout is awaiting approval for Tokvilo API services.";
  else if (!["sandbox", "production"].includes(env.PADDLE_ENVIRONMENT || "") || !token.startsWith(environment === "sandbox" ? "test_" : "live_") || !env.PADDLE_API_KEY?.trim() || !env.PADDLE_WEBHOOK_SECRET?.trim() || !PACKAGES.every(value => idValid(env[`PADDLE_PRICE_${value}_ID`], "pri"))) reason = "Paddle checkout is being configured. Enterprise bank transfer is available on request.";
  return { enabled: reason === null, environment, clientToken: reason === null ? token : null, packages, reason };
}

function publicOrder(order: Order) {
  return { id: order.id, status: order.status, transactionId: order.transaction_id, amountUsd: order.amount_cents / 100,
    creditMicrousd: order.credit_microusd, creditedMicrousd: order.applied_credit_microusd,
    credited: order.environment === "production" && (order.status === "paid" || order.status === "adjusted"), environment: order.environment };
}

async function readBody(request: Request, maximum: number): Promise<string> {
  if (!request.body || Number(request.headers.get("content-length")) > maximum) return fail("Request body is too large or missing.", 413);
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > maximum) { await reader.cancel(); return fail("Request body is too large.", 413); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally { reader.releaseLock(); }
}

async function paddleApi(path: string, env: PaddleEnv, body?: unknown): Promise<PaddleEnvelope> {
  const apiKey = env.PADDLE_API_KEY?.trim();
  if (!apiKey) return fail("Payment verification is unavailable.", 503, "paddle_unavailable");
  const base = apiBase(env.PADDLE_ENVIRONMENT || "production"), url = new URL(path, base);
  if (url.origin !== base) return fail("Invalid payment service response.", 503, "paddle_unavailable");
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: {
    Authorization: `Bearer ${apiKey}`, "Paddle-Version": "1", "content-type": "application/json",
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000), redirect: "manual" });
  // Never surface the provider's payload or credentials to the customer.
  // Workers does not implement redirect:'error'. Manual mode plus !ok rejects
  // 3xx without forwarding Authorization to a redirect destination.
  if (!response.ok) return fail("The payment service is temporarily unavailable.", 503, "paddle_unavailable");
  const result = await response.json() as PaddleEnvelope;
  if (!result || !("data" in result)) return fail("Invalid payment service response.", 503, "paddle_unavailable");
  return result;
}

async function paddleList(path: string, env: PaddleEnv, limit = 10): Promise<Json[]> {
  const rows: Json[] = []; let next = path;
  for (let page = 0; page < limit; page++) {
    const result = await paddleApi(next, env);
    if (!Array.isArray(result.data)) return fail("Invalid payment service response.", 503, "paddle_unavailable");
    rows.push(...result.data.map(object));
    if (result.meta?.pagination?.has_more === false) return rows;
    if (result.meta?.pagination?.has_more !== true || !result.meta.pagination.next) return fail("Payment verification is incomplete.", 503, "paddle_unavailable");
    next = result.meta.pagination.next;
  }
  return fail("Payment reconciliation requires support. Please keep your order reference.", 503, "paddle_reconciliation_pending");
}

function minorUnits(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) return fail("Payment amount could not be verified.", 409, "paddle_payment_mismatch");
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return fail("Payment amount could not be verified.", 409, "paddle_payment_mismatch");
  return amount;
}

function validateTransaction(transaction: Json, order: Order) {
  const custom = object(transaction.custom_data), items = transaction.items;
  if (!idValid(transaction.id, "txn") || (order.transaction_id && order.transaction_id !== transaction.id)
    || transaction.currency_code !== "USD" || transaction.collection_mode !== "automatic" || transaction.subscription_id
    || custom.tokvilo_order_id !== order.id || custom.tokvilo_user_id !== order.user_id
    || !equal(String(custom.tokvilo_binding || ""), order.binding_secret)
    || !Array.isArray(items) || items.length !== 1) return fail("Payment does not match this order.", 409, "paddle_payment_mismatch");
  const item = object(items[0]), price = object(item.price), unit = object(price.unit_price);
  if (item.quantity !== 1 || price.id !== order.price_id || price.billing_cycle !== null || price.trial_period !== null
    || unit.currency_code !== "USD" || minorUnits(unit.amount) !== order.amount_cents)
    return fail("Payment line item does not match this order.", 409, "paddle_payment_mismatch");
  // The configured amount is tax-exclusive. No discounts, recurring items or
  // localized overrides can silently grant more usage than was purchased.
  if (transaction.status === "completed") {
    const totals = object(object(transaction.details).totals);
    if (minorUnits(totals.subtotal) !== order.amount_cents || minorUnits(totals.discount) !== 0 || minorUnits(totals.total) < order.amount_cents)
      return fail("Paid amount does not match this order.", 409, "paddle_payment_mismatch");
  }
}

export function adjustedCredit(transaction: Json, adjustments: Json[], creditMicrousd: number): number {
  const subtotal = minorUnits(object(object(transaction.details).totals).subtotal);
  if (subtotal <= 0) return fail("Payment amount could not be verified.", 409, "paddle_payment_mismatch");
  let reversed = 0;
  for (const adjustment of adjustments) {
    if (adjustment.transaction_id !== transaction.id || adjustment.currency_code !== "USD") return fail("Payment adjustment does not match this order.", 409, "paddle_payment_mismatch");
    // Fetching all current adjustments means a reversal is reflected by its
    // original debit being 'reversed'. Adding reverse entries again would
    // double restore credit. Tax-only refunds have a zero service subtotal.
    if (adjustment.status !== "approved" || !["refund", "credit", "chargeback"].includes(String(adjustment.action))) continue;
    reversed += minorUnits(object(adjustment.totals).subtotal);
  }
  return Math.max(0, creditMicrousd - Math.ceil(creditMicrousd * Math.min(subtotal, reversed) / subtotal));
}

async function findOrder(id: string): Promise<Order | null> { return getD1().prepare("SELECT * FROM paddle_orders WHERE id=?").bind(id).first<Order>(); }

async function reconcile(order: Order, env: PaddleEnv, event?: { id: string; type: string; occurred: string }, knownTransaction?: Json): Promise<Order> {
  const token = crypto.randomUUID(), now = Date.now(), db = getD1(), candidateTransactionId = order.transaction_id;
  const locked = await db.prepare("UPDATE paddle_orders SET lock_token=?,lock_until=? WHERE id=? AND lock_until<? RETURNING id").bind(token, now + 45_000, order.id, now).first();
  if (!locked) return fail("Payment confirmation is in progress.", 503, "paddle_reconciliation_pending");
  try {
    order = (await findOrder(order.id))!;
    const transactionId = order.transaction_id || candidateTransactionId || knownTransaction?.id;
    if (!idValid(transactionId, "txn")) return fail("Payment transaction is still pending.", 503, "paddle_reconciliation_pending");
    const transaction = object((await paddleApi(`/transactions/${transactionId}`, env)).data);
    validateTransaction(transaction, order);
    let status = transaction.status === "canceled" ? "canceled" : "checkout_ready";
    let credited = order.applied_credit_microusd;
    if (transaction.status === "completed") {
      const adjustments = await paddleList(`/adjustments?transaction_id=${transaction.id}&per_page=50`, env);
      credited = adjustedCredit(transaction, adjustments, order.credit_microusd);
      status = credited === order.credit_microusd ? "paid" : "adjusted";
    } else if (order.status === "paid" || order.status === "adjusted") {
      return fail("Payment reconciliation is awaiting the current transaction.", 503, "paddle_reconciliation_pending");
    }
    const at = new Date().toISOString();
    const statements = [db.prepare(`UPDATE paddle_orders SET transaction_id=?,status=?,applied_credit_microusd=?,
      reconciliation_version=reconciliation_version+1,lock_token=NULL,lock_until=0,last_checked_at=?,updated_at=?
      WHERE id=? AND lock_token=? AND lock_until>?`).bind(transaction.id, status, credited, now, at, order.id, token, Date.now())];
    if (event) statements.push(db.prepare(`INSERT OR IGNORE INTO paddle_events(event_id,event_type,transaction_id,order_id,occurred_at)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM paddle_orders WHERE id=? AND last_checked_at=?)`).bind(event.id, event.type, transaction.id, order.id, event.occurred, order.id, now));
    const results = await db.batch(statements);
    if (results[0].meta.changes !== 1) return fail("Payment confirmation is still pending.", 503, "paddle_reconciliation_pending");
    return (await findOrder(order.id))!;
  } finally {
    await db.prepare("UPDATE paddle_orders SET lock_token=NULL,lock_until=0 WHERE id=? AND lock_token=?").bind(order.id, token).run();
  }
}

async function createCheckout(request: Request, user: PortalUser) {
  const env = currentEnv(), config = getPaddleConfig(env);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return fail("Submit JSON.", 415);
  const input = await atPaddleStage("checkout.parse_request", async () => object(JSON.parse(await readBody(request, 4000)))), packageId = input.packageId, requestId = input.requestId;
  const pack = config.packages.find(value => value.id === packageId);
  if (!pack || typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{12,80}$/.test(requestId)) return fail("Choose a service package and a valid order reference.");
  const db = getD1();
  const existing = await atPaddleStage("checkout.lookup_order", () => db.prepare("SELECT * FROM paddle_orders WHERE user_id=? AND request_id=?").bind(user.id, requestId).first<Order>());
  if (existing) {
    if (existing.package_id !== packageId || existing.environment !== config.environment) return fail("This order reference belongs to a different purchase.", 409, "paddle_order_conflict");
    return reply({ order: publicOrder(existing), reused: true });
  }
  if (!config.enabled) return fail(config.reason || "Paddle checkout is not available.", 503, "paddle_unavailable");
  const recent = await atPaddleStage("checkout.count_orders", () => db.prepare("SELECT COUNT(*) AS count FROM paddle_orders WHERE user_id=? AND created_at>?").bind(user.id, new Date(Date.now() - 3600_000).toISOString()).first<{count: number}>());
  if ((recent?.count || 0) >= 20) return fail("Too many checkout requests. Please use your existing order.", 429, "paddle_rate_limited");
  const priceId = env[`PADDLE_PRICE_${pack.id as "20" | "50" | "100"}_ID`]!;
  const price = object((await atPaddleStage("checkout.read_price", () => paddleApi(`/prices/${priceId}`, env))).data), unit = object(price.unit_price);
  if (price.id !== priceId || price.status !== "active" || price.billing_cycle !== null || price.trial_period !== null || price.tax_mode !== "external"
    || unit.currency_code !== "USD" || minorUnits(unit.amount) !== pack.amountUsd * 100
    || (Array.isArray(price.unit_price_overrides) && price.unit_price_overrides.length > 0))
    return fail("The service package is not configured correctly. Please contact support.", 503, "paddle_price_unavailable");
  const id = crypto.randomUUID(), at = new Date().toISOString(), binding = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const inserted = await atPaddleStage("checkout.insert_intent", () => db.prepare(`INSERT INTO paddle_orders(id,user_id,request_id,package_id,environment,price_id,amount_cents,credit_microusd,binding_secret,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,request_id) DO NOTHING RETURNING id`).bind(id, user.id, requestId, pack.id, config.environment, priceId, pack.amountUsd * 100, pack.creditMicrousd, binding, at, at).first());
  if (!inserted) {
    const repeated = await db.prepare("SELECT * FROM paddle_orders WHERE user_id=? AND request_id=?").bind(user.id, requestId).first<Order>();
    if (!repeated || repeated.package_id !== pack.id || repeated.environment !== config.environment) return fail("Order reference conflict.", 409, "paddle_order_conflict");
    return reply({ order: publicOrder(repeated), reused: true });
  }
  // Persist the intent BEFORE the only external POST. An ambiguous response is
  // never retried as a new transaction. GET recovery and webhooks reconcile it.
  try {
    const transaction = object((await atPaddleStage("checkout.create_transaction", () => paddleApi("/transactions", env, {
      items: [{ price_id: priceId, quantity: 1 }], currency_code: "USD", collection_mode: "automatic",
      custom_data: { tokvilo_order_id: id, tokvilo_user_id: user.id, tokvilo_binding: binding, tokvilo_scope: "api_usage" },
      checkout: { url: `${(env.PUBLIC_BASE_URL || "https://tokvilo.com").replace(/\/+$/, "")}/dashboard/wallet?lang=en&paddle_order=${id}` },
    }))).data);
    validateTransaction(transaction, (await findOrder(id))!);
    await db.prepare("UPDATE paddle_orders SET transaction_id=?,status='checkout_ready',updated_at=? WHERE id=? AND transaction_id IS NULL AND status='creating'").bind(transaction.id, new Date().toISOString(), id).run();
  } catch {
    await db.prepare("UPDATE paddle_orders SET status='outcome_unknown',updated_at=? WHERE id=? AND status='creating' AND transaction_id IS NULL").bind(new Date().toISOString(), id).run();
  }
  return reply({ order: publicOrder((await findOrder(id))!), reused: false }, 201);
}

async function getOrder(id: string, user: PortalUser) {
  let order = await findOrder(id);
  if (!order || order.user_id !== user.id) return fail("Order not found.", 404, "paddle_order_missing");
  const env = currentEnv();
  if (order.environment !== (env.PADDLE_ENVIRONMENT || "production")) return reply({ order: publicOrder(order), wallet: await getWallet(user.id) });
  // Read-only recovery cannot create another charge. Poll at most every 15s.
  if (Date.now() - order.last_checked_at >= 15_000 && Date.now() - Date.parse(order.created_at) >= 5000) {
    try {
      if (order.transaction_id) order = await reconcile(order, env);
      else {
        const from = new Date(Date.parse(order.created_at) - 60_000).toISOString();
        const to = new Date(Date.parse(order.created_at) + 10 * 60_000).toISOString();
        const transactions = await paddleList(`/transactions?per_page=30&created_at[GTE]=${encodeURIComponent(from)}&created_at[LTE]=${encodeURIComponent(to)}`, env);
        const matches = transactions.filter(value => object(value.custom_data).tokvilo_order_id === order!.id);
        if (matches.length === 1) order = await reconcile(order, env, undefined, matches[0]);
        else await getD1().prepare("UPDATE paddle_orders SET last_checked_at=? WHERE id=? AND transaction_id IS NULL").bind(Date.now(), id).run();
      }
    } catch { /* Keep existing receipt and balance while provider is unavailable. */ }
  }
  return reply({ order: publicOrder(order), wallet: await getWallet(user.id) });
}

export async function verifyPaddleSignature(raw: string, header: string | null, secret: string, now = Date.now()): Promise<boolean> {
  if (!header || !secret || header.length > 2000) return false;
  const parts = header.split(";").map(part => part.trim().split("="));
  const timestamps = parts.filter(([key]) => key === "ts"), signatures = parts.filter(([key]) => key === "h1").map(([, value]) => value);
  if (timestamps.length !== 1 || !/^\d{10}$/.test(timestamps[0][1] || "") || Math.abs(Math.floor(now / 1000) - Number(timestamps[0][1])) > 5) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamps[0][1]}:${raw}`)))].map(value => value.toString(16).padStart(2, "0")).join("");
  return signatures.some(value => /^[0-9a-f]{64}$/.test(value || "") && equal(value, signature));
}

export async function handlePaddleWebhook(request: Request): Promise<Response> {
  try {
    const env = currentEnv(), raw = await readBody(request, 262_144);
    if (!await verifyPaddleSignature(raw, request.headers.get("paddle-signature"), env.PADDLE_WEBHOOK_SECRET || "")) return reply({ error: { code: "paddle_signature_invalid", message: "Invalid webhook signature." } }, 401);
    const event = object(JSON.parse(raw)), data = object(event.data);
    if (!["transaction.completed", "adjustment.created", "adjustment.updated"].includes(String(event.event_type))) return reply({ received: true, ignored: true });
    if (!idValid(event.event_id, "evt") || typeof event.occurred_at !== "string" || !Number.isFinite(Date.parse(event.occurred_at))) return fail("Invalid payment notification.");
    if (await getD1().prepare("SELECT event_id FROM paddle_events WHERE event_id=?").bind(event.event_id).first()) return reply({ received: true, duplicate: true });
    const transactionId = event.event_type === "transaction.completed" ? data.id : data.transaction_id;
    if (!idValid(transactionId, "txn")) return fail("Invalid transaction reference.");
    const transaction = object((await paddleApi(`/transactions/${transactionId}`, env)).data);
    const custom = object(transaction.custom_data), orderId = custom.tokvilo_order_id;
    // Other apps may share this merchant account. Never provision their sales.
    if (typeof orderId !== "string") return reply({ received: true, ignored: true });
    const order = await findOrder(orderId);
    if (!order) return fail("Order is not yet available for reconciliation.", 503, "paddle_order_pending");
    if (order.environment !== (env.PADDLE_ENVIRONMENT || "production")) return fail("Payment environment does not match.", 409, "paddle_payment_mismatch");
    if (transaction.status !== "completed") return fail("Payment is not completed yet.", 503, "paddle_payment_pending");
    // Re-fetch within the order lease: concurrent adjustment events must not
    // apply an older pre-lock snapshot over a newer refund/reversal.
    const bound = { ...order, transaction_id: order.transaction_id || transactionId };
    await reconcile(bound, env, { id: event.event_id, type: String(event.event_type), occurred: event.occurred_at });
    return reply({ received: true });
  } catch (cause) { return errorResponse(cause); }
}

function errorResponse(cause: unknown) {
  return reply({ error: { code: cause instanceof WalletError ? cause.code : "paddle_unavailable", message: cause instanceof WalletError ? cause.message : "Payment confirmation is temporarily unavailable. Please keep your order reference." } }, cause instanceof WalletError ? cause.status : 503);
}

export async function handlePaddleRequest(request: Request, action: "checkout" | "order", orderId?: string): Promise<Response> {
  try {
    const user = await atPaddleStage("request.authenticate", () => getPortalUser());
    if (!user) return fail("Please sign in to continue.", 401, "login_required");
    if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) return fail("Please submit this request from Tokvilo.", 403, "origin_invalid");
    await atPaddleStage("request.ensure_account", () => ensureUser(user));
    const account = await atPaddleStage("request.read_account", () => getD1().prepare("SELECT status FROM users WHERE id=?").bind(user.id).first<{status: string}>());
    if (account?.status !== "active") return fail("This account is disabled.", 403, "account_disabled");
    if (action === "checkout" && request.method === "POST") return await createCheckout(request, user);
    if (action === "order" && request.method === "GET" && orderId) return await getOrder(orderId, user);
    return fail("Unsupported request method.", 405);
  } catch (cause) { return errorResponse(cause); }
}
