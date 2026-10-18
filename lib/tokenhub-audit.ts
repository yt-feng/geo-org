import type { RuntimeEnv } from "./config";
import { archiveAuditCaseMedia, archiveAuditMediaBackfill } from "./tokenhub-audit-media";
import { decryptProviderKey, encryptProviderKey } from "./provider-settings";
import { AUDIT_BUDGET_MICROS, AUDIT_CHAT_MODELS, AUDIT_CHAT_POLICIES, AUDIT_VIDEO_POLICIES, AUDIT_PLAN_VERSION, AUDIT_SLOT_MS, AUDIT_SLOTS, auditCases, gradeAuditAnswer, type AuditCase } from "./tokenhub-audit-cases";

import { knownAuditModels, normalizeAuditCatalog, validCatalogSource, type CatalogModel, type CatalogSnapshotRow } from "./tokenhub-audit-catalog";

export const AUDIT_PAID_TIMEOUT_MS = 300_000;
const ORIGIN = "https://ai-tokenhub.ai";
const KEY_CONTEXT = "eco-geo/audit/tokenhub/v1";
const DAY = 24 * 60 * 60 * 1000;
const TASK_PATH = "/api/v3/contents/generations/tasks";
const TRACE_HEADERS = ["x-request-id", "request-id", "x-bifrost-request-id", "x-bifrost-model", "x-bifrost-provider", "x-bifrost-cache-hit", "x-cache", "x-model", "x-provider", "cf-ray"];
type Json = Record<string, unknown>;
type Campaign = { id: string; state: "active" | "paused" | "completed"; started_at: string; ends_at: string; budget_micros: number; encrypted_key: string; key_hint: string; catalog_json: string; catalog_hash: string; plan_version: string; pause_reason: string | null };
type CaseRow = { campaign_id: string; slot: number; case_id: string; kind: string; model: string; state: string; reserved_micros: number; request_json: string; request_hash: string; expected_json: string; price_json: string; price_hash: string; response_json: string | null; response_hash: string | null; creation_json: string | null; headers_json: string | null; http_status: number | null; latency_ms: number | null; usage_json: string | null; returned_model: string | null; derived_cost_micros: number | null; grading_json: string | null; flags_json: string; independent_analysis_json: string | null; billing_actual_micros: number | null; billing_evidence_json: string | null; task_id: string | null; poll_count: number; next_poll_at: string | null; submitted_at: string; updated_at: string };
type Rates = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; image?: number; video?: number };
export class AuditError extends Error { constructor(message: string, public status = 503) { super(message); } }
function db(env: RuntimeEnv) { if (!env.DB) throw new AuditError("审计存储不可用。"); return env.DB; }
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
function parse(value: string | null | undefined): unknown { if (!value) return null; try { return JSON.parse(value); } catch { return null; } }
function number(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function integer(value: unknown): value is number { return number(value) && Number.isSafeInteger(value); }
function date(value: Date) { if (!Number.isFinite(value.getTime())) throw new AuditError("审计时间无效。", 400); return value.toISOString(); }
async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join(""); }
function sanitize(value: unknown, key: string): unknown {
  if (typeof value === "string") return value.replaceAll(key, "[redacted]").replaceAll(encodeURIComponent(key), "[redacted]");
  if (Array.isArray(value)) return value.map(item => sanitize(item, key));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([name, item]) => [String(sanitize(name, key)), sanitize(item, key)]));
  return value;
}
async function readJson(response: Response): Promise<Json> {
  if (!response.body) throw new AuditError("上游响应为空。", 502);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 2_000_000) { await reader.cancel(); throw new AuditError("上游响应超过审计大小上限。", 502); } chunks.push(value); }
    const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    let data: unknown; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new AuditError("上游未返回完整 JSON。", 502); }
    if (!object(data)) throw new AuditError("上游 JSON 格式不正确。", 502);
    return data;
  } finally { reader.releaseLock(); }
}
async function latest(env: RuntimeEnv) { return db(env).prepare("SELECT * FROM tokenhub_audit_campaigns ORDER BY created_at DESC, rowid DESC LIMIT 1").first<Campaign>(); }
async function pause(env: RuntimeEnv, id: string, reason: string, now: Date) {
  await db(env).prepare("UPDATE tokenhub_audit_campaigns SET state='paused',pause_reason=?,updated_at=? WHERE id=? AND state='active'").bind(reason, date(now), id).run();
}
function core(data: Json): Json { return object(data.data) ? data.data : data; }
function collectHeaders(headers: Headers, key: string) { return Object.fromEntries(TRACE_HEADERS.flatMap(name => { const value = headers.get(name); return value ? [[name, sanitize(value.slice(0, 1000), key)]] : []; })); }

// Prices are USD per million tokens (or per image), expressed in micro-USD.
export function auditPriceRates(snapshot: unknown, spec: Pick<AuditCase, "kind" | "model">): Rates {
  if (!object(snapshot) || snapshot.currencyCode !== "USD" || !Array.isArray(snapshot.data)) throw new AuditError("价格目录缺失或币种不是 USD，审计已暂停。", 409);
  const matching = snapshot.data.filter(item => object(item) && item.id === spec.model);
  if (matching.length !== 1 || !object(matching[0]) || !Array.isArray(matching[0].deployments)) throw new AuditError("模型价格不唯一或缺失，审计已暂停。", 409);
  const deployments = matching[0].deployments.filter(item => object(item) && item.enabled === true);
  if (!deployments.length) throw new AuditError("模型没有已启用的价格，审计已暂停。", 409);
  function amount(value: unknown, cap: number, tokenPrice: boolean) {
    if (!object(value) || !object(value.amount) || value.amount.currencyCode !== "USD" || !integer(value.amount.unitsMicros) || value.amount.unitsMicros > cap || (tokenPrice && (typeof value.display !== "string" || !/\/\s*1M tokens$/.test(value.display)))) throw new AuditError("价格单位、币种或上限校验失败，审计已暂停。", 409);
    const exact = value.amount.exactUnits ?? value.amount.units;
    if (typeof exact !== "string" || !/^\d+(?:\.\d+)?$/.test(exact) || Math.abs(Number(exact) * 1_000_000 - value.amount.unitsMicros) > 0.01) throw new AuditError("价格精度字段不一致，审计已暂停。", 409);
    return value.amount.unitsMicros;
  }
  const candidates = deployments.map(item => {
    if (!object(item) || !object(item.pricing)) throw new AuditError("模型价格缺失，审计已暂停。", 409);
    const p = item.pricing;
    if (spec.kind === "chat") {
      // The reservation bounds input and output; no additional cache-write fee is budgeted.
      const policy = AUDIT_CHAT_POLICIES[spec.model];
      if (!policy) throw new AuditError("模型未列入固定审计价格策略。", 409);
      return { input: amount(p.input, policy.inputMicros, true), output: amount(p.output, policy.outputMicros, true), cacheRead: amount(p.cacheRead, policy.cacheReadMicros, true), cacheWrite: amount(p.cacheWrite, 0, true) };
    }
    if (spec.kind === "image") {
      if (!object(p.fixed) || p.fixed.priceUnit !== "image") throw new AuditError("图片计价单位不明确，审计已暂停。", 409);
      return { image: amount(p.fixed, 120_000, false) };
    }
    if (!object(p.video)) throw new AuditError("视频价格缺失，审计已暂停。", 409);
    const policy = AUDIT_VIDEO_POLICIES[spec.model];
    if (!policy) throw new AuditError("视频模型尚未配置已验证的付费审计策略。", 409);
    return { video: amount(p.video.withoutVideo480p, policy.rateMicros, true) };
  });
  if (new Set(candidates.map(value => JSON.stringify(value))).size !== 1) throw new AuditError("模型不同部署的价格不一致，审计已暂停。", 409);
  return candidates[0];
}

export async function startAudit(env: RuntimeEnv, input: { apiKey: string; budgetMicros: number }, now = new Date()) {
  date(now);
  if (input.budgetMicros !== AUDIT_BUDGET_MICROS) throw new AuditError("本次七天审计的固定预算为 5 美元。", 400);
  const existing = await db(env).prepare("SELECT id FROM tokenhub_audit_campaigns WHERE state IN ('active','paused') LIMIT 1").first();
  if (existing) throw new AuditError("已有审计活动，不能覆盖或重新开始。", 409);
  if (typeof input.apiKey !== "string" || !/^[\x21-\x7e]{12,512}$/.test(input.apiKey.trim())) throw new AuditError("请输入独立的审计 API Key。", 400);
  const key = input.apiKey.trim();
  if (key === env.TOKENHUB_API_KEY?.trim()) throw new AuditError("请使用独立的审计密钥，不要使用日常业务密钥。", 400);
  const business = await db(env).prepare("SELECT encrypted_key FROM provider_settings WHERE provider='tokenhub'").first<{ encrypted_key: string }>();
  if (business && key === await decryptProviderKey(business.encrypted_key, env.ADMIN_SESSION_SECRET, "eco-geo/provider/tokenhub/v1")) throw new AuditError("请使用独立的审计密钥，不要使用日常业务密钥。", 400);
  const encrypted = await encryptProviderKey(key, env.ADMIN_SESSION_SECRET, KEY_CONTEXT);
  let response: Response;
  try { response = await fetch(ORIGIN + "/api/v1/models", { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) }); } catch { throw new AuditError("暂时无法验证审计密钥。", 502); }
  if (!response.ok) throw new AuditError(response.status === 401 || response.status === 403 ? "审计密钥无效。" : "上游密钥验证失败。", response.status === 401 || response.status === 403 ? 422 : 502);
  const catalog = sanitize(await readJson(response), key) as Json;
  if (catalog.object !== "list" || !Array.isArray(catalog.data) || !AUDIT_CHAT_MODELS.every(model => (catalog.data as unknown[]).some(item => object(item) && item.id === model))) throw new AuditError("审计密钥没有返回全部四个待测对话模型。", 409);
  const catalogJson = JSON.stringify(catalog), id = crypto.randomUUID();
  try {
    await db(env).prepare("INSERT INTO tokenhub_audit_campaigns (id,state,started_at,ends_at,budget_micros,encrypted_key,key_hint,catalog_json,catalog_hash,plan_version) VALUES (?,'active',?,?,?,?,?,?,?,?)")
      .bind(id, date(now), date(new Date(now.getTime() + 7 * DAY)), input.budgetMicros, encrypted, `••••${key.slice(-4)}`, catalogJson, await hash(catalogJson), AUDIT_PLAN_VERSION).run();
  } catch { if (await db(env).prepare("SELECT id FROM tokenhub_audit_campaigns WHERE state IN ('active','paused') LIMIT 1").first()) throw new AuditError("已有审计活动，不能重复创建。", 409); throw new AuditError("审计活动保存失败。"); }
  return getAuditStatus(env);
}

export async function pauseAudit(env: RuntimeEnv) {
  const campaign = await latest(env); if (!campaign) throw new AuditError("尚未创建审计。", 404);
  await pause(env, campaign.id, "管理员已暂停新的付费请求。已提交视频仍可查询结果。", new Date());
  return getAuditStatus(env);
}

function evaluate(spec: AuditCase, data: Json, rates: Rates) {
  const body = core(data), usage = object(body.usage) ? body.usage : object(data.usage) ? data.usage : null;
  const flags: string[] = [], returnedModel = typeof body.model === "string" ? body.model : typeof data.model === "string" ? data.model : null;
  if (returnedModel && returnedModel !== spec.model) flags.push("returned_model_mismatch");
  if (!returnedModel) flags.push("returned_model_missing");
  let derivedCost: number | null = null, grading: unknown = { status: "manual_review_pending", score: null };
  if (spec.kind === "chat") {
    const choice = Array.isArray(body.choices) && object(body.choices[0]) ? body.choices[0] : {};
    const message = object(choice.message) ? choice.message : {};
    grading = gradeAuditAnswer(message.content, spec.expected, choice.finish_reason);
    if (object(grading) && grading.status === "stale_or_mismatched_nonce") flags.push("stale_or_mismatched_nonce");
    if (choice.finish_reason === "length") flags.push("output_truncated");
    if (typeof message.content !== "string" || !message.content.trim()) flags.push("empty_answer");
    const prompt = usage?.prompt_tokens, output = usage?.completion_tokens, total = usage?.total_tokens;
    if (integer(prompt) && integer(output)) {
      const details = object(usage?.prompt_tokens_details) ? usage.prompt_tokens_details : {};
      const cached = integer(details.cached_tokens) ? details.cached_tokens : integer(usage?.prompt_cache_hit_tokens) ? usage.prompt_cache_hit_tokens : 0;
      if (cached <= prompt) derivedCost = Math.ceil(((prompt - cached) * rates.input! + cached * rates.cacheRead! + output * rates.output!) / 1_000_000);
      else flags.push("invalid_cached_token_count");
      if (cached > 0) flags.push("cache_usage_despite_disabled_request");
      if (output > Number(spec.body.max_tokens)) flags.push("reported_output_exceeds_request_limit");
      if (prompt > 4608) flags.push("reported_input_exceeds_conservative_bound");
      if (integer(total) && total !== prompt + output) flags.push("usage_total_mismatch");
    } else flags.push("usage_missing_or_invalid");
  } else if (spec.kind === "image") {
    const images = Array.isArray(body.data) ? body.data : Array.isArray(data.data) ? data.data : [];
    const count = images.filter(item => object(item) && typeof item.url === "string").length;
    if (count > 0) derivedCost = count * rates.image!;
    if (count !== 1) flags.push("image_count_not_one");
  } else {
    const output = usage?.completion_tokens;
    if (integer(output)) derivedCost = Math.ceil(output * rates.video! / 1_000_000);
    else if (body.status === "succeeded") flags.push("usage_missing_or_invalid");
  }
  if (derivedCost !== null && derivedCost > spec.reservedMicros) flags.push("derived_cost_exceeds_reservation");
  return { usage, flags, returnedModel, derivedCost, grading };
}

async function saveResult(env: RuntimeEnv, campaign: Campaign, spec: AuditCase, slot: number, response: Response, data: Json, rates: Rates, key: string, started: number, now: Date, poll = false) {
  const payload = sanitize(data, key) as Json, body = core(payload), result = evaluate(spec, payload, rates);
  let state = response.ok ? "succeeded" : "provider_error", taskId: string | null = null;
  if (spec.kind === "video" && response.ok) {
    taskId = typeof body.id === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(body.id) ? body.id : null;
    const taskState = typeof body.status === "string" ? body.status : "submitted";
    if (!poll && !taskId) { state = "outcome_unknown"; result.flags.push("missing_task_id"); }
    else state = ["succeeded", "failed", "cancelled", "expired"].includes(taskState) ? taskState : "pending_video";
  }
  const json = JSON.stringify(payload);
  await db(env).prepare(`UPDATE tokenhub_audit_cases SET state=?,response_json=?,response_hash=?,creation_json=CASE WHEN ?=0 THEN ? ELSE creation_json END,headers_json=?,http_status=?,latency_ms=?,usage_json=?,returned_model=?,derived_cost_micros=?,grading_json=?,flags_json=?,task_id=COALESCE(?,task_id),next_poll_at=?,updated_at=? WHERE campaign_id=? AND slot=? AND case_id=?`)
    .bind(state, json, await hash(json), poll ? 1 : 0, spec.kind === "video" ? json : null, JSON.stringify(collectHeaders(response.headers, key)), response.status, Date.now() - started, JSON.stringify(result.usage), result.returnedModel, result.derivedCost, JSON.stringify(result.grading), JSON.stringify(result.flags), taskId, state === "pending_video" ? date(new Date(now.getTime() + 5 * 60_000)) : null, date(now), campaign.id, slot, spec.id).run();
  if (result.flags.some(flag => ["derived_cost_exceeds_reservation", "reported_output_exceeds_request_limit", "reported_input_exceeds_conservative_bound", "returned_model_mismatch"].includes(flag))) await pause(env, campaign.id, "返回模型、用量或费用估算超出审计约束，等待核对证据。", now);
  if (state === "succeeded" && spec.kind !== "chat" && env.AUDIT_MEDIA) {
    // A failed artifact copy must never turn a known model result into an unknown charge.
    try { await archiveAuditCaseMedia(env, { campaign: campaign.id, slot, caseId: spec.id }); } catch { /* Retried independently by the bounded read-only archive queue. */ }
  }
}

function storedSpec(row: CaseRow): AuditCase {
  const body = parse(row.request_json), expected = parse(row.expected_json);
  if (!object(body) || !object(expected) || !["chat", "image", "video"].includes(row.kind)) throw new AuditError("已保存案例证据不可读取，未重新生成参数。", 409);
  return { id: row.case_id, kind: row.kind as AuditCase["kind"], model: row.model, reservedMicros: row.reserved_micros, body, expected };
}
function projectedReservation(campaignId: string, rows: CaseRow[]) {
  const saved = new Set(rows.map(row => `${row.slot}/${row.case_id}`));
  // Include every historical reservation even when a newer schedule omits its slot.
  return rows.reduce((sum, row) => sum + row.reserved_micros, 0) +
    Array.from({ length: AUDIT_SLOTS }, (_, slot) => auditCases(campaignId, slot).reduce((sum, spec) => sum + (saved.has(`${slot}/${spec.id}`) ? 0 : spec.reservedMicros), 0)).reduce((sum, value) => sum + value, 0);
}
async function observeCatalog(env: RuntimeEnv, campaign: Campaign, key: string, now: Date) {
  const day = Math.floor((now.getTime() - new Date(campaign.started_at).getTime()) / DAY);
  if (day < 0 || day > 6 || now.getTime() >= new Date(campaign.ends_at).getTime()) return;
  // A leased daily claim prevents concurrent ticks from duplicating free reads.
  // Successful snapshots are immutable; failed attempts have a bounded backoff.
  const lease = date(new Date(now.getTime() + 15 * 60_000));
  const claim = await db(env).prepare(`INSERT INTO tokenhub_audit_catalog_snapshots (campaign_id,day,state,attempt_count,next_attempt_at,updated_at)
    VALUES (?,?,'fetching',1,?,?) ON CONFLICT(campaign_id,day) DO UPDATE SET state='fetching',attempt_count=attempt_count+1,next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at
    WHERE tokenhub_audit_catalog_snapshots.state!='succeeded' AND tokenhub_audit_catalog_snapshots.attempt_count<8 AND tokenhub_audit_catalog_snapshots.next_attempt_at<=?
    RETURNING *`).bind(campaign.id, day, lease, date(now), date(now)).first<CatalogSnapshotRow>();
  if (!claim) return;
  const sources = await Promise.all((['models', 'pricing'] as const).map(async source => {
    const existing = parse(source === 'models' ? claim.models_json : claim.pricing_json);
    if (validCatalogSource(existing, source)) return { source, value: existing, error: null };
    try {
      const response = await fetch(ORIGIN + (source === 'models' ? '/api/v1/models' : '/api/pricing'), { headers: source === 'models' ? { Authorization: `Bearer ${key}`, Accept: 'application/json' } : { Accept: 'application/json' }, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return { source, value: null, error: `${source}:http_${response.status}` };
      const value = sanitize(await readJson(response), key);
      return validCatalogSource(value, source) ? { source, value, error: null } : { source, value, error: `${source}:invalid_or_empty_catalog` };
    } catch { return { source, value: null, error: `${source}:unavailable` }; }
  }));
  const models = sources[0].value, pricing = sources[1].value, errors = sources.flatMap(item => item.error ? [item.error] : []);
  const modelValid = validCatalogSource(models, "models"), priceValid = validCatalogSource(pricing, "pricing");
  const modelJson = models ? JSON.stringify(models) : null, priceJson = pricing ? JSON.stringify(pricing) : null;
  await db(env).prepare(`UPDATE tokenhub_audit_catalog_snapshots SET state=?,next_attempt_at=?,models_json=?,models_hash=?,pricing_json=?,pricing_hash=?,catalog_json=?,error_json=?,fetched_at=?,updated_at=? WHERE campaign_id=? AND day=? AND attempt_count=?`)
    .bind(errors.length === 0 ? 'succeeded' : modelValid || priceValid ? 'partial' : 'failed', date(new Date(now.getTime() + Math.min(180, 15 * 2 ** (claim.attempt_count - 1)) * 60_000)), modelJson, modelJson ? await hash(modelJson) : null, priceJson, priceJson ? await hash(priceJson) : null, JSON.stringify(normalizeAuditCatalog(modelValid ? models : null, priceValid ? pricing : null)), JSON.stringify(errors), date(now), date(now), campaign.id, day, claim.attempt_count).run();
}

// Explicit dashboard refresh observes public metadata only; it never runs inference.
export async function refreshAuditCatalog(env: RuntimeEnv, now = new Date()) {
  date(now);
  const campaign = await latest(env); if (!campaign) throw new AuditError("尚未创建审计。", 404);
  let key: string;
  try { key = await decryptProviderKey(campaign.encrypted_key, env.ADMIN_SESSION_SECRET, KEY_CONTEXT); }
  catch { throw new AuditError("审计专用密钥不可读取；未改用业务密钥。", 409); }
  await observeCatalog(env, campaign, key, now);
  return getAuditStatus(env);
}

async function pollVideos(env: RuntimeEnv, campaign: Campaign, key: string, now: Date) {
  const rows = (await db(env).prepare("SELECT * FROM tokenhub_audit_cases WHERE campaign_id=? AND state='pending_video' AND next_poll_at<=? ORDER BY next_poll_at LIMIT 2").bind(campaign.id, date(now)).all<CaseRow>()).results ?? [];
  for (const row of rows) {
    if (!row.task_id) continue;
    if (row.poll_count >= 96 || now.getTime() > new Date(campaign.ends_at).getTime() + 2 * DAY) {
      await db(env).prepare("UPDATE tokenhub_audit_cases SET state='poll_limit_reached',flags_json=?,updated_at=? WHERE campaign_id=? AND slot=? AND case_id=? AND state='pending_video'").bind(JSON.stringify(["video_result_recovery_limit"]), date(now), campaign.id, row.slot, row.case_id).run(); continue;
    }
    const claim = await db(env).prepare("UPDATE tokenhub_audit_cases SET poll_count=poll_count+1,next_poll_at=? WHERE campaign_id=? AND slot=? AND case_id=? AND state='pending_video' AND next_poll_at<=? RETURNING case_id")
      .bind(date(new Date(now.getTime() + 5 * 60_000)), campaign.id, row.slot, row.case_id, date(now)).first();
    if (!claim) continue;
    const spec = storedSpec(row);
    const storedPrice = parse(row.price_json), rates = auditPriceRates(object(storedPrice) ? storedPrice.data : null, spec), started = Date.now();
    try {
      const response = await fetch(ORIGIN + TASK_PATH + "/" + row.task_id, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (response.status >= 300 && response.status < 400) throw new Error();
      const payload = await readJson(response);
      if (!response.ok) continue; // A transient GET failure must not destroy a known pending task.
      await saveResult(env, campaign, spec, row.slot, response, payload, rates, key, started, now, true);
    } catch { /* Read-only recovery remains bounded by poll_count and the deadline. */ }
  }
}

export async function runAuditTick(env: RuntimeEnv, options: { maxCases?: number; now?: Date } = {}) {
  const clock = () => options.now ?? new Date();
  const now = clock(), maxCases = Math.max(1, Math.min(10, Math.floor(Number.isFinite(options.maxCases) ? options.maxCases! : 2))); date(now);
  const campaign = await latest(env); if (!campaign) return getAuditStatus(env);
  let key: string;
  try { key = await decryptProviderKey(campaign.encrypted_key, env.ADMIN_SESSION_SECRET, KEY_CONTEXT); } catch { await pause(env, campaign.id, "审计专用密钥不可读取；未改用业务密钥。", now); return getAuditStatus(env); }
  await observeCatalog(env, campaign, key, now);
  await pollVideos(env, campaign, key, now);
  if (env.AUDIT_MEDIA) { try { await archiveAuditMediaBackfill(env); } catch { /* Archive failures never trigger new inference. */ } }
  if (now.getTime() >= new Date(campaign.ends_at).getTime()) {
    await db(env).prepare("UPDATE tokenhub_audit_campaigns SET state='completed',updated_at=? WHERE id=? AND state='active'").bind(date(now), campaign.id).run();
    return getAuditStatus(env);
  }
  if (campaign.state !== "active" || env.SERVICE_ENABLED?.toLowerCase() !== "true") return getAuditStatus(env);
  const existingRows = (await db(env).prepare("SELECT * FROM tokenhub_audit_cases WHERE campaign_id=?").bind(campaign.id).all<CaseRow>()).results ?? [];
  if (projectedReservation(campaign.id, existingRows) > campaign.budget_micros) {
    await pause(env, campaign.id, "已锁定预留与剩余计划超过固定预算，未追加额度或重新提交。", now);
    return getAuditStatus(env);
  }
  if (campaign.plan_version !== AUDIT_PLAN_VERSION) await db(env).prepare("UPDATE tokenhub_audit_campaigns SET plan_version=?,updated_at=? WHERE id=? AND state='active'").bind(AUDIT_PLAN_VERSION, date(now), campaign.id).run();
  const slot = Math.floor((now.getTime() - new Date(campaign.started_at).getTime()) / AUDIT_SLOT_MS);
  if (slot < 0 || slot >= AUDIT_SLOTS) return getAuditStatus(env);
  const inWindow = (at: Date) => at.getTime() >= new Date(campaign.started_at).getTime() + slot * AUDIT_SLOT_MS
    && at.getTime() < Math.min(new Date(campaign.ends_at).getTime(), new Date(campaign.started_at).getTime() + (slot + 1) * AUDIT_SLOT_MS);
  let submitted = 0;
  for (const spec of auditCases(campaign.id, slot)) {
    if (submitted >= maxCases || !inWindow(clock())) break;
    if (await db(env).prepare("SELECT case_id FROM tokenhub_audit_cases WHERE campaign_id=? AND slot=? AND case_id=?").bind(campaign.id, slot, spec.id).first()) continue;
    const current = await db(env).prepare("SELECT state FROM tokenhub_audit_campaigns WHERE id=?").bind(campaign.id).first<{ state: string }>();
    if (current?.state !== "active") break;
    let snapshot: Json = { fetchedAt: date(now), data: null }, rates: Rates;
    try {
      const pricing = await fetch(ORIGIN + "/api/pricing", { headers: { Accept: "application/json" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!pricing.ok) throw new AuditError("公开价格暂不可获取，审计已暂停。", 502);
      snapshot = { fetchedAt: date(now), data: sanitize(await readJson(pricing), key) };
      rates = auditPriceRates(snapshot.data, spec);
    } catch (cause) {
      const reason = cause instanceof AuditError ? cause.message : "公开价格暂不可获取，审计已暂停。";
      const request = JSON.stringify(spec.body), price = JSON.stringify(snapshot);
      await db(env).prepare("INSERT INTO tokenhub_audit_cases (campaign_id,slot,case_id,kind,model,state,reserved_micros,request_json,request_hash,expected_json,price_json,price_hash,flags_json,submitted_at,updated_at) VALUES (?,?,?,?,?,'price_blocked',0,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING")
        .bind(campaign.id, slot, spec.id, spec.kind, spec.model, request, await hash(request), JSON.stringify(spec.expected), price, await hash(price), JSON.stringify(["price_unverified", reason]), date(now), date(now)).run();
      await pause(env, campaign.id, reason, now); break;
    }
    const request = JSON.stringify(spec.body), price = JSON.stringify(snapshot), requestHash = await hash(request), priceHash = await hash(price);
    const claimNow = clock();
    if (!inWindow(claimNow)) break;
    const idempotencyKey = `${campaign.id}-${slot}-${await hash(spec.id)}`;
    // One SQLite statement serializes the unique claim AND its conservative budget reservation.
    const claim = await db(env).prepare(`INSERT INTO tokenhub_audit_cases (campaign_id,slot,case_id,kind,model,state,reserved_micros,request_json,request_hash,expected_json,price_json,price_hash,submitted_at,updated_at)
      SELECT ?,?,?,?,?, 'reserved', ?,?,?,?,?,?,?,? FROM tokenhub_audit_campaigns c
      WHERE c.id=? AND c.state='active' AND c.ends_at>? AND c.budget_micros >= ? + COALESCE((SELECT SUM(reserved_micros) FROM tokenhub_audit_cases WHERE campaign_id=c.id),0)
      ON CONFLICT DO NOTHING RETURNING case_id`)
      .bind(campaign.id, slot, spec.id, spec.kind, spec.model, spec.reservedMicros, request, requestHash, JSON.stringify(spec.expected), price, priceHash, date(claimNow), date(claimNow), campaign.id, date(claimNow), spec.reservedMicros).first();
    if (!claim) continue;
    const sending = await db(env).prepare("UPDATE tokenhub_audit_cases SET state='submitting' WHERE campaign_id=? AND slot=? AND case_id=? AND state='reserved' AND EXISTS (SELECT 1 FROM tokenhub_audit_campaigns WHERE id=? AND state='active') RETURNING case_id").bind(campaign.id, slot, spec.id, campaign.id).first();
    if (!sending) continue;
    // Recheck after the D1 round-trip, immediately before fetch. No await occurs
    // between this clock check and dispatch. A prior long response must not
    // permit the next call to cross its slot or the seven-day deadline.
    const dispatchNow = clock();
    if (!inWindow(dispatchNow)) {
      await db(env).prepare("UPDATE tokenhub_audit_cases SET state='window_expired',flags_json=?,updated_at=? WHERE campaign_id=? AND slot=? AND case_id=? AND state='submitting'")
        .bind(JSON.stringify(["window_expired_before_dispatch"]), date(dispatchNow), campaign.id, slot, spec.id).run();
      break; // Preserve the claimed reservation; never submit this case later.
    }
    submitted++;
    const path = spec.kind === "chat" ? "/api/v1/chat/completions" : spec.kind === "image" ? "/api/v3/images/generations" : TASK_PATH;
    const started = Date.now();
    try {
      const response = await fetch(ORIGIN + path, { method: "POST", headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: request, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(AUDIT_PAID_TIMEOUT_MS) });
      if (response.status >= 300 && response.status < 400) throw new Error();
      await saveResult(env, campaign, spec, slot, response, await readJson(response), rates, key, started, clock());
    } catch {
      // A timeout, parse error or storage error may follow a charge. Never retry this case or release its reservation.
      await db(env).prepare("UPDATE tokenhub_audit_cases SET state='outcome_unknown',flags_json=?,latency_ms=?,updated_at=? WHERE campaign_id=? AND slot=? AND case_id=? AND state='submitting'")
        .bind(JSON.stringify(["outcome_unknown_no_retry"]), Date.now() - started, date(now), campaign.id, slot, spec.id).run();
    }
  }
  const finishedAt = clock();
  if (finishedAt.getTime() >= new Date(campaign.ends_at).getTime()) await db(env).prepare("UPDATE tokenhub_audit_campaigns SET state='completed',updated_at=? WHERE id=? AND state='active'").bind(date(finishedAt), campaign.id).run();
  return getAuditStatus(env);
}

export async function getAuditStatus(env: RuntimeEnv, includeEvidence = false) {
  const campaign = await latest(env);
  if (!campaign) return { configured: false, campaign: null, counts: {}, days: [], cases: [], flags: [], catalogModels: [], catalogObservations: [] };
  const rows = (await db(env).prepare("SELECT * FROM tokenhub_audit_cases WHERE campaign_id=? ORDER BY slot,case_id").bind(campaign.id).all<CaseRow>()).results ?? [];
  const byId = new Map(rows.map(row => [`${row.slot}/${row.case_id}`, row]));
  const snapshots = (await db(env).prepare("SELECT * FROM tokenhub_audit_catalog_snapshots WHERE campaign_id=? ORDER BY day").bind(campaign.id).all<CatalogSnapshotRow>()).results ?? [];
  const catalogObservations = snapshots.map(row => {
    const models = (parse(row.catalog_json) ?? []) as CatalogModel[];
    return { day: row.day + 1, observedAt: row.fetched_at, updatedAt: row.updated_at, status: row.state, attemptCount: row.attempt_count, nextAttemptAt: row.next_attempt_at,
      modelsHash: row.models_hash, pricingHash: row.pricing_hash, modelCount: models.length, models, errors: (parse(row.error_json) ?? []) as string[],
      ...(includeEvidence ? { modelsResponse: parse(row.models_json), pricingResponse: parse(row.pricing_json) } : {}) };
  });
  const now = Date.now(), start = new Date(campaign.started_at).getTime();
  const plans = Array.from({ length: AUDIT_SLOTS }, (_, slot) => auditCases(campaign.id, slot).map(spec => ({ slot, spec, retainedFromEarlierPlan: false }))).flat();
  const plannedKeys = new Set(plans.map(({ slot, spec }) => `${slot}/${spec.id}`));
  for (const row of rows) if (!plannedKeys.has(`${row.slot}/${row.case_id}`)) plans.push({ slot: row.slot, spec: storedSpec(row), retainedFromEarlierPlan: true });
  plans.sort((a, b) => a.slot - b.slot || a.spec.id.localeCompare(b.spec.id));
  const cases = plans.map(({ slot, spec: plannedSpec, retainedFromEarlierPlan }) => {
    const row = byId.get(`${slot}/${plannedSpec.id}`), spec = row ? storedSpec(row) : plannedSpec, state = row?.state ?? (now >= start + (slot + 1) * AUDIT_SLOT_MS ? "missed" : "planned");
    const evidenceExpected = row ? parse(row.expected_json) : spec.expected, evidenceRequest = row ? parse(row.request_json) : spec.body;
    const planVersion = object(evidenceExpected) && typeof evidenceExpected.protocolVersion === "string" ? evidenceExpected.protocolVersion : row ? "tokenhub-audit-v1" : AUDIT_PLAN_VERSION;
    return { slot, caseId: spec.id, retainedFromEarlierPlan, planVersion, maxOutputTokens: object(evidenceRequest) && integer(evidenceRequest.max_tokens) ? evidenceRequest.max_tokens : null, kind: spec.kind, requestedModel: spec.model, state, reservedMicros: row?.reserved_micros ?? 0,
      submittedAt: row && !["price_blocked", "reserved", "window_expired"].includes(row.state) ? row.submitted_at : null, updatedAt: row?.updated_at ?? null, usage: parse(row?.usage_json), returnedModel: row?.returned_model ?? null,
      derivedExpectedCostMicros: row?.derived_cost_micros ?? null, grading: parse(row?.grading_json), flags: (parse(row?.flags_json) ?? []) as string[], taskId: row?.task_id ?? null,
      httpStatus: row?.http_status ?? null, latencyMs: row?.latency_ms ?? null, requestHash: row?.request_hash ?? null, responseHash: row?.response_hash ?? null,
      independentAnalysis: parse(row?.independent_analysis_json), billingActualMicros: row?.billing_actual_micros ?? null, billingEvidence: parse(row?.billing_evidence_json),
      tokenVerification: object(parse(row?.independent_analysis_json)) ? String((parse(row?.independent_analysis_json) as Json).tokenVerification ?? "provisional") : "pending_official_tokenizer", billingVerification: row?.billing_actual_micros !== null && row?.billing_actual_micros !== undefined && row?.billing_evidence_json ? "recorded" : "pending",
      ...(includeEvidence ? { request: parse(row?.request_json), response: parse(row?.response_json), expected: parse(row?.expected_json), priceSnapshot: parse(row?.price_json), priceHash: row?.price_hash ?? null, creationResponse: parse(row?.creation_json), headers: parse(row?.headers_json), pollCount: row?.poll_count ?? 0 } : {}) };
  });
  const catalogUnion = new Map(knownAuditModels().map(model => [model.model, { ...model, lastSeenAt: null as string | null }]));
  for (const model of normalizeAuditCatalog(parse(campaign.catalog_json), null)) catalogUnion.set(model.model, { ...model, lastSeenAt: campaign.started_at });
  for (const observation of catalogObservations) for (const model of observation.models) catalogUnion.set(model.model, { ...model, lastSeenAt: observation.observedAt });
  for (const item of cases) if (!catalogUnion.has(item.requestedModel)) catalogUnion.set(item.requestedModel, { model: item.requestedModel, kind: item.kind, label: item.requestedModel, sources: [], enabled: null, lastSeenAt: null });
  const latestComplete = [...catalogObservations].reverse().find(item => item.status === "succeeded");
  const supported = new Set(knownAuditModels().map(item => item.model));
  const catalogModels = Array.from(catalogUnion.values()).map(model => ({ ...model,
    catalogState: !model.lastSeenAt ? "unobserved" : latestComplete?.observedAt && latestComplete.observedAt >= model.lastSeenAt && !latestComplete.models.some(item => item.model === model.model) ? "disappeared" : "present",
    paidAdapterSupported: supported.has(model.model), plannedCalls: cases.filter(item => item.requestedModel === model.model).length,
    observedDays: catalogObservations.filter(day => day.status === "succeeded" && day.models.some(item => item.model === model.model)).length,
  }));
  const reservedMicros = rows.reduce((sum, row) => sum + row.reserved_micros, 0), counts: Record<string, number> = {};
  for (const item of cases) counts[item.state] = (counts[item.state] ?? 0) + 1;
  const days = Array.from({ length: 7 }, (_, dayIndex) => ({ day: dayIndex + 1, date: new Date(start + dayIndex * DAY + 8 * 3600_000).toISOString().slice(0, 10), startsAt: new Date(start + dayIndex * DAY).toISOString(), endsAt: new Date(start + (dayIndex + 1) * DAY).toISOString(),
    models: catalogModels.map(entry => {
      const model = entry.model, observation = catalogObservations.find(item => item.day === dayIndex + 1);
      const inCatalog = observation?.models.some(item => item.model === model) ?? false;
      const selected = cases.filter(item => item.requestedModel === model && Math.floor(item.slot / 2) === dayIndex);
      const grades = selected.map(item => item.grading).filter((grade): grade is Json => object(grade) && integer(grade.total) && grade.total > 0);
      const correct = grades.reduce((sum, grade) => sum + Number(grade.correct || 0), 0), items = grades.reduce((sum, grade) => sum + Number(grade.total), 0);
      const recorded = selected.filter(item => item.submittedAt), costs = selected.map(item => item.derivedExpectedCostMicros).filter((value): value is number => value !== null);
      const pending = selected.filter(item => ["planned", "reserved", "submitting"].includes(item.state)).length, missed = selected.filter(item => ["missed", "window_expired"].includes(item.state)).length;
      const latencies = selected.map(item => item.latencyMs).filter((value): value is number => value !== null);
      return { model, kind: entry.kind, catalogObserved: observation?.status === "succeeded" && inCatalog,
        catalogState: inCatalog ? "present" : observation?.status === "succeeded" ? "absent" : observation ? "unverified" : "pending",
        inferenceState: recorded.length ? "tested" : !entry.paidAdapterSupported ? "adapter_pending" : selected.length === 0 ? "not_scheduled" : missed === selected.length ? "missed" : "scheduled",
        planned: selected.length, requests: recorded.length, missed, pending, correct, items, score: entry.kind === "chat" && items ? correct / items * 100 : null,
        latencyMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
        derivedExpectedCostMicros: costs.length ? costs.reduce((sum, value) => sum + value, 0) : null, relativeToDay1: null as number | null,
        status: (items === 0 ? recorded.length ? "no_answers" : "pending" : items === selected.length * 4 ? "complete" : "partial") as "pending" | "partial" | "complete" | "no_answers" };
    }) }));
  for (const day of days) for (const model of day.models) { const first = days[0].models.find(item => item.model === model.model); if (first?.score !== null && first?.score !== undefined && model.score !== null) model.relativeToDay1 = model.score - first.score; }
  return { configured: true, campaign: { id: campaign.id, state: campaign.state, startedAt: campaign.started_at, endsAt: campaign.ends_at, budgetMicros: campaign.budget_micros, reservedMicros, remainingMicros: Math.max(0, campaign.budget_micros - reservedMicros), keyHint: campaign.key_hint, planVersion: campaign.plan_version, pauseReason: campaign.pause_reason, catalog: parse(campaign.catalog_json), catalogHash: campaign.catalog_hash, plannedCalls: cases.length, plannedReservationMicros: projectedReservation(campaign.id, rows), identityVerification: "unverified", billingVerification: "pending", tokenVerification: cases.some(item => object(item.independentAnalysis) && item.independentAnalysis.status === "needs_review") ? "needs_review" : cases.some(item => item.independentAnalysis) ? "provisional" : "pending_official_tokenizer" }, catalogModels, catalogObservations, counts, days, cases, flags: Array.from(new Set(cases.flatMap(item => item.flags))) };
}
