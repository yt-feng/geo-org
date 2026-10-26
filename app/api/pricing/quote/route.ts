import { getPortalUser } from "@/lib/auth";
import { getD1 } from "@/lib/config";
import { getTokenHubPricing, quoteTokenHubRequest, PricingError, publicPriceRates } from "@/lib/pricing";
import { getApimartPricing, quoteApimartRequest } from "@/lib/apimart-pricing";
import { prepareRkapiRequest } from "@/lib/rkapi-pricing";
import { quoteFingerprint } from "@/lib/quote-fingerprint";

import { APIMART_PATHS, type ApimartKind } from "@/lib/apimart-request";
import { publicModelId } from "@/lib/model-id";

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
    if (!object(input) || Object.keys(input).some(key => !["provider", "mode", "body"].includes(key)) || !["tokenhub", "apimart", "selected"].includes(String(input.provider)) || !["chat", "image", "video", "audio"].includes(String(input.mode)) || !object(input.body)) return Response.json({ error: "请选择支持的服务、模型类型和请求参数。" }, { status: 400, headers });
    const body = input.body, mode = input.mode as ApimartKind;
    if (typeof body.model !== "string" || !body.model.trim() || body.model.length > 200 || body.stream) return Response.json({ error: "请填写有效模型并使用非流式请求。" }, { status: 400, headers });
    if (mode === "chat" && (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 200) ||
        mode === "image" && (typeof body.prompt !== "string" || !body.prompt.trim()) ||
        input.provider === "tokenhub" && mode === "video" && (!Array.isArray(body.content) || body.content.length < 1 || body.content.length > 32)) return Response.json({ error: "请填写所选模型需要的内容。" }, { status: 400, headers });
    const now = new Date().toISOString(), expires = new Date(Date.now() + 60_000).toISOString();
    const allowed = await getD1().prepare(`INSERT INTO login_rate_limits(id,attempts,expires_at,updated_at) VALUES(?,1,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END,updated_at=CURRENT_TIMESTAMP
      WHERE expires_at<=? OR attempts<10 RETURNING attempts`).bind(`price-quote:${user.id}`, expires, now, now, now).first();
    if (!allowed) return Response.json({ error: "报价请求较频繁，请一分钟后重试。" }, { status: 429, headers });
    if (input.provider === "selected") {
      if (mode !== "chat" && mode !== "image") throw new PricingError("tokvilo 精选暂未开放此接口。", 422);
      const { quote, basis } = await prepareRkapiRequest(body);
      if (quote.kind !== mode) throw new PricingError("模型与所选接口不匹配。", 400);
      return Response.json({ provider: "selected", model: quote.model, mode, currency: "USD", observedAt: quote.observedAt, reservedMicrousd: quote.reservedMicrousd, quoteFingerprint: await quoteFingerprint({ quote, basis }),
        rates: quote.rates.map(({ dimension, unit, retailMicrousd, label, condition }) => ({ dimension, unit, retailMicrousd, label, condition })) }, { headers });
    }
    if (input.provider === "tokenhub") {
      if (mode === "audio") throw new PricingError("此接口尚未开通音乐生成。", 422);
      const quote = quoteTokenHubRequest(await getTokenHubPricing(), mode, body);
      return Response.json({ provider: "tokenhub", model: quote.model, mode, currency: "USD", observedAt: quote.observedAt, reservedMicrousd: quote.reservedMicrousd, quoteFingerprint: await quoteFingerprint(quote), rates: publicPriceRates(quote.rates), dimension: quote.dimension }, { headers });
    }
    const catalog = await getApimartPricing();
    const quote = quoteApimartRequest(body, APIMART_PATHS[mode], catalog);
    return Response.json({ provider: "apimart", model: publicModelId(quote.model), mode, currency: "USD", observedAt: quote.observedAt, reservedMicrousd: quote.amountMicrousd, quoteFingerprint: await quoteFingerprint(quote), rates: publicPriceRates(catalog.models.find(model => model.model === quote.model)?.rates || []) }, { headers });
  } catch (cause) {
    return Response.json({ error: cause instanceof PricingError ? cause.message : "报价暂不可用，请稍后重试。" }, { status: cause instanceof PricingError ? cause.status : 503, headers });
  }
}
