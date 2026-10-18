import type { RuntimeEnv } from "./config";

export class AuditEvidenceError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
export type AuditEvidenceQuery = { campaign: string; slot: number; caseId: string; download: boolean };
export type AuditEvidenceMedia = { kind: "image" | "video"; url: string; sourcePath: string; label: string };
type Json = Record<string, unknown>;
type CampaignRow = { id: string; started_at: string; ends_at: string; plan_version: string };
type EvidenceRow = {
  campaign_id: string; slot: number; case_id: string; kind: "chat" | "image" | "video"; model: string; state: string;
  reserved_micros: number; request_json: string; request_hash: string; expected_json: string; price_json: string;
  price_hash: string; response_json: string | null; response_hash: string | null; creation_json: string | null;
  headers_json: string | null; http_status: number | null; latency_ms: number | null; usage_json: string | null;
  returned_model: string | null; derived_cost_micros: number | null; grading_json: string | null; flags_json: string;
  independent_analysis_json: string | null; billing_actual_micros: number | null; billing_evidence_json: string | null;
  task_id: string | null; poll_count: number; next_poll_at: string | null; submitted_at: string; updated_at: string;
};

// Keep this allowlist independent from campaign credentials and future schema additions.
const CASE_COLUMNS = "campaign_id,slot,case_id,kind,model,state,reserved_micros,request_json,request_hash,expected_json,price_json,price_hash,response_json,response_hash,creation_json,headers_json,http_status,latency_ms,usage_json,returned_model,derived_cost_micros,grading_json,flags_json,independent_analysis_json,billing_actual_micros,billing_evidence_json,task_id,poll_count,next_poll_at,submitted_at,updated_at";
const TRACE_HEADERS = new Set(["x-request-id", "request-id", "x-bifrost-request-id", "x-bifrost-model", "x-bifrost-provider", "x-bifrost-cache-hit", "x-cache", "x-model", "x-provider", "cf-ray"]);
const UNSENT_STATES = new Set(["price_blocked", "reserved", "window_expired", "planned", "missed"]);
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
function parse(value: string | null | undefined): unknown { if (!value) return null; try { return JSON.parse(value); } catch { return null; } }
function traceHeaders(value: unknown): Json | null {
  return object(value) ? Object.fromEntries(Object.entries(value).filter(([key, item]) => TRACE_HEADERS.has(key.toLowerCase()) && typeof item === "string")) : null;
}

export function parseAuditEvidenceQuery(params: URLSearchParams): AuditEvidenceQuery {
  const allowed = new Set(["campaign", "slot", "caseId", "download"]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) throw new AuditEvidenceError("底稿查询参数不正确。", 400);
  const campaign = params.get("campaign") ?? "", slot = params.get("slot") ?? "", caseId = params.get("caseId") ?? "", download = params.get("download");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaign)
    || !/^(?:[0-9]|1[0-3])$/.test(slot) || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/.test(caseId)
    || (download !== null && download !== "1")) throw new AuditEvidenceError("请选择有效的核验活动、轮次和底稿。", 400);
  return { campaign, slot: Number(slot), caseId, download: download === "1" };
}

function safeMediaUrl(value: unknown, kind: "image" | "video"): string | null {
  if (typeof value !== "string" || value.length > 2_000_000 || value !== value.trim()) return null;
  if (kind === "image" && /^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) && value.includes(",") && value.split(",")[1].length > 0) return value;
  if (!/^https:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !!url.hostname ? value : null; } catch { return null; }
}
function base64Image(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // A format signature is required: do not label arbitrary base64 or SVG as an image.
  let prefix: string;
  try { prefix = atob(value.slice(0, 16)); } catch { return null; }
  const mime = prefix.startsWith("\x89PNG\r\n\x1a\n") ? "png" : prefix.startsWith("\xff\xd8\xff") ? "jpeg" : prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP" ? "webp" : null;
  return mime ? safeMediaUrl(`data:image/${mime};base64,${value}`, "image") : null;
}

/** Extract only documented image/video result fields, never URLs from generated text. */
export function extractAuditEvidenceMedia(kind: "chat" | "image" | "video", response: unknown, creationResponse?: unknown): AuditEvidenceMedia[] {
  const media: AuditEvidenceMedia[] = [], seen = new Set<string>();
  function add(mediaKind: "image" | "video", value: unknown, sourcePath: string, label: string) {
    const url = safeMediaUrl(value, mediaKind); if (!url || seen.has(url)) return;
    seen.add(url); media.push({ kind: mediaKind, url, sourcePath, label });
  }
  for (const [source, value] of [["response", response], ["creationResponse", creationResponse]] as const) {
    if (!object(value)) continue;
    const body = object(value.data) ? value.data : value, path = object(value.data) ? `${source}.data` : source;
    if (kind === "image" && Array.isArray(body.data)) body.data.forEach((item, index) => {
      if (!object(item)) return;
      add("image", item.url, `${path}.data[${index}].url`, `生成图片 ${index + 1}`);
      add("image", base64Image(item.b64_json), `${path}.data[${index}].b64_json`, `生成图片 ${index + 1}`);
    });
    if (kind === "video") {
      const content = object(body.content) ? body.content : {};
      add("video", content.video_url, `${path}.content.video_url`, "生成视频");
      add("video", body.video_url, `${path}.video_url`, "生成视频");
      add("image", content.last_frame_url, `${path}.content.last_frame_url`, "视频尾帧");
      add("image", body.last_frame_url, `${path}.last_frame_url`, "视频尾帧");
    }
  }
  return media;
}

export async function getAuditCaseEvidence(env: RuntimeEnv, query: Pick<AuditEvidenceQuery, "campaign" | "slot" | "caseId">) {
  if (!env.DB) throw new AuditEvidenceError("底稿存储暂不可用。");
  const campaign = await env.DB.prepare("SELECT id,started_at,ends_at,plan_version FROM tokenhub_audit_campaigns WHERE id=?").bind(query.campaign).first<CampaignRow>();
  if (!campaign) throw new AuditEvidenceError("没有找到该核验活动。", 404);
  const row = await env.DB.prepare(`SELECT ${CASE_COLUMNS} FROM tokenhub_audit_cases WHERE campaign_id=? AND slot=? AND case_id=?`).bind(query.campaign, query.slot, query.caseId).first<EvidenceRow>();
  if (!row) throw new AuditEvidenceError("这条检测尚无已保存的底稿。", 404);
  const request = parse(row.request_json), response = parse(row.response_json), expected = parse(row.expected_json), independentAnalysis = parse(row.independent_analysis_json), creationResponse = parse(row.creation_json);
  const wasSubmitted = !UNSENT_STATES.has(row.state);
  return {
    campaign: { id: campaign.id, startedAt: campaign.started_at, endsAt: campaign.ends_at, planVersion: campaign.plan_version },
    case: {
      slot: row.slot, caseId: row.case_id, kind: row.kind, requestedModel: row.model, state: row.state, wasSubmitted,
      planVersion: object(expected) && typeof expected.protocolVersion === "string" ? expected.protocolVersion : "tokenhub-audit-v1",
      maxOutputTokens: object(request) && Number.isSafeInteger(request.max_tokens) && Number(request.max_tokens) >= 0 ? Number(request.max_tokens) : null,
      reservedMicros: row.reserved_micros, submittedAt: wasSubmitted ? row.submitted_at : null, rawSubmittedAt: row.submitted_at, updatedAt: row.updated_at,
      request, response, expected, creationResponse, priceSnapshot: parse(row.price_json), priceHash: row.price_hash,
      headers: traceHeaders(parse(row.headers_json)), pollCount: row.poll_count, nextPollAt: row.next_poll_at, usage: parse(row.usage_json), returnedModel: row.returned_model,
      derivedExpectedCostMicros: row.derived_cost_micros, grading: parse(row.grading_json), flags: parse(row.flags_json) ?? [], taskId: row.task_id,
      httpStatus: row.http_status, latencyMs: row.latency_ms, requestHash: row.request_hash, responseHash: row.response_hash,
      independentAnalysis, billingActualMicros: row.billing_actual_micros, billingEvidence: parse(row.billing_evidence_json),
      tokenVerification: object(independentAnalysis) ? String(independentAnalysis.tokenVerification ?? "provisional") : "pending_official_tokenizer",
      billingVerification: row.billing_actual_micros !== null && row.billing_evidence_json ? "recorded" : "pending",
    },
    media: extractAuditEvidenceMedia(row.kind, response, creationResponse),
  };
}
export type AuditCaseEvidence = Awaited<ReturnType<typeof getAuditCaseEvidence>>;
