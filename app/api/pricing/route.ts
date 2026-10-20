import { getTokenHubPricing, PricingError } from "@/lib/pricing";
import { getApimartPricing } from "@/lib/apimart-pricing";

export async function GET() {
  const results = await Promise.allSettled([getTokenHubPricing(), getApimartPricing()]);
  const sources = results.map((result, index) => ({
    provider: index === 0 ? "tokenhub" : "apimart",
    status: result.status === "fulfilled" ? "available" : "unavailable",
    observedAt: result.status === "fulfilled" ? result.value.observedAt : null,
    ...(result.status === "rejected" ? { message: result.reason instanceof PricingError ? result.reason.message : "此上游实时价格暂不可用。" } : {}),
  }));
  const catalogs = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (!catalogs.length) return Response.json({ error: "实时价格暂不可用。", sources }, { status: 503, headers: { "cache-control": "no-store" } });
  return Response.json({
    currency: "USD", markupPercent: 20, observedAt: new Date().toISOString(), sources,
    models: catalogs.flatMap(catalog => catalog.models),
    unavailable: results.flatMap((result, index) => result.status === "fulfilled" ? result.value.unavailable.map(item => ({ ...item, provider: index === 0 ? "tokenhub" : "apimart" })) : []),
  }, { headers: { "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } });
}
