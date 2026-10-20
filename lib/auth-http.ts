import { ACCESS_COOKIE, REFRESH_COOKIE } from "./auth";

export class AuthInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function readAuthPayload(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new AuthInputError("请从本站登录或注册页面提交。", 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new AuthInputError("请提交 JSON 格式。", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthInputError("请求内容为空。");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 16_384) { await reader.cancel(); throw new AuthInputError("请求内容过长。", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new AuthInputError("请求格式不正确。"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new AuthInputError("请求格式不正确。");
  return payload as Record<string, unknown>;
}

export function authCookie(name: string, value: string, seconds: number, secure: boolean): string {
  return [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", secure ? "Secure" : "", `Max-Age=${Math.max(0, Math.floor(seconds))}`].filter(Boolean).join("; ");
}

export function sessionResponse(request: Request, token: string, seconds: number): Response {
  const secure = new URL(request.url).protocol === "https:";
  const headers = new Headers({ "content-type": "application/json", "cache-control": "private, no-store" });
  headers.append("set-cookie", authCookie(ACCESS_COOKIE, token, seconds, secure));
  headers.append("set-cookie", authCookie(REFRESH_COOKIE, "", 0, secure));
  return new Response(JSON.stringify({ ok: true, authenticated: true, requiresEmailVerification: false }), { headers });
}

export function providerSessionResponse(
  request: Request,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number },
): Response {
  const secure = new URL(request.url).protocol === "https:";
  const headers = new Headers({ "content-type": "application/json", "cache-control": "private, no-store" });
  headers.append("set-cookie", authCookie(ACCESS_COOKIE, tokens.accessToken, tokens.expiresIn, secure));
  headers.append("set-cookie", authCookie(REFRESH_COOKIE, tokens.refreshToken, 30 * 24 * 60 * 60, secure));
  return new Response(JSON.stringify({ ok: true, authenticated: true, requiresEmailVerification: false }), { headers });
}

export function requestCookie(request: Request, name: string): string {
  const raw = (request.headers.get("cookie") || "").split(";").map(part => part.trim())
    .find(part => part.startsWith(`${name}=`));
  try { return raw ? decodeURIComponent(raw.slice(name.length + 1)) : ""; } catch { return ""; }
}
