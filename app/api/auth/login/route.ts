import { createAdminSession } from "@/lib/auth";
import { authenticateLocalAccount, createLocalSession, hasLocalAccount } from "@/lib/local-auth";
import { AuthInputError, readAuthPayload, sessionResponse, providerSessionResponse } from "@/lib/auth-http";
import { AuthProviderError, authProviderRequest, authTokens } from "@/lib/auth-provider";
import { consumeLoginAttempt } from "@/lib/login-rate-limit";

export const dynamic = "force-dynamic";
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = await readAuthPayload(request);
    if (typeof payload.email !== "string" || typeof payload.password !== "string") throw new AuthInputError("请输入账号和密码。");
    const email = payload.email.trim().toLowerCase(), password = payload.password;
    if (!email || email.length > 254 || !password || password.length > 512) throw new AuthInputError("账号或密码格式不正确。");
    if (!await consumeLoginAttempt(request)) return errorResponse("登录尝试过于频繁，请稍后重试。", 429);
    const adminSession = await createAdminSession(email, password);
    if (adminSession) return sessionResponse(request, adminSession, 60 * 60 * 12);
    if (await hasLocalAccount(email)) {
      const user = await authenticateLocalAccount(email, password);
      if (!user) return errorResponse("账号或密码不正确，或账号已停用。", 401);
      return sessionResponse(request, await createLocalSession(user.id), 7 * 24 * 60 * 60);
    }
    const result = await authProviderRequest("token?grant_type=password", { email, password });
    const tokens = authTokens(result);
    if (!tokens) return errorResponse("登录服务返回异常，请稍后重试。", 503);
    return providerSessionResponse(request, tokens);
  } catch (cause) {
    const expected = cause instanceof AuthInputError || cause instanceof AuthProviderError;
    return errorResponse(expected ? cause.message : "登录服务暂不可用，请稍后重试。", expected ? cause.status : 503);
  }
}
