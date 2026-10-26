import { publicModelId } from "./model-id";
import { valueRetailMicrousd, VALUE_PRICING_VERSION } from "./value-pricing";

// Monetary values are integer micro-USD. Display and settlement use the same
// marked-up rates; the final request total is rounded up only once.
export const MARKUP_PERCENT = 20;
export class PricingError extends Error {
  constructor(message: string, public status = 503) { super(message); this.name = "PricingError"; }
}
export type PriceRate = {
  dimension: string; unit: "1M_tokens" | "image";
  upstreamMicrousd: number; retailMicrousd: number;
};
export type ModelPrice = {
  provider: "tokenhub" | "apimart"; model: string; name: string;
  kind: "chat" | "image" | "video"; rates: PriceRate[]; available: true;
};
export type PublicPriceRate = { dimension: string; unit: PriceRate["unit"] | "second" | "call"; retailMicrousd: number };
export type PublicModelPrice = Omit<ModelPrice, "kind" | "rates"> & { kind: ModelPrice["kind"] | "audio"; rates: PublicPriceRate[] };
/** Explicit allowlists keep internal rates and any future supplier metadata off public APIs. */
export function publicPriceRates(rates: readonly PublicPriceRate[]): PublicPriceRate[] {
  return rates.map(({ dimension, unit, retailMicrousd }) => ({ dimension, unit, retailMicrousd }));
}
export function publicModelPrice(model: PublicModelPrice): PublicModelPrice {
  return { provider: model.provider, model: publicModelId(model.model), name: publicServiceText(publicModelId(model.name)), kind: model.kind,
    available: model.available, rates: publicPriceRates(model.rates) };
}
const INTERNAL_PRICE_KEYS = /^(?:markup(?:_?percent)?|upstream(?:_?(?:microusd|rates|price|cost))|source_?(?:price|cost|url)|cost|credits_cost|(?:input|output|total|cache|prompt|completion)_cost)$/i;
/** Scrub service metadata, including saved receipts, while preserving generated content. */
export function publicRelayResponse(value: unknown): unknown {
  if (!object(value)) return value;
  const result: Json = {};
  for (const [key, entry] of Object.entries(value)) {
    if (INTERNAL_PRICE_KEYS.test(key)) continue;
    if (["data", "usage", "billing", "tokvilo_billing", "pricing", "rates"].includes(key)) {
      result[key] = Array.isArray(entry) ? entry.map(publicRelayResponse) : publicRelayResponse(entry);
    } else result[key] = entry;
  }
  return publicServiceErrors(result);
}
/** Presentation only: never apply to model IDs, routes, credentials or price-source URLs. */
export function publicServiceText(value: string): string {
  return value.replace(/\btoken\s*hub\b/gi, "tokvilo 多模态").replace(/\bapi[\s-]*mart\b/gi, "tokvilo 模型服务");
}
/** Normalize service diagnostics only; generated content and machine identifiers stay intact. */
export function publicServiceErrors(value: unknown): unknown {
  if (!object(value)) return value;
  const result = { ...value };
  if (typeof result.message === "string") result.message = publicServiceText(result.message);
  if (typeof result.error === "string") result.error = publicServiceText(result.error);
  else if (object(result.error)) result.error = publicServiceErrors(result.error);
  if (object(result.data) && (result.data.error || ["failed", "error"].includes(String(result.data.status)))) result.data = publicServiceErrors(result.data);
  return result;
}
export type PriceCatalog = {
  currency: "USD"; markupPercent: 20; observedAt: string;
  models: ModelPrice[]; unavailable: Array<{ model: string; reason: string }>;
};
export type TokenHubQuote = {
  provider: "tokenhub"; model: string; kind: ModelPrice["kind"];
  observedAt: string; rates: PriceRate[]; reservedMicrousd: number;
  dimension?: string;
  retailPolicyVersion?: string;
};
type Json = Record<string, unknown>;
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function safe(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(0)) throw new PricingError("金额超出可处理范围。", 400);
  return Number(value);
}
export function markupMicrousd(costMicrousd: number): number {
  if (!integer(costMicrousd)) throw new PricingError("上游金额无效。");
  return safe((BigInt(costMicrousd) * BigInt(6) + BigInt(4)) / BigInt(5));
}
/** Convert a decimal USD price to retail micro-USD with one final rounding step. */
export function retailUsdMicrousd(value: number, priceFactor = 1): number {
  if (![value, priceFactor].every(part => Number.isFinite(part) && part >= 0 && part <= 100_000)) throw new PricingError("定价金额无效。");
  const fraction = (part: number): [bigint, bigint] => {
    const [mantissa, exponent = "0"] = String(part).toLowerCase().split("e");
    const decimals = mantissa.split(".")[1]?.length || 0;
    const scale = Number(exponent) - decimals;
    const digits = BigInt(mantissa.replace(".", ""));
    return scale >= 0 ? [digits * BigInt(10) ** BigInt(scale), BigInt(1)] : [digits, BigInt(10) ** BigInt(-scale)];
  };
  const [a, b] = fraction(value), [c, d] = fraction(priceFactor);
  const numerator = a * c * BigInt(6_000_000), denominator = b * d * BigInt(5);
  return safe((numerator + denominator - BigInt(1)) / denominator);
}
export function tokenCostMicrousd(count: number, retailRatePerMillion: number): number {
  if (!integer(count) || !integer(retailRatePerMillion)) throw new PricingError("用量或费率无效。");
  return safe((BigInt(count) * BigInt(retailRatePerMillion) + BigInt(999_999)) / BigInt(1_000_000));
}
function tokenTotal(terms: Array<[number, number]>) {
  const numerator = terms.reduce((sum, [count, rate]) => {
    if (!integer(count) || !integer(rate)) throw new PricingError("用量或费率无效。");
    return sum + BigInt(count) * BigInt(rate);
  }, BigInt(0));
  return safe((numerator + BigInt(999_999)) / BigInt(1_000_000));
}
function parseRate(value: unknown, dimension: string, unit: PriceRate["unit"]): PriceRate {
  if (!object(value) || !object(value.amount) || value.amount.currencyCode !== "USD" || !integer(value.amount.unitsMicros)) throw new PricingError("上游费率缺失或币种不一致。");
  const exact = value.amount.exactUnits ?? value.amount.units;
  if (typeof exact !== "string" || !/^\d+(?:\.\d+)?$/.test(exact) || Math.abs(Number(exact) * 1_000_000 - value.amount.unitsMicros) > 0.01) throw new PricingError("上游价格精度不一致。");
  if (unit === "1M_tokens" && (typeof value.display !== "string" || !/\/\s*1M tokens$/.test(value.display))) throw new PricingError("上游 token 计价单位不明确。");
  return { dimension, unit, upstreamMicrousd: value.amount.unitsMicros, retailMicrousd: markupMicrousd(value.amount.unitsMicros) };
}
export function normalizeTokenHubPricing(snapshot: unknown, observedAt = new Date().toISOString()): PriceCatalog {
  if (!object(snapshot) || snapshot.currencyCode !== "USD" || !Array.isArray(snapshot.data) || !snapshot.data.length) throw new PricingError("tokvilo 多模态 实时价格目录不可用，请稍后重试。");
  const models: ModelPrice[] = [], unavailable: PriceCatalog["unavailable"] = [];
  const seen = new Set<string>();
  for (const item of snapshot.data) {
    if (!object(item) || typeof item.id !== "string" || !item.id || item.id.length > 200) throw new PricingError("tokvilo 多模态 价格目录格式无效。");
    if (seen.has(item.id)) throw new PricingError("tokvilo 多模态 价格目录包含重复模型。");
    seen.add(item.id);
    try {
      if (!Array.isArray(item.deployments)) throw new PricingError("模型价格缺失。");
      const deployments = item.deployments.filter(value => object(value) && value.enabled === true);
      if (!deployments.length) throw new PricingError("模型没有启用的报价。");
      const variants = deployments.map(value => {
        if (!object(value) || !object(value.pricing)) throw new PricingError("模型价格缺失。");
        const p = value.pricing;
        if (object(p.fixed)) {
          if (p.fixed.priceUnit !== "image") throw new PricingError("暂不支持此固定计价单位。");
          return { kind: "image" as const, rates: [parseRate(p.fixed, "image", "image")] };
        }
        if (object(p.video)) {
          const rates = Object.entries(p.video).filter(([dimension]) => /^(?:with|without)Video(?:480p|720p|1080p|4k)$/.test(dimension))
            .map(([dimension, amount]) => parseRate(amount, dimension, "1M_tokens"))
            // Zero is used by this catalog for unavailable video configurations.
            .filter(rate => rate.upstreamMicrousd > 0).sort((a, b) => a.dimension.localeCompare(b.dimension));
          if (!rates.length) throw new PricingError("视频配置没有有效报价。");
          return { kind: "video" as const, rates };
        }
        return { kind: "chat" as const, rates: ["input", "output", "cacheRead", "cacheWrite"].map(name => parseRate(p[name], name, "1M_tokens")) };
      });
      if (new Set(variants.map(value => JSON.stringify(value))).size !== 1) throw new PricingError("模型的多个上游部署价格不同，等待确认。");
      const variant = variants[0];
      if (variant.kind === "chat") variant.rates = variant.rates.map(rate => ({ ...rate, retailMicrousd: valueRetailMicrousd(item.id as string, rate) }));
      models.push({ provider: "tokenhub", model: item.id, name: publicServiceText(typeof item.label === "string" ? item.label.slice(0, 200) : item.id), ...variant, available: true });
    } catch (cause) { unavailable.push({ model: item.id, reason: cause instanceof PricingError ? cause.message : "价格暂不可用。" }); }
  }
  return { currency: "USD", markupPercent: 20, observedAt, models, unavailable };
}
export async function getTokenHubPricing(fetcher: typeof fetch = fetch): Promise<PriceCatalog> {
  try {
    const response = await fetcher("https://ai-tokenhub.ai/api/pricing", {
      headers: { Accept: "application/json" }, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !response.body) throw new Error();
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.byteLength; if (length > 2_000_000) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return normalizeTokenHubPricing(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (cause) {
    if (cause instanceof PricingError) throw cause;
    throw new PricingError("tokvilo 多模态 实时价格读取失败，尚未发起付费请求。");
  }
}
function rate(quote: Pick<TokenHubQuote, "rates">, dimension: string) {
  const found = quote.rates.find(item => item.dimension === dimension);
  if (!found) throw new PricingError("所选模型参数没有已确认的报价。", 409);
  return found.retailMicrousd;
}
export function quoteTokenHubRequest(catalog: PriceCatalog, kind: ModelPrice["kind"], body: Json): TokenHubQuote {
  const model = catalog.models.find(item => item.model === body.model && item.kind === kind);
  if (!model) throw new PricingError("所选模型没有可用的实时价格。", 409);
  const quote: TokenHubQuote = { provider: "tokenhub", model: model.model, kind, observedAt: catalog.observedAt, rates: structuredClone(model.rates), reservedMicrousd: 0, retailPolicyVersion: VALUE_PRICING_VERSION };
  if (kind === "chat") {
    const messages = body.messages;
    if (!Array.isArray(messages) || !messages.every(message => object(message) && (typeof message.content === "string" || message.content === null || Array.isArray(message.content) && message.content.every(part => object(part) && part.type === "text" && typeof part.text === "string")))) throw new PricingError("当前计费对话支持文本消息；其他输入等待价格适配。", 400);
    if (body.n !== undefined && body.n !== 1) throw new PricingError("当前每次对话支持一个回复。", 400);
    if (body.tools !== undefined && (!Array.isArray(body.tools) || !body.tools.every(tool => object(tool) && tool.type === "function"))) throw new PricingError("当前计费对话仅支持客户端函数工具。", 400);
    if (rate(quote, "cacheWrite") !== 0) throw new PricingError("此模型的缓存写入计费尚未完成适配。", 409);
    const maximum = body.max_completion_tokens ?? body.max_tokens;
    if (!integer(maximum) || maximum < 1 || maximum > 32_768 || body.max_completion_tokens !== undefined && body.max_tokens !== undefined) throw new PricingError("请设置 1–32768 的 max_tokens 或 max_completion_tokens。", 400);
    // This is a conservative temporary hold, never a substitute for returned usage.
    const inputBound = new TextEncoder().encode(JSON.stringify(body)).byteLength * 2 + messages.length * 64 + 1024;
    quote.reservedMicrousd = tokenTotal([[inputBound, Math.max(rate(quote, "input"), rate(quote, "cacheRead"))], [maximum, rate(quote, "output")]]);
  } else if (kind === "image") {
    const n = body.n ?? 1;
    if (!integer(n) || n < 1 || n > 10 || body.sequential_image_generation !== undefined && body.sequential_image_generation !== "disabled" || body.sequential_image_generation_options !== undefined) throw new PricingError("图片计费支持明确的 1–10 张生成数量，不支持自动连续生成。", 400);
    quote.reservedMicrousd = safe(BigInt(n) * BigInt(rate(quote, "image")));
  } else {
    const resolution = body.resolution ?? "720p", seconds = body.duration === -1 ? 15 : body.duration ?? 5;
    const content = body.content;
    if (!["480p", "720p", "1080p"].includes(String(resolution)) || !integer(seconds) || seconds < 4 || seconds > 15 || !Array.isArray(content) || !content.every(value => object(value) && ["text", "image_url"].includes(String(value.type)))) throw new PricingError("当前视频计费支持 4–15 秒、480p/720p/1080p 的文字或图片输入。", 400);
    if (body.frames !== undefined || body.fps !== undefined || body.draft === true) throw new PricingError("当前视频配置尚未完成计费适配。", 400);
    if (body.service_tier !== undefined || body.draft_task_id !== undefined || content.some(item => object(item) && item.type === "text" && typeof item.text === "string" && /--[A-Za-z]/.test(item.text))) throw new PricingError("请通过标准 JSON 参数选择视频配置，不使用提示词参数或特殊计费模式。", 400);
    quote.dimension = `withoutVideo${resolution}`;
    const shortSide = Number(String(resolution).replace("p", ""));
    // A hold above the documented token formula (maximum 4:1 pixel rectangle,
    // 60 fps). Settlement always uses the provider's final completion_tokens.
    const maximumTokens = Math.ceil(shortSide * shortSide * 4 * 60 * seconds / 1024);
    quote.reservedMicrousd = tokenCostMicrousd(maximumTokens, rate(quote, quote.dimension));
  }
  if (quote.reservedMicrousd <= 0) throw new PricingError("模型价格尚未确认。", 409);
  return quote;
}
export function tokenHubActualCost(quote: TokenHubQuote, payload: unknown): number | null {
  if (!object(payload)) return null;
  const data = object(payload.data) ? payload.data : payload;
  if (typeof data.model === "string" && data.model !== quote.model) return null;
  if (quote.kind === "image") {
    const images = Array.isArray(payload.data) ? payload.data : Array.isArray(data.data) ? data.data : null;
    if (!images) return null;
    const successful = images.filter(item => object(item) && !item.error && (typeof item.url === "string" && item.url.length > 0 || typeof item.b64_json === "string" && item.b64_json.length > 0));
    // Missing/partial response evidence remains held for reconciliation.
    if (!successful.length) return null;
    return safe(BigInt(successful.length) * BigInt(rate(quote, "image")));
  }
  if (!object(data.usage)) return null;
  const usage = data.usage;
  if (quote.kind === "video") {
    if (data.status !== "succeeded" || !integer(usage.completion_tokens) || !quote.dimension) return null;
    return tokenCostMicrousd(usage.completion_tokens, rate(quote, quote.dimension));
  }
  const prompt = usage.prompt_tokens, output = usage.completion_tokens;
  if (!integer(prompt) || !integer(output)) return null;
  const details = object(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const cached = details.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
  if (!integer(cached) || cached > prompt) return null;
  if (details.cached_tokens !== undefined && usage.prompt_cache_hit_tokens !== undefined && details.cached_tokens !== usage.prompt_cache_hit_tokens) return null;
  if (usage.prompt_cache_miss_tokens !== undefined && usage.prompt_cache_miss_tokens !== prompt - cached) return null;
  if (details.cache_creation_tokens !== undefined && details.cache_creation_tokens !== 0 || usage.cache_creation_input_tokens !== undefined && usage.cache_creation_input_tokens !== 0) return null;
  if (usage.total_tokens !== undefined && (!integer(usage.total_tokens) || usage.total_tokens !== prompt + output)) return null;
  return tokenTotal([[prompt - cached, rate(quote, "input")], [cached, rate(quote, "cacheRead")], [output, rate(quote, "output")]]);
}
