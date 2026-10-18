import { getPortalUser } from "@/lib/auth";
import { runtimeEnv } from "@/lib/config";
import { AuditEvidenceError, parseAuditEvidenceQuery } from "@/lib/tokenhub-audit-evidence";
import { AuditMediaError, archiveAuditCaseMedia, serveAuditMedia } from "@/lib/tokenhub-audit-media";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
function reply(data: unknown, status = 200) { return Response.json(data, { status, headers }); }
async function handle(request: Request) {
  try {
    const user = await getPortalUser();
    if (!user) return reply({ error: "请先登录管理员账户。" }, 401);
    if (!user.isAdmin) return reply({ error: "仅管理员可以查看核验媒体。" }, 403);
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(key => key !== "asset") || params.getAll("asset").length !== 1) return reply({ error: "媒体查询参数不正确。" }, 400);
      return await serveAuditMedia(runtimeEnv(), params.get("asset")!, request.headers.get("Range"));
    }
    if (request.headers.get("Origin") !== new URL(request.url).origin) return reply({ error: "请从本站底稿页面提交归档操作。" }, 403);
    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") return reply({ error: "请提交 JSON 请求。" }, 415);
    const reader = request.body?.getReader(); if (!reader) return reply({ error: "请求内容不能为空。" }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2048) { await reader.cancel(); return reply({ error: "请求内容过长。" }, 413); } chunks.push(value); } } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let payload: unknown; try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply({ error: "请求格式不正确。" }, 400); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return reply({ error: "请求格式不正确。" }, 400);
    const body = payload as Record<string, unknown>;
    if (Object.keys(body).some(key => !["campaign", "slot", "caseId"].includes(key)) || typeof body.campaign !== "string" || typeof body.caseId !== "string" || !Number.isInteger(body.slot)) return reply({ error: "请求参数不正确。" }, 400);
    const query = parseAuditEvidenceQuery(new URLSearchParams({ campaign: body.campaign, slot: String(body.slot), caseId: body.caseId }));
    // Existing artifacts only: this endpoint never submits a model request.
    return reply(await archiveAuditCaseMedia(runtimeEnv(), query));
  } catch (error) {
    return reply({ error: error instanceof AuditMediaError || error instanceof AuditEvidenceError ? error.message : "媒体归档暂不可用。" }, error instanceof AuditMediaError || error instanceof AuditEvidenceError ? error.status : 503);
  }
}
export function GET(request: Request) { return handle(request); }
export function POST(request: Request) { return handle(request); }
