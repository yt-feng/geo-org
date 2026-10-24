import { getPortalUser } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/config";
import { apimartOpenApi } from "@/lib/apimart-openapi";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff" };

export async function GET(): Promise<Response> {
  if (!await getPortalUser()) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  return Response.json(apimartOpenApi(publicBaseUrl()), { headers });
}
