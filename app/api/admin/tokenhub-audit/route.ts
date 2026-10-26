import { getPortalUser } from "@/lib/auth";
import { getD1, runtimeEnv } from "@/lib/config";
import { sha256Hex } from "@/lib/crypto";
import { AuditError, getAuditStatus, pauseAudit, refreshAuditCatalog, runAuditTick, startAudit } from "@/lib/tokenhub-audit";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
function reply(data: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return Response.json(data, { status, headers: { ...headers, ...extraHeaders } });
}

async function handle(request: Request) {
  try {
    const user = await getPortalUser();
    if (!user) return reply({ error: "请先登录管理员账户。" }, 401);
    if (!user.isAdmin) return reply({ error: "仅管理员可以查看和运行核验。" }, 403);
    if (request.method === "GET") {
      const evidence = new URL(request.url).searchParams.get("evidence") === "1";
      return reply(await getAuditStatus(runtimeEnv(), evidence), 200, evidence ? { "content-disposition": 'attachment; filename="tokvilo-audit-evidence.json"' } : undefined);
    }
    if (request.headers.get("Origin") !== new URL(request.url).origin) return reply({ error: "请从本站核验后台提交操作。" }, 403);
    if (!request.headers.get("Content-Type")?.toLowerCase().split(";")[0].trim().match(/^application\/json$/)) return reply({ error: "请提交 JSON 格式的请求。" }, 415);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "请求内容不能为空。" }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2048) { await reader.cancel(); return reply({ error: "请求内容过长。" }, 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply({ error: "请求格式不正确。" }, 400); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return reply({ error: "请求格式不正确。" }, 400);
    const body = payload as Record<string, unknown>;
    if (!["start", "tick", "pause", "observe"].includes(String(body.action)) || Object.keys(body).some(key => key !== "action" && !(body.action === "start" && key === "apiKey"))) return reply({ error: "请求参数不正确。" }, 400);
    if (body.action === "start" && (typeof body.apiKey !== "string" || !body.apiKey.trim() || body.apiKey.length > 1024)) return reply({ error: "请输入多模态审计专用 API Key。" }, 400);
    const id = "tokenhub-audit:" + await sha256Hex(user.id), now = new Date().toISOString(), expires = new Date(Date.now() + 60_000).toISOString();
    const allowed = await getD1().prepare(`INSERT INTO login_rate_limits (id, attempts, expires_at, updated_at) VALUES (?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN expires_at <= ? THEN 1 ELSE attempts+1 END,
      expires_at=CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END, updated_at=CURRENT_TIMESTAMP
      WHERE expires_at <= ? OR attempts < 10 RETURNING attempts`).bind(id, expires, now, now, now).first();
    if (!allowed) return reply({ error: "操作较频繁，请一分钟后重试。" }, 429);
    if (body.action === "start") return reply(await startAudit(runtimeEnv(), { apiKey: (body.apiKey as string).trim(), budgetMicros: 5_000_000 }));
    if (body.action === "pause") return reply(await pauseAudit(runtimeEnv()));
    if (body.action === "observe") { await refreshAuditCatalog(runtimeEnv()); return reply(await getAuditStatus(runtimeEnv())); }
    return reply(await runAuditTick(runtimeEnv(), { maxCases: 1 }));
  } catch (error) {
    return reply({ error: error instanceof AuditError ? error.message : "核验服务暂不可用，请稍后刷新查看状态。" }, error instanceof AuditError ? error.status : 503);
  }
}

export function GET(request: Request) { return handle(request); }
export function POST(request: Request) { return handle(request); }
