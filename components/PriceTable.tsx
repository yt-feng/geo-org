"use client";

import { displayServiceText, serviceLabel } from "@/lib/brand-display";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSiteLocale } from "./LocaleProvider";
import { englishPriceText } from "@/lib/price-copy";
import { OfficialPriceComparison } from "./OfficialPriceComparison";
import { ProviderLogo } from "./ProviderLogo";
import { groupModels, modelProvider, providerIdentity } from "@/lib/model-identity";
import { modelRequestKind, modelWorkbenchUrl, type ModelCategory } from "@/lib/model-catalog";

type Rate = { dimension: string; label?: string; unit: string; retailMicrousd: number; condition?: string };
type ModelPrice = { provider: string; model: string; name: string; kind: string; rates: Rate[]; billingReady?: boolean; notes?: string[]; capabilitiesNotes?: string[] };
type Catalog = { observedAt: string; models: ModelPrice[]; unavailable?: { model: string; reason: string }[] };
const labels: Record<string, string> = { input: "输入", output: "输出", cacheRead: "缓存读取", cacheWrite: "缓存写入", fixed: "图像生成", image: "图像生成", cached_input: "缓存输入" };
const units: Record<string, string> = { "1M_tokens": "百万 tokens", image: "张", second: "秒", call: "次", "1000_queries": "千次查询", "1M_token_hours": "百万 token·小时" };
const PAGE_SIZE = 12;
const priceCategory = (model: string, kind: string): ModelCategory => {
  const category = kind === "image" || kind === "video" ? kind : ["audio", "music", "speech", "transcription", "realtime"].includes(kind) ? "audio" : "text";
  return ["audio", "speech", "transcription", "realtime"].includes(modelRequestKind(model, category)) ? "audio" : category;
};
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
  const [family, setFamily] = useState("");
  const [page, setPage] = useState(1);
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/pricing", { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error("暂时无法读取价格，请稍后刷新。");
      setData(value);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, []);
  const serviceModels = data?.models?.filter(item => (!provider || item.provider === provider) && (!model || item.model === model) && (!source || item.provider === source)) || [];
  const candidates = serviceModels.filter(item => !search || `${item.name} ${item.model}`.toLowerCase().includes(search.toLowerCase().trim()));
  const candidateGroups = groupModels(candidates.map(item => ({ ...item, id: item.model, service: item.provider, provider: modelProvider(item.model) })));
  const vendors = Array.from(new Set(groupModels(serviceModels.map(item => ({ ...item, id: item.model, service: item.provider, provider: modelProvider(item.model) }))).map(group => group.provider)));
  const families = candidateGroups.filter(group => !manufacturer || group.provider === manufacturer);
  const groups = families.filter(group => !family || `${group.provider}:${group.family.id}` === family);
  const modelCount = groups.reduce((total, group) => total + group.models.length, 0);
  const pageCount = Math.max(1, Math.ceil(modelCount / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  let offset = 0;
  const visibleGroups = groups.map(group => {
    const groupStart = offset;
    offset += group.models.length;
    return { ...group, total: group.models.length, models: group.models.slice(Math.max(0, start - groupStart), Math.max(0, start + PAGE_SIZE - groupStart)) };
  }).filter(group => group.models.length);
  const vendorName = (value: string) => isEnglish ? providerIdentity(value).nameEn : providerIdentity(value).name;
  const resetPosition = () => { setPage(1); setFamily(""); };
  const focusResults = () => {
    resultsRef.current?.focus({ preventScroll: true });
    resultsRef.current?.scrollIntoView({ block: "start" });
  };
  const selectManufacturer = (value: string) => {
    setManufacturer(value); resetPosition(); focusResults();
  };
  const changePage = (value: number) => {
    setPage(Math.max(1, Math.min(pageCount, value))); focusResults();
  };
  const pagination = (position: "top" | "bottom") => pageCount > 1 ? <nav className="price-pagination" aria-label={position === "top" ? t("价格结果分页", "Price results pagination") : t("价格结果底部分页", "Price results pagination at bottom")}>
    <button type="button" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>{t("上一页", "Previous")}</button>
    <label>{t("页码", "Page")}<select aria-label={t("选择价格页码", "Select price page")} value={currentPage} onChange={event => changePage(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} / {pageCount}</option>)}</select></label>
    <button type="button" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>{t("下一页", "Next")}</button>
  </nav> : null;
  const priceCard = (item: ModelPrice) => <section className="price-model" key={`${item.provider}:${item.model}`}>
    <div className="price-model-heading"><div><small>{serviceName(item.provider)}</small><h3>{copy(item.name || item.model)}</h3><code>{item.model}</code></div><Link href={href(modelWorkbenchUrl({ id: item.model, category: priceCategory(item.model, item.kind), upstream: item.provider === "tokenhub" || item.provider === "selected" ? item.provider : "apimart" }))}>{t("打开工作台 ↗", "Open playground ↗")}</Link></div>
    {item.billingReady === false ? <p className="price-caption">{item.provider === "selected" ? t("价格已列示 · 服务待开通", "Pricing listed · Activation pending") : t("价格已列示 · 接口暂未开放", "Pricing listed · Interface unavailable")}</p> : null}
    {item.kind === "chat" ? <OfficialPriceComparison price={item} /> : null}
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
      <div className={model ? "price-detail-layout" : "price-browser"}>
        {!model ? <aside className="price-sidebar" aria-label={t("按厂商浏览价格", "Browse prices by provider")}>
          <div className="price-sidebar-title">{t("按厂商浏览", "Browse providers")}</div>
          <label className="price-mobile-provider">{t("厂商", "Provider")}<select value={manufacturer} onChange={event => selectManufacturer(event.target.value)}><option value="">{t("全部厂商", "All providers")} · {candidates.length}</option>{vendors.map(vendor => <option key={vendor} value={vendor}>{vendorName(vendor)} · {candidates.filter(item => modelProvider(item.model) === vendor).length}</option>)}</select></label>
          <nav className="price-provider-list" aria-label={t("价格厂商导航", "Pricing providers")}>
            <button type="button" aria-pressed={!manufacturer} onClick={() => selectManufacturer("")}><span>{t("全部厂商", "All providers")}</span><small>{candidates.length}</small></button>
            {vendors.map(vendor => <button type="button" key={vendor} aria-pressed={manufacturer === vendor} onClick={() => selectManufacturer(vendor)}><ProviderLogo provider={vendor} size={24} /><span>{vendorName(vendor)}</span><small>{candidates.filter(item => modelProvider(item.model) === vendor).length}</small></button>)}
          </nav>
        </aside> : null}
        <div className="price-results" ref={resultsRef} tabIndex={-1} role="region" aria-label={t("价格结果", "Price results")}>
          {!model ? <>
            <div className="price-filters">
              <label>{t("查找模型", "Find a model")}<input value={search} onChange={event => { setSearch(event.target.value); resetPosition(); }} placeholder={t("搜索模型或版本…", "Search models or versions…")} /></label>
              {!provider ? <label>{t("服务", "Service")}<select aria-label={t("筛选价格服务", "Filter pricing service")} value={source} onChange={event => { setSource(event.target.value); setManufacturer(""); resetPosition(); }}><option value="">{t("全部服务", "All services")}</option><option value="tokenhub">{t("tokvilo 多模态", "tokvilo Multimodal")}</option><option value="apimart">{t("tokvilo 模型服务", "tokvilo Models")}</option><option value="selected">{t("tokvilo 精选", "tokvilo Select")}</option></select></label> : null}
              <label>{t("模型系列", "Model family")}<select value={family} onChange={event => { setFamily(event.target.value); setPage(1); }}><option value="">{t("全部系列", "All families")}</option>{families.map(group => <option key={`${group.provider}:${group.family.id}`} value={`${group.provider}:${group.family.id}`}>{isEnglish ? group.family.nameEn : group.family.name} · {group.models.length}</option>)}</select></label>
            </div>
            <div className="price-results-heading"><div><h2>{manufacturer ? vendorName(manufacturer) : t("全部厂商", "All providers")}{family ? ` / ${isEnglish ? groups[0]?.family.nameEn || "" : groups[0]?.family.name || ""}` : ""}</h2><p role="status">{modelCount ? t(`显示 ${start + 1}–${Math.min(start + PAGE_SIZE, modelCount)} / 共 ${modelCount} 个服务版本`, `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, modelCount)} of ${modelCount} service versions`) : t("没有匹配的服务版本", "No matching service versions")}</p></div>{pagination("top")}</div>
            <p className="price-caption">{t("同系列版本并排比较，每页最多展示 12 个。展开完整费率可查看所有计费单位、上下文档位与附加费用。", "Compare versions side by side, up to 12 per page. Expand full rates for all billing units, context tiers and additional charges.")}</p>
          </> : null}
          {!modelCount ? <div className="price-empty"><p>{t("没有匹配的报价。", "No matching prices.")}</p>{!model ? <button type="button" onClick={() => { setSearch(""); setSource(""); setManufacturer(""); resetPosition(); }}>{t("清除价格筛选", "Clear filters")}</button> : null}</div> : model ? candidates.map(priceCard) : visibleGroups.map(group => <section className="price-family" key={`${group.provider}:${group.family.id}`}>
            <header className="price-family-heading"><ProviderLogo provider={group.provider} size={30} /><div><small>{vendorName(group.provider)}</small><h2>{isEnglish ? group.family.nameEn : group.family.name}</h2></div><span>{group.models.length === group.total ? t(`${group.total} 个服务版本`, `${group.total} service versions`) : t(`本页 ${group.models.length} / 共 ${group.total} 个`, `${group.models.length} of ${group.total} on this page`)}</span></header>
            <div className="price-family-grid">{group.models.map(item => priceCard({ ...item, provider: item.service }))}</div>
          </section>)}
          {!model ? pagination("bottom") : null}
        </div>
      </div>
      {!model && !!data.unavailable?.length ? <details><summary>{data.unavailable.length} {t("项报价暂不可用", "prices unavailable")}</summary>{data.unavailable.map((item, index) => <p key={index}>{item.model}：{copy(item.reason)}</p>)}</details> : null}
      <p className="price-caption">{t("报价读取时间：", "Prices retrieved: ")}{new Date(data.observedAt).toLocaleString(isEnglish ? "en-US" : "zh-CN", { timeZone: "Asia/Shanghai" })}{t("（北京时间）。最终扣费按实际用量计算，金额向上取整到百万分之一美元。", " (UTC+8). Final charges use actual usage, rounded up to the nearest micro-USD.")}</p>
    </>}
  </div>;
}
