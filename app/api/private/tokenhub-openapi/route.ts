import { getPortalUser } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/config";
import { tokenHubOpenApi } from "@/lib/tokenhub-openapi";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff" };

export async function GET(): Promise<Response> {
  const user = await getPortalUser();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  if (!user.isAdmin) return Response.json({ error: "TokenHub API 文档仅向管理员开放。" }, { status: 403, headers });
  return Response.json(tokenHubOpenApi(publicBaseUrl()), { headers });
}
