import { ACCESS_COOKIE, REFRESH_COOKIE, verifyAccessToken } from "@/lib/auth";
import { AuthInputError, readAuthPayload, requestCookie, providerSessionResponse } from "@/lib/auth-http";
import { AuthProviderError, authProviderRequest, authTokens } from "@/lib/auth-provider";

export const dynamic = "force-dynamic";
const reply = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export async function POST(request: Request): Promise<Response> {
  try {
    await readAuthPayload(request);
    const access = requestCookie(request, ACCESS_COOKIE);
    const refresh = requestCookie(request, REFRESH_COOKIE);
    if (access.startsWith("eco_admin.") || access.startsWith("tk_session_")) {
      const user = await verifyAccessToken(access);
      return user ? reply({ ok: true, authenticated: true }) : reply({ error: "请重新登录。" }, 401);
    }
    // Read exp only to decide when to rotate; it never authenticates a request.
    if (access) {
      let expires = 0;
      try {
        const encoded = access.split(".")[1];
        const payload = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
        expires = typeof payload.exp === "number" ? payload.exp : 0;
      } catch { /* malformed tokens go through the provider refresh path */ }
      if (expires > Date.now() / 1000 + 20 * 60 && await verifyAccessToken(access)) {
        return reply({ ok: true, authenticated: true });
      }
    }
    if (!refresh || refresh.length > 16_384) return reply({ error: "请重新登录。" }, 401);
    const result = await authProviderRequest("token?grant_type=refresh_token", { refresh_token: refresh });
    const tokens = authTokens(result);
    if (!tokens) throw new AuthProviderError("登录续期返回异常，请重新登录。", 503, "auth_invalid_response");
    return providerSessionResponse(request, tokens);
  } catch (cause) {
    const expected = cause instanceof AuthInputError || cause instanceof AuthProviderError;
    return reply({ error: expected ? cause.message : "登录续期暂不可用，请稍后重试。" }, expected ? cause.status : 503);
  }
}
