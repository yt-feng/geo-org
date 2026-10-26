"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { serviceLabel } from "@/lib/brand-display";
import { allModelCatalog, modelCategories, modelWorkbenchUrl, type CatalogModel, type ModelCategory, type ModelDirectorySource } from "@/lib/model-catalog";
import { groupModels, modelFamily, providerIdentity, type ModelFamily } from "@/lib/model-identity";
import { isChatModel, modelSelectionKey } from "@/lib/model-selection-ui";
import { ProviderLogo } from "./ProviderLogo";
import { Icon } from "./Icon";
import { PriceTable } from "./PriceTable";
import { useSiteLocale } from "./LocaleProvider";

type ServiceFilter = "all" | "apimart" | "tokenhub" | "selected";
export type MarketFilters = { category: ModelCategory | "all"; provider: string; family: string; query: string; service: ServiceFilter; capabilities: string[]; list: boolean; page: number };
const emptyFilters: MarketFilters = { category: "all", provider: "", family: "", query: "", service: "all", capabilities: [], list: false, page: 1 };
export const MARKET_PAGE_SIZE = 12;
const publicServices: Record<string, ServiceFilter> = { gateway: "apimart", studio: "tokenhub", selected: "selected" };
const serviceKeys: Record<ServiceFilter, string> = { all: "", apimart: "gateway", tokenhub: "studio", selected: "selected" };

// Public URL filters are shareable. Canonical manufacturer IDs are case-insensitive;
// service IDs remain separate so identical model IDs never select another route.
export function readMarketFilters(params: URLSearchParams, catalog: CatalogModel[]): MarketFilters {
  const category = modelCategories.some(item => item.id === params.get("category")) ? params.get("category") as ModelCategory : "all";
  const requestedService = params.get("service") || "";
  const service = Object.hasOwn(publicServices, requestedService) ? publicServices[requestedService] : "all";
  const scope = catalog.filter(model => (category === "all" || model.category === category) && (service === "all" || (model.upstream || "apimart") === service));
  const requestedProvider = params.get("provider");
  const provider = requestedProvider && scope.some(model => providerIdentity(model.provider).id === providerIdentity(requestedProvider).id) ? providerIdentity(requestedProvider).id : "";
  const familyScope = scope.filter(model => !provider || providerIdentity(model.provider).id === provider);
  const family = familyScope.some(model => modelFamily(model).id === params.get("family")) ? params.get("family")! : "";
  const capabilities = Array.from(new Set(params.getAll("capability"))).filter(capability => familyScope.some(model => model.capabilities.includes(capability)));
  return { category, service, provider, family, capabilities, query: (params.get("q") || "").slice(0, 200), list: params.get("view") === "list", page: Math.max(1, Math.min(100000, Math.floor(Number(params.get("page")) || 1))) };
}

export function marketFilterParams(filters: MarketFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.category !== "all") params.set("category", filters.category);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.family) params.set("family", filters.family);
  if (filters.query) params.set("q", filters.query);
  if (filters.service !== "all") params.set("service", serviceKeys[filters.service]);
  filters.capabilities.forEach(capability => params.append("capability", capability));
  if (filters.list) params.set("view", "list");
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

export function filterMarketModels(catalog: CatalogModel[], filters: MarketFilters): CatalogModel[] {
  const query = filters.query.toLowerCase().trim();
  return catalog.filter(model => (filters.category === "all" || model.category === filters.category)
    && (filters.service === "all" || (model.upstream || "apimart") === filters.service)
    && (!filters.provider || providerIdentity(model.provider).id === filters.provider)
    && (!filters.family || modelFamily(model).id === filters.family)
    && filters.capabilities.every(value => model.capabilities.includes(value))
    && `${model.name} ${model.id} ${providerIdentity(model.provider).name} ${providerIdentity(model.provider).nameEn} ${modelFamily(model).name} ${modelFamily(model).nameEn} ${serviceLabel(model.upstream || "apimart")}`.toLowerCase().includes(query));
}

const capabilityEnglish: Record<string, string> = { "文本生成": "Text generation", "图像生成": "Image generation", "视频生成": "Video generation", "音乐生成": "Music generation", "音频处理": "Audio processing", "向量嵌入": "Embeddings", "内容审核": "Moderation", "语音转写": "Transcription", "语音合成": "Text to speech", "实时音频": "Realtime audio", "文本补全": "Text completion", "对话": "Chat", "文生图": "Text to image", "图生图": "Image to image", "文生视频": "Text to video", "图生视频": "Image to video", "任务查询": "Task status" };
const categoryEnglish: Record<ModelCategory, string> = { text: "Text", image: "Image", video: "Video", audio: "Audio" };

export function ModelMarket({ catalog = allModelCatalog, live = false, observedAt, sources = [] }: { catalog?: CatalogModel[]; live?: boolean; observedAt?: string; sources?: ModelDirectorySource[] }) {
  const { isEnglish, t, href } = useSiteLocale();
  const providerName = (value: string) => { const identity = providerIdentity(value); return isEnglish ? identity.nameEn || identity.name : identity.name; };
  const familyName = (family: ModelFamily) => isEnglish ? family.nameEn || family.name : family.name;
  const modelName = (value: string) => isEnglish ? value.replaceAll("tokvilo 模型服务", "tokvilo Models").replaceAll("tokvilo 多模态", "tokvilo Multimodal").replaceAll("tokvilo 精选", "tokvilo Select") : value;
  const capabilityName = (value: string) => isEnglish ? capabilityEnglish[value] || value : value;
  const categoryName = (value: ModelCategory) => isEnglish ? categoryEnglish[value] : modelCategories.find(item => item.id === value)?.label;
  const serviceName = (value: ServiceFilter) => isEnglish ? value === "selected" ? "tokvilo Select" : value === "tokenhub" ? "tokvilo Multimodal" : "tokvilo Models" : serviceLabel(value);
  const statusLabel = (model: CatalogModel) => model.upstream === "tokenhub" ? t("版本参考", "Reference version") : model.available === true ? t("工作台已配置", "Playground configured") : model.available === false ? t("待开放", "Coming later") : t("状态待确认", "Status unconfirmed");
  const [filters, setFilters] = useState<MarketFilters>(emptyFilters);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const results = useRef<HTMLDivElement>(null);
  const revealResults = useRef(false);
  const [detail, setDetail] = useState<CatalogModel | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const gatewaySource = sources.find(source => source.service === "gateway");
  const gatewayLive = gatewaySource?.live ?? live;
  const gatewayObservedAt = gatewaySource?.observedAt ?? observedAt;
  const selectedSource = sources.find(source => source.service === "selected");

  useEffect(() => {
    const restore = () => setFilters(readMarketFilters(new URLSearchParams(window.location.search), catalog));
    // URL state is an external browser source; restore it after hydration and on Back/Forward.
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [catalog]);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || dialog.current?.open || target?.isContentEditable || target?.closest("input, textarea, select")) return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  useEffect(() => { if (detail && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [detail]);

  useEffect(() => {
    if (!revealResults.current) return;
    revealResults.current = false;
    results.current?.focus({ preventScroll: true });
    results.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [filters]);

  function updateFilters(patch: Partial<MarketFilters>, replace = false, reveal = false) {
    const next = { ...filters, page: 1, ...patch };
    if (reveal) { revealResults.current = true; setNavigationOpen(false); }
    setFilters(next);
    const params = marketFilterParams(next).toString();
    const url = `${window.location.pathname}${params ? `?${params}` : ""}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history[replace ? "replaceState" : "pushState"](window.history.state, "", url);
      window.dispatchEvent(new Event("tokvilo:locationchange"));
    }
  }
  const reset = () => updateFilters({ ...emptyFilters, list: filters.list });
  const scope = catalog.filter(model => (filters.category === "all" || model.category === filters.category) && (filters.service === "all" || (model.upstream || "apimart") === filters.service));
  const providerGroups = groupModels(scope);
  const providerOptions = Array.from(new Map(providerGroups.map(group => [providerIdentity(group.provider).id, group.provider])).values());
  const manufacturerScope = scope.filter(model => !filters.provider || providerIdentity(model.provider).id === filters.provider);
  const families = Array.from(new Map(groupModels(manufacturerScope).map(group => [group.family.id, group.family])).values());
  const categoryCapabilities = Array.from(new Set(manufacturerScope.flatMap(model => model.capabilities)));
  const models = useMemo(() => filterMarketModels(catalog, filters), [catalog, filters]);
  const groups = useMemo(() => groupModels(models), [models]);
  const hasFilters = !!filters.query || !!filters.provider || !!filters.family || !!filters.capabilities.length || filters.service !== "all" || filters.category !== "all";
  const advancedCount = filters.capabilities.length + Number(filters.service !== "all");
  const overview = !filters.family && !filters.query.trim() && !filters.capabilities.length && !filters.list;
  const itemCount = overview ? groups.length : models.length;
  const pageCount = Math.max(1, Math.ceil(itemCount / MARKET_PAGE_SIZE));
  const currentPage = Math.min(filters.page, pageCount);
  const pageStart = (currentPage - 1) * MARKET_PAGE_SIZE;
  const pageGroups = overview ? groups.slice(pageStart, pageStart + MARKET_PAGE_SIZE) : groupModels(groups.flatMap(group => group.models).slice(pageStart, pageStart + MARKET_PAGE_SIZE));
  const visibleManufacturers = Array.from(new Map(pageGroups.map(group => [providerIdentity(group.provider).id, group.provider])).values());
  const selectedFamily = families.find(family => family.id === filters.family);

  function pagination(position: string) {
    if (pageCount <= 1) return null;
    return <nav className="market-pagination" aria-label={t(`模型目录${position === "top" ? "顶部" : "底部"}分页`, `Catalogue pagination ${position}`)}>
      <span aria-live="polite">{t(`第 ${pageStart + 1}–${Math.min(pageStart + MARKET_PAGE_SIZE, itemCount)} 项，共 ${itemCount} ${overview ? "个系列" : "个模型"}`, `${pageStart + 1}–${Math.min(pageStart + MARKET_PAGE_SIZE, itemCount)} of ${itemCount} ${overview ? "families" : "models"}`)}</span>
      <div><button type="button" disabled={currentPage === 1} onClick={() => updateFilters({ page: currentPage - 1 }, false, true)} aria-label={t("上一页", "Previous page")}>← {t("上一页", "Previous")}</button><label><select aria-label={t("选择页码", "Choose page")} value={currentPage} onChange={event => updateFilters({ page: Number(event.target.value) }, false, true)}>{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{t(`第 ${index + 1} / ${pageCount} 页`, `${index + 1} / ${pageCount}`)}</option>)}</select></label><button type="button" disabled={currentPage === pageCount} onClick={() => updateFilters({ page: currentPage + 1 }, false, true)} aria-label={t("下一页", "Next page")}>{t("下一页", "Next")} →</button></div>
    </nav>;
  }

  function modelCard(model: CatalogModel) {
    return <article className="market-model-card" key={`${model.upstream || "apimart"}:${model.category}:${model.id}`} data-model-id={model.id} data-service={serviceKeys[model.upstream || "apimart"]}>
      <div className="model-card-content">
        <div className="model-card-top"><span className="model-category-label">{categoryName(model.category)}</span><span className={`model-availability${model.available === true && model.upstream !== "tokenhub" ? " model-availability-ready" : ""}`}><i />{statusLabel(model)}</span></div>
        <h4><button type="button" onClick={() => setDetail(model)}>{modelName(model.name)}</button></h4>
        <code className="model-exact-id" title={model.id}>{model.id}</code>
        {isChatModel(model) ? <Link className="market-compare-link" href={href(`/compare?models=${encodeURIComponent(modelSelectionKey(model))}`)}>{t("比较能力与版本 ↗", "Compare capabilities & versions ↗")}</Link> : null}
        <div className="model-card-tags">{model.capabilities.map(item => <span key={item}>{capabilityName(item)}</span>)}</div>
      </div>
      <div className="model-card-footer"><span>{serviceName(model.upstream || "apimart")}</span><button className="model-detail-button" type="button" aria-label={t(`查看 ${model.name} · ${serviceName(model.upstream || "apimart")} 的价格与详情`, `View pricing and details for ${modelName(model.name)} · ${serviceName(model.upstream || "apimart")}`)} onClick={() => setDetail(model)}>{t("价格与详情", "Pricing & details")}<Icon name="arrow-right" size={14} /></button><Link className="model-detail-button" href={href(modelWorkbenchUrl(model))} aria-label={t(`打开 ${model.name} · ${serviceName(model.upstream || "apimart")} 的 Playground`, `Open playground for ${modelName(model.name)} · ${serviceName(model.upstream || "apimart")}`)}>Playground<Icon name="arrow-up-right" size={14} /></Link></div>
    </article>;
  }

  return <section className="market-catalog" aria-label={t("模型目录", "Model catalogue")}>
    <div className="selection-market-banner"><div><h2>{t("型号太多，不知道选哪个？", "Too many models to choose from?")}</h2><p>{t("按任务获取建议，或者并排比较不同代际的能力与官方价格。", "Get a task-based shortlist or compare generations, capabilities and official prices.")}</p></div><div><Link className="button button-secondary" href={href("/compare")}>{t("比较模型", "Compare models")}</Link><Link className="button button-primary" href={href("/advisor")}>{t("帮我选模型 →", "Help me choose →")}</Link></div></div>
    <div className="market-browser-layout">
      <aside className="market-sidebar" aria-label={t("厂商与系列导航", "Provider and family navigation")}>
        <button type="button" className="market-sidebar-toggle" aria-expanded={navigationOpen} aria-controls="market-sidebar-navigation" onClick={() => setNavigationOpen(!navigationOpen)}><span><Icon name="list" size={20} />{filters.provider ? providerName(filters.provider) : t("浏览厂商与系列", "Browse providers & families")}{selectedFamily ? ` / ${familyName(selectedFamily)}` : ""}</span><Icon name="chevron-down" size={18} /></button>
        <div className={`market-sidebar-content${navigationOpen ? " is-open" : ""}`} id="market-sidebar-navigation">
          <div className="market-sidebar-title"><strong>{t("厂商与系列", "Providers & families")}</strong><span>{providerOptions.length}</span></div>
          <nav aria-label={t("模型厂商", "Model provider")}>
            <button type="button" className="market-sidebar-provider" aria-current={!filters.provider && !filters.family ? "true" : undefined} onClick={() => updateFilters({ provider: "", family: "", capabilities: [] }, false, true)}><Icon name="grid" size={22} /><span>{t("全部厂商", "All providers")}</span><small>{scope.length}</small></button>
            {providerOptions.map(provider => {
              const providerId = providerIdentity(provider).id;
              const providerFamilies = providerGroups.filter(group => providerIdentity(group.provider).id === providerId);
              const selected = filters.provider === providerId;
              return <div className="market-sidebar-group" key={providerId}>
                <button type="button" className="market-sidebar-provider" aria-current={selected && !filters.family ? "true" : undefined} aria-expanded={selected} onClick={() => updateFilters({ provider: providerId, family: "", capabilities: [] }, false, true)}><ProviderLogo provider={provider} size={24} /><span>{providerName(provider)}</span><small>{providerFamilies.reduce((sum, group) => sum + group.models.length, 0)}</small></button>
                {selected ? <div className="market-sidebar-families" role="group" aria-label={t(`${providerName(provider)} 模型系列`, `${providerName(provider)} model families`)}>{providerFamilies.map(group => <button key={group.family.id} type="button" aria-current={filters.family === group.family.id ? "true" : undefined} onClick={() => updateFilters({ family: group.family.id }, false, true)}><span>{familyName(group.family)}</span><small>{group.models.length}</small></button>)}</div> : null}
              </div>;
            })}
          </nav>
          <p className="market-sidebar-note">{t("先选厂商，再按系列比较版本。", "Choose a provider, then compare versions by family.")}</p>
        </div>
      </aside>
      <div className="market-browser-main">
        <div className="market-discovery">
          <div className="market-search-row"><label className="market-search"><Icon name="search" size={20} /><input ref={searchInput} aria-label={t("搜索模型", "Search models")} placeholder={t("搜索模型、系列，如 Claude、GPT", "Search models or families — Claude, GPT")} value={filters.query} onChange={event => updateFilters({ query: event.target.value }, true)} />{filters.query ? <button type="button" aria-label={t("清空搜索", "Clear search")} onClick={() => updateFilters({ query: "" }, true)}><Icon name="close" size={18} /></button> : <kbd>/</kbd>}</label><div className="market-view-switch" role="group" aria-label={t("目录视图", "Catalogue view")}><button type="button" aria-pressed={!filters.list} onClick={() => updateFilters({ list: false })}><Icon name="grid" size={18} />{t("按系列", "Families")}</button><button type="button" aria-pressed={filters.list} onClick={() => updateFilters({ list: true })}><Icon name="list" size={18} />{t("列表", "List")}</button></div></div>
          <div className="market-tabs" role="group" aria-label={t("模型类型", "Model type")}><button type="button" aria-pressed={filters.category === "all"} onClick={() => updateFilters({ category: "all", provider: "", family: "", capabilities: [] })}>{t("全部", "All")}<span>{catalog.length}</span></button>{modelCategories.map(item => <button key={item.id} type="button" aria-pressed={filters.category === item.id} onClick={() => updateFilters({ category: item.id, provider: "", family: "", capabilities: [] })}><Icon name={item.icon} size={18} />{categoryName(item.id)}<span>{catalog.filter(model => model.category === item.id).length}</span></button>)}</div>
          <details className="market-advanced"><summary><Icon name="sliders" size={18} />{t("服务与能力筛选", "Service & capability filters")}{advancedCount ? <span>{advancedCount}</span> : null}<Icon name="chevron-down" size={16} /></summary><div className="market-advanced-content"><fieldset><legend>{t("tokvilo 服务", "tokvilo service")}</legend><div className="market-capabilities">{(["all", "apimart", "tokenhub", "selected"] as const).map(service => <label key={service}><input type="radio" name="model-service" checked={filters.service === service} onChange={() => updateFilters({ service, provider: "", family: "", capabilities: [] })} /><span>{service === "all" ? t("全部服务", "All services") : serviceName(service)}</span></label>)}</div></fieldset><fieldset><legend>{t("模型能力", "Capabilities")}</legend><div className="market-capabilities">{categoryCapabilities.map(item => <label key={item}><input type="checkbox" checked={filters.capabilities.includes(item)} onChange={() => updateFilters({ capabilities: filters.capabilities.includes(item) ? filters.capabilities.filter(value => value !== item) : [...filters.capabilities, item] })} /><span>{capabilityName(item)}</span></label>)}</div></fieldset></div></details>
        </div>
        <div ref={results} className="market-results" tabIndex={-1} aria-label={t("目录结果", "Catalogue results")}>
          {filters.family ? <button type="button" className="market-family-back" onClick={() => updateFilters({ family: "", query: "", capabilities: [], list: false }, false, true)}>← {filters.provider ? t(`返回 ${providerName(filters.provider)} 全部系列`, `All ${providerName(filters.provider)} families`) : t("返回全部系列", "All model families")}</button> : null}
          <div className="market-results-heading"><div><h2>{selectedFamily ? familyName(selectedFamily) : filters.query ? t("搜索结果", "Search results") : filters.provider ? providerName(filters.provider) : overview ? t("探索模型系列", "Explore model families") : t("全部模型", "All models")}</h2><p aria-live="polite">{t(`${models.length} 个模型 · ${groups.length} 个系列`, `${models.length} models · ${groups.length} families`)}<span>{overview ? t("选择系列，查看所有版本与价格", "Choose a family to see versions and pricing") : t("同系列版本按版本号由新到旧排列", "Versions grouped by family, newest version number first")}</span></p></div>{hasFilters ? <button type="button" className="market-clear-filters" onClick={reset}>{t("清除筛选", "Clear filters")}<Icon name="close" size={16} /></button> : null}</div>
          {hasFilters ? <div className="market-active-filters" aria-label={t("当前筛选", "Active filters")}>{filters.query ? <button type="button" onClick={() => updateFilters({ query: "" })}>{t("搜索：", "Search: ")}{filters.query}<Icon name="close" size={14} /></button> : null}{filters.category !== "all" ? <button type="button" onClick={() => updateFilters({ category: "all", capabilities: [] })}>{categoryName(filters.category)}<Icon name="close" size={14} /></button> : null}{filters.provider ? <button type="button" onClick={() => updateFilters({ provider: "", family: "", capabilities: [] })}>{providerName(filters.provider)}<Icon name="close" size={14} /></button> : null}{filters.family ? <button type="button" onClick={() => updateFilters({ family: "" })}>{selectedFamily ? familyName(selectedFamily) : filters.family}<Icon name="close" size={14} /></button> : null}{filters.service !== "all" ? <button type="button" onClick={() => updateFilters({ service: "all" })}>{serviceName(filters.service)}<Icon name="close" size={14} /></button> : null}{filters.capabilities.map(capability => <button key={capability} type="button" onClick={() => updateFilters({ capabilities: filters.capabilities.filter(value => value !== capability) })}>{capabilityName(capability)}<Icon name="close" size={14} /></button>)}</div> : null}
          {pagination("top")}
          {overview ? <div className="market-family-overview">{pageGroups.map(group => <button type="button" className="market-family-tile" key={`${providerIdentity(group.provider).id}:${group.family.id}`} data-family-id={group.family.id} data-provider-id={providerIdentity(group.provider).id} onClick={() => updateFilters({ provider: providerIdentity(group.provider).id, family: group.family.id }, false, true)}><span className="market-family-tile-provider"><ProviderLogo provider={group.provider} size={28} />{providerName(group.provider)}</span><strong>{familyName(group.family)}</strong><span className="market-family-preview">{Array.from(new Set(group.models.map(model => modelName(model.name)))).slice(0, 2).join(" · ")}</span><span className="market-family-tile-footer"><span>{t(`${group.models.length} 个版本与服务`, `${group.models.length} versions & services`)}</span><Icon name="arrow-right" size={20} /></span></button>)}</div> : <div className={filters.list ? "market-groups market-list-view" : "market-groups"}>{visibleManufacturers.map(provider => <section key={provider} className="market-manufacturer-section" aria-label={providerName(provider)}>{!filters.provider ? <header className="market-manufacturer-heading"><ProviderLogo provider={provider} size={28} /><h3>{providerName(provider)}</h3></header> : null}{pageGroups.filter(group => providerIdentity(group.provider).id === providerIdentity(provider).id).map(group => <section className="market-family-section" key={group.family.id} aria-label={`${providerName(provider)} ${familyName(group.family)}`}><div className="market-family-heading"><h3>{familyName(group.family)}</h3><span>{t(`${groups.find(item => item.provider === group.provider && item.family.id === group.family.id)?.models.length || group.models.length} 个版本与服务`, `${groups.find(item => item.provider === group.provider && item.family.id === group.family.id)?.models.length || group.models.length} versions & services`)}</span></div><div className="market-model-grid">{group.models.map(modelCard)}</div></section>)}</section>)}</div>}
          {!models.length ? <div className="market-empty"><Icon name="search" size={28} /><h3>{t("未找到匹配模型", "No matching models")}</h3><p>{t("试试其他关键词，或清除厂商、系列和能力筛选。", "Try another keyword or clear the provider, family and capability filters.")}</p><button type="button" onClick={reset}>{t("重置筛选", "Reset filters")}</button></div> : null}
          {pagination("bottom")}
        </div>
        <div className="market-directory-note"><Icon name="info" size={18} /><p>{gatewayLive ? t("tokvilo 模型服务目录已实时同步。", "The tokvilo Models catalogue is synced live.") : t("tokvilo 模型服务当前显示最近同步的目录快照。", "tokvilo Models currently shows the latest saved catalogue.")}{gatewayObservedAt ? t(` 模型服务目录更新于 ${gatewayObservedAt.slice(0, 10)}。`, ` Catalogue updated ${gatewayObservedAt.slice(0, 10)}.`) : ""}{selectedSource ? t(` tokvilo 精选为${selectedSource.observedAt ? ` ${selectedSource.observedAt.slice(0, 10)} ` : ""}目录与价格快照。`, ` tokvilo Select uses a catalogue and price snapshot${selectedSource.observedAt ? ` from ${selectedSource.observedAt.slice(0, 10)}` : ""}.`) : ""}{t(" tokvilo 多模态目录为版本参考；每个模型的计费与调用状态见详情。", " tokvilo Multimodal lists reference versions. Open a model for billing and availability details.")}</p><Link href={href("/studio")}>{t("tokvilo 多模态 实时目录", "tokvilo Multimodal live catalogue")}<Icon name="arrow-right" size={16} /></Link></div>
      </div>
    </div>
    {detail ? <dialog className="model-detail-dialog" ref={dialog} onCancel={() => setDetail(null)} onClick={event => { if (event.target === event.currentTarget) setDetail(null); }} aria-labelledby="model-detail-title">
      <div className="model-detail-inner">
        <button className="model-detail-close" type="button" onClick={() => setDetail(null)} aria-label={t("关闭模型详情", "Close model details")}><Icon name="close" size={18} /></button>
        <span className="model-detail-provider">{serviceName(detail.upstream || "apimart")} / {providerName(detail.provider)} / {categoryName(detail.category)}</span>
        <h2 id="model-detail-title">{modelName(detail.name)}</h2><p>{isEnglish ? "Review this version’s capabilities, pricing and availability in tokvilo." : detail.description}</p>
        <div className="model-card-tags">{detail.capabilities.map(value => <span key={value}>{capabilityName(value)}</span>)}</div>
        <dl><dt>{detail.upstream === "tokenhub" ? t("完整版本 Model ID", "Full version Model ID") : "Model ID"}</dt><dd><code>{detail.id}</code></dd>
          <dt>{t("接入状态", "Availability")}</dt><dd>{detail.upstream === "tokenhub" ? t("已收录版本参考；实时目录、价格和调用状态请在工作台确认。", "Listed as a reference version. Check the playground for the live catalogue, pricing and availability.") : detail.available === true ? t("标准计费已配置；实际调用状态以工作台返回为准。", "Standard billing is configured. Actual availability is determined by the playground response.") : detail.available === false ? detail.upstream === "selected" ? t("价格已列示，服务待开通；当前不能提交生成请求。", "Pricing is listed; the service is awaiting activation. Generation requests are not yet available.") : t("已收录目录，计费或接口适配待完成。", "Listed in the catalogue; billing or API integration is still in progress.") : t("请在工作台确认实时可调用状态。", "Check the playground for current availability.")}</dd>
          {detail.upstream === "tokenhub" ? <><dt>{t("tokvilo 接口", "tokvilo endpoint")}</dt><dd><code>{detail.category === "text" ? "/api/studio/v1/chat/completions" : detail.category === "image" ? "/api/studio/v3/images/generations" : "/api/studio/v3/contents/generations/tasks"}</code></dd></> : null}
          <dt>{t("计费", "Billing")}</dt><dd>{t("按页面价格和实际用量结算", "Billed at the displayed price based on actual usage")}</dd>
        </dl><PriceTable provider={detail.upstream || "apimart"} model={detail.id} />
        <div className="model-detail-actions"><a href={href(detail.docs)} target="_blank" rel="noreferrer">{t("查看模型文档", "API documentation")}<Icon name="arrow-up-right" size={15} /></a><Link href={href(modelWorkbenchUrl(detail))}>{t("打开工作台", "Open playground")}<Icon name="arrow-right" size={15} /></Link></div>
      </div>
    </dialog> : null}
  </section>;
}
