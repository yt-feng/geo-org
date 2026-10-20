import { getPortalUser } from "@/lib/auth";
import { getD1 } from "@/lib/config";
import { getTokenHubPricing, quoteTokenHubRequest, PricingError } from "@/lib/pricing";
import { getApimartPricing, quoteApimartRequest } from "@/lib/apimart-pricing";

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export async function POST(request: Request) {
  try {
    const user = await getPortalUser();
    if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });
    if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "请从本站工作台获取报价。" }, { status: 403, headers });
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ error: "请提交 JSON 请求。" }, { status: 415, headers });
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "请求内容为空。" }, { status: 400, headers });
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > 128_000) { await reader.cancel(); return Response.json({ error: "报价请求超过大小限制。" }, { status: 413, headers }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let input;
    try { input = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return Response.json({ error: "请求格式不正确。" }, { status: 400, headers }); }
    if (!object(input) || Object.keys(input).some(key => !["provider", "mode", "body"].includes(key)) || !["tokenhub", "apimart"].includes(String(input.provider)) || !["chat", "image", "video"].includes(String(input.mode)) || !object(input.body)) return Response.json({ error: "请选择支持的上游、模型类型和请求参数。" }, { status: 400, headers });
    const body = input.body, mode = input.mode as "chat" | "image" | "video";
    if (typeof body.model !== "string" || !body.model.trim() || body.model.length > 200 || body.stream) return Response.json({ error: "请填写有效模型并使用非流式请求。" }, { status: 400, headers });
    if (mode === "chat" && (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 200) ||
        mode === "image" && (typeof body.prompt !== "string" || !body.prompt.trim()) ||
        mode === "video" && (!Array.isArray(body.content) || body.content.length < 1 || body.content.length > 32)) return Response.json({ error: "请填写所选模型需要的内容。" }, { status: 400, headers });
    const now = new Date().toISOString(), expires = new Date(Date.now() + 60_000).toISOString();
    const allowed = await getD1().prepare(`INSERT INTO login_rate_limits(id,attempts,expires_at,updated_at) VALUES(?,1,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END,updated_at=CURRENT_TIMESTAMP
      WHERE expires_at<=? OR attempts<10 RETURNING attempts`).bind(`price-quote:${user.id}`, expires, now, now, now).first();
    if (!allowed) return Response.json({ error: "报价请求较频繁，请一分钟后重试。" }, { status: 429, headers });
    if (input.provider === "tokenhub") {
      const quote = quoteTokenHubRequest(await getTokenHubPricing(), mode, body);
      return Response.json({ provider: "tokenhub", model: quote.model, mode, currency: "USD", markupPercent: 20, observedAt: quote.observedAt, reservedMicrousd: quote.reservedMicrousd, rates: quote.rates, dimension: quote.dimension }, { headers });
    }
    if (mode === "video") throw new PricingError("此视频上游尚未开通计费。", 409);
    const catalog = await getApimartPricing();
    const quote = quoteApimartRequest(body, mode === "chat" ? "/v1/chat/completions" : "/v1/images/generations", catalog);
    return Response.json({ provider: "apimart", model: quote.model, mode, currency: "USD", markupPercent: 20, observedAt: quote.observedAt, reservedMicrousd: quote.amountMicrousd, rates: catalog.models.find(model => model.model === quote.model)?.rates }, { headers });
  } catch (cause) {
    return Response.json({ error: cause instanceof PricingError ? cause.message : "报价暂不可用，请稍后重试。" }, { status: cause instanceof PricingError ? cause.status : 503, headers });
  }
}
