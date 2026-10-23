"use client";

import { displayServiceText, serviceLabel } from "@/lib/brand-display";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSiteLocale } from "./LocaleProvider";
import { englishPriceText } from "@/lib/price-copy";
import { ProviderLogo } from "./ProviderLogo";
import { groupModels, modelProvider, providerIdentity } from "@/lib/model-identity";

type Rate = { dimension: string; label?: string; unit: string; retailMicrousd: number; condition?: string };
type ModelPrice = { provider: string; model: string; name: string; kind: string; rates: Rate[]; billingReady?: boolean; notes?: string[]; capabilitiesNotes?: string[] };
type Catalog = { observedAt: string; models: ModelPrice[]; unavailable?: { model: string; reason: string }[] };
const labels: Record<string, string> = { input: "输入", output: "输出", cacheRead: "缓存读取", cacheWrite: "缓存写入", fixed: "图像生成", image: "图像生成", cached_input: "缓存输入" };
const units: Record<string, string> = { "1M_tokens": "百万 tokens", image: "张", second: "秒", call: "次", "1000_queries": "千次查询", "1M_token_hours": "百万 token·小时" };
const money = (value: number) => `$${(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
const keyRates = (rates: Rate[]) => {
  const input = rates.find(rate => /^(?:.*:)?input$/.test(rate.dimension));
  const output = rates.find(rate => /^(?:.*:)?output$/.test(rate.dimension));
  return input && output ? [input, output] : rates.slice(0, 2);
};

export function PriceTable({ provider, model }: { provider?: string; model?: string }) {
  const { t, isEnglish, href } = useSiteLocale();
  const copy = (value: string) => isEnglish ? englishPriceText(displayServiceText(value)) : displayServiceText(value);
  const serviceName = (value: string) => isEnglish ? ({ tokenhub: "tokvilo Multimodal", apimart: "tokvilo Models", selected: "tokvilo Select" }[value] || displayServiceText(value)) : serviceLabel(value);
  const unit = (value: string) => isEnglish ? ({ "1M_tokens": "1M tokens", image: "image", second: "second", call: "request", "1000_queries": "1,000 queries", "1M_token_hours": "1M token-hours" }[value] || value) : units[value] || value;
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [limit, setLimit] = useState(8);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/pricing", { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error("暂时无法读取价格，请稍后刷新。");
      setData(value);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, []);
  const models = data?.models?.filter(item => (!provider || item.provider === provider) && (!model || item.model === model) && (!source || item.provider === source) && (!manufacturer || modelProvider(item.model) === manufacturer) && (!search || `${item.name} ${item.model}`.toLowerCase().includes(search.toLowerCase().trim()))) || [];
  const groups = groupModels(models.map(item => ({ ...item, id: item.model, service: item.provider, provider: modelProvider(item.model) })));
  const vendors = Array.from(new Set((data?.models || []).map(item => modelProvider(item.model))));
  const priceCard = (item: ModelPrice) => <section className="price-model" key={`${item.provider}:${item.model}`}>
    <div className="price-model-heading"><div><small>{serviceName(item.provider)}</small><h3>{copy(item.name || item.model)}</h3><code>{item.model}</code></div>{item.billingReady !== false ? <Link href={href(item.provider === "tokenhub" ? `/studio?model=${encodeURIComponent(item.model)}&mode=${item.kind}` : item.provider === "selected" ? `/selected?model=${encodeURIComponent(item.model)}` : `/playground?model=${encodeURIComponent(item.model)}`)}>{t("打开工作台 ↗", "Open playground ↗")}</Link> : <span>{item.provider === "selected" ? t("价格已列示 · 服务待开通", "Pricing listed · Activation pending") : t("价格已列示 · 接口暂未开放", "Pricing listed · Interface unavailable")}</span>}</div>
    {item.capabilitiesNotes?.map(note => <p className="price-caption" key={note}>{copy(note)}</p>)}
    <details className="price-rate-detail" open={!!model}>
      <summary>{t("查看完整费率", "View full rates")} <span>{item.rates.length} {t("个计费项", "rate items")}</span></summary>
      {item.rates.length ? <div className="price-scroll"><table><thead><tr><th>{t("计费项", "Rate")}</th><th>{t("单位", "Unit")}</th><th>{t("tokvilo 价格", "tokvilo price")}</th></tr></thead><tbody>{item.rates.map(rate => <tr key={rate.dimension}><td>{copy(rate.label || labels[rate.dimension] || rate.dimension)}{rate.condition ? <small style={{ display: "block" }}>{copy(rate.condition)}</small> : null}</td><td>{unit(rate.unit)}</td><td><strong>{money(rate.retailMicrousd)}</strong></td></tr>)}</tbody></table></div> : <p>{t("报价暂不可用。", "Pricing unavailable.")}</p>}
      {item.notes?.map(note => <p className="price-caption" key={note}>{copy(note)}</p>)}
    </details>
    {!model ? <div className="price-preview" aria-label={t("主要费率", "Key rates")}>{keyRates(item.rates).map(rate => <div key={rate.dimension}><span>{copy(rate.label || labels[rate.dimension] || rate.dimension)}{rate.condition ? ` · ${copy(rate.condition)}` : ""}</span><strong>{money(rate.retailMicrousd)}<small> / {unit(rate.unit)}</small></strong></div>)}</div> : null}
  </section>;
  return <div className="tokvilo-prices">
    {error ? <p role="status">{t(displayServiceText(error), "Pricing is temporarily unavailable. Please refresh this page.")}</p> : !data ? <p role="status">{t("正在读取价格…", "Loading prices…")}</p> : <>
      {!model ? <><div className="price-filters"><label>{t("查找模型", "Find a model")}<input value={search} onChange={event => { setSearch(event.target.value); setLimit(8); }} placeholder={t("搜索模型或版本…", "Search models or versions…")} /></label>{!provider ? <label>{t("服务", "Service")}<select value={source} onChange={event => { setSource(event.target.value); setLimit(8); }}><option value="">{t("全部服务", "All services")}</option><option value="tokenhub">{t("tokvilo 多模态", "tokvilo Multimodal")}</option><option value="apimart">{t("tokvilo 模型服务", "tokvilo Models")}</option><option value="selected">{t("tokvilo 精选", "tokvilo Select")}</option></select></label> : null}<label>{t("厂商", "Provider")}<select value={manufacturer} onChange={event => { setManufacturer(event.target.value); setLimit(8); }}><option value="">{t("全部厂商", "All providers")}</option>{vendors.map(vendor => <option key={vendor} value={vendor}>{isEnglish ? providerIdentity(vendor).nameEn : providerIdentity(vendor).name}</option>)}</select></label><span role="status">{models.length} {t("个服务版本", "service versions")} · {groups.length} {t("个系列", "families")}</span></div><p className="price-caption">{t("同一系列的版本并排展示。不同计费单位独立列示；展开完整费率可查看上下文档位与附加费用。", "Versions in each family appear side by side. Billing units are listed separately; expand full rates for context tiers and additional charges.")}</p></> : null}
      {!models.length ? <div className="price-empty"><p>{t("没有匹配的报价。", "No matching prices.")}</p><button type="button" onClick={() => { setSearch(""); setSource(""); setManufacturer(""); setLimit(8); }}>{t("清除价格筛选", "Clear filters")}</button></div> : model ? models.map(priceCard) : groups.slice(0, limit).map(group => <section className="price-family" key={`${group.provider}:${group.family.id}`}>
        <header className="price-family-heading"><ProviderLogo provider={group.provider} size={30} /><div><small>{isEnglish ? providerIdentity(group.provider).nameEn : providerIdentity(group.provider).name}</small><h2>{isEnglish ? group.family.nameEn : group.family.name}</h2></div><span>{group.models.length} {t("个服务版本", "service versions")}</span></header>
        <div className="price-family-grid">{group.models.map(item => priceCard({ ...item, provider: item.service }))}</div>
      </section>)}
      {!model && groups.length > limit ? <button type="button" className="price-load-more" onClick={() => setLimit(limit + 8)}>{t(`继续查看系列（剩余 ${groups.length - limit} 组）`, `Show more families (${groups.length - limit} remaining)`)}</button> : null}
      {!model && !!data.unavailable?.length ? <details><summary>{data.unavailable.length} {t("项报价暂不可用", "prices unavailable")}</summary>{data.unavailable.map((item, index) => <p key={index}>{item.model}：{copy(item.reason)}</p>)}</details> : null}
      <p className="price-caption">{t("报价读取时间：", "Prices retrieved: ")}{new Date(data.observedAt).toLocaleString(isEnglish ? "en-US" : "zh-CN", { timeZone: "Asia/Shanghai" })}{t("（北京时间）。最终扣费按实际用量计算，金额向上取整到百万分之一美元。", " (UTC+8). Final charges use actual usage, rounded up to the nearest micro-USD.")}</p>
    </>}
  </div>;
}
