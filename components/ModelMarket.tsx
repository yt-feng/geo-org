"use client";

import { serviceLabel } from "@/lib/brand-display";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { PriceTable } from "./PriceTable";
import { allModelCatalog as modelCatalog, modelCategories, modelWorkbenchUrl, providerInitials, type CatalogModel, type ModelCategory } from "@/lib/model-catalog";

export function ModelMarket() {
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
  const allProviders = Array.from(new Set(modelCatalog.map(model => model.provider)));
  const categoryCapabilities = Array.from(new Set(modelCatalog.filter(model => category === "all" || model.category === category).flatMap(model => model.capabilities)));
  const models = useMemo(() => {
    const result = modelCatalog.filter(model => (category === "all" || model.category === category) && (upstream === "all" || (model.upstream || "apimart") === upstream) && (!providers.length || providers.includes(model.provider)) && (!capabilities.length || capabilities.every(value => model.capabilities.includes(value))) && `${model.name} ${model.id} ${model.provider} ${model.upstream || "apimart"}`.toLowerCase().includes(query.toLowerCase().trim()));
    return sort === "name" ? result.sort((a, b) => a.name.localeCompare(b.name)) : result;
  }, [category, upstream, providers, capabilities, query, sort]);
  function toggleFilter(value: string, selected: string[], set: (values: string[]) => void) { set(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]); }
  const hasFilters = !!query || providers.length > 0 || capabilities.length > 0 || upstream !== "all" || category !== "all";

  return <section className="market-catalog" aria-label="模型目录">
    <div className="market-toolbar">
      <div className="market-tabs" role="tablist" aria-label="模型类型"><button type="button" role="tab" aria-selected={category === "all"} className={category === "all" ? "selected" : ""} onClick={() => { setCategory("all"); setCapabilities([]); }}>全部</button>{modelCategories.map(item => <button key={item.id} type="button" role="tab" aria-selected={category === item.id} className={category === item.id ? "selected" : ""} onClick={() => { setCategory(item.id); setCapabilities([]); }}>{item.label}</button>)}</div>
      <label className="market-search"><Icon name="search" size={17} /><input aria-label="搜索模型" placeholder="搜索模型..." value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label="模型排序" value={sort} onChange={event => setSort(event.target.value)}><option value="recommended">推荐排序</option><option value="name">名称 A–Z</option></select>
      <button className="market-view-toggle" type="button" aria-label={list ? "切换卡片视图" : "切换列表视图"} aria-pressed={list} onClick={() => setList(!list)}><Icon name={list ? "grid" : "list"} size={18} /></button>
    </div>
    <div className="market-filters">
      <section className="market-filter-panel"><h2>服务分类</h2><p>多种能力，统一入口</p><div className="market-capabilities">{(["all", "tokenhub", "apimart"] as const).map(source => <label key={source}><input type="radio" name="model-upstream" checked={upstream === source} onChange={() => setUpstream(source)} /><span>{source === "all" ? "全部服务" : source === "tokenhub" ? "tokvilo 多模态" : "tokvilo 文本与图像"} · {modelCatalog.filter(model => source === "all" || (model.upstream || "apimart") === source).length}</span></label>)}</div></section>
      <section className="market-filter-panel"><h2>模型能力</h2><p>{category === "all" ? "全部类型" : modelCategories.find(item => item.id === category)?.label}</p><div className="market-capabilities">{categoryCapabilities.map(item => <label key={item}><input type="checkbox" checked={capabilities.includes(item)} onChange={() => toggleFilter(item, capabilities, setCapabilities)} /><span>{item}</span></label>)}</div></section>
      <section className="market-filter-panel"><h2>供应商</h2><p>{allProviders.length}</p><div className="market-providers">{allProviders.map(item => <label key={item} title={serviceLabel(item)}><input type="checkbox" checked={providers.includes(item)} onChange={() => toggleFilter(item, providers, setProviders)} /><span>{serviceLabel(item)}</span></label>)}</div></section>
    </div>
    <div className="market-results-meta"><p><span>{models.length}</span> 个模型 <i />来源与接入状态分别标注</p>{hasFilters ? <button type="button" onClick={() => { setProviders([]); setCapabilities([]); setQuery(""); setUpstream("all"); setCategory("all"); }}>清除筛选 <Icon name="close" size={13} /></button> : <span>统一售价：源头价格 × 1.20</span>}</div>
    <div className={`market-model-grid${list ? " market-list-view" : ""}`}>{models.map(model => <article className="market-model-card" key={`${model.upstream || "apimart"}:${model.id}`}>
      {/* These are public catalogue presentation assets, not generated results. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="model-card-art" src={`/model-art/model-${String(modelCatalog.indexOf(model) % 12 + 1).padStart(2, "0")}.webp`} alt="" loading="lazy" width={828} height={828} />
      <div className="model-card-content">
      <div className="model-card-top"><span className="model-category-label">{model.category === "text" ? "LLM" : model.category.toUpperCase()}</span><span>{model.upstream === "tokenhub" ? "tokvilo 多模态 · 已封装" : "tokvilo 文本与图像 · 能力参考"}</span><a href={`/dashboard/docs?provider=${model.upstream === "tokenhub" ? "studio" : "gateway"}`} target="_blank" rel="noreferrer" aria-label={`${model.name} tokvilo 接口文档`}><Icon name="book" size={11} />模型文档</a></div>
      <h3><span className={`model-provider-mark provider-${model.provider.toLowerCase().replaceAll(" ", "-")}`} aria-hidden="true">{providerInitials(serviceLabel(model.provider))}</span><button type="button" onClick={() => setDetail(model)}>{model.name}</button></h3>
      <p className="model-card-description">{model.description}{model.upstream === "tokenhub" ? <code className="model-exact-id">{model.id}</code> : null}</p>
      <div className="model-card-tags">{model.capabilities.map(item => <span key={item}>{item}</span>)}</div>
      </div><button className="model-detail-button" type="button" onClick={() => setDetail(model)}><Icon name="arrow-right" size={14} />查看详情</button>
    </article>)}</div>
    {!models.length ? <div className="market-empty"><Icon name="search" size={28} /><h3>未找到匹配模型</h3><p>试试其他关键词，或清除供应商和能力筛选。</p><button type="button" onClick={() => { setProviders([]); setCapabilities([]); setQuery(""); setUpstream("all"); setCategory("all"); }}>重置筛选</button></div> : null}
    <div className="market-directory-note"><Icon name="info" size={16} /><p>多模态型号来自 2026-10-18 模型与价格目录，实时目录在工作台同步。文本与图像条目展示公开能力参考，实际可用模型和参数以工作台为准。</p><Link href="/studio">tokvilo 多模态 实时目录 <Icon name="arrow-right" size={14} /></Link></div>
    {detail ? <dialog className="model-detail-dialog" ref={dialog} onCancel={() => setDetail(null)} onClick={event => { if (event.target === event.currentTarget) setDetail(null); }} aria-labelledby="model-detail-title"><div className="model-detail-inner"><button className="model-detail-close" type="button" onClick={() => setDetail(null)} aria-label="关闭模型详情"><Icon name="close" size={18} /></button><span className="model-detail-provider">{detail.upstream === "tokenhub" ? "tokvilo 多模态" : "tokvilo 文本与图像"} / {serviceLabel(detail.provider)} / {detail.category.toUpperCase()}</span><h2 id="model-detail-title">{detail.name}</h2><p>{detail.description}</p><div className="model-card-tags">{detail.capabilities.map(value => <span key={value}>{value}</span>)}</div><dl><dt>{detail.upstream === "tokenhub" ? "完整版本 Model ID" : "Model ID 参考"}</dt><dd><code>{detail.id}</code></dd><dt>接入状态</dt><dd>{detail.upstream === "tokenhub" ? "tokvilo 转发接口已接入；实际生成结果与账户权限单独核验。" : "以已配置上游的模型列表为准"}</dd>{detail.upstream === "tokenhub" ? <><dt>tokvilo 接口</dt><dd><code>{detail.category === "text" ? "/api/studio/v1/chat/completions" : detail.category === "image" ? "/api/studio/v3/images/generations" : "/api/studio/v3/contents/generations/tasks"}</code></dd></> : null}<dt>计费</dt><dd>源头报价 × 1.20，按实际用量结算</dd></dl><PriceTable provider={detail.upstream || "apimart"} model={detail.id} /><div className="model-detail-actions"><a href={`/dashboard/docs?provider=${detail.upstream === "tokenhub" ? "studio" : "gateway"}`} target="_blank" rel="noreferrer">查看模型文档<Icon name="arrow-up-right" size={15} /></a><Link href={modelWorkbenchUrl(detail)}>打开工作台<Icon name="arrow-right" size={15} /></Link></div></div></dialog> : null}
  </section>;
}
