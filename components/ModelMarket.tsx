"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { modelCatalog, modelCategories, providerInitials, type CatalogModel, type ModelCategory } from "@/lib/model-catalog";

export function ModelMarket() {
  const [category, setCategory] = useState<ModelCategory>("image");
  const [query, setQuery] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [sort, setSort] = useState("recommended");
  const [list, setList] = useState(false);
  const [detail, setDetail] = useState<CatalogModel | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (detail && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [detail]);
  const allProviders = Array.from(new Set(modelCatalog.map(model => model.provider)));
  const categoryCapabilities = Array.from(new Set(modelCatalog.filter(model => model.category === category).flatMap(model => model.capabilities)));
  const models = useMemo(() => {
    const result = modelCatalog.filter(model => model.category === category && (!providers.length || providers.includes(model.provider)) && (!capabilities.length || capabilities.every(value => model.capabilities.includes(value))) && `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(query.toLowerCase().trim()));
    return sort === "name" ? result.sort((a, b) => a.name.localeCompare(b.name)) : result;
  }, [category, providers, capabilities, query, sort]);
  function toggleFilter(value: string, selected: string[], set: (values: string[]) => void) { set(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]); }
  const hasFilters = !!query || providers.length > 0 || capabilities.length > 0;

  return <section className="market-catalog" aria-label="模型目录">
    <div className="market-toolbar">
      <div className="market-tabs" role="tablist" aria-label="模型类型">{modelCategories.map(item => <button key={item.id} type="button" role="tab" aria-selected={category === item.id} className={category === item.id ? "selected" : ""} onClick={() => { setCategory(item.id); setCapabilities([]); }}>{item.label}</button>)}</div>
      <label className="market-search"><Icon name="search" size={17} /><input aria-label="搜索模型" placeholder="搜索模型..." value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label="模型排序" value={sort} onChange={event => setSort(event.target.value)}><option value="recommended">推荐排序</option><option value="name">名称 A–Z</option></select>
      <button className="market-view-toggle" type="button" aria-label={list ? "切换卡片视图" : "切换列表视图"} aria-pressed={list} onClick={() => setList(!list)}><Icon name={list ? "grid" : "list"} size={18} /></button>
    </div>
    <div className="market-filters">
      <section className="market-filter-panel"><h2>模型能力</h2><p>{modelCategories.find(item => item.id === category)?.label}</p><div className="market-capabilities">{categoryCapabilities.map(item => <label key={item}><input type="checkbox" checked={capabilities.includes(item)} onChange={() => toggleFilter(item, capabilities, setCapabilities)} /><span>{item}</span></label>)}</div></section>
      <section className="market-filter-panel"><h2>供应商</h2><p>{allProviders.length}</p><div className="market-providers">{allProviders.map(item => <label key={item} title={item}><input type="checkbox" checked={providers.includes(item)} onChange={() => toggleFilter(item, providers, setProviders)} /><span>{item}</span></label>)}</div></section>
    </div>
    <div className="market-results-meta"><p><span>{models.length}</span> 个模型 <i />公开能力参考</p>{hasFilters ? <button type="button" onClick={() => { setProviders([]); setCapabilities([]); setQuery(""); }}>清除筛选 <Icon name="close" size={13} /></button> : <span>实际可用性以已配置上游为准</span>}</div>
    <div className={`market-model-grid${list ? " market-list-view" : ""}`}>{models.map(model => <article className="market-model-card" key={model.id}>
      {/* These are public catalogue presentation assets, not generated results. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="model-card-art" src={`/model-art/model-${String(modelCatalog.indexOf(model) % 12 + 1).padStart(2, "0")}.webp`} alt="" loading="lazy" width={828} height={828} />
      <div className="model-card-content">
      <div className="model-card-top"><span className="model-category-label">{model.category === "text" ? "LLM" : model.category.toUpperCase()}</span><span>能力目录</span><a href={model.docs} target="_blank" rel="noreferrer" aria-label={`${model.name} 上游文档`}><Icon name="book" size={11} />模型文档</a></div>
      <h3><span className={`model-provider-mark provider-${model.provider.toLowerCase().replaceAll(" ", "-")}`} aria-hidden="true">{providerInitials(model.provider)}</span><button type="button" onClick={() => setDetail(model)}>{model.name}</button></h3>
      <p className="model-card-description">{model.description}</p>
      <div className="model-card-tags">{model.capabilities.map(item => <span key={item}>{item}</span>)}</div>
      </div><button className="model-detail-button" type="button" onClick={() => setDetail(model)}><Icon name="arrow-right" size={14} />查看详情</button>
    </article>)}</div>
    {!models.length ? <div className="market-empty"><Icon name="search" size={28} /><h3>未找到匹配模型</h3><p>试试其他关键词，或清除供应商和能力筛选。</p><button type="button" onClick={() => { setProviders([]); setCapabilities([]); setQuery(""); }}>重置筛选</button></div> : null}
    <div className="market-directory-note"><Icon name="info" size={16} /><p>这是基于上游公开资料整理的能力目录。模型标识、参数和价格请以管理员同步的模型列表及上游文档为准。</p><Link href="/dashboard">进入控制台 <Icon name="arrow-right" size={14} /></Link></div>
    {detail ? <dialog className="model-detail-dialog" ref={dialog} onCancel={() => setDetail(null)} onClick={event => { if (event.target === event.currentTarget) setDetail(null); }} aria-labelledby="model-detail-title"><div className="model-detail-inner"><button className="model-detail-close" type="button" onClick={() => setDetail(null)} aria-label="关闭模型详情"><Icon name="close" size={18} /></button><span className="model-detail-provider">{detail.provider} / {detail.category.toUpperCase()}</span><h2 id="model-detail-title">{detail.name}</h2><p>{detail.description}</p><div className="model-card-tags">{detail.capabilities.map(value => <span key={value}>{value}</span>)}</div><dl><dt>Model ID 参考</dt><dd><code>{detail.id}</code></dd><dt>可用状态</dt><dd>以已配置上游的模型列表为准</dd><dt>计费</dt><dd>以账户上游的实际价格为准</dd></dl><div className="model-detail-actions"><a href={detail.docs} target="_blank" rel="noreferrer">查看模型文档<Icon name="arrow-up-right" size={15} /></a><Link href={`/playground?model=${encodeURIComponent(detail.id)}&category=${detail.category}`}>打开工作台<Icon name="arrow-right" size={15} /></Link></div></div></dialog> : null}
  </section>;
}
