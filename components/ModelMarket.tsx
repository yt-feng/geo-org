"use client";

import { serviceLabel } from "@/lib/brand-display";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { PriceTable } from "./PriceTable";
import { allModelCatalog, modelCategories, modelWorkbenchUrl, providerInitials, type CatalogModel, type ModelCategory } from "@/lib/model-catalog";

export function ModelMarket({ catalog = allModelCatalog, live = false, observedAt }: { catalog?: CatalogModel[]; live?: boolean; observedAt?: string }) {
  const modelCatalog = catalog;
  const [category, setCategory] = useState<ModelCategory | "all">("all");
  const [upstream, setUpstream] = useState<"all" | "tokenhub" | "apimart">("all");
  const [query, setQuery] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [sort, setSort] = useState("recommended");
  const [list, setList] = useState(false);
  const [detail, setDetail] = useState<CatalogModel | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (detail && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [detail]);
  const scope = modelCatalog.filter(model => (category === "all" || model.category === category) && (upstream === "all" || (model.upstream || "apimart") === upstream));
  const allProviders = Array.from(new Set(scope.map(model => model.provider))).sort();
  const categoryCapabilities = Array.from(new Set(scope.flatMap(model => model.capabilities)));
  const models = useMemo(() => {
    const result = modelCatalog.filter(model => (category === "all" || model.category === category) && (upstream === "all" || (model.upstream || "apimart") === upstream) && (!providers.length || providers.includes(model.provider)) && (!capabilities.length || capabilities.every(value => model.capabilities.includes(value))) && `${model.name} ${model.id} ${model.provider} ${model.upstream || "apimart"}`.toLowerCase().includes(query.toLowerCase().trim()));
    return sort === "name" ? result.sort((a, b) => a.name.localeCompare(b.name)) : result;
  }, [modelCatalog, category, upstream, providers, capabilities, query, sort]);
  function toggleFilter(value: string, selected: string[], set: (values: string[]) => void) { set(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]); }
  const hasFilters = !!query || providers.length > 0 || capabilities.length > 0 || upstream !== "all" || category !== "all";

  return <section className="market-catalog" aria-label="模型目录">
    <div className="market-toolbar">
      <div className="market-tabs" role="tablist" aria-label="模型类型"><button type="button" role="tab" aria-selected={category === "all"} className={category === "all" ? "selected" : ""} onClick={() => { setCategory("all"); setCapabilities([]); setProviders([]); }}>全部</button>{modelCategories.map(item => <button key={item.id} type="button" role="tab" aria-selected={category === item.id} className={category === item.id ? "selected" : ""} onClick={() => { setCategory(item.id); setCapabilities([]); setProviders([]); }}>{item.label}</button>)}</div>
      <label className="market-search"><Icon name="search" size={17} /><input aria-label="搜索模型" placeholder="搜索模型..." value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label="模型排序" value={sort} onChange={event => setSort(event.target.value)}><option value="recommended">推荐排序</option><option value="name">名称 A–Z</option></select>
      <button className="market-view-toggle" type="button" aria-label={list ? "切换卡片视图" : "切换列表视图"} aria-pressed={list} onClick={() => setList(!list)}><Icon name={list ? "grid" : "list"} size={18} /></button>
    </div>
    <div className="market-filters">
      <section className="market-filter-panel"><h2>服务分类</h2><p>多种能力，统一入口</p><div className="market-capabilities">{(["all", "tokenhub", "apimart"] as const).map(source => <label key={source}><input type="radio" name="model-upstream" checked={upstream === source} onChange={() => { setUpstream(source); setProviders([]); setCapabilities([]); }} /><span>{source === "all" ? "全部服务" : source === "tokenhub" ? "tokvilo 多模态" : "tokvilo 模型服务"} · {modelCatalog.filter(model => source === "all" || (model.upstream || "apimart") === source).length}</span></label>)}</div></section>
      <section className="market-filter-panel"><h2>模型能力</h2><p>{category === "all" ? "全部类型" : modelCategories.find(item => item.id === category)?.label}</p><div className="market-capabilities">{categoryCapabilities.map(item => <label key={item}><input type="checkbox" checked={capabilities.includes(item)} onChange={() => toggleFilter(item, capabilities, setCapabilities)} /><span>{item}</span></label>)}</div></section>
      <section className="market-filter-panel"><h2>模型厂商</h2><p>{allProviders.length}</p><div className="market-providers">{allProviders.map(item => <label key={item} title={serviceLabel(item)}><input type="checkbox" checked={providers.includes(item)} onChange={() => toggleFilter(item, providers, setProviders)} /><span>{serviceLabel(item)}</span></label>)}</div></section>
    </div>
    <div className="market-results-meta"><p><span>{models.length}</span> 个模型 <i />按模型类型、厂商和能力筛选</p>{hasFilters ? <button type="button" onClick={() => { setProviders([]); setCapabilities([]); setQuery(""); setUpstream("all"); setCategory("all"); }}>清除筛选 <Icon name="close" size={13} /></button> : <span>查看模型详情，了解价格</span>}</div>
    <div className={`market-model-grid${list ? " market-list-view" : ""}`}>{models.map(model => <article className="market-model-card" key={`${model.upstream || "apimart"}:${model.category}:${model.id}`}>
      {/* These are public catalogue presentation assets, not generated results. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="model-card-art" src={`/model-art/model-${String(modelCatalog.indexOf(model) % 12 + 1).padStart(2, "0")}.webp`} alt="" loading="lazy" width={828} height={828} />
      <div className="model-card-content">
      <div className="model-card-top"><span className="model-category-label">{modelCategories.find(item => item.id === model.category)?.label}</span><span>{model.upstream === "tokenhub" ? "tokvilo 多模态" : "tokvilo 模型服务"}</span><a href={`/dashboard/docs?provider=${model.upstream === "tokenhub" ? "studio" : "gateway"}`} target="_blank" rel="noreferrer" aria-label={`${model.name} tokvilo 接口文档`}><Icon name="book" size={11} />模型文档</a></div>
      <h3><span className={`model-provider-mark provider-${model.provider.toLowerCase().replaceAll(" ", "-")}`} aria-hidden="true">{providerInitials(serviceLabel(model.provider))}</span><button type="button" onClick={() => setDetail(model)}>{model.name}</button></h3>
      <p className="model-card-description">{model.description}{model.upstream === "tokenhub" ? <code className="model-exact-id">{model.id}</code> : null}</p>
      <div className="model-card-tags">{model.capabilities.map(item => <span key={item}>{item}</span>)}</div>
      </div><button className="model-detail-button" type="button" onClick={() => setDetail(model)}><Icon name="arrow-right" size={14} />查看详情</button>
    </article>)}</div>
    {!models.length ? <div className="market-empty"><Icon name="search" size={28} /><h3>未找到匹配模型</h3><p>试试其他关键词，或清除模型厂商和能力筛选。</p><button type="button" onClick={() => { setProviders([]); setCapabilities([]); setQuery(""); setUpstream("all"); setCategory("all"); }}>重置筛选</button></div> : null}
    <div className="market-directory-note"><Icon name="info" size={16} /><p>{live ? "模型服务目录已同步。多模态目录为版本参考；每个模型的计费适配状态见详情。" : "当前显示最近同步的模型目录，计费与调用状态请在工作台确认。"}{observedAt ? ` 更新于 ${observedAt.slice(0, 10)}。` : ""}</p><Link href="/studio">tokvilo 多模态 实时目录 <Icon name="arrow-right" size={14} /></Link></div>
    {detail ? <dialog className="model-detail-dialog" ref={dialog} onCancel={() => setDetail(null)} onClick={event => { if (event.target === event.currentTarget) setDetail(null); }} aria-labelledby="model-detail-title"><div className="model-detail-inner"><button className="model-detail-close" type="button" onClick={() => setDetail(null)} aria-label="关闭模型详情"><Icon name="close" size={18} /></button><span className="model-detail-provider">{detail.upstream === "tokenhub" ? "tokvilo 多模态" : "tokvilo 模型服务"} / {serviceLabel(detail.provider)} / {detail.category.toUpperCase()}</span><h2 id="model-detail-title">{detail.name}</h2><p>{detail.description}</p><div className="model-card-tags">{detail.capabilities.map(value => <span key={value}>{value}</span>)}</div><dl><dt>{detail.upstream === "tokenhub" ? "完整版本 Model ID" : "Model ID"}</dt><dd><code>{detail.id}</code></dd><dt>接入状态</dt><dd>{detail.upstream === "tokenhub" ? "已收录版本参考；实时目录、价格和调用状态请在工作台确认。" : detail.available === true ? "标准计费已配置；实际调用状态以工作台返回为准。" : detail.available === false ? "已收录目录，计费或接口适配待完成。" : "请在工作台确认实时可调用状态。"}</dd>{detail.upstream === "tokenhub" ? <><dt>tokvilo 接口</dt><dd><code>{detail.category === "text" ? "/api/studio/v1/chat/completions" : detail.category === "image" ? "/api/studio/v3/images/generations" : "/api/studio/v3/contents/generations/tasks"}</code></dd></> : null}<dt>计费</dt><dd>按页面价格和实际用量结算</dd></dl><PriceTable provider={detail.upstream || "apimart"} model={detail.id} /><div className="model-detail-actions"><a href={`/dashboard/docs?provider=${detail.upstream === "tokenhub" ? "studio" : "gateway"}`} target="_blank" rel="noreferrer">查看模型文档<Icon name="arrow-up-right" size={15} /></a>{detail.available !== false ? <Link href={modelWorkbenchUrl(detail)}>打开工作台<Icon name="arrow-right" size={15} /></Link> : <span>接口适配完成后开放工作台调用</span>}</div></div></dialog> : null}
  </section>;
}
