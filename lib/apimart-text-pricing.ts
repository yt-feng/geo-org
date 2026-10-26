import { PricingError } from "./pricing";
import { modelRequestKind } from "./model-request-kind";
import { valueRetailMicrousd, VALUE_PRICING_VERSION } from "./value-pricing";

type Json = Record<string, unknown>;
type Exact = { n: string; d: string };
type Tier = { upToInputTokens: number | null; usdRates: Record<string, Exact>; retailUsdRates?: Record<string, Exact> };
export type TextPrice = {
  model: string;
  rates: Array<{ dimension: string; unit: "1M_tokens"; upstreamMicrousd: number; retailMicrousd: number }>;
  tiers: Tier[];
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  time?: { currentRate: Exact; maximumRate: Exact; nextSwitchAt: number };
  retailPolicyVersion?: string;
};
export type TextQuote = {
  model: string;
  amountMicrousd: number;
  inputTokenLimit: number;
  outputTokenLimit: number;
  quotedAt: number;
  price: TextPrice;
  omittedWriteIsZero?: boolean;
};
const dimensions = ["input", "cached_input", "explicit_cached_input", "cache_write", "cache_write_5m", "cache_write_1h", "output"];
const object = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const unit = (n: number): Exact => ({ n: String(n), d: "1" });
const ZERO = unit(0), ONE = unit(1), MARKUP: Exact = { n: "6", d: "5" };
function fail(message = "模型用量或价格尚无法完整核对，预留金额等待核对。", status = 502): never { throw new PricingError(message, status); }
function multiply(a: Exact, b: Exact): Exact { return { n: String(BigInt(a.n) * BigInt(b.n)), d: String(BigInt(a.d) * BigInt(b.d)) }; }
function add(a: Exact, b: Exact): Exact { return { n: String(BigInt(a.n) * BigInt(b.d) + BigInt(b.n) * BigInt(a.d)), d: String(BigInt(a.d) * BigInt(b.d)) }; }
function compare(a: Exact, b: Exact): number { const delta = BigInt(a.n) * BigInt(b.d) - BigInt(b.n) * BigInt(a.d); return delta < 0 ? -1 : delta > 0 ? 1 : 0; }
function divide(a: Exact, b: Exact): Exact { if (b.n === "0") fail(); return { n: String(BigInt(a.n) * BigInt(b.d)), d: String(BigInt(a.d) * BigInt(b.n)) }; }
function ceiling(a: Exact): number {
  const value = (BigInt(a.n) + BigInt(a.d) - BigInt(1)) / BigInt(a.d);
  if (value < 0 || value > BigInt(Number.MAX_SAFE_INTEGER)) fail("计费金额超出可处理范围。");
  return Number(value);
}
function decimal(value: unknown): Exact {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100_000) fail("模型价格格式无效。");
  const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const scale = fraction.length - Number(exponent), numerator = BigInt(whole + fraction);
  return scale >= 0 ? { n: String(numerator), d: String(BigInt(10) ** BigInt(scale)) } : { n: String(numerator * BigInt(10) ** BigInt(-scale)), d: "1" };
}
function readRates(value: unknown, factor = ONE): Record<string, Exact> {
  if (!object(value)) fail();
  const rates: Record<string, Exact> = {};
  for (const [name, amount] of Object.entries(value)) {
    if (name === "up_to_input_tokens") continue;
    if (!dimensions.includes(name)) fail("模型包含尚未适配的计费维度。");
    if (amount !== null && amount !== undefined) rates[name] = multiply(decimal(amount), factor);
  }
  if (!rates.input || !rates.output) fail();
  return rates;
}
function sameRates(a: Record<string, Exact>, b: Record<string, Exact>): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => b[k] &&
    Math.abs(Number(a[k].n) / Number(a[k].d) - Number(b[k].n) / Number(b[k].d)) < 1e-10);
}
function validateExtras(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!object(value) || Object.keys(value).some(key => !["tools", "google_web_search", "context_cache_storage"].includes(key))) fail();
  const tools = value.tools;
  if (tools !== undefined) {
    if (!object(tools)) fail();
    for (const tool of Object.values(tools)) {
      if (!object(tool) || tool.unit !== "usd_per_1000_queries") fail();
      decimal(tool.price);
    }
  }
  if (value.google_web_search !== undefined) {
    if (!object(value.google_web_search) || value.google_web_search.unit !== "usd_per_1000_queries") fail();
    decimal(value.google_web_search.price);
  }
  if (value.context_cache_storage !== undefined) {
    const storage = value.context_cache_storage;
    if (!object(storage) || storage.unit !== "usd_per_million_token_hours" || storage.billed_on !== "explicit_cache_create") fail();
    decimal(storage.price);
  }
}

/** TokenPricingV2: effective_rates are current payable rates; tiers use price_factor.
 * https://docs.apimart.ai/en/api-reference/texts/qwen3.8-max/pricing
 * Extra tools and explicit context-cache creation are deliberately not requested.
 */
export function parseTextPrice(item: unknown): TextPrice | null {
  try {
    if (!object(item) || typeof item.id !== "string" || !item.id || modelRequestKind(item.id, "llm") !== "chat") return null;
    const p = item.pricing;
    if (!object(p) || p.unit !== "usd_per_million_tokens" || p.pricing_mode !== "standard" ||
      !integer(p.tier_count) || p.tier_count < 1 || p.tier_count > 20) return null;
    const current = readRates(p.effective_rates);
    validateExtras(p.extras);
    let tiers: Tier[] = [{ upToInputTokens: null, usdRates: current }];
    if (p.tier_count > 1) {
      const metadata = object(item.token_pricing) && object(item.token_pricing.model) ? item.token_pricing.model : null;
      if (!metadata || metadata.tier_metric !== "input_tokens" || metadata.tier_mode !== "full_request" ||
        !Array.isArray(p.tiers) || p.tiers.length !== p.tier_count) return null;
      const factor = decimal(p.price_factor);
      if (factor.n === "0") return null;
      let previous = 0;
      tiers = p.tiers.map((entry, index) => {
        if (!object(entry)) fail();
        const last = index === Number(p.tier_count) - 1, threshold = entry.up_to_input_tokens;
        if (last ? threshold !== undefined && threshold !== null : !integer(threshold) || threshold <= previous) fail();
        if (!last) previous = Number(threshold);
        return { upToInputTokens: last ? null : Number(threshold), usdRates: readRates(entry, factor) };
      });
      if (!sameRates(current, tiers[0].usdRates)) return null;
    }
    const limits = object(p.limits) ? p.limits : {};
    const maxInputTokens = integer(limits.max_input_tokens) && limits.max_input_tokens > 0 ? limits.max_input_tokens : null;
    const maxOutputTokens = integer(limits.max_output_tokens) && limits.max_output_tokens > 0 ? limits.max_output_tokens : null;
    let time: TextPrice["time"];
    if (p.time_pricing !== undefined && p.time_pricing !== null) {
      const window = p.time_pricing;
      if (!object(window) || window.timezone !== "UTC" || !Array.isArray(window.windows) ||
        !window.windows.length || !integer(window.next_switch_at) || typeof window.current_window !== "string") return null;
      const currentRate = decimal(window.current_rate);
      if (currentRate.n === "0") return null;
      if (p.time_rate !== undefined && compare(decimal(p.time_rate), currentRate) !== 0) return null;
      const currentWindow = window.windows.find(w => object(w) && w.name === window.current_window);
      if (!object(currentWindow) || compare(decimal(currentWindow.rate), currentRate) !== 0) return null;
      const maximumRate = window.windows.reduce<Exact>((max, w) => {
        if (!object(w)) fail();
        const rate = decimal(w.rate);
        return compare(rate, max) > 0 ? rate : max;
      }, currentRate);
      time = { currentRate, maximumRate, nextSwitchAt: window.next_switch_at };
    }
    // Persist exact customer rates in the quote. Unchanged floors retain their
    // decimal precision, rather than rounding each token dimension prematurely.
    for (const [index, tier] of tiers.entries()) tier.retailUsdRates = Object.fromEntries(Object.entries(tier.usdRates).map(([dimension, value]) => {
      const floor = multiply(value, MARKUP), floorMicrousd = ceiling(multiply(floor, unit(1_000_000)));
      const retail = time ? floorMicrousd : valueRetailMicrousd(item.id as string, {
        dimension: tiers.length > 1 ? `tier${index + 1}:${dimension}` : dimension, unit: "1M_tokens", retailMicrousd: floorMicrousd,
        ...(tiers.length > 1 ? { tierMinInputTokens: index === 0 ? 0 : tiers[index - 1].upToInputTokens!, tierMaxInputTokens: tier.upToInputTokens } : {}),
      });
      return [dimension, retail > floorMicrousd ? { n: String(retail), d: "1000000" } : floor];
    }));
    const rates = tiers.flatMap((tier, index) => Object.entries(tier.usdRates).map(([dimension, value]) => ({
      dimension: tiers.length === 1 ? dimension : `${dimension} [${index === 0 ? "0" : Number(tiers[index - 1].upToInputTokens) + 1}–${tier.upToInputTokens ?? "∞"} input tokens]`,
      unit: "1M_tokens" as const,
      // Display projection only; quote/settlement use the exact decimal rational.
      upstreamMicrousd: ceiling(multiply(value, unit(1_000_000))),
      retailMicrousd: ceiling(multiply(tier.retailUsdRates![dimension], unit(1_000_000))),
    })));
    return { model: item.id, rates, tiers, maxInputTokens, maxOutputTokens, retailPolicyVersion: VALUE_PRICING_VERSION, ...(time ? { time } : {}) };
  } catch (cause) { if (cause instanceof PricingError) return null; throw cause; }
}

function total(terms: Array<[number, Exact]>, retail = false): number {
  // USD per million × tokens × micro-USD per USD: the two million factors cancel.
  // All dimensions are added exactly before the single final micro-USD rounding.
  return ceiling(multiply(terms.reduce((sum, [count, rate]) => add(sum, multiply(unit(count), rate)), ZERO), retail ? ONE : MARKUP));
}
function billableRates(price: TextPrice, tier: Tier): Record<string, Exact> {
  if (!price.retailPolicyVersion) return tier.usdRates; // Pre-policy persisted quotes keep their original 6/5 calculation.
  if (!tier.retailUsdRates || Object.keys(tier.usdRates).some(key => !tier.retailUsdRates![key])) fail();
  return tier.retailUsdRates;
}
export function quoteText(body: Json, parsed: TextPrice): TextQuote {
  const allowed = ["model", "messages", "stream", "max_tokens", "max_completion_tokens", "temperature", "top_p"];
  if (body.model !== parsed.model || Object.keys(body).some(key => !allowed.includes(key)) || body.stream === true ||
    !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100 ||
    !body.messages.every(message => object(message) && Object.keys(message).every(key => ["role", "content"].includes(key)) &&
      ["user", "assistant", "system"].includes(String(message.role)) && typeof message.content === "string")) {
    fail("当前计费支持纯文本对话；工具、显式缓存和其他输入暂未开放。", 400);
  }
  const outputTokenLimit = body.max_completion_tokens ?? body.max_tokens ?? 1024;
  if (body.max_completion_tokens !== undefined && body.max_tokens !== undefined ||
    !integer(outputTokenLimit) || outputTokenLimit < 1 || outputTokenLimit > 4096 ||
    parsed.maxOutputTokens !== null && outputTokenLimit > parsed.maxOutputTokens) fail("最大输出 token 超出支持范围。", 400);
  const inputTokenLimit = new TextEncoder().encode(JSON.stringify(body.messages)).byteLength * 2 + body.messages.length * 64 + 1024;
  if (parsed.maxInputTokens !== null && inputTokenLimit > parsed.maxInputTokens) fail("消息长度超出此模型的输入范围。", 400);
  const quotedAt = Math.floor(Date.now() / 1000);
  if (parsed.time && quotedAt >= parsed.time.nextSwitchAt - 15) fail("此模型即将切换时段价格，请刷新报价后重试。", 409);
  const candidates: Tier[] = [];
  for (const tier of parsed.tiers) {
    candidates.push(tier);
    if (tier.upToInputTokens === null || inputTokenLimit <= tier.upToInputTokens) break;
  }
  const factor = parsed.time ? divide(parsed.time.maximumRate, parsed.time.currentRate) : ONE;
  let input = ZERO, output = ZERO;
  for (const tier of candidates) for (const [dimension, value] of Object.entries(billableRates(parsed, tier))) {
    const rate = multiply(value, factor);
    if (dimension === "output") { if (compare(rate, output) > 0) output = rate; }
    else if (compare(rate, input) > 0) input = rate;
  }
  return {
    model: parsed.model, amountMicrousd: total([[inputTokenLimit, input], [outputTokenLimit, output]], !!parsed.retailPolicyVersion),
    inputTokenLimit, outputTokenLimit, quotedAt, price: structuredClone(parsed),
    // APIMart's Claude cache guide explicitly processes string content as regular
    // input. This request contract cannot carry the array-block cache marker.
    // Do not extend this documented exception to GPT/Qwen automatic cache writes.
    ...(parsed.model.startsWith("claude-") ? { omittedWriteIsZero: true } : {}),
  };
}

function usageCount(value: unknown): number { if (!integer(value)) fail(); return value; }
function zeroOrAbsent(value: unknown): boolean {
  if (value === undefined || value === null || value === 0) return true;
  if (object(value)) return Object.values(value).every(zeroOrAbsent);
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
/** Cache usage contract:
 * https://docs.apimart.ai/en/api-reference/texts/general/claude-context-cache
 * https://docs.apimart.ai/en/api-reference/texts/gemini/context-cache
 * Gemini storage fees are separate log entries, so quoteText forbids cache_control.
 */
export function settleText(quote: TextQuote, response: Json): number {
  const data = object(response.data) ? response.data : response;
  if (data.model !== undefined && data.model !== quote.model) fail("返回模型与已确认报价不一致，预留金额等待核对。");
  const usage = data.usage;
  if (!object(usage)) fail();
  const prompt = usageCount(usage.prompt_tokens), completion = usageCount(usage.completion_tokens);
  if (prompt > quote.inputTokenLimit || completion > quote.outputTokenLimit ||
    usage.total_tokens !== undefined && usage.total_tokens !== prompt + completion) fail();
  for (const [key, value] of Object.entries(usage)) {
    if (/(?:tool|search|storage|grounding)/i.test(key) && !zeroOrAbsent(value)) fail("响应含额外工具或存储用量，预留金额等待核对。");
  }
  if (quote.price.time) {
    const now = Math.floor(Date.now() / 1000), created = data.created;
    if (!integer(created) || created < quote.quotedAt - 60 || created > now + 5 ||
      created >= quote.price.time.nextSwitchAt || now >= quote.price.time.nextSwitchAt) fail("请求跨越计价时段或缺少时间凭证，预留金额等待核对。");
  }
  const tier = quote.price.tiers.find(t => t.upToInputTokens === null || prompt <= t.upToInputTokens);
  if (!tier) fail();
  const rates = billableRates(quote.price, tier);
  const details = object(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const cached = usageCount(details.cached_tokens ?? 0);
  const explicit = usageCount(details.explicit_cached_tokens ?? 0);
  const genericWrite = usageCount(details.cache_write_tokens ?? 0);
  const write5m = usageCount(usage.claude_cache_creation_5_m_tokens ?? 0);
  const write1h = usageCount(usage.claude_cache_creation_1_h_tokens ?? 0);
  const hasWritePrices = Object.keys(rates).some(key => key.startsWith("cache_write"));
  const hasWriteUsage = details.cache_write_tokens !== undefined ||
    usage.claude_cache_creation_5_m_tokens !== undefined || usage.claude_cache_creation_1_h_tokens !== undefined;
  if (hasWritePrices && !hasWriteUsage && quote.omittedWriteIsZero !== true) fail("响应缺少缓存写入用量，预留金额等待核对。");
  if (explicit > 0) fail("响应含未请求的显式缓存用量，预留金额等待核对。");
  if (genericWrite > 0 && write5m + write1h > 0) fail("缓存写入字段重复，预留金额等待核对。");
  const write = genericWrite + write5m + write1h;
  if (cached + write > prompt) fail();
  const terms: Array<[number, Exact]> = [[prompt - cached - write, rates.input], [completion, rates.output]];
  if (cached) terms.push([cached, rates.cached_input || rates.input]);
  const chargeWrite = (count: number, dimension: string) => {
    if (!count) return;
    const rate = rates[dimension];
    if (!rate) fail("缓存写入费率或 TTL 尚不明确，预留金额等待核对。");
    terms.push([count, rate]);
  };
  if (genericWrite) {
    // A generic count cannot distinguish two TTL prices. Never infer the cheaper TTL.
    const available = ["cache_write", "cache_write_5m", "cache_write_1h"].filter(key => rates[key]);
    const key = rates.cache_write ? "cache_write" : available.length === 1 ? available[0] : "";
    chargeWrite(genericWrite, key);
  }
  chargeWrite(write5m, "cache_write_5m");
  chargeWrite(write1h, "cache_write_1h");
  const amount = total(terms, !!quote.price.retailPolicyVersion);
  if (amount > quote.amountMicrousd) fail("实际费用超出已确认预留，等待核对。");
  return amount;
}
