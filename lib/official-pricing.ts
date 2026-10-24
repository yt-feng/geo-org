/** Manufacturer API list prices, independently verified; never procurement costs.
 * Update procedure and deliberately unmatched IDs: docs/official-pricing.md.
 */
export const OFFICIAL_PRICING_AS_OF = "2026-10-24";
export type OfficialRate = {
  dimension: string;
  unit: "1M_tokens";
  currency: "USD" | "CNY";
  amount: number;
  condition: string;
  /** Lower bound is exclusive; upper bound is inclusive, matching public rate metadata. */
  minInputTokens?: number;
  maxInputTokens?: number;
  timeBand?: "peak" | "off_peak";
  validThrough?: string;
};
export type OfficialModelPricing = {
  modelId: string;
  provider: string;
  aliases: readonly string[];
  sourceUrl: string;
  asOf: string;
  rates: readonly OfficialRate[];
  notes: string;
};
export type ComparableRetailRate = {
  dimension: string;
  unit: string;
  retailMicrousd: number;
  condition?: string;
  tierMinInputTokens?: number;
  tierMaxInputTokens?: number | null;
};
export type OfficialPriceComparison = {
  status: "verified" | "conditions_unknown" | "unverified" | "currency_mismatch" | "unit_mismatch" | "dimension_unverified";
  official: OfficialRate | null;
  sourceUrl: string | null;
  asOf: string;
  savingsPercent: number | null;
  /** Official / tokvilo. Null for a zero tokvilo rate, never Infinity. */
  multiple: number | null;
  pricePosition: "lower" | "equal" | "higher" | null;
  reason: string;
};
type RateOptions = Partial<Pick<OfficialRate, "minInputTokens" | "maxInputTokens" | "timeBand" | "validThrough">> & {
  currency?: OfficialRate["currency"];
  condition?: string;
};
const STANDARD = "Standard on-demand text tokens; excludes batch, priority, regional surcharges, tools and taxes.";
const SOURCES = {
  openai: "https://developers.openai.com/api/docs/models/",
  anthropic: "https://platform.claude.com/docs/en/about-claude/pricing",
  google: "https://ai.google.dev/gemini-api/docs/pricing",
  deepseek: "https://api-docs.deepseek.com/quick_start/pricing/",
  qwen: "https://help.aliyun.com/en/model-studio/model-pricing",
  zhipu: "https://docs.z.ai/guides/overview/pricing",
  xai: "https://docs.x.ai/developers/pricing",
  minimax: "https://platform.minimax.io/docs/pricing/overview",
  moonshot: "https://platform.kimi.ai/",
};
function rates(input: number, output: number, cached: number | null, options: RateOptions = {}): OfficialRate[] {
  const { currency = "USD", condition = STANDARD, ...limits } = options;
  const values: [string, number][] = [["input", input], ["output", output]];
  if (cached !== null) values.push(["cached_input", cached]);
  return values.map(([dimension, amount]) => ({ dimension, amount, currency, unit: "1M_tokens", condition, ...limits }));
}
function tiered(short: [number, number, number | null], long: [number, number, number | null], boundary: number, options: RateOptions = {}): OfficialRate[] {
  return [
    ...rates(...short, { ...options, maxInputTokens: boundary, condition: `${options.condition || STANDARD} Input ≤ ${boundary.toLocaleString("en-US")} tokens.` }),
    ...rates(...long, { ...options, minInputTokens: boundary, condition: `${options.condition || STANDARD} Input > ${boundary.toLocaleString("en-US")} tokens.` }),
  ];
}
function model(provider: keyof typeof SOURCES, modelId: string, values: OfficialRate[], aliases: string[] = [], notes = ""): OfficialModelPricing {
  return { provider, modelId, aliases, rates: values, sourceUrl: provider === "openai" ? SOURCES.openai + modelId : SOURCES[provider], asOf: OFFICIAL_PRICING_AS_OF, notes };
}
function claude(id: string, input: number, output: number, cached: number, aliases: string[] = [], options: RateOptions = {}): OfficialModelPricing {
  const values = rates(input, output, cached, options);
  for (const [dimension, multiplier, ttl] of [["cache_write_5m", 1.25, "5 minutes"], ["cache_write_1h", 2, "1 hour"]] as const) {
    values.push({ ...values[0], dimension, amount: input * multiplier, condition: `${values[0].condition} Cache write TTL: ${ttl}.` });
  }
  return model("anthropic", id, values, aliases, "Direct Claude API, global routing; output includes thinking tokens. Cache writes require the specified TTL.");
}

/** Every alias is enumerated. There is no prefix, fuzzy, suffix or date normalization. */
export const OFFICIAL_MODEL_PRICING: readonly OfficialModelPricing[] = [
  model("openai", "gpt-6.1-sol", tiered([2, 10, .1], [4, 15, .2], 272_000)),
  model("openai", "gpt-6-sol", tiered([2, 10, .2], [4, 15, .4], 272_000)),
  model("openai", "gpt-6-astra", tiered([10, 50, 1], [20, 75, 2], 272_000)),
  model("openai", "gpt-6-luna", tiered([.1, .5, .01], [.2, .75, .02], 272_000)),
  model("openai", "gpt-5.6-sol", tiered([4, 20, .4], [8, 30, .8], 272_000, { validThrough: "2026-11-21", condition: `${STANDARD} Promotional rate confirmed through November 21, 2026; requires re-verification after that date.` })),
  model("openai", "gpt-5.5", tiered([5, 30, .5], [10, 45, 1], 272_000)),
  model("openai", "gpt-5.4", tiered([2.5, 15, .25], [5, 22.5, .5], 272_000), ["gpt-5.4-2026-03-05"]),
  model("openai", "gpt-5.4-mini", rates(.75, 4.5, .075)),
  model("openai", "gpt-5.4-nano", rates(.2, 1.25, .02)),
  model("openai", "gpt-5.3-codex", rates(1.75, 14, .175)),
  model("openai", "gpt-5.2", rates(1.75, 14, .175)),
  model("openai", "gpt-5.1", rates(1.25, 10, .125)),
  model("openai", "gpt-5", rates(1.25, 10, .125)),
  model("openai", "gpt-5-mini", rates(.25, 2, .025)),
  model("openai", "gpt-5-nano", rates(.05, .4, .005)),
  model("openai", "gpt-4.1", rates(2, 8, .5)),
  model("openai", "gpt-4.1-mini", rates(.4, 1.6, .1)),
  model("openai", "gpt-4.1-nano", rates(.1, .4, .025)),
  model("openai", "gpt-4o", rates(2.5, 10, 1.25)),
  model("openai", "gpt-4o-mini", rates(.15, .6, .075)),
  claude("claude-fable-5-1", 10, 50, .25),
  claude("claude-fable-5", 10, 50, 1),
  claude("claude-opus-5-5", 4, 20, .2),
  claude("claude-sonnet-5-5", 2, 10, .1),
  { ...claude("claude-haiku-5-5", .1, .5, .01), rates: [
    ...claude("claude-haiku-5-5", .1, .5, .01, [], { maxInputTokens: 100_000, condition: `${STANDARD} Input ≤ 100,000 tokens.` }).rates,
    ...claude("claude-haiku-5-5", .5, 2.5, .05, [], { minInputTokens: 100_000, condition: `${STANDARD} Input > 100,000 tokens.` }).rates,
  ] },
  ...["claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6"].map(id => claude(id, 5, 25, .5)),
  claude("claude-sonnet-5", 2, 10, .2),
  claude("claude-sonnet-4-6", 3, 15, .3),
  // Earlier generations' long-context eligibility is not inferred from later generations.
  claude("claude-opus-4-5-20251101", 5, 25, .5, ["claude-opus-4-5"], { maxInputTokens: 200_000, condition: `${STANDARD} Input ≤ 200,000 tokens.` }),
  claude("claude-sonnet-4-5-20250929", 3, 15, .3, ["claude-sonnet-4-5"], { maxInputTokens: 200_000, validThrough: "2026-11-30", condition: `${STANDARD} Input ≤ 200,000 tokens; official retirement November 30, 2026.` }),
  claude("claude-haiku-4-5-20251001", 1, 5, .1, ["claude-haiku-4-5"], { maxInputTokens: 200_000, condition: `${STANDARD} Input ≤ 200,000 tokens.` }),
  model("google", "gemini-4-argon", rates(2, 10, .1, { validThrough: "2026-11-30", condition: `${STANDARD} Gemini Developer API paid tier; introductory pricing through November 30, 2026. Implicit cache only; thinking tokens billed as output.` })),
  ...["gemini-3.8-flash", "gemini-3.6-flash"].map(id => model("google", id, rates(.75, 3.75, .075, { validThrough: "2026-12-31", condition: `${STANDARD} Gemini Developer API paid tier; introductory pricing through December 31, 2026. Output includes thinking; explicit-cache storage charged separately.` }))),
  model("google", "gemini-3.5-flash-lite", rates(.3, 2.5, .03), [], "Gemini Developer API paid tier; thinking included in output. Cache storage is additional."),
  model("google", "gemini-3.1-flash-lite", rates(.25, 1.5, .025), [], "Gemini Developer API paid tier; text only. The preview identifier is not assumed equivalent."),
  model("google", "gemini-3.1-pro-preview", tiered([2, 12, .2], [4, 18, .4], 200_000), ["gemini-3.1-pro-preview-customtools"], "Gemini Developer API paid tier; thinking included in output. Cache storage is additional."),
  model("google", "gemini-2.5-pro", tiered([1.25, 10, .125], [2.5, 15, .25], 200_000), [], "Gemini Developer API paid tier; thinking included in output. Cache storage is additional."),
  model("google", "gemini-2.5-flash", rates(.3, 2.5, .03), [], "Gemini Developer API paid tier; text only. Audio has a separate input price; cache storage is additional."),
  model("google", "gemini-2.5-flash-lite", rates(.1, .4, .01), [], "Gemini Developer API paid tier; text only. Audio has a separate input price; cache storage is additional."),
  ...[
    ["glm-5.3", 1.4, 4.4, .26], ["glm-5.3-flash", .15, .5, .03], ["glm-5.2", 1.4, 4.4, .26],
    ["glm-5.1", 1.4, 4.4, .26], ["glm-5", 1, 3.2, .2], ["glm-4.7", .6, 2.2, .11], ["glm-4.6", .6, 2.2, .11],
  ].map(([id, input, output, cached]) => model("zhipu", String(id), rates(Number(input), Number(output), Number(cached)), [], "Z.AI direct international API in USD; not a CNY quote from the China platform.")),
  ...[
    ["grok-4.7", 2, 6, .5], ["grok-4.6", 2, 6, .5], ["grok-4.5", 2, 6, .3], ["grok-4.3", 1.25, 2.5, .2],
    ["grok-build-0.1", 1, 2, .2], ["grok-4.20-multi-agent-0309", 1.25, 2.5, .2],
    ["grok-4.20-0309-reasoning", 1.25, 2.5, .2], ["grok-4.20-0309-non-reasoning", 1.25, 2.5, .2],
  ].map(([id, input, output, cached]) => model("xai", String(id), tiered([Number(input), Number(output), Number(cached)], [Number(input) * 2, Number(output) * 2, Number(cached) * 2], 199_999), [], "Global endpoint. Official long-context tier starts at ≥200,000 prompt tokens, including the boundary itself.")),
  model("minimax", "MiniMax-M3", tiered([.3, 1.2, .06], [.6, 2.4, .12], 512_000), ["minimax-m3"], "Standard service tier; uses the current discounted payable rate, not the struck-through list price."),
  model("minimax", "MiniMax-M3.1-Flash", rates(.15, .6, .015), ["minimax-m3.1-flash"]),
  model("moonshot", "kimi-k3", rates(3, 15, .3), [], "Kimi direct API in USD; 1,048,576-token context. Cache write TTL pricing is not inferred from the homepage's unspecific write rate. No Kimi Code subscription price is used."),
  ...["qwen3.8-max", "qwen3.8-max-0902", "qwen3.7-max"].map(id => model("qwen", id, rates(12, 36, null, { currency: "CNY", condition: "Alibaba Model Studio China (Beijing), global deployment, standard pay-as-you-go; up to 1M input tokens. Thinking and non-thinking output use the same rate." }), [], "No USD conversion. Cache pricing not verified.")),
  model("qwen", "qwen3.8-flash", rates(.8, 2.7, null, { currency: "CNY", condition: "Alibaba Model Studio China (Beijing), standard pay-as-you-go; up to 1M input tokens." }), [], "No USD conversion. Cache pricing not verified."),
  model("qwen", "qwen3.6-plus", tiered([2, 12, null], [8, 48, null], 256_000, { currency: "CNY", condition: "Alibaba Model Studio China (Beijing), standard pay-as-you-go; thinking and non-thinking output; maximum 1M context." }), ["qwen3.6-plus-2026-04-02"], "No USD conversion. Cache pricing not verified."),
  model("qwen", "qwen3.6-flash", tiered([1.2, 7.2, null], [4.8, 28.8, null], 256_000, { currency: "CNY", condition: "Alibaba Model Studio China (Beijing), standard pay-as-you-go; thinking and non-thinking output; maximum 1M context." }), ["qwen3.6-flash-2026-04-16"], "No USD conversion. Cache pricing not verified."),
  model("qwen", "qwen3.7-flash", [
    ...rates(.2, .8, null, { currency: "CNY", maxInputTokens: 32_000, condition: "Alibaba Model Studio China (Beijing), standard pay-as-you-go; input ≤ 32,000 tokens." }),
    ...rates(.6, 2.4, null, { currency: "CNY", minInputTokens: 32_000, maxInputTokens: 256_000, condition: "Alibaba Model Studio China (Beijing), standard pay-as-you-go; input > 32,000 and ≤ 256,000 tokens." }),
    ...rates(1.2, 4.8, null, { currency: "CNY", minInputTokens: 256_000, condition: "Alibaba Model Studio China (Beijing), standard pay-as-you-go; input > 256,000 tokens; maximum 1M context." }),
  ], ["qwen3.7-flash-2026-07-15"], "No USD conversion. Cache pricing not verified."),
  ...[
    { id: "deepseek-flash", short: [.15, .6, .003], peak: [.3, 1.2, .006] },
    { id: "deepseek-v4-pro", short: [.66, 1.98, .022], peak: [1.32, 3.96, .044] },
  ].map(({ id, short, peak }) => model("deepseek", id, [
    ...rates(short[0], short[1], short[2], { timeBand: "off_peak", condition: `${STANDARD} Off-peak: outside weekday UTC 01:00–04:00 and 06:00–10:00; Chinese statutory holidays are off-peak.` }),
    ...rates(peak[0], peak[1], peak[2], { timeBand: "peak", condition: `${STANDARD} Peak: weekdays UTC 01:00–04:00 or 06:00–10:00, excluding Chinese statutory holidays.` }),
  ], [], "Prices apply to the current documented API route. Retired V4 Flash identifiers are not equated with V4.1 model weights.")),
];

const index = new Map<string, OfficialModelPricing>();
for (const entry of OFFICIAL_MODEL_PRICING) {
  for (const id of [entry.modelId, ...entry.aliases]) {
    if (index.has(id)) throw new Error(`Duplicate official pricing ID: ${id}`);
    index.set(id, entry);
  }
}
export function matchOfficialModel(modelId: string): OfficialModelPricing | null {
  return index.get(modelId) || null;
}

const dimensionAliases: Record<string, string> = {
  input: "input", text_input: "input", output: "output", text_output: "output",
  cached_input: "cached_input", cached_text_input: "cached_input", cacheRead: "cached_input",
  explicit_cached_input: "explicit_cached_input", cache_write: "cache_write", cacheWrite: "cache_write",
  cache_write_5m: "cache_write_5m", cache_write_1h: "cache_write_1h",
};
function dimensionKey(value: string): string | null {
  // These are the exact structural forms emitted by the public pricing adapters.
  const prefixed = value.replace(/^tier\d+:/, "").replace(/^(peak|off_peak):/, "");
  const suffix = prefixed.replace(/:(standard|long|long_context)$/, "");
  return dimensionAliases[suffix] || null;
}
type ContextRange = { min: number; max: number };
function conditionRange(condition: string): ContextRange | null {
  const clean = condition.trim().replaceAll(",", "");
  let m = /^(?:输入\s*≤|输入不超过|Input\s*<=|Input\s*≤)\s*(\d+)\s*tokens?\.?$/i.exec(clean);
  if (m) return { min: 0, max: Number(m[1]) };
  m = /^(?:输入\s*>|输入超过|Input\s*>)\s*(\d+)(?:，无更高分档)?\s*tokens?\.?$/i.exec(clean);
  if (m) return { min: Number(m[1]), max: Infinity };
  m = /^输入\s*>\s*(\d+)\s*≤\s*(\d+)\s*tokens?$/.exec(clean);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  return null;
}
function validRange(value: ContextRange) {
  return Number.isSafeInteger(value.min) && value.min >= 0 && (value.max === Infinity || Number.isSafeInteger(value.max)) && value.max > value.min;
}
export function compareOfficialRate(modelId: string, retail: ComparableRetailRate, options: { inputTokens?: number; timeBand?: "peak" | "off_peak"; now?: Date } = {}): OfficialPriceComparison {
  const entry = matchOfficialModel(modelId);
  const result: OfficialPriceComparison = { status: "unverified", official: null, sourceUrl: entry?.sourceUrl || null, asOf: entry?.asOf || OFFICIAL_PRICING_AS_OF, savingsPercent: null, multiple: null, pricePosition: null, reason: "exact_model_not_verified" };
  const fail = (status: OfficialPriceComparison["status"], reason: string) => ({ ...result, status, reason });
  if (!entry) return result;
  if (retail.unit !== "1M_tokens") return fail("unit_mismatch", "requires_usd_per_million_tokens");
  if (!Number.isSafeInteger(retail.retailMicrousd) || retail.retailMicrousd < 0) return fail("conditions_unknown", "invalid_retail_amount");
  const dimension = dimensionKey(retail.dimension);
  if (!dimension) return fail("dimension_unverified", "billing_dimension_not_verified");
  let candidates = entry.rates.filter(rate => rate.dimension === dimension);
  if (!candidates.length) return fail("dimension_unverified", "billing_dimension_not_verified");
  const declaredTimeBand = /^(?:tier\d+:)?(peak|off_peak):/.exec(retail.dimension)?.[1];
  if (declaredTimeBand && (!options.timeBand || declaredTimeBand !== options.timeBand)) return fail("conditions_unknown", "retail_time_window_not_verified");
  let range: ContextRange | null = null;
  if (retail.tierMinInputTokens !== undefined || retail.tierMaxInputTokens !== undefined) {
    range = { min: retail.tierMinInputTokens ?? 0, max: retail.tierMaxInputTokens ?? Infinity };
    if (!validRange(range)) return fail("conditions_unknown", "invalid_context_range");
  }
  if (retail.condition?.trim()) {
    const parsed = conditionRange(retail.condition);
    if (!parsed || !validRange(parsed)) return fail("conditions_unknown", "unverified_retail_condition");
    if (range && (range.min !== parsed.min || range.max !== parsed.max)) return fail("conditions_unknown", "conflicting_context_conditions");
    range = parsed;
  }
  if (options.inputTokens !== undefined) {
    if (!Number.isSafeInteger(options.inputTokens) || options.inputTokens < 1 || range && (options.inputTokens <= range.min || options.inputTokens > range.max)) return fail("conditions_unknown", "input_outside_retail_tier");
    range = { min: options.inputTokens - 1, max: options.inputTokens };
  }
  if (range) candidates = candidates.filter(rate => range.min >= (rate.minInputTokens ?? 0) && range.max <= (rate.maxInputTokens ?? Infinity));
  else candidates = candidates.filter(rate => rate.minInputTokens === undefined && rate.maxInputTokens === undefined);
  if (options.timeBand) candidates = candidates.filter(rate => !rate.timeBand || rate.timeBand === options.timeBand);
  else candidates = candidates.filter(rate => !rate.timeBand);
  if (candidates.length !== 1) return fail("conditions_unknown", "context_or_time_band_required");
  const official = candidates[0];
  result.official = official;
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) return fail("conditions_unknown", "invalid_comparison_date");
  if (official.validThrough && now.getTime() > Date.parse(`${official.validThrough}T23:59:59.999Z`)) return fail("conditions_unknown", "official_price_requires_refresh");
  if (official.currency !== "USD") return fail("currency_mismatch", "no_foreign_exchange_assumed");
  const officialMicrousd = Math.round(official.amount * 1_000_000);
  const delta = officialMicrousd - retail.retailMicrousd;
  return {
    ...result, status: "verified", reason: "same_model_currency_unit_and_conditions", official,
    savingsPercent: officialMicrousd > 0 ? delta / officialMicrousd * 100 : null,
    multiple: retail.retailMicrousd > 0 ? officialMicrousd / retail.retailMicrousd : null,
    pricePosition: delta > 0 ? "lower" : delta < 0 ? "higher" : "equal",
  };
}
