import { getPortalUser } from "@/lib/auth";
import { runtimeEnv } from "@/lib/config";
import { AuditEvidenceError, getAuditCaseEvidence, parseAuditEvidenceQuery } from "@/lib/tokenhub-audit-evidence";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
function reply(data: unknown, status = 200, extra?: Record<string, string>) { return Response.json(data, { status, headers: { ...headers, ...extra } }); }

export async function GET(request: Request) {
  try {
    const user = await getPortalUser();
    if (!user) return reply({ error: "请先登录管理员账户。" }, 401);
    if (!user.isAdmin) return reply({ error: "仅管理员可以查看核验底稿。" }, 403);
    const query = parseAuditEvidenceQuery(new URL(request.url).searchParams);
    const evidence = await getAuditCaseEvidence(runtimeEnv(), query);
    return reply(evidence, 200, query.download ? { "content-disposition": `attachment; filename="eco-geo-audit-day-${Math.floor(query.slot / 2) + 1}-slot-${query.slot}-${query.caseId.replaceAll(":", "-")}.json"` } : undefined);
  } catch (error) {
    return reply({ error: error instanceof AuditEvidenceError ? error.message : "底稿读取暂不可用，请稍后重试。" }, error instanceof AuditEvidenceError ? error.status : 503);
  }
}
