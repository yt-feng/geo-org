import { markupMicrousd, PricingError } from "./pricing";

export const APIMART_PRICE_SOURCE = "https://apimart.ai/api/pricing/models/all";
type Json = Record<string, unknown>;
export type ApimartRate = { dimension: string; unit: "1M_tokens" | "image"; upstreamMicrousd: number; retailMicrousd: number };
export type ApimartPrice = { provider: "apimart"; model: string; name: string; kind: "chat" | "image"; rates: ApimartRate[]; available: true };
export type ApimartQuote = { kind: "chat" | "image"; model: string; amountMicrousd: number; upstreamRates: Record<string, number>; observedAt: string; inputTokenLimit?: number; outputTokenLimit?: number };
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
function micro(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100_000) throw new PricingError("APIMart 定价金额无效。", 502);
  return Math.ceil(value * 1_000_000 - 1e-8);
}
function rate(dimension: string, unit: ApimartRate["unit"], value: unknown): ApimartRate {
  const upstreamMicrousd = micro(value);
  return { dimension, unit, upstreamMicrousd, retailMicrousd: markupMicrousd(upstreamMicrousd) };
}
function markedTokenTotal(terms: Array<[number, number]>) {
  const numerator = terms.reduce((sum, [count, upstreamRate]) => sum + BigInt(count) * BigInt(markupMicrousd(upstreamRate)), BigInt(0));
  return Number((numerator + BigInt(999_999)) / BigInt(1_000_000));
}

/** Read the same public structured catalog used by APIMart's official pricing page. */
export function parseApimartPricing(payload: unknown) {
  if (!object(payload) || payload.success !== true || !object(payload.data) || !object(payload.data.models)) throw new PricingError("APIMart 定价目录暂不可用。", 502);
  const models: ApimartPrice[] = [], unavailable: { provider: "apimart"; model: string; reason: string }[] = [];
  for (const [category, items] of Object.entries(payload.data.models)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!object(item) || typeof item.id !== "string" || !item.id || item.id.length > 200) continue;
      let rates: ApimartRate[] = [], kind: "chat" | "image" | null = null;
      const price = item.pricing, fixed = item.fixed_prices;
      if (category === "llm" && object(price) && price.unit === "usd_per_million_tokens" && price.pricing_mode === "standard"
        && price.tier_count === 1 && !price.time_pricing && !price.extras && object(price.effective_rates)
        && Object.keys(price.effective_rates).every(key => ["input", "cached_input", "output"].includes(key))
        && typeof price.effective_rates.input === "number" && typeof price.effective_rates.output === "number") {
        rates = Object.entries(price.effective_rates).map(([name, value]) => rate(name, "1M_tokens", value));
        kind = "chat";
      } else if (category === "image" && object(fixed) && fixed.unit === "usd_per_image"
        && ["resolution", "default"].includes(String(fixed.dimension)) && Array.isArray(fixed.items)
        && !item.input_material_prices && !item.token_settlement_prices) {
        rates = fixed.items.filter(object).filter(entry => typeof entry.key === "string").map(entry => rate(String(entry.key).toLowerCase(), "image", entry.after_discount));
        if (rates.length && new Set(rates.map(entry => entry.dimension)).size === rates.length) kind = "image";
      }
      if (kind && rates.length) models.push({ provider: "apimart", model: item.id, name: typeof item.name === "string" ? item.name : item.id, kind, rates, available: true });
      else unavailable.push({ provider: "apimart", model: item.id, reason: "此模型的计费参数尚未开通，请选择已标价模型。" });
    }
  }
  if (!models.length) throw new PricingError("APIMart 暂未返回可用定价。", 502);
  return { observedAt: new Date().toISOString(), source: APIMART_PRICE_SOURCE, models, unavailable };
}

export async function getApimartPricing(fetcher: typeof fetch = fetch) {
  let response: Response;
  try { response = await fetcher(APIMART_PRICE_SOURCE, { headers: { Accept: "application/json" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000) }); }
  catch { throw new PricingError("暂时无法读取 APIMart 定价，请稍后重试。", 503); }
  if (!response.ok || !response.body) throw new PricingError("APIMart 定价服务暂不可用。", 503);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 4_000_000) { await reader.cancel(); throw new PricingError("APIMart 定价目录过大。", 502); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new PricingError("APIMart 定价格式无效。", 502); }
  return parseApimartPricing(data);
}

export function quoteApimartRequest(body: Json, path: string, catalog: Awaited<ReturnType<typeof getApimartPricing>>): ApimartQuote {
  const selected = catalog.models.find(item => item.model === body.model);
  const kind = path === "/v1/chat/completions" ? "chat" : "image";
  if (!selected || selected.kind !== kind) throw new PricingError("所选模型尚未开通此接口的计费，请选择已标价模型。", 422);
  const upstreamRates = Object.fromEntries(selected.rates.map(item => [item.dimension, item.upstreamMicrousd]));
  if (kind === "image") {
    const dimension = typeof body.resolution === "string" ? body.resolution.toLowerCase() : "default";
    const price = upstreamRates[dimension] ?? (Object.keys(upstreamRates).length === 1 ? upstreamRates.default : undefined);
    if (price === undefined) throw new PricingError("此图片分辨率尚无已核实的价格。", 422);
    return { kind, model: String(body.model), amountMicrousd: markupMicrousd(price), upstreamRates, observedAt: catalog.observedAt };
  }
  const inputTokenLimit = new TextEncoder().encode(JSON.stringify(body.messages)).byteLength + (body.messages as unknown[]).length * 32 + 256;
  const outputTokenLimit = Number(body.max_completion_tokens ?? body.max_tokens ?? 1024);
  const amountMicrousd = markedTokenTotal([[inputTokenLimit, upstreamRates.input], [outputTokenLimit, upstreamRates.output]]);
  return { kind, model: String(body.model), amountMicrousd, upstreamRates, observedAt: catalog.observedAt, inputTokenLimit, outputTokenLimit };
}

export function apimartChatCharge(quote: ApimartQuote, response: Json): number {
  const data = object(response.data) ? response.data : response;
  if (data.model !== undefined && data.model !== quote.model) throw new PricingError("上游返回模型与报价不一致，预留金额等待核对。", 502);
  const usage = data.usage;
  if (!object(usage) || !Number.isSafeInteger(usage.prompt_tokens) || Number(usage.prompt_tokens) < 0
    || !Number.isSafeInteger(usage.completion_tokens) || Number(usage.completion_tokens) < 0) throw new PricingError("上游未返回完整用量，预留金额等待核对。", 502);
  const prompt = Number(usage.prompt_tokens), completion = Number(usage.completion_tokens);
  if (usage.total_tokens !== undefined && usage.total_tokens !== prompt + completion) throw new PricingError("上游总用量不一致，预留金额等待核对。", 502);
  const details = object(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const cached = Number(details.cached_tokens ?? 0);
  if (!Number.isSafeInteger(cached) || cached < 0 || cached > prompt || prompt > Number(quote.inputTokenLimit) || completion > Number(quote.outputTokenLimit)) throw new PricingError("上游用量超出已确认范围，预留金额等待核对。", 502);
  const rates = quote.upstreamRates;
  return markedTokenTotal([[prompt - cached, rates.input], [cached, rates.cached_input ?? rates.input], [completion, rates.output]]);
}

export function apimartTaskCharge(data: Json): number {
  // APIMart's task endpoint reports `cost` in USD, separate from `credits_cost`.
  if (typeof data.cost !== "number" || !Number.isFinite(data.cost) || data.cost < 0) throw new PricingError("任务尚未返回结算金额，预留金额等待核对。", 502);
  return markupMicrousd(micro(data.cost));
}
