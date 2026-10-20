import { markupMicrousd, retailUsdMicrousd, PricingError, publicServiceText } from "./pricing";
import { APIMART_VIDEO_MODELS, APIMART_IMAGE_MODELS, apimartRequestKind, normalizeApimartRequest, type ApimartKind } from "./apimart-request";
import { midjourneyPriceDimension } from "./apimart-midjourney";
import { parseTextPrice, quoteText, settleText, type TextPrice, type TextQuote } from "./apimart-text-pricing";

export const APIMART_PRICE_SOURCE = "https://apimart.ai/api/pricing/models/all";
type Json = Record<string, unknown>;
export type ApimartRate = { dimension: string; unit: "1M_tokens" | "image" | "second" | "call"; upstreamMicrousd: number; retailMicrousd: number; usd?: number };
export type ApimartPrice = { provider: "apimart"; model: string; name: string; kind: ApimartKind; rates: ApimartRate[]; available: true; billingDimension?: string; inputImage?: { retailMicrousd: number; freeCount: number; usd: number }; referencesBlocked?: boolean; textPrice?: TextPrice };
export type ApimartQuote = { kind: ApimartKind; model: string; amountMicrousd: number; upstreamRates: Record<string, number>; retailRates?: Record<string, number>; observedAt: string; inputTokenLimit?: number; outputTokenLimit?: number; textQuote?: TextQuote };
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
function micro(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100_000) throw new PricingError("tokvilo 模型服务 定价金额无效。", 502);
  return Math.ceil(value * 1_000_000 - 1e-8);
}
function rate(dimension: string, unit: ApimartRate["unit"], value: unknown): ApimartRate {
  const upstreamMicrousd = micro(value);
  return { dimension, unit, upstreamMicrousd, usd: Number(value), retailMicrousd: retailUsdMicrousd(Number(value)) };
}
function markedTokenTotal(terms: Array<[number, number]>) {
  const numerator = terms.reduce((sum, [count, upstreamRate]) => sum + BigInt(count) * BigInt(markupMicrousd(upstreamRate)), BigInt(0));
  return Number((numerator + BigInt(999_999)) / BigInt(1_000_000));
}

function mediaTotal(terms: Array<[number, number]>) {
  let numerator = BigInt(0), denominator = BigInt(1);
  for (const [count, usd] of terms) {
    if (!Number.isSafeInteger(count) || count < 0) throw new PricingError("生成数量无效。", 422);
    const [mantissa, exponent = "0"] = String(usd).toLowerCase().split("e");
    const scale = Number(exponent) - (mantissa.split(".")[1]?.length || 0);
    const digits = BigInt(mantissa.replace(".", ""));
    const n = digits * BigInt(count) * (scale >= 0 ? BigInt(10) ** BigInt(scale) : BigInt(1));
    const d = scale < 0 ? BigInt(10) ** BigInt(-scale) : BigInt(1);
    numerator = numerator * d + n * denominator; denominator *= d;
  }
  numerator *= BigInt(6_000_000); denominator *= BigInt(5);
  const amount = (numerator + denominator - BigInt(1)) / denominator;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new PricingError("预留金额超出范围。", 422);
  return Number(amount);
}

/** Read the same public structured catalog used by APIMart's official pricing page. */
export function parseApimartPricing(payload: unknown) {
  if (!object(payload) || payload.success !== true || !object(payload.data) || !object(payload.data.models)) throw new PricingError("tokvilo 模型服务 定价目录暂不可用。", 502);
  const models: ApimartPrice[] = [], unavailable: { provider: "apimart"; model: string; reason: string }[] = [];
  for (const [category, items] of Object.entries(payload.data.models)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!object(item) || typeof item.id !== "string" || !item.id || item.id.length > 200) continue;
      let rates: ApimartRate[] = [], kind: ApimartKind | null = null;
      let inputImage: ApimartPrice["inputImage"], referencesBlocked = false;
      const textPrice = category === "llm" ? parseTextPrice(item) : null;
      const fixed = item.fixed_prices;
      if (textPrice) {
        rates = textPrice.rates;
        kind = "chat";
      } else if (category === "image" && item.id === "midjourney" && object(fixed)
        && fixed.unit === "usd_per_call" && fixed.dimension === "action_version_speed" && Array.isArray(fixed.items)) {
        rates = fixed.items.filter(object).filter(entry => /^imagine-(?:v(?:5\.1|5\.2|6\.1|7|8\.1|8\.2)|niji[67])(?:-(?:fast|turbo))?$/.test(String(entry.key)))
          .map(entry => rate(String(entry.key), "call", entry.after_discount));
        if (rates.length) kind = "image";
      } else if (category === "image" && APIMART_IMAGE_MODELS.has(item.id) && object(fixed) && fixed.unit === "usd_per_image"
        && ["resolution", "default", "version_resolution", "size_quality"].includes(String(fixed.dimension)) && Array.isArray(fixed.items)
        && !item.token_settlement_prices) {
        rates = fixed.items.filter(object).filter(entry => typeof entry.key === "string").map(entry => rate(String(entry.key).toLowerCase(), "image", entry.after_discount));
        if (rates.length && new Set(rates.map(entry => entry.dimension)).size === rates.length) kind = "image";
      } else if (category === "video" && APIMART_VIDEO_MODELS.has(item.id) && object(fixed)
        && ["usd_per_second", "usd_per_call"].includes(String(fixed.unit)) && fixed.dimension === "resolution"
        && Array.isArray(fixed.items) && !item.token_settlement_prices) {
        rates = fixed.items.filter(object).filter(entry => typeof entry.key === "string").map(entry => rate(String(entry.key).toLowerCase(), fixed.unit === "usd_per_second" ? "second" : "call", entry.after_discount));
        if (rates.length && new Set(rates.map(entry => entry.dimension)).size === rates.length) kind = "video";
      } else if (category === "audio" && ["suno", "flowmusic"].includes(item.id) && object(fixed)
        && fixed.unit === "usd_per_call" && Array.isArray(fixed.items)) {
        const allowed = item.id === "suno" ? ["music-v6", "music-v6-wild", "music-v6-mini"] : ["generate"];
        rates = fixed.items.filter(object).filter(entry => allowed.includes(String(entry.key))).map(entry => rate(String(entry.key), "call", entry.after_discount));
        if (rates.length) kind = "audio";
      }
      if (object(item.input_material_prices)) {
        const image = item.input_material_prices.image;
        if (object(image) && image.unit === "usd_per_image" && typeof image.after_discount === "number"
          && (image.free_count === undefined || Number.isSafeInteger(image.free_count) && Number(image.free_count) >= 0)) {
          inputImage = { usd: image.after_discount, retailMicrousd: retailUsdMicrousd(image.after_discount), freeCount: Number(image.free_count || 0) };
        } else referencesBlocked = true;
      }
      if (kind && rates.length) models.push({ provider: "apimart", model: item.id, name: publicServiceText(typeof item.name === "string" ? item.name : item.id), kind, rates, available: true,
        ...(textPrice ? { textPrice } : {}), ...(object(fixed) ? { billingDimension: String(fixed.dimension) } : {}), ...(inputImage ? { inputImage } : {}), ...(referencesBlocked ? { referencesBlocked } : {}) });
      else unavailable.push({ provider: "apimart", model: item.id, reason: "此模型的计费参数尚未开通，请选择已标价模型。" });
    }
  }
  if (!models.length) throw new PricingError("tokvilo 模型服务 暂未返回可用定价。", 502);
  return { observedAt: new Date().toISOString(), source: APIMART_PRICE_SOURCE, models, unavailable };
}

/** Server-only raw discovery; public callers must use explicit display projections. */
export async function fetchApimartPricingPayload(fetcher: typeof fetch = fetch): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(APIMART_PRICE_SOURCE, { headers: { Accept: "application/json" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000) }); }
  catch { throw new PricingError("暂时无法读取 tokvilo 模型服务 定价，请稍后重试。", 503); }
  if (!response.ok || !response.body) throw new PricingError("tokvilo 模型服务 定价服务暂不可用。", 503);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 4_000_000) { await reader.cancel(); throw new PricingError("tokvilo 模型服务 定价目录过大。", 502); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new PricingError("tokvilo 模型服务 定价格式无效。", 502); }
  return data;
}
export async function getApimartPricing(fetcher: typeof fetch = fetch) {
  return parseApimartPricing(await fetchApimartPricingPayload(fetcher));
}

export function quoteApimartRequest(body: Json, path: string, catalog: Awaited<ReturnType<typeof getApimartPricing>>): ApimartQuote {
  body = normalizeApimartRequest(body, path);
  const selected = catalog.models.find(item => item.model === body.model);
  const kind = apimartRequestKind(path);
  if (!selected || selected.kind !== kind) throw new PricingError("所选模型尚未开通此接口的计费，请选择已标价模型。", 422);
  const upstreamRates = Object.fromEntries(selected.rates.map(item => [item.dimension, item.upstreamMicrousd]));
  const retailRates = Object.fromEntries(selected.rates.map(item => [item.dimension, item.retailMicrousd]));
  if (kind !== "chat") {
    let dimension = typeof body.resolution === "string" ? body.resolution.toLowerCase() : "default";
    const model = String(body.model);
    if (kind === "image") {
      if (model === "midjourney") dimension = midjourneyPriceDimension(body);
      else if (selected.billingDimension === "version_resolution") {
        if (!body.version || !body.resolution) throw new PricingError("请明确填写图片版本与分辨率。", 422);
        dimension = `${body.version}@${dimension}`;
      } else if (selected.billingDimension === "size_quality") {
        if (!body.quality || !body.resolution) throw new PricingError("请明确填写图片质量与分辨率。", 422);
        dimension = `${dimension}@${body.quality}`;
      } else if (body.version !== undefined || body.quality !== undefined) throw new PricingError("此型号的版本或质量参数尚无对应报价。", 422);
      if (selected.billingDimension === "default" || model === "z-image-turbo" && ["1k", "2k"].includes(dimension)) dimension = "default";
      if (model === "seedream-5-0-pro" && dimension === "1.5k") dimension = "1k";
      if (model === "gemini-3-pro-image-preview" && ["1k", "2k"].includes(dimension)) dimension = "default";
    } else if (kind === "audio") dimension = model === "flowmusic" ? "generate" : `music-${body.version}`;
    else if (/^veo3\.1-(fast|quality|lite)$/.test(model)) dimension = dimension === "4k" ? "4k" : "default";
    else if (/^kling-(v2-6|v3|v3-omni|video-o1)$/.test(model)) {
      dimension = body.mode === "std" ? "default" : String(body.mode);
      if (body.audio ?? body.generate_audio) dimension = dimension === "default" ? "sound" : `${dimension}-sound`;
    } else {
      if (retailRates[dimension] === undefined && (
        ["wan2.6", "wan2.7"].includes(model) && dimension === "720p" ||
        /^MiniMax-Hailuo-2\.3/.test(model) && dimension === "768p")) dimension = "default";
      if ((body.audio ?? body.generate_audio) && /^(pixverse-v6|wan2\.6-i2v-flash|veo3\.1-.*-official)$/.test(model)) {
        const candidate = `${dimension}-audio`;
        dimension = retailRates[candidate] !== undefined ? candidate : dimension === "720p" || dimension === "1080p" ? "audio" : candidate;
      }
    }
    const price = retailRates[dimension];
    if (price === undefined) throw new PricingError("这些生成参数尚无已核实的价格，请调整分辨率、模式或版本。", 422);
    const references = (Array.isArray(body.image_urls) ? body.image_urls.length : 0)
      + (Array.isArray(body.image_with_roles) ? body.image_with_roles.length : 0)
      + (Array.isArray(body.img_references) ? body.img_references.length : 0)
      + ["first_frame_image", "last_frame_image", "end_frame_image"].filter(key => typeof body[key] === "string").length;
    if (references && selected.referencesBlocked) throw new PricingError("此型号的参考图费用尚未开通。", 422);
    const selectedRate = selected.rates.find(rate => rate.dimension === dimension)!;
    const units = (selectedRate.unit === "second" ? Number(body.duration) : 1) * (kind === "audio" && body.max_mode ? 2 : 1);
    const extraImages = selected.inputImage ? Math.max(0, references - selected.inputImage.freeCount) : 0;
    // New quotes sum exact decimal generation + material amounts before one rounding.
    // Persisted quotes retain their already-confirmed integer reservation.
    const amountMicrousd = selectedRate.usd !== undefined
      ? mediaTotal([[units, selectedRate.usd], ...(selected.inputImage ? [[extraImages, selected.inputImage.usd] as [number, number]] : [])])
      : price * units + extraImages * (selected.inputImage?.retailMicrousd || 0);
    if (!Number.isSafeInteger(amountMicrousd) || amountMicrousd < 1) throw new PricingError("暂时无法确定有效预留金额。", 422);
    return { kind, model, amountMicrousd, upstreamRates, retailRates, observedAt: catalog.observedAt };
  }
  if (!selected.textPrice) throw new PricingError("此模型的文本价格尚未核定。", 422);
  const textQuote = quoteText(body, selected.textPrice);
  return { kind, model: String(body.model), amountMicrousd: textQuote.amountMicrousd, upstreamRates, retailRates, observedAt: catalog.observedAt,
    inputTokenLimit: textQuote.inputTokenLimit, outputTokenLimit: textQuote.outputTokenLimit, textQuote };
}

export function apimartChatCharge(quote: ApimartQuote, response: Json): number {
  if (quote.textQuote) return settleText(quote.textQuote, response);
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
  if (quote.retailRates) return Math.ceil(((prompt - cached) * quote.retailRates.input + cached * (quote.retailRates.cached_input ?? quote.retailRates.input) + completion * quote.retailRates.output) / 1_000_000);
  return markedTokenTotal([[prompt - cached, rates.input], [cached, rates.cached_input ?? rates.input], [completion, rates.output]]);
}

export function apimartTaskCharge(data: Json): number {
  // APIMart's task endpoint reports `cost` in USD, separate from `credits_cost`.
  if (typeof data.cost !== "number" || !Number.isFinite(data.cost) || data.cost < 0) throw new PricingError("任务尚未返回结算金额，预留金额等待核对。", 502);
  return retailUsdMicrousd(data.cost);
}
