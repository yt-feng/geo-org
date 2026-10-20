import { fetchApimartPricingPayload, parseApimartPricing } from "./apimart-pricing";
import { publicModelId } from "./model-id";
import { retailUsdMicrousd, PricingError, publicServiceText } from "./pricing";

type Json = Record<string, unknown>;
export type DisplayPriceUnit = "1M_tokens" | "image" | "second" | "call" | "1000_queries" | "1M_token_hours";
export type DisplayPriceRate = {
  dimension: string; label: string; unit: DisplayPriceUnit; retailMicrousd: number;
  scope: "generation" | "input" | "settlement" | "reservation" | "tool" | "storage";
  condition?: string; tierMinInputTokens?: number; tierMaxInputTokens?: number | null;
};
export type DisplayModelPrice = {
  provider: "apimart"; model: string; name: string; kind: "chat" | "image" | "video" | "audio";
  rates: DisplayPriceRate[]; available: boolean; billingReady: boolean; notes: string[]; capabilitiesNotes: string[];
};
const units: Record<string, DisplayPriceUnit> = {
  usd_per_million_tokens: "1M_tokens", usd_per_image: "image", usd_per_second: "second",
  usd_per_call: "call", usd_per_1000_queries: "1000_queries", usd_per_million_token_hours: "1M_token_hours",
};
const labels: Record<string, string> = {
  input: "输入", output: "输出", cached_input: "缓存输入", explicit_cached_input: "显式缓存输入",
  cache_write: "缓存写入", cache_write_5m: "缓存写入 · 5 分钟", cache_write_1h: "缓存写入 · 1 小时",
  text_input: "文本输入", cached_text_input: "缓存文本输入", image_input: "图像输入",
  cached_image_input: "缓存图像输入", text_output: "文本输出", image_output: "图像输出",
  google_web_search: "Google 网页搜索", web_search: "网页搜索", image_search: "图片搜索",
  code_interpreter: "代码执行", web_extractor: "网页提取", web_search_image: "网页图片搜索",
};
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
function amount(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000; }
function name(value: unknown, fallback = "") { return typeof value === "string" ? publicServiceText(value.slice(0, 160)) : fallback; }
function retail(value: unknown, factor = 1): number {
  if (!amount(value)) throw new Error("invalid_price");
  return retailUsdMicrousd(value, factor);
}
function rate(dimension: string, label: string, unit: DisplayPriceUnit, value: unknown, scope: DisplayPriceRate["scope"], condition = "", factor = 1): DisplayPriceRate {
  return { dimension, label, unit, retailMicrousd: retail(value, factor), scope, ...(condition ? { condition } : {}) };
}
function fixedRates(value: unknown, prefix: string, label: string, scope: DisplayPriceRate["scope"], condition = "") {
  if (!object(value) || !units[String(value.unit)]) throw new Error("unknown_price_unit");
  const unit = units[String(value.unit)], entries = Array.isArray(value.items) ? value.items : [{ key: "default", after_discount: value.after_discount }];
  if (!entries.length || entries.length > 1000) throw new Error("missing_prices");
  return entries.map(entry => {
    if (!object(entry) || typeof entry.key !== "string" || !entry.key || entry.key.length > 160) throw new Error("invalid_price_dimension");
    const dimension = name(entry.key), suffix = dimension === "default" ? "默认" : dimension;
    return rate(`${prefix}${dimension}`, label ? `${label} · ${suffix}` : suffix, unit, entry.after_discount, scope, condition);
  });
}
function tokenRates(price: Json): DisplayPriceRate[] {
  if (price.unit !== "usd_per_million_tokens" || !object(price.effective_rates)) throw new Error("unknown_token_unit");
  const tiered = Number(price.tier_count) > 1;
  const tiers = tiered ? price.tiers : [object(price.rates) ? price.rates : price.effective_rates];
  if (!Array.isArray(tiers) || !tiers.length || tiers.length > 100 || tiered && tiers.length !== price.tier_count) throw new Error("incomplete_tiers");
  const time = object(price.time_pricing) ? price.time_pricing : null;
  const windows = time && Array.isArray(time.windows) ? time.windows : [null];
  if (!windows.length || windows.length > 32 || time && (!amount(time.current_rate) || time.current_rate <= 0 || !amount(price.price_factor))) throw new Error("invalid_time_prices");
  const output: DisplayPriceRate[] = [];
  let previous = 0;
  for (let index = 0; index < tiers.length; index++) {
    const tier = tiers[index];
    if (!object(tier)) throw new Error("invalid_tier");
    const upper = typeof tier.up_to_input_tokens === "number" ? tier.up_to_input_tokens : null;
    if (upper !== null && (!Number.isSafeInteger(upper) || upper <= previous) || tiered && index < tiers.length - 1 && upper === null) throw new Error("invalid_tier_range");
    const base = index === 0 && object(price.rates) ? price.rates : tier;
    for (const window of windows) {
      if (window !== null && (!object(window) || !amount(window.rate) || typeof window.name !== "string")) throw new Error("invalid_window");
      const current = index === 0 && !time ? price.effective_rates : null;
      const factor = time && object(window)
        ? Number(price.price_factor) / Number(time.current_rate) * Number(window.rate) : price.price_factor;
      const fields = [...new Set([...Object.keys(base), ...Object.keys(current || {})])].filter(key => Object.hasOwn(labels, key));
      const range = tiered ? `${previous ? `输入 > ${previous.toLocaleString("en-US")}` : "输入"}${upper === null ? "，无更高分档" : ` ≤ ${upper.toLocaleString("en-US")}`} tokens` : "";
      const timeCondition = object(window) && time
        ? `${name(window.label, name(window.name))}（${name(time.timezone, "UTC")}，${Array.isArray(window.ranges) ? window.ranges.map(value => name(value)).join(" / ") : "其余时段"}）` : "";
      for (const field of fields) {
        const useEffective = current && amount(current[field]);
        const raw = useEffective ? current[field] : amount(base[field]) && amount(factor) ? base[field] : null;
        if (raw === null) continue;
        const item = rate(`${tiered ? `tier${index + 1}:` : ""}${object(window) ? `${name(window.name)}:` : ""}${field}`,
          labels[field], "1M_tokens", raw, "generation", [range, timeCondition].filter(Boolean).join("；"), useEffective ? 1 : Number(factor));
        if (tiered) { item.tierMinInputTokens = previous; item.tierMaxInputTokens = upper; }
        output.push(item);
      }
    }
    previous = upper ?? previous;
  }
  if (!output.length) throw new Error("missing_token_rates");
  return output;
}
function extraRates(price: Json): DisplayPriceRate[] {
  if (!object(price.extras)) return [];
  const extras = price.extras, output: DisplayPriceRate[] = [];
  // The public pricing page displays these two explicit add-ons directly.
  const search = extras.google_web_search;
  if (object(search)) {
    const unit = units[String(search.unit)]; if (!unit) throw new Error("unknown_tool_unit");
    output.push(rate("tool:google_web_search", labels.google_web_search, unit, search.price, "tool", "启用搜索工具时另计"));
  }
  if (object(extras.tools)) for (const [key, tool] of Object.entries(extras.tools)) {
    if (key === "google_web_search" && object(search)) continue;
    if (!object(tool) || !units[String(tool.unit)] || !amount(tool.price) || !amount(price.price_factor)) throw new Error("unknown_tool_price");
    // Matches the official getEffectiveToolPrice(tool, price_factor) display helper.
    output.push(rate(`tool:${name(key)}`, labels[key] || name(key), units[String(tool.unit)], tool.price, "tool", "启用此工具时另计", price.price_factor));
  }
  const storage = extras.context_cache_storage;
  if (object(storage)) {
    if (!units[String(storage.unit)]) throw new Error("unknown_storage_unit");
    output.push(rate("storage:hour", "显式缓存存储", units[String(storage.unit)], storage.price, "storage", "仅创建显式缓存时计费"));
    if (Array.isArray(storage.supported_ttl)) for (const ttl of storage.supported_ttl) {
      if (!object(ttl) || typeof ttl.ttl !== "string") throw new Error("invalid_storage_duration");
      output.push(rate(`storage:${name(ttl.ttl)}`, `显式缓存存储 · ${name(ttl.ttl)}`, "1M_tokens",
        ttl.price_per_million_tokens, "storage", "按此缓存时长计费，与按小时价格为同一费用的不同表示"));
    }
  }
  return output;
}

function capabilitiesNotes(item: Json, category: string, billingReady: boolean): string[] {
  if (item.id === "suno") return [
    "当前开放 v6、v6-wild、v6-mini 的基础音乐生成；旧版本、续写、转换及其他操作的价格仅供查阅，暂未开放调用。",
  ];
  if (item.id === "flowmusic") return [
    "当前开放 generate 基础音乐生成；其他版本、续写、转换及其他操作的价格仅供查阅，暂未开放调用。",
  ];
  if (category === "llm" && billingReady) {
    const notes = ["当前开放纯文本对话；多模态输入、工具调用和显式缓存创建暂未开放。"];
    if (object(item.pricing) && object(item.pricing.extras) && Object.keys(item.pricing.extras).length) {
      notes.push("下列工具与缓存存储价格供查阅，不代表这些附加功能已开放。");
    }
    return notes;
  }
  if ((category === "image" || category === "video") && billingReady) return [
    "当前开放已核定参数的新生成请求；专用编辑和扩展接口、外部视频或音频输入及动作迁移暂未开放，参考图仅支持已核定的参数组合。",
  ];
  return [];
}

/** Full display catalogue, independent of which request adapters are enabled. Never returns supplier fields. */
export function parseApimartDisplayPricing(payload: unknown, observedAt = new Date().toISOString()) {
  if (!object(payload) || payload.success !== true || !object(payload.data) || !object(payload.data.models)) throw new PricingError("tokvilo 价格目录暂不可用。", 502);
  let executable: Set<string>;
  try { executable = new Set(parseApimartPricing(payload).models.map(model => model.model)); } catch { executable = new Set(); }
  const models: DisplayModelPrice[] = [], unavailable: { model: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const [category, entries] of Object.entries(payload.data.models)) {
    if (!["llm", "image", "video", "audio"].includes(category) || !Array.isArray(entries)) continue;
    for (const item of entries) {
      if (!object(item) || typeof item.id !== "string" || !item.id || item.id.length > 200) continue;
      if (seen.has(item.id)) throw new PricingError("价格目录包含重复模型。", 502);
      seen.add(item.id);
      const model = publicModelId(item.id), notes: string[] = [], rates: DisplayPriceRate[] = [];
      try {
        if (object(item.fixed_prices)) rates.push(...fixedRates(item.fixed_prices, "", "", item.token_settlement_prices ? "reservation" : "generation",
          item.token_settlement_prices ? "生成预留参考；最终按下列 token 单价结算" : ""));
        else if (object(item.pricing)) rates.push(...tokenRates(item.pricing));
        else throw new Error("missing_price");
      } catch { notes.push("部分生成价格尚未明确，请等待完整报价。"); }
      if (item.token_settlement_prices) try {
        rates.push(...fixedRates(item.token_settlement_prices, "settlement:", "最终结算", "settlement"));
      } catch { notes.push("最终结算单价尚未明确。"); }
      if (object(item.input_material_prices)) for (const [material, price] of Object.entries(item.input_material_prices)) {
        if (!object(price)) { notes.push("参考素材价格尚未明确。"); continue; }
        const conditions = ["参考素材另计",
          Number.isSafeInteger(price.free_count) && Number(price.free_count) >= 0 ? `前 ${price.free_count} 项免费` : "",
          Number.isSafeInteger(price.max_billable_seconds) && Number(price.max_billable_seconds) > 0 ? `最多计 ${price.max_billable_seconds} 秒` : "",
        ].filter(Boolean).join("；");
        try { rates.push(...fixedRates(price, `input:${material}:`, `参考${material === "image" ? "图片" : material === "video" ? "视频" : name(material)}`, "input", conditions)); }
        catch { notes.push("参考素材价格尚未明确。"); }
      }
      if (object(item.pricing)) try { rates.push(...extraRates(item.pricing)); }
      catch { notes.push("部分附加功能价格尚未明确，调用前需另行确认。"); }
      if (!rates.length) unavailable.push({ model, reason: "此模型暂未取得明确报价。" });
      const kind = category === "llm" ? "chat" : category as "image" | "video" | "audio";
      models.push({ provider: "apimart", model, name: name(publicModelId(name(item.name, item.id)), model), kind, rates,
        available: rates.length > 0, billingReady: executable.has(item.id), notes: [...new Set(notes)],
        capabilitiesNotes: capabilitiesNotes(item, category, executable.has(item.id)) });
    }
  }
  if (!models.length) throw new PricingError("tokvilo 价格目录为空。", 502);
  return { observedAt, models, unavailable };
}
export async function getApimartDisplayPricing(fetcher: typeof fetch = fetch) {
  return parseApimartDisplayPricing(await fetchApimartPricingPayload(fetcher));
}
