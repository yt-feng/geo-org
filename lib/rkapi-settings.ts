import { runtimeEnv, type RuntimeEnv } from "./config";
import { PricingError } from "./pricing";
import snapshot from "./rkapi-catalog-snapshot.json";

export const RKAPI_ORIGIN = "https://rkapi.com";
export type RkapiRoute = { group: string; apiKey: string; groupVerifiedAt: string; crossGroupRetry: false; modelIds: string[] };
export type RkapiConversion = { cnyPerQuota: number; cnyPerUsd: number; observedAt: string };
type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/** A browser login is not an API credential. Administrators must explicitly attest
 * the fixed group shown on each key before that key can enable requests. Never
 * accept inherited/automatic groups, whose final multiplier cannot be quoted. */
export function parseRkapiRoutes(value: string | undefined): RkapiRoute[] {
  if (!value) return [];
  try {
    if (value.length > 32_000) throw new Error();
    const parsed = JSON.parse(value);
    if (!object(parsed) || !Array.isArray(parsed.routes) || parsed.routes.length > 7) throw new Error();
    const groups = new Set<string>();
    return parsed.routes.map((route: unknown) => {
      if (!object(route) || typeof route.group !== "string" || !Object.hasOwn(snapshot.groupRatios, route.group) || groups.has(route.group)
        || typeof route.apiKey !== "string" || !/^[\x21-\x7e]{16,512}$/.test(route.apiKey)
        || route.crossGroupRetry !== false || typeof route.groupVerifiedAt !== "string" || !Number.isFinite(Date.parse(route.groupVerifiedAt))
        || Date.parse(route.groupVerifiedAt) > Date.now() + 60_000
        || !Array.isArray(route.modelIds) || !route.modelIds.length || route.modelIds.length > 100
        || route.modelIds.some(id => typeof id !== "string" || !snapshot.models.some(model => model.id === id && model.groups.includes(route.group as string)))) throw new Error();
      groups.add(route.group);
      return { group: route.group, apiKey: route.apiKey, groupVerifiedAt: route.groupVerifiedAt, crossGroupRetry: false as const, modelIds: Array.from(new Set(route.modelIds as string[])) };
    });
  } catch { throw new PricingError("tokvilo 精选服务配置待核对。", 503); }
}

async function json(response: Response): Promise<Json> {
  if (!response.ok || !response.body) throw new PricingError("tokvilo 精选暂时无法核验服务状态。", 503);
  const text = await response.text();
  if (text.length > 1_000_000) throw new PricingError("tokvilo 精选服务状态响应过长。", 503);
  try { const data = JSON.parse(text); if (!object(data) || data.success === false || data.error) throw new Error(); return data; }
  catch { throw new PricingError("tokvilo 精选服务状态格式不完整。", 503); }
}
let statusCache: { expires: number; value: RkapiConversion } | undefined;
export async function getRkapiConversion(fetcher: typeof fetch = fetch): Promise<RkapiConversion> {
  if (fetcher === fetch && statusCache && statusCache.expires > Date.now()) return statusCache.value;
  let raw: Json;
  try { raw = await json(await fetcher(`${RKAPI_ORIGIN}/api/status`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) })); }
  catch { throw new PricingError("tokvilo 精选暂时无法更新费率，请稍后重试。", 503); }
  const data = raw.data;
  if (!object(data) || data.quota_per_unit !== 500_000 || typeof data.price !== "number" || !Number.isFinite(data.price) || data.price <= 0 || data.price > 100
    || typeof data.usd_exchange_rate !== "number" || !Number.isFinite(data.usd_exchange_rate) || data.usd_exchange_rate < 1 || data.usd_exchange_rate > 100) throw new PricingError("tokvilo 精选币种换算待核对。", 503);
  const value = { cnyPerQuota: data.price, cnyPerUsd: data.usd_exchange_rate, observedAt: new Date().toISOString() };
  if (fetcher === fetch) statusCache = { expires: Date.now() + 60_000, value };
  return value;
}

// Cache a read-only model check; it never verifies a key's group by inference.
const routeChecks = new Map<string, { expires: number; models: string[] }>();
export async function verifiedRkapiRoutes(env: RuntimeEnv = runtimeEnv(), fetcher: typeof fetch = fetch): Promise<RkapiRoute[]> {
  const routes = parseRkapiRoutes(env.RKAPI_ROUTES_JSON);
  const checked = await Promise.all(routes.map(async route => {
    try {
      const cached = fetcher === fetch ? routeChecks.get(route.apiKey) : undefined;
      let ids: string[];
      if (cached && cached.expires > Date.now()) ids = cached.models;
      else {
        const data = await json(await fetcher(`${RKAPI_ORIGIN}/v1/models`, { headers: { Authorization: `Bearer ${route.apiKey}`, Accept: "application/json" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) }));
        if (!Array.isArray(data.data)) return null;
        ids = data.data.filter(object).map(row => row.id).filter((id): id is string => typeof id === "string");
        if (fetcher === fetch) { if (routeChecks.size > 16) routeChecks.clear(); routeChecks.set(route.apiKey, { expires: Date.now() + 60_000, models: ids }); }
      }
      const modelIds = route.modelIds.filter(id => ids.includes(id));
      return modelIds.length ? { ...route, modelIds } : null;
    } catch { return null; }
  }));
  return checked.filter((route): route is RkapiRoute => !!route);
}
