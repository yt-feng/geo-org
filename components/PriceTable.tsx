"use client";

import { displayServiceText, serviceLabel } from "@/lib/brand-display";

import { useEffect, useState } from "react";
import Link from "next/link";

type Rate = { dimension: string; unit: string; upstreamMicrousd: number; retailMicrousd: number };
type ModelPrice = { provider: string; model: string; name: string; kind: string; rates: Rate[] };
type Catalog = { observedAt: string; models: ModelPrice[]; unavailable?: { model: string; reason: string }[] };
const labels: Record<string, string> = { input: "输入", output: "输出", cacheRead: "缓存读取", cacheWrite: "缓存写入", fixed: "图像生成", image: "图像生成", cached_input: "缓存输入" };
const money = (value: number) => `$${(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 })}`;

export function PriceTable({ provider, model }: { provider?: string; model?: string }) {
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/pricing", { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error("暂时无法取得上游报价，请稍后刷新。");
      setData(value);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, []);
  const models = data?.models?.filter(item => (!provider || item.provider === provider) && (!model || item.model === model) && (!source || item.provider === source) && (!search || `${item.name} ${item.model}`.toLowerCase().includes(search.toLowerCase().trim()))) || [];
  return <div className="tokvilo-prices">
    {error ? <p role="status">{displayServiceText(error)}</p> : !data ? <p role="status">正在读取源头报价…</p> : <>
      {!model ? <div className="price-filters"><label>查找模型<input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索模型名称…" /></label>{!provider ? <label>服务<select value={source} onChange={event => setSource(event.target.value)}><option value="">全部服务</option><option value="tokenhub">tokvilo 多模态</option><option value="apimart">tokvilo 文本与图像</option></select></label> : null}<span>{models.length} 个可计价模型</span></div> : null}
      {!models.length ? <p>此型号暂未取得可用于计费的报价。</p> : models.map(item => <section className="price-model" key={`${item.provider}:${item.model}`}>
        <div className="price-model-heading"><div><small>{serviceLabel(item.provider)}</small><h3>{item.name || item.model}</h3><code>{item.model}</code></div><Link href={item.provider === "tokenhub" ? `/studio?model=${encodeURIComponent(item.model)}&mode=${item.kind}` : `/playground?model=${encodeURIComponent(item.model)}`}>打开工作台 ↗</Link></div>
        <div className="price-scroll"><table><thead><tr><th>计费项</th><th>单位</th><th>源头价格</th><th>tokvilo 价格</th></tr></thead><tbody>{item.rates.map(rate => <tr key={rate.dimension}><td>{labels[rate.dimension] || rate.dimension}</td><td>{rate.unit === "1M_tokens" ? "百万 tokens" : rate.unit === "image" ? "张" : rate.unit}</td><td>{money(rate.upstreamMicrousd)}</td><td><strong>{money(rate.retailMicrousd)}</strong></td></tr>)}</tbody></table></div>
      </section>)}
      {!model && !!data.unavailable?.length ? <details><summary>{data.unavailable.length} 项报价暂不可用</summary>{data.unavailable.map((item, index) => <p key={index}>{item.model}：{displayServiceText(item.reason)}</p>)}</details> : null}
      <p className="price-caption">报价读取时间：{new Date(data.observedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）。最终扣费按实际用量计算，金额向上取整到百万分之一美元。</p>
    </>}
  </div>;
}
