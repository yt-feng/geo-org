import { getPortalUser } from "./auth";
import { getD1, runtimeEnv } from "./config";
import { sha256Hex } from "./crypto";
import { ProviderError } from "./provider-settings";
import { createTokenHubSettings } from "./tokenhub-settings";

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
function reply(data: unknown, status = 200) { return Response.json(data, { status, headers }); }

export async function handleTokenHubProviderRequest(request: Request, action: "status" | "save" | "test" | "models"): Promise<Response> {
  try {
    const user = await getPortalUser();
    if (!user) return reply({ error: "请先登录管理员账户。" }, 401);
    if (!user.isAdmin) return reply({ error: "仅管理员可以管理上游服务。" }, 403);
    if (request.method !== (action === "save" || action === "test" ? "POST" : "GET")) return reply({ error: "不支持此请求方法。" }, 405);
    if (request.method === "POST" && request.headers.get("Origin") !== new URL(request.url).origin) return reply({ error: "请从本站管理后台提交配置。" }, 403);
    if (action !== "status") {
      // Share the existing provider-management rate limit across upstreams.
      const id = "provider:" + await sha256Hex(user.id), now = new Date().toISOString(), expires = new Date(Date.now() + 60_000).toISOString();
      const allowed = await getD1().prepare(`INSERT INTO login_rate_limits (id, attempts, expires_at, updated_at) VALUES (?, 1, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN expires_at <= ? THEN 1 ELSE attempts+1 END,
        expires_at=CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END, updated_at=CURRENT_TIMESTAMP
        WHERE expires_at <= ? OR attempts < 10 RETURNING attempts`).bind(id, expires, now, now, now).first();
      if (!allowed) return reply({ error: "操作较频繁，请一分钟后重试。" }, 429);
    }
    const service = createTokenHubSettings(runtimeEnv());
    if (action === "status") return reply({ tokenhub: await service.status() });
    if (action === "test") return reply(await service.test());
    if (action === "models") return reply(await service.models());
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return reply({ error: "请提交 JSON 格式的配置。" }, 415);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "请输入 API Key。" }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2048) { await reader.cancel(); return reply({ error: "提交内容过长。" }, 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply({ error: "配置格式不正确。" }, 400); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some(k => k !== "apiKey")) return reply({ error: "配置格式不正确。" }, 400);
    return reply(await service.save(payload.apiKey));
  } catch (error) {
    return reply({ error: error instanceof ProviderError ? error.message : "配置服务暂不可用，请稍后重试。" }, error instanceof ProviderError ? error.status : 503);
  }
}
