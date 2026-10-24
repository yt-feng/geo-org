import { getPortalUser } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/config";
import { selectedOpenApi } from "@/lib/selected-openapi";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff" };
export async function GET() {
  if (!await getPortalUser()) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  return Response.json(selectedOpenApi(publicBaseUrl()), { headers });
}
