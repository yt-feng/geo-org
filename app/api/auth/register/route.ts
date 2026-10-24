import { AuthInputError, readAuthPayload, providerSessionResponse } from "@/lib/auth-http";
import { AuthProviderError, authProviderRequest, authTokens, record } from "@/lib/auth-provider";
import { getD1, publicBaseUrl } from "@/lib/config";
import { consumeLoginAttempt } from "@/lib/login-rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = await readAuthPayload(request);
    if (typeof payload.email !== "string" || typeof payload.password !== "string" ||
      (payload.displayName !== undefined && typeof payload.displayName !== "string")) throw new AuthInputError("邮箱、密码和显示名称的格式不正确。");
    const email = payload.email.trim().toLowerCase(), password = payload.password;
    const displayName = (payload.displayName as string | undefined)?.trim() || email.split("@")[0];
    if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) throw new AuthInputError("请输入有效的邮箱地址。");
    if (password.length < 10 || password.length > 512) throw new AuthInputError("密码长度须为 10 至 512 位。");
    if (displayName.length > 100) throw new AuthInputError("显示名称不能超过 100 个字符。");
    if (!await consumeLoginAttempt(request)) throw new AuthInputError("操作过于频繁，请稍后再试。", 429);
    const existing = await getD1().prepare("SELECT id FROM users WHERE lower(trim(email))=? LIMIT 1")
      .bind(email).first<{ id: string }>();
    if (existing) throw new AuthInputError("该邮箱已有本站账户，请直接登录；旧认证账户请联系管理员协助恢复。", 409);
    const redirectTo = encodeURIComponent(`${publicBaseUrl()}/login?verified=1`);
    const result = await authProviderRequest(`signup?redirect_to=${redirectTo}`, {
      email, password, data: { display_name: displayName },
    });
    const tokens = authTokens(result);
    if (tokens) return providerSessionResponse(request, tokens);
    if (result.access_token || record(result.session)) {
      throw new AuthProviderError("注册会话返回不完整，请尝试登录。", 503, "auth_invalid_response");
    }
    const user = record(result.user) || result;
    if (typeof user.id !== "string" || !user.id.trim()) {
      throw new AuthProviderError("注册服务返回异常，请稍后重试。", 503, "auth_invalid_response");
    }
    return Response.json({ ok: true, authenticated: false, requiresEmailVerification: true }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (cause) {
    const expected = cause instanceof AuthInputError || cause instanceof AuthProviderError;
    return Response.json({ error: expected ? cause.message : "暂时无法创建账户，请稍后重试。", code: expected && "code" in cause ? cause.code : "signup_failed" }, {
      status: expected ? cause.status : 503, headers: { "cache-control": "no-store" },
    });
  }
}
