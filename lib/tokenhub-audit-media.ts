import type { RuntimeEnv } from "./config";

const HOSTS = new Set(["ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com"]);
export const AUDIT_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const AUDIT_MEDIA_MAX_ASSETS = 40;
export const AUDIT_MEDIA_CAMPAIGN_BYTES = 100 * 1024 * 1024;
const MAX_PER_CASE = 4, MAX_ATTEMPTS = 3;
type Json = Record<string, unknown>;
type CaseQuery = { campaign: string; slot: number; caseId: string };
type CaseRow = { kind: "image" | "video"; state: string; response_json: string | null };
type Candidate = { kind: "image" | "video"; sourcePath: string; sourceUrl: string };
type MediaRow = { asset_id: string; campaign_id: string; slot: number; case_id: string; kind: "image" | "video"; source_path: string; source_url: string; source_expires_at: string | null; state: string; attempt_count: number; next_attempt_at: string; object_key: string | null; mime_type: string | null; size_bytes: number | null; sha256: string | null; archived_at: string | null; error_code: string | null };
export class AuditMediaError extends Error { constructor(message: string, public status = 503) { super(message); } }
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
function parse(value: string | null): unknown { try { return value ? JSON.parse(value) : null; } catch { return null; } }
async function digest(value: Uint8Array | string) { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value; return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), b => b.toString(16).padStart(2, "0")).join(""); }
export function auditMediaSource(value: unknown): { url: string; expiresAt: string | null } | null {
  if (typeof value !== "string" || !/^https:\/\//i.test(value) || value.length > 8192 || value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.username || url.password || url.port || url.hash) return null;
    const signed = url.searchParams.get("X-Tos-Date"), ttl = url.searchParams.get("X-Tos-Expires");
    let expiresAt: string | null = null;
    if (signed && /^\d{8}T\d{6}Z$/.test(signed) && ttl && /^\d{1,7}$/.test(ttl)) {
      const at = Date.parse(`${signed.slice(0,4)}-${signed.slice(4,6)}-${signed.slice(6,8)}T${signed.slice(9,11)}:${signed.slice(11,13)}:${signed.slice(13,15)}Z`);
      if (Number.isFinite(at)) expiresAt = new Date(at + Number(ttl) * 1000).toISOString();
    }
    return { url: value, expiresAt };
  } catch { return null; }
}
function candidates(kind: "image" | "video", response: unknown): Candidate[] {
  if (!object(response)) return [];
  const body = object(response.data) ? response.data : response, prefix = object(response.data) ? "response.data" : "response";
  const out: Candidate[] = [], seen = new Set<string>();
  function add(mediaKind: Candidate["kind"], sourcePath: string, value: unknown) {
    if (typeof value !== "string" || value.length > 8192 || seen.has(value) || out.length >= MAX_PER_CASE) return;
    seen.add(value); out.push({ kind: mediaKind, sourcePath, sourceUrl: value });
  }
  if (kind === "image" && Array.isArray(body.data)) body.data.slice(0, MAX_PER_CASE).forEach((item, index) => { if (object(item)) add("image", `${prefix}.data[${index}].url`, item.url); });
  if (kind === "video") {
    const content = object(body.content) ? body.content : {};
    add("video", `${prefix}.content.video_url`, content.video_url); add("video", `${prefix}.video_url`, body.video_url);
    add("image", `${prefix}.content.last_frame_url`, content.last_frame_url); add("image", `${prefix}.last_frame_url`, body.last_frame_url);
  }
  return out;
}
function safeMime(kind: Candidate["kind"], value: string | null) { const mime = value?.toLowerCase().split(";")[0].trim(); return mime && (kind === "video" ? ["video/mp4", "video/webm"] : ["image/png", "image/jpeg", "image/webp"]).includes(mime) ? mime : null; }
async function bytesLimited(response: Response) {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > AUDIT_MEDIA_MAX_BYTES)) { await response.body?.cancel(); throw new Error("too_large"); }
  if (!response.body) throw new Error("empty_body");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > AUDIT_MEDIA_MAX_BYTES) { await reader.cancel(); throw new Error("too_large"); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  if (!size) throw new Error("empty_body");
  if (declared && Number(declared) !== size) throw new Error("incomplete_body");
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}

/** Only downloads already-generated artifacts. Never calls model inference or alters raw evidence. */
export async function archiveAuditCaseMedia(env: RuntimeEnv, query: CaseQuery, now = new Date(), maxAssets = MAX_PER_CASE) {
  if (!env.AUDIT_MEDIA || !env.DB) return { configured: false, attempted: 0, archives: [] };
  const db = env.DB, row = await db.prepare("SELECT kind,state,response_json FROM tokenhub_audit_cases WHERE campaign_id=? AND slot=? AND case_id=?").bind(query.campaign, query.slot, query.caseId).first<CaseRow>();
  if (!row) throw new AuditMediaError("没有找到该检测底稿。", 404);
  if (row.state !== "succeeded" || !["image", "video"].includes(row.kind)) return { configured: true, attempted: 0, archives: await getAuditMediaArchives(env, query) };
  let attempted = 0;
  for (const candidate of candidates(row.kind, parse(row.response_json))) {
    const source = auditMediaSource(candidate.sourceUrl), assetId = await digest(`${query.campaign}/${query.slot}/${query.caseId}/${candidate.sourcePath}/${candidate.sourceUrl}`);
    const initialState = !source ? "unsupported" : source.expiresAt && Date.parse(source.expiresAt) <= now.getTime() ? "expired" : "pending";
    await db.prepare(`INSERT INTO tokenhub_audit_media (asset_id,campaign_id,slot,case_id,kind,source_path,source_url,source_expires_at,state,next_attempt_at,error_code,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM tokenhub_audit_media WHERE campaign_id=?)<? AND (SELECT COUNT(*) FROM tokenhub_audit_media WHERE campaign_id=? AND slot=? AND case_id=?)<? ON CONFLICT DO NOTHING`)
      .bind(assetId, query.campaign, query.slot, query.caseId, candidate.kind, candidate.sourcePath, candidate.sourceUrl, source?.expiresAt ?? null, initialState, now.toISOString(), initialState === "unsupported" ? "unsupported_source" : initialState === "expired" ? "source_expired" : null, now.toISOString(), query.campaign, AUDIT_MEDIA_MAX_ASSETS, query.campaign, query.slot, query.caseId, MAX_PER_CASE).run();
    if (!source || attempted >= Math.max(0, Math.min(MAX_PER_CASE, maxAssets))) continue;
    const claim = await db.prepare(`UPDATE tokenhub_audit_media SET state='archiving',attempt_count=attempt_count+1,reserved_bytes=?,next_attempt_at=?,updated_at=? WHERE asset_id=? AND state IN ('pending','failed','archiving') AND attempt_count<? AND next_attempt_at<=? AND (? - reserved_bytes + (SELECT COALESCE(SUM(reserved_bytes),0) FROM tokenhub_audit_media WHERE campaign_id=?))<=? RETURNING asset_id`)
      .bind(AUDIT_MEDIA_MAX_BYTES, new Date(now.getTime() + 10 * 60_000).toISOString(), now.toISOString(), assetId, MAX_ATTEMPTS, now.toISOString(), AUDIT_MEDIA_MAX_BYTES, query.campaign, AUDIT_MEDIA_CAMPAIGN_BYTES).first();
    if (!claim) {
      await db.prepare("UPDATE tokenhub_audit_media SET error_code='capacity_limit',updated_at=? WHERE asset_id=? AND state IN ('pending','failed') AND attempt_count<? AND (? - reserved_bytes + (SELECT COALESCE(SUM(reserved_bytes),0) FROM tokenhub_audit_media WHERE campaign_id=?))>?")
        .bind(now.toISOString(), assetId, MAX_ATTEMPTS, AUDIT_MEDIA_MAX_BYTES, query.campaign, AUDIT_MEDIA_CAMPAIGN_BYTES).run();
      continue;
    }
    attempted++;
    try {
      if (source.expiresAt && Date.parse(source.expiresAt) <= now.getTime()) throw new Error("source_expired");
      const response = await fetch(source.url, { method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000), headers: { Accept: candidate.kind === "video" ? "video/mp4,video/webm" : "image/png,image/jpeg,image/webp" } });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error("redirect_blocked"); }
      if (!response.ok || response.status === 206) { await response.body?.cancel(); throw new Error(`source_http_${response.status}`); }
      const mime = safeMime(candidate.kind, response.headers.get("content-type"));
      if (!mime) { await response.body?.cancel(); throw new Error("unsupported_mime"); }
      const bytes = await bytesLimited(response), sha256 = await digest(bytes), key = `tokenhub/${query.campaign}/${assetId}`;
      await env.AUDIT_MEDIA.put(key, bytes, { httpMetadata: { contentType: mime }, customMetadata: { sha256, assetId } });
      await db.prepare("UPDATE tokenhub_audit_media SET state='archived',object_key=?,mime_type=?,size_bytes=?,reserved_bytes=?,sha256=?,archived_at=?,error_code=NULL,updated_at=? WHERE asset_id=? AND state='archiving'")
        .bind(key, mime, bytes.byteLength, bytes.byteLength, sha256, now.toISOString(), now.toISOString(), assetId).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : "archive_unavailable";
      const code = /^(?:too_large|empty_body|incomplete_body|source_expired|redirect_blocked|unsupported_mime|source_http_\d{3})$/.test(message) ? message : "archive_unavailable";
      await db.prepare("UPDATE tokenhub_audit_media SET state=?,error_code=?,updated_at=? WHERE asset_id=? AND state='archiving'").bind(code === "source_expired" ? "expired" : "failed", code, now.toISOString(), assetId).run();
    }
  }
  return { configured: true, attempted, archives: await getAuditMediaArchives(env, query) };
}

export async function archiveAuditMediaBackfill(env: RuntimeEnv, now = new Date()) {
  if (!env.DB || !env.AUDIT_MEDIA) return { configured: false, attempted: 0 };
  const rows = (await env.DB.prepare("SELECT campaign_id,slot,case_id FROM tokenhub_audit_cases WHERE state='succeeded' AND kind IN ('image','video') ORDER BY submitted_at DESC LIMIT 40").all<{ campaign_id: string; slot: number; case_id: string }>()).results ?? [];
  let attempted = 0;
  for (const row of rows) { if (attempted >= 2) break; const result = await archiveAuditCaseMedia(env, { campaign: row.campaign_id, slot: row.slot, caseId: row.case_id }, now, 2 - attempted); attempted += result.attempted; }
  return { configured: true, attempted };
}

export async function getAuditMediaArchives(env: RuntimeEnv, query: CaseQuery) {
  if (!env.DB) return [];
  const rows = (await env.DB.prepare("SELECT asset_id,kind,source_path,source_url,source_expires_at,state,mime_type,size_bytes,sha256,archived_at,error_code,attempt_count FROM tokenhub_audit_media WHERE campaign_id=? AND slot=? AND case_id=? ORDER BY source_path").bind(query.campaign, query.slot, query.caseId).all<MediaRow>()).results ?? [];
  return rows.map(row => ({ assetId: row.asset_id, kind: row.kind, sourcePath: row.source_path, sourceUrl: row.source_url, state: row.state, sourceExpiresAt: row.source_expires_at, archivedAt: row.archived_at, mimeType: row.mime_type, sizeBytes: row.size_bytes, sha256: row.sha256, attemptCount: row.attempt_count, error: row.error_code, url: row.state === "archived" ? `/api/admin/tokenhub-audit/media?asset=${row.asset_id}` : null }));
}

export function parseAuditMediaRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new AuditMediaError("不支持该媒体范围。", 416);
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || (!match[1] && Number(match[2]) === 0)) throw new AuditMediaError("媒体范围超出文件大小。", 416);
  return { offset: start, length: end - start + 1 };
}
export async function serveAuditMedia(env: RuntimeEnv, asset: string, rangeHeader: string | null) {
  if (!/^[0-9a-f]{64}$/.test(asset)) throw new AuditMediaError("媒体标识不正确。", 400);
  if (!env.DB || !env.AUDIT_MEDIA) throw new AuditMediaError("媒体归档暂不可用。");
  const row = await env.DB.prepare("SELECT kind,state,object_key,mime_type,size_bytes,sha256 FROM tokenhub_audit_media WHERE asset_id=?").bind(asset).first<MediaRow>();
  if (!row || row.state !== "archived" || !row.object_key || !row.size_bytes || !safeMime(row.kind, row.mime_type)) throw new AuditMediaError("没有找到已归档的媒体。", 404);
  let range: { offset: number; length: number } | null;
  try { range = parseAuditMediaRange(rangeHeader, row.size_bytes); }
  catch (error) { if (error instanceof AuditMediaError) return new Response(null, { status: 416, headers: { "content-range": `bytes */${row.size_bytes}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } }); throw error; }
  const stored = await env.AUDIT_MEDIA.get(row.object_key, range ? { range } : undefined);
  if (!stored) throw new AuditMediaError("归档文件暂不可读取。", 404);
  const headers = new Headers({ "content-type": row.mime_type!, "content-length": String(range?.length ?? row.size_bytes), "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-disposition": "inline", etag: `"${row.sha256}"` });
  if (range) headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${row.size_bytes}`);
  return new Response(stored.body, { status: range ? 206 : 200, headers });
}
