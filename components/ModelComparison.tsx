"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { modelWorkbenchUrl, type CatalogModel } from "@/lib/model-catalog";
import { getModelGuidance } from "@/lib/model-guidance";
import { compareModelVersions, modelFamily, providerIdentity } from "@/lib/model-identity";
import { isChatModel, modelSelectionKey, selectionPrice, type SelectionPricing } from "@/lib/model-selection-ui";
import { useSiteLocale } from "./LocaleProvider";
import { OfficialPriceComparison } from "./OfficialPriceComparison";
import { ProviderLogo } from "./ProviderLogo";

const dimensions = ["coding", "math", "writing", "creative", "reasoning", "speed"] as const;
const dimensionLabels = { coding: ["代码", "Coding"], math: ["数学", "Math"], writing: ["写作", "Writing"], creative: ["创意", "Creativity"], reasoning: ["推理", "Reasoning"], speed: ["速度", "Speed"] };

function initialKeys(models: CatalogModel[], requested: string[]) {
  const matched = requested.slice(0, 4).flatMap(id => { const model = models.find(item => modelSelectionKey(item) === id || item.id === id); return model ? [modelSelectionKey(model)] : []; });
  const defaults = ["gpt-6.1-sol", "gemini-3.8-flash", "claude-sonnet-5-5"].flatMap(id => { const model = models.find(item => item.id === id && item.upstream === "apimart"); return model ? [modelSelectionKey(model)] : []; });
  return [...new Set(matched.length ? matched : defaults)];
}

export function ModelComparison({ catalog, initialModels = [], initialProvider = "" }: { catalog: CatalogModel[]; initialModels?: string[]; initialProvider?: string }) {
  const { t, locale, href, isEnglish } = useSiteLocale();
  const models = useMemo(() => catalog.filter(isChatModel).sort(compareModelVersions), [catalog]);
  const [selected, setSelected] = useState<string[]>(() => initialKeys(models, initialModels));
  const [provider, setProvider] = useState(() => models.find(model => model.provider === initialProvider || providerIdentity(model.provider).id === initialProvider)?.provider || "");
  const [query, setQuery] = useState("");
  const [pricing, setPricing] = useState<SelectionPricing | null>(null);
  const [priceError, setPriceError] = useState(false);
  useEffect(() => {
    const restore = () => { const params = new URLSearchParams(window.location.search); setSelected(initialKeys(models, (params.get("models") || "").split(","))); setProvider(models.find(model => model.provider === params.get("provider") || providerIdentity(model.provider).id === params.get("provider"))?.provider || ""); };
    window.addEventListener("popstate", restore);
    const controller = new AbortController();
    fetch("/api/pricing", { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); return response.json(); }).then(setPricing).catch(() => { if (!controller.signal.aborted) setPriceError(true); });
    return () => { controller.abort(); window.removeEventListener("popstate", restore); };
  }, [models]);
  const providers = [...new Set(models.map(model => model.provider))];
  const filtered = models.filter(model => (!provider || model.provider === provider || providerIdentity(model.provider).id === provider) && `${model.id} ${model.name}`.toLowerCase().includes(query.toLowerCase()));
  const chosen = selected.flatMap(key => { const model = models.find(item => modelSelectionKey(item) === key); return model ? [model] : []; });
  const select = (keys: string[]) => {
    const next = [...new Set(keys)].slice(0, 4); setSelected(next);
    const url = new URL(window.location.href); if (next.length) url.searchParams.set("models", next.join(",")); else url.searchParams.delete("models");
    window.history.replaceState(window.history.state, "", url.pathname + url.search); window.dispatchEvent(new Event("tokvilo:locationchange"));
  };
  const service = (model: CatalogModel) => model.upstream === "selected" ? "tokvilo Select" : model.upstream === "tokenhub" ? t("tokvilo 多模态", "tokvilo Multimodal") : t("tokvilo 模型服务", "tokvilo Models");
  return <div className="model-comparison">
    <div className="selection-intro-links"><Link href={href("/advisor")}>{t("不知道怎么选？让 tokvilo 帮你推荐 →", "Not sure where to start? Ask the tokvilo advisor →")}</Link><Link href={href("/pricing")}>{t("查看全部价格 ↗", "All prices ↗")}</Link></div>
    <div className="comparison-picker"><label>{t("厂商", "Provider")}<select value={provider} onChange={event => setProvider(event.target.value)}><option value="">{t("全部厂商", "All providers")}</option>{providers.map(value => <option value={value} key={value}>{isEnglish ? providerIdentity(value).nameEn : providerIdentity(value).name}</option>)}</select></label><label>{t("搜索版本", "Find a version")}<input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("例如 Claude、GPT、Gemini", "Claude, GPT, Gemini…")} /></label><label>{t(`添加模型（${selected.length}/4）`, `Add a model (${selected.length}/4)`)}<select value="" disabled={selected.length >= 4} onChange={event => { if (event.target.value) select([...selected, event.target.value]); }}><option value="">{selected.length >= 4 ? t("移除一项后继续添加", "Remove a model to add another") : t("选择具体版本与服务", "Choose a version and service")}</option>{filtered.filter(model => !selected.includes(modelSelectionKey(model))).map(model => <option key={modelSelectionKey(model)} value={modelSelectionKey(model)}>{model.id} · {service(model)}</option>)}</select></label></div>
    <p className="selection-method">{t("按实际任务选型，不用单一“智商分”。场景建议是编辑判断；公开评测保留原测试条件，不能跨测试直接排名。速度描述来自厂商资料，不代表 tokvilo 实测速率。", "Choose for your task, not an IQ score. Use-case guidance is editorial; published benchmarks retain their original conditions and cannot be ranked across different tests. Speed descriptions are vendor claims, not measured tokvilo throughput.")}</p>
    {!chosen.length ? <div className="selection-empty">{t("选择 2–4 个模型，比较不同代际与取舍。", "Choose 2–4 models to compare generations and trade-offs.")}</div> : <div className="comparison-scroll" tabIndex={0} aria-label={t("模型比较表，可横向滚动", "Model comparison table, scroll horizontally")}><table className="comparison-table"><thead><tr><th>{t("比较维度", "Compare")}</th>{chosen.map(model => <th key={modelSelectionKey(model)}><div className="comparison-model-title"><ProviderLogo provider={model.provider} size={26} /><button type="button" onClick={() => select(selected.filter(key => key !== modelSelectionKey(model)))} aria-label={t(`移除 ${model.id}`, `Remove ${model.id}`)}>×</button></div><strong>{model.id}</strong><small>{service(model)} · {isEnglish ? modelFamily(model).nameEn : modelFamily(model).name}</small><Link href={href(modelWorkbenchUrl(model))}>{t("打开工作台 ↗", "Open playground ↗")}</Link></th>)}</tr></thead><tbody>
      <tr><th>{t("定位与代际", "Positioning")}</th>{chosen.map(model => { const info = getModelGuidance(model.id); return <td key={modelSelectionKey(model)}>{info ? <><strong>{info.generation}</strong><p>{info.positioning[locale]}</p></> : <p>{t("此精确版本资料待核实；不套用其他版本的成绩。", "This exact version is not yet verified. Scores from other versions are not substituted.")}</p>}<span className="evidence-label">{model.available === true ? t("计费已配置 · 调用以实际返回为准", "Billing configured · Verify execution in Playground") : t("服务状态待确认", "Service availability unconfirmed")}</span></td>; })}</tr>
      {dimensions.map(dimension => <tr key={dimension}><th>{t(dimensionLabels[dimension][0], dimensionLabels[dimension][1])}</th>{chosen.map(model => { const item = getModelGuidance(model.id)?.dimensions[dimension]; return <td key={modelSelectionKey(model)}>{item ? <><strong>{item.label[locale]}</strong><p>{item.detail[locale]}</p><span className="evidence-label">{item.basis === "official" ? t("厂商资料", "Vendor documentation") : item.basis === "editorial" ? t("场景建议", "Editorial guidance") : t("待核实", "Unverified")}</span></> : "—"}</td>; })}</tr>)}
      <tr><th>{t("上下文与输入", "Context & inputs")}</th>{chosen.map(model => { const info = getModelGuidance(model.id); return <td key={modelSelectionKey(model)}>{info ? <><strong>{info.contextTokens ? `${info.contextTokens.toLocaleString()} tokens` : t("上下文未核实", "Context unverified")}</strong><p>{info.inputModalities.join(" · ")}</p><small>{t("以上为厂商能力；平台表单支持范围可能不同。", "Vendor capabilities; supported tokvilo inputs may differ.")}</small></> : "—"}</td>; })}</tr>
      <tr><th>{t("公开评测", "Published evaluations")}</th>{chosen.map(model => { const info = getModelGuidance(model.id); return <td key={modelSelectionKey(model)}>{info?.benchmarks.length ? info.benchmarks.map((benchmark, index) => <div className="benchmark-entry" key={`${benchmark.name}-${index}`}><strong>{benchmark.name}: {benchmark.value}{benchmark.unit}</strong><p>{benchmark.condition[locale]}</p></div>) : t("未收录可核实的同版本成绩", "No verified score recorded for this exact version")}</td>; })}</tr>
      <tr><th>{t("售价与官方比较", "Price vs official")}</th>{chosen.map(model => { const price = selectionPrice(model, pricing?.models); return <td key={modelSelectionKey(model)}>{price ? <OfficialPriceComparison price={price} compact /> : priceError ? t("价格读取失败，请刷新。", "Prices could not be loaded. Please refresh.") : pricing ? t("当前没有可核实报价", "No verified current quote") : t("正在读取价格…", "Loading prices…")}</td>; })}</tr>
      <tr><th>{t("依据与注意事项", "Sources & trade-offs")}</th>{chosen.map(model => { const info = getModelGuidance(model.id); return <td key={modelSelectionKey(model)}>{info ? <>{info.notes.map((note, index) => <p key={index}>{note[locale]}</p>)}{info.sources.map(source => <a className="comparison-source" key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.publisher} · {source.title} ↗<small>{t("核实于", "Checked")} {source.reviewedAt}</small></a>)}</> : t("暂无精确型号的资料来源", "No exact-model sources recorded")}</td>; })}</tr>
    </tbody></table></div>}
  </div>;
}
