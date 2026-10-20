import { authBaseUrl, authRequestHeaders } from "./auth";

export class AuthProviderError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
    this.name = "AuthProviderError";
  }
}

const knownErrors: Record<string, [string, number]> = {
  signup_disabled: ["本站暂未开放新账户注册，请联系管理员。", 503],
  email_provider_disabled: ["邮箱注册暂未开启，请联系管理员。", 503],
  email_address_invalid: ["此邮箱地址无效，请检查后重试。", 400],
  email_address_not_authorized: ["邮件服务暂不支持向此邮箱发送验证邮件，请联系管理员。", 503],
  over_email_send_rate_limit: ["验证邮件发送过于频繁，请稍后再试。", 429],
  over_request_rate_limit: ["请求过于频繁，请稍后再试。", 429],
  user_already_exists: ["该邮箱已注册，请直接登录。", 400],
  email_exists: ["该邮箱已注册，请直接登录。", 400],
  email_not_confirmed: ["请先打开验证邮件完成邮箱确认，再返回登录。", 401],
  invalid_credentials: ["邮箱或密码不正确，请检查后重试。", 401],
  weak_password: ["密码强度不足，请使用更长且包含不同字符的密码。", 400],
  captcha_failed: ["注册验证未通过，请刷新页面重试或联系管理员。", 400],
  captcha_required: ["注册服务需要额外验证，请联系管理员。", 503],
  validation_failed: ["信息未通过校验，请检查邮箱和密码。", 400],
  refresh_token_not_found: ["登录已过期，请重新登录。", 401],
  refresh_token_already_used: ["登录已过期，请重新登录。", 401],
  session_not_found: ["登录已过期，请重新登录。", 401],
};

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export async function authProviderRequest(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  let base: string, headers: Headers;
  try { base = authBaseUrl(); headers = authRequestHeaders(); }
  catch { throw new AuthProviderError("认证服务尚未完成配置，请联系管理员。", 503, "auth_not_configured"); }
  const signal = AbortSignal.timeout(10_000);
  let response: Response, result: unknown;
  try {
    response = await fetch(`${base}/auth/v1/${path}`, {
      method: "POST", headers, body: JSON.stringify(payload),
      signal, redirect: "manual", cache: "no-store",
    });
    result = await response.json();
  } catch {
    throw new AuthProviderError(
      signal.aborted ? "认证服务响应超时，请稍后重试。" : "认证服务暂时无法连接或返回异常，请稍后重试。",
      503, signal.aborted ? "auth_timeout" : "auth_upstream_unavailable",
    );
  }
  const data = record(result);
  if (!response.ok) {
    const code = data?.error_code;
    if (typeof code === "string" && Object.hasOwn(knownErrors, code)) {
      const [message, status] = knownErrors[code];
      throw new AuthProviderError(message, status, code);
    }
    if (response.status === 429) throw new AuthProviderError("请求过于频繁，请稍后再试。", 429, "auth_rate_limited");
    if (response.status >= 500) throw new AuthProviderError("认证服务暂时无法完成请求或发送验证邮件，请稍后再试。", 503, "auth_upstream_unavailable");
    if (response.status === 401 || response.status === 403) throw new AuthProviderError("认证服务配置暂不可用，请联系管理员。", 503, "auth_credentials_rejected");
    throw new AuthProviderError("操作未成功，请检查填写的信息后重试。", 400, "auth_request_rejected");
  }
  if (!data) throw new AuthProviderError("认证服务返回异常，请稍后重试。", 503, "auth_invalid_response");
  return data;
}

export type AuthTokens = { accessToken: string; refreshToken: string; expiresIn: number };
export function authTokens(payload: Record<string, unknown>): AuthTokens | null {
  const source = record(payload.session) || payload;
  if (typeof source.access_token !== "string" || !source.access_token ||
    typeof source.refresh_token !== "string" || !source.refresh_token ||
    source.access_token.length > 16_384 || source.refresh_token.length > 16_384) return null;
  const seconds = typeof source.expires_in === "number" && Number.isFinite(source.expires_in) && source.expires_in > 0
    ? Math.floor(source.expires_in) : 3600;
  return { accessToken: source.access_token, refreshToken: source.refresh_token, expiresIn: Math.min(86400, seconds) };
}
