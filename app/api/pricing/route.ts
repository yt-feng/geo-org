import { getTokenHubPricing, publicModelPrice } from "@/lib/pricing";
import { getApimartDisplayPricing } from "@/lib/apimart-display-pricing";

export async function GET() {
  const results = await Promise.allSettled([
    getTokenHubPricing().then(catalog => ({ ...catalog, models: catalog.models.map(model => ({
      ...publicModelPrice(model), billingReady: true,
    })) })),
    getApimartDisplayPricing(),
  ]);
  const sources = results.map((result, index) => ({
    provider: index === 0 ? "tokenhub" : "apimart",
    status: result.status === "fulfilled" ? "available" : "unavailable",
    observedAt: result.status === "fulfilled" ? result.value.observedAt : null,
    ...(result.status === "rejected" ? { message: "此服务实时价格暂不可用。" } : {}),
  }));
  const catalogs = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (!catalogs.length) return Response.json({ error: "实时价格暂不可用。", sources }, { status: 503, headers: { "cache-control": "no-store" } });
  return Response.json({
    currency: "USD", observedAt: new Date().toISOString(), sources,
    models: catalogs.flatMap<unknown>(catalog => catalog.models),
    unavailable: results.flatMap((result, index) => result.status === "fulfilled" ? result.value.unavailable.map(item => ({
      model: item.model, reason: "此模型暂未开放计费，请选择已标价模型。", provider: index === 0 ? "tokenhub" : "apimart",
    })) : []),
  }, { headers: { "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } });
}
