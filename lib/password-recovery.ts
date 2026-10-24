import { ACCESS_COOKIE, REFRESH_COOKIE, authBaseUrl } from "./auth";
import { AuthInputError, authCookie, readAuthPayload, requestCookie } from "./auth-http";
import { AuthProviderError, authProviderRequest, authTokens, record } from "./auth-provider";
import { getD1, publicBaseUrl, runtimeEnv } from "./config";
import { sha256Hex } from "./crypto";
import { consumeLoginAttempt } from "./login-rate-limit";
import { decryptProviderKey, encryptProviderKey } from "./provider-settings";

const RECOVERY_COOKIE = "tokvilo_password_recovery";
const COOKIE_PATH = "/api/auth/reset-password";
const GRANT_SECONDS = 10 * 60;
const GENERIC_NOTICE = "如果该邮箱可用于找回密码，我们会发送恢复邮件。请检查收件箱与垃圾邮件；如未收到，请稍后再试或联系管理员。";
const INVALID_GRANT = "恢复授权不存在、已过期或已使用，请重新申请找回密码。";
type Grant = {
  id: string;
  user_id: string;
  encrypted_access_token: string;
  expires_at: number;
};
const nowSeconds = () => Math.floor(Date.now() / 1000);
const purpose = (id: string, providerHash: string) => `tokvilo/password-recovery/v1/${providerHash}/${id}`;
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");

function response(payload: Record<string, unknown>, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ "cache-control": "private, no-store", "referrer-policy": "no-referrer" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return Response.json(payload, { status, headers });
}

function resetCookie(request: Request, token: string, seconds: number): string {
  return authCookie(RECOVERY_COOKIE, token, seconds, new URL(request.url).protocol === "https:")
    .replace("Path=/;", `Path=${COOKIE_PATH};`).replace("SameSite=Lax", "SameSite=Strict");
}

function clearedCookies(request: Request): string[] {
  const secure = new URL(request.url).protocol === "https:";
  return [resetCookie(request, "", 0), authCookie(ACCESS_COOKIE, "", 0, secure), authCookie(REFRESH_COOKIE, "", 0, secure)];
}

function failure(cause: unknown): Response {
  const expected = cause instanceof AuthInputError || cause instanceof AuthProviderError;
  return response({
    error: expected ? cause.message : "恢复服务暂不可用，请稍后重试。",
    code: cause instanceof AuthProviderError ? cause.code : "password_recovery_failed",
  }, expected ? cause.status : 503);
}

async function providerHash(): Promise<string> {
  try { return await sha256Hex(authBaseUrl()); }
  catch { throw new AuthProviderError("认证服务尚未完成配置，请联系管理员。", 503, "auth_not_configured"); }
}

async function consumeEmailAttempt(email: string): Promise<boolean> {
  const now = nowSeconds(), window = Math.floor(now / 3600);
  const id = await sha256Hex(`tokvilo/recovery/email/${window}/${email}`);
  const row = await getD1().prepare(`INSERT INTO auth_recovery_email_limits(id,attempts,expires_at)
    VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1
    WHERE attempts < 3 RETURNING attempts`).bind(id, (window + 1) * 3600).first();
  return Boolean(row);
}

export async function handleForgotPassword(request: Request): Promise<Response> {
  try {
    const payload = await readAuthPayload(request);
    if (typeof payload.email !== "string") throw new AuthInputError("请输入有效的邮箱地址。");
    const email = payload.email.trim().toLowerCase();
    if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) throw new AuthInputError("请输入有效的邮箱地址。");
    if (!await consumeLoginAttempt(request)) throw new AuthInputError("操作过于频繁，请稍后再试。", 429);
    // Check configuration before an account-dependent request. Provider replies,
    // including account-specific delivery failures, share the same public result.
    await providerHash();
    if (await consumeEmailAttempt(email)) {
      try {
        await authProviderRequest(`recover?redirect_to=${encodeURIComponent(`${publicBaseUrl()}/reset-password`)}`, { email });
      } catch (cause) {
        if (!(cause instanceof AuthProviderError) || cause.code === "auth_not_configured") throw cause;
      }
    }
    return response({ ok: true, message: GENERIC_NOTICE });
  } catch (cause) { return failure(cause); }
}

async function grantIdentity(request: Request): Promise<{ id: string; provider: string }> {
  const token = requestCookie(request, RECOVERY_COOKIE);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new AuthProviderError(INVALID_GRANT, 401, "recovery_expired");
  return { id: await sha256Hex(token), provider: await providerHash() };
}

async function verifyRecovery(request: Request, tokenHash: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{32,512}$/.test(tokenHash)) throw new AuthInputError("恢复链接格式不正确，请重新申请找回密码。");
  const provider = await providerHash(), secret = runtimeEnv().ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new AuthProviderError("恢复服务尚未配置完成，请联系管理员。", 503, "recovery_not_configured");
  const recoveryHash = await sha256Hex(`${provider}/${tokenHash}`);
  const existing = await getD1().prepare("SELECT id FROM auth_password_recovery WHERE recovery_hash=?").bind(recoveryHash).first();
  if (existing) throw new AuthProviderError(INVALID_GRANT, 401, "recovery_expired");
  const result = await authProviderRequest("verify", { token_hash: tokenHash, type: "recovery" });
  const tokens = authTokens(result), user = record(result.user) || record(record(result.session)?.user);
  if (!tokens || typeof user?.id !== "string" || !user.id || user.id.length > 200) {
    throw new AuthProviderError("恢复服务返回异常，请重新申请恢复邮件。", 503, "auth_invalid_response");
  }
  const token = randomToken(), id = await sha256Hex(token);
  const ciphertext = await encryptProviderKey(tokens.accessToken, secret, purpose(id, provider));
  const now = nowSeconds(), seconds = Math.min(GRANT_SECONDS, tokens.expiresIn);
  await getD1().prepare(`INSERT INTO auth_password_recovery
    (id,provider_hash,recovery_hash,user_id,encrypted_access_token,state,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,'ready',?,?,?)`)
    .bind(id, provider, recoveryHash, user.id, ciphertext, now + seconds, now, now).run();
  // Recovery tokens never become normal login cookies or browser JSON data.
  return response({ ok: true, ready: true }, 200, [resetCookie(request, token, seconds)]);
}

async function readyGrant(request: Request): Promise<Response> {
  const { id, provider } = await grantIdentity(request);
  const row = await getD1().prepare(`SELECT id FROM auth_password_recovery
    WHERE id=? AND provider_hash=? AND state='ready' AND expires_at>?`)
    .bind(id, provider, nowSeconds()).first();
  if (!row) throw new AuthProviderError(INVALID_GRANT, 401, "recovery_expired");
  return response({ ok: true, ready: true });
}

async function updatePassword(request: Request, password: string): Promise<Response> {
  if (password.length < 10 || password.length > 512) throw new AuthInputError("密码长度须为 10 至 512 位。");
  const { id, provider } = await grantIdentity(request), now = nowSeconds();
  const grant = await getD1().prepare(`UPDATE auth_password_recovery SET state='processing',updated_at=?
    WHERE id=? AND provider_hash=? AND state='ready' AND expires_at>?
      AND NOT EXISTS (SELECT 1 FROM auth_password_recovery busy
        WHERE busy.provider_hash=auth_password_recovery.provider_hash
          AND busy.user_id=auth_password_recovery.user_id AND busy.state='processing' AND busy.expires_at>?)
    RETURNING id,user_id,encrypted_access_token,expires_at`)
    .bind(now, id, provider, now, now).first<Grant>();
  if (!grant) throw new AuthProviderError(INVALID_GRANT, 401, "recovery_expired");
  let accessToken: string;
  try {
    accessToken = await decryptProviderKey(grant.encrypted_access_token, runtimeEnv().ADMIN_SESSION_SECRET, purpose(id, provider));
  } catch {
    await getD1().prepare("UPDATE auth_password_recovery SET state='expired',encrypted_access_token='',updated_at=? WHERE id=?")
      .bind(nowSeconds(), id).run();
    throw new AuthProviderError(INVALID_GRANT, 401, "recovery_expired");
  }
  try {
    const user = await authProviderRequest("user", { password }, { method: "PUT", accessToken });
    if (user.id !== grant.user_id) throw new AuthProviderError("密码修改结果暂无法确认，请先尝试用新密码登录，或重新申请恢复邮件。", 503, "recovery_result_unknown", true);
  } catch (cause) {
    const retryable = cause instanceof AuthProviderError && !cause.outcomeUnknown &&
      ["weak_password", "same_password", "validation_failed"].includes(cause.code);
    await getD1().prepare(`UPDATE auth_password_recovery SET state=?,encrypted_access_token=?,updated_at=?
      WHERE id=? AND state='processing'`)
      .bind(retryable ? "ready" : "unknown", retryable ? grant.encrypted_access_token : "", nowSeconds(), id).run();
    if (retryable) throw cause;
    return response({
      error: "密码修改结果暂无法确认，请先尝试用新密码登录，或重新申请恢复邮件。",
      code: "recovery_result_unknown",
    }, 503, clearedCookies(request));
  }
  let sessionsRevoked = false;
  try {
    await authProviderRequest("logout?scope=global", {}, { accessToken, emptyResponse: true });
    sessionsRevoked = true;
  } catch { /* Password update succeeded; never report it as a failed update. */ }
  // Even if recording this receipt fails, the claimed grant cannot be reused;
  // the confirmed provider password change must still be reported accurately.
  try {
    await getD1().prepare(`UPDATE auth_password_recovery SET
      state=CASE WHEN id=? THEN 'completed' ELSE 'expired' END,encrypted_access_token='',updated_at=?
      WHERE provider_hash=? AND user_id=? AND (id=? OR state='ready')`)
      .bind(id, nowSeconds(), provider, grant.user_id, id).run();
  } catch { /* A processing grant remains unavailable until it expires. */ }
  return response({
    ok: true, passwordReset: true, sessionsRevoked,
    message: sessionsRevoked ? "密码已重置，请使用新密码登录。" : "密码已重置，请使用新密码登录。其他设备的会话注销暂未确认。",
  }, 200, clearedCookies(request));
}

export async function handleResetPassword(request: Request): Promise<Response> {
  try {
    const payload = await readAuthPayload(request);
    if (!await consumeLoginAttempt(request)) throw new AuthInputError("操作过于频繁，请稍后再试。", 429);
    const fields = Object.keys(payload);
    if (fields.length === 0) return await readyGrant(request);
    if (fields.length === 1 && typeof payload.tokenHash === "string") return await verifyRecovery(request, payload.tokenHash);
    if (fields.length === 1 && typeof payload.password === "string") return await updatePassword(request, payload.password);
    throw new AuthInputError("恢复请求格式不正确，请重新打开邮件中的链接。");
  } catch (cause) { return failure(cause); }
}
