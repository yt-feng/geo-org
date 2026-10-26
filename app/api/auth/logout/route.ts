import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth";
import { authCookie } from "@/lib/auth-http";
import { revokeLocalSession } from "@/lib/local-auth";

export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "请从本站退出登录。" }, { status: 403 });
  const raw = (request.headers.get("cookie") || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${ACCESS_COOKIE}=`));
  let token = "";
  try { token = raw ? decodeURIComponent(raw.slice(ACCESS_COOKIE.length + 1)) : ""; } catch { /* malformed cookie is cleared below */ }
  if (token.startsWith("tk_session_")) {
    try { await revokeLocalSession(token); } catch { return Response.json({ error: "退出登录未完成，请重试。" }, { status: 503 }); }
  }
  const secure = new URL(request.url).protocol === "https:", headers = new Headers({ "content-type": "application/json", "cache-control": "private, no-store" });
  headers.append("set-cookie", authCookie(ACCESS_COOKIE, "", 0, secure));
  headers.append("set-cookie", authCookie(REFRESH_COOKIE, "", 0, secure));
  return new Response(JSON.stringify({ ok: true }), { headers });
}
