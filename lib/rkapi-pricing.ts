import { PricingError } from "./pricing";
import { runtimeEnv, type RuntimeEnv } from "./config";
import snapshot from "./rkapi-catalog-snapshot.json";
import { normalizeRkapiRequest, type RkapiRequest } from "./rkapi-request";
import { getRkapiConversion, verifiedRkapiRoutes, type RkapiConversion, type RkapiRoute } from "./rkapi-settings";

export type RkapiModel = { id: string; name: string; manufacturer: string; category: string; kind: string; groups: string[]; adapter: string | null; tiers: Array<{ id: string; maxInputTokens?: number; ratesCnyPerMillion: Record<string, string> }> };
const models = snapshot.models as RkapiModel[];
export type RkapiPublicRate = { dimension: string; label: string; condition?: string; unit: "1M_tokens" | "call"; retailMicrousd: number };
export type RkapiPublicModel = { provider: "selected"; model: string; name: string; kind: "chat" | "image"; available: boolean; billingReady: boolean; rates: RkapiPublicRate[]; notes: string[] };
export type RkapiQuote = { provider: "selected"; model: string; kind: "chat" | "image"; currency: "USD"; observedAt: string; reservedMicrousd: number; rates: RkapiPublicRate[] };
export type RkapiBasis = { model: RkapiModel; group: string; groupRatio: number; conversion: RkapiConversion; inputTokenLimit: number; outputTokenLimit: number };
const groupRatio = (group: string) => Number((snapshot.groupRatios as Record<string, string>)[group]);
const cheapestGroup = (model: RkapiModel) => [...model.groups].sort((a, b) => groupRatio(a) - groupRatio(b))[0];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function rkapiSnapshotCurrent(now = Date.now()): boolean {
  return Number.isFinite(now) && Date.parse(snapshot.observedAt) <= now && Date.parse(snapshot.expiresAt) > now;
}
type Fraction = [bigint, bigint];
function fraction(value: string | number): Fraction {
  if (!/^\d+(?:\.\d+)?$/.test(String(value))) throw new PricingError("精选费率格式待核对。");
  const text = String(value), places = text.split(".")[1]?.length || 0;
  return [BigInt(text.replace(".", "")), BigInt(10) ** BigInt(places)];
}
function multiply([a, b]: Fraction, [c, d]: Fraction): Fraction { return [a * c, b * d]; }
function add([a, b]: Fraction, [c, d]: Fraction): Fraction { return [a * d + c * b, b * d]; }
function ceiling([a, b]: Fraction): number {
  if (b <= BigInt(0) || a < BigInt(0)) throw new PricingError("精选费率待核对。");
  const value = (a + b - BigInt(1)) / b;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new PricingError("金额超出可处理范围。", 400);
  return Number(value);
}
/** Snapshot values already contain CNY 0.2 / quota. Normalize that factor, apply
 * the live cash conversion and the configured fixed group once, then round only
 * the final marked-up micro-USD amount. The source catalogue's '$' is cosmetic. */
export function rkapiAmount(terms: Array<{ count: number; rateCny: string; unit?: "call" }>, basis: Pick<RkapiBasis, "groupRatio" | "conversion">): number {
  let total: Fraction = [BigInt(0), BigInt(1)];
  for (const term of terms) {
    if (!integer(term.count)) throw new PricingError("精选用量格式待核对。");
    total = add(total, multiply(fraction(term.rateCny), [BigInt(term.count) * (term.unit === "call" ? BigInt(1_000_000) : BigInt(1)), BigInt(1)]));
  }
  total = multiply(total, fraction(basis.groupRatio));
  total = multiply(total, fraction(basis.conversion.cnyPerQuota));
  const [r, s] = fraction(snapshot.referenceCnyPerQuota), [fx, scale] = fraction(basis.conversion.cnyPerUsd);
  return ceiling(multiply(total, [s * scale * BigInt(6), r * fx * BigInt(5)]));
}

export function rkapiPublicRates(model: RkapiModel, group: string, conversion: RkapiConversion): RkapiPublicRate[] {
  return model.tiers.flatMap(tier => Object.entries(tier.ratesCnyPerMillion).filter((entry): entry is [string, string] => typeof entry[1] === "string").map(([dimension, rateCny]) => ({
    dimension: model.tiers.length > 1 ? `${dimension}:${tier.id}` : dimension,
    label: ({ input: "输入", output: "输出", cached_input: "缓存读取", cache_write: "缓存写入", request: "每次请求" } as Record<string, string>)[dimension] || dimension,
    ...(model.tiers.length > 1 ? { condition: tier.maxInputTokens ? `输入不超过 ${tier.maxInputTokens.toLocaleString("en-US")} token` : `输入超过 ${(model.tiers[0].maxInputTokens || 0).toLocaleString("en-US")} token` } : {}),
    unit: dimension === "request" ? "call" as const : "1M_tokens" as const,
    retailMicrousd: rkapiAmount([{ count: dimension === "request" ? 1 : 1_000_000, rateCny, ...(dimension === "request" ? { unit: "call" as const } : {}) }], { groupRatio: groupRatio(group), conversion }),
  })));
}
function routeFor(model: RkapiModel, routes: RkapiRoute[]): RkapiRoute | undefined {
  return routes.filter(route => model.groups.includes(route.group) && route.modelIds.includes(model.id)).sort((a, b) => groupRatio(a.group) - groupRatio(b.group))[0];
}
export async function getRkapiDisplayPricing() {
  const [conversionResult, routesResult] = await Promise.allSettled([getRkapiConversion(), verifiedRkapiRoutes()]);
  const conversion = conversionResult.status === "fulfilled" ? conversionResult.value : { cnyPerQuota: Number(snapshot.referenceCnyPerQuota), cnyPerUsd: Number(snapshot.referenceCnyPerUsd), observedAt: snapshot.observedAt };
  const routes = routesResult.status === "fulfilled" ? routesResult.value : [];
  const publicModels: RkapiPublicModel[] = models.map(model => {
    const route = routeFor(model, routes), ready = !!model.adapter && !!route && conversionResult.status === "fulfilled" && rkapiSnapshotCurrent();
    return { provider: "selected", model: model.id, name: model.name, kind: model.kind as "chat" | "image", available: ready, billingReady: ready,
      rates: rkapiPublicRates(model, route?.group || cheapestGroup(model), conversion),
      notes: [ready ? model.kind === "chat" ? "支持纯文本完整响应；按实际用量结算。" : "每次生成一张 1024x1024 图像。" : "价格已列示，服务待开通。", ...(model.tiers.length > 1 ? ["长上下文使用对应档位费率。"] : [])] };
  });
  return { currency: "USD" as const, observedAt: snapshot.observedAt, models: publicModels, unavailable: publicModels.filter(model => !model.billingReady).map(model => ({ model: model.model, reason: "价格已列示，服务待开通。" })) };
}
export const getRkapiPricing = getRkapiDisplayPricing;

export function createRkapiQuote(body: RkapiRequest, model: RkapiModel, group: string, conversion: RkapiConversion) {
  if (!model.groups.includes(group) || !model.adapter || body.model !== model.id) throw new PricingError("此精选模型尚未开通。", 422);
  const inputTokenLimit = body.messages ? new TextEncoder().encode(JSON.stringify(body.messages)).byteLength + body.messages.length * 64 + 256 : 0;
  const outputTokenLimit = body.max_completion_tokens ?? body.max_tokens ?? 0;
  const basis: RkapiBasis = { model, group, groupRatio: groupRatio(group), conversion, inputTokenLimit, outputTokenLimit };
  let amount: number;
  if (model.adapter === "image") amount = rkapiAmount([{ count: 1, rateCny: String(model.tiers[0].ratesCnyPerMillion.request), unit: "call" }], basis);
  else {
    // Reserve every input token at the highest input/cache rate, and every output
    // token at the highest tier. Settlement only uses the actual token buckets.
    const rates = model.tiers.map(tier => tier.ratesCnyPerMillion as Record<string, string>);
    const input = String(Math.max(...rates.flatMap(rate => [rate.input, rate.cached_input, rate.cache_write].filter(Boolean).map(Number))));
    const output = String(Math.max(...rates.map(rate => Number(rate.output))));
    amount = rkapiAmount([{ count: inputTokenLimit, rateCny: input }, { count: outputTokenLimit, rateCny: output }], basis);
  }
  const quote: RkapiQuote = { provider: "selected", model: model.id, kind: model.kind as "chat" | "image", currency: "USD", observedAt: snapshot.observedAt,
    reservedMicrousd: amount, rates: rkapiPublicRates(model, group, conversion) };
  return { quote, basis };
}
export async function prepareRkapiRequest(value: unknown, env: RuntimeEnv = runtimeEnv()) {
  if (!rkapiSnapshotCurrent()) throw new PricingError("精选价格正在更新，请稍后重新获取报价。", 503);
  const body = normalizeRkapiRequest(value), model = models.find(model => model.id === body.model)!;
  const [routes, conversion] = await Promise.all([verifiedRkapiRoutes(env), getRkapiConversion()]);
  const route = routeFor(model, routes);
  if (!route) throw new PricingError("此精选模型的服务尚未开通，请选择已开通模型。", 503);
  return { body, route, ...createRkapiQuote(body, model, route.group, conversion) };
}
export async function quoteRkapiRequest(value: unknown): Promise<RkapiQuote> { return (await prepareRkapiRequest(value)).quote; }

export function settleRkapiResponse(basis: RkapiBasis, response: unknown): number {
  if (!object(response) || response.error || response.success === false || typeof response.model === "string" && response.model !== basis.model.id) throw new PricingError("精选响应与请求不一致，等待账务核对。", 502);
  if (basis.model.adapter === "image") {
    if (!Array.isArray(response.data) || response.data.length !== 1 || !object(response.data[0]) || typeof response.data[0].url !== "string" || !/^https:\/\//.test(response.data[0].url) || response.data[0].b64_json !== undefined) throw new PricingError("图像链接不完整，等待账务核对。", 502);
    return rkapiAmount([{ count: 1, rateCny: String(basis.model.tiers[0].ratesCnyPerMillion.request), unit: "call" }], basis);
  }
  if (!Array.isArray(response.choices) || response.choices.length !== 1 || !object(response.choices[0]) || !object(response.choices[0].message) || typeof response.choices[0].message.content !== "string") throw new PricingError("精选文本结果不完整，等待账务核对。", 502);
  const usage = response.usage;
  if (!object(usage) || !integer(usage.prompt_tokens) || usage.prompt_tokens < 1 || !integer(usage.completion_tokens) || response.choices[0].message.content.length > 0 && usage.completion_tokens < 1 || !integer(usage.total_tokens) || usage.prompt_tokens + usage.completion_tokens !== usage.total_tokens
    || usage.prompt_tokens > basis.inputTokenLimit || usage.completion_tokens > basis.outputTokenLimit) throw new PricingError("精选用量不完整，等待账务核对。", 502);
  const details = usage.prompt_tokens_details === undefined ? {} : usage.prompt_tokens_details;
  if (!object(details)) throw new PricingError("精选缓存用量待核对。", 502);
  const tier = basis.model.tiers.find(tier => !tier.maxInputTokens || (usage.prompt_tokens as number) <= tier.maxInputTokens) || basis.model.tiers.at(-1)!;
  const rates = tier.ratesCnyPerMillion;
  // Only the OpenAI prompt-token inclusive cache schema has a settlement adapter.
  // Native/translated cache counters have different inclusion semantics; preserve
  // the hold rather than guessing whether those tokens are already in prompt_tokens.
  for (const name of ["cache_read_input_tokens", "cache_creation_input_tokens", "cache_creation", "claude_cache_creation_5_m_tokens", "claude_cache_creation_1_h_tokens"]) if (usage[name] !== undefined) throw new PricingError("精选缓存用量格式待核对。", 502);
  const writes = [details.cache_write_tokens, details.cache_creation_tokens].filter(value => value !== undefined);
  if (writes.length > 1 && writes[0] !== writes[1]) throw new PricingError("精选缓存用量不一致。", 502);
  const cached = details.cached_tokens ?? (rates.cached_input ? undefined : 0), written = writes[0] ?? (rates.cache_write ? undefined : 0);
  if (!integer(cached) || !integer(written) || cached + written > usage.prompt_tokens) throw new PricingError("精选缓存用量待核对。", 502);
  if (cached && !rates.cached_input || written && !rates.cache_write) throw new PricingError("精选缓存费率待核对。", 502);
  for (const [name, value] of Object.entries(details)) if (!["cached_tokens", "cache_write_tokens", "cache_creation_tokens"].includes(name) && value !== 0 && value !== null && value !== undefined) throw new PricingError("精选输入用量格式待核对。", 502);
  if (usage.completion_tokens_details !== undefined) {
    if (!object(usage.completion_tokens_details)) throw new PricingError("精选输出用量格式待核对。", 502);
    for (const [name, value] of Object.entries(usage.completion_tokens_details)) {
      if (["reasoning_tokens", "accepted_prediction_tokens", "rejected_prediction_tokens"].includes(name)) {
        if (!integer(value) || value > usage.completion_tokens) throw new PricingError("精选输出用量格式待核对。", 502);
      } else if (value !== 0 && value !== null && value !== undefined) throw new PricingError("精选输出用量格式待核对。", 502);
    }
  }
  // Optional media/tool/storage buckets were not admitted in this request.
  for (const [name, value] of Object.entries({ ...usage, ...details })) if (/audio|image|web_search|server_tool|cache_creation_1h|cache_creation_5m/i.test(name) && value !== 0 && value !== null && value !== undefined) throw new PricingError("精选响应包含待核对用量。", 502);
  return rkapiAmount([{ count: usage.prompt_tokens - cached - written, rateCny: rates.input }, { count: usage.completion_tokens, rateCny: rates.output },
    ...(cached ? [{ count: cached, rateCny: rates.cached_input }] : []), ...(written ? [{ count: written, rateCny: rates.cache_write }] : [])], basis);
}
