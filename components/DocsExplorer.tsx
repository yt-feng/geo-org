"use client";

import { useSiteLocale } from "./LocaleProvider";
import { englishApiOperation, englishApiDocText } from "@/lib/api-doc-copy";

import { displayServiceText } from "@/lib/brand-display";

import { useEffect, useMemo, useState } from "react";
import { apiCurlExample, loadApiDocumentation, requestBodyExample, requestBodySchema, type ApiOperation, type DocumentationResult, type DocumentationSource } from "@/lib/api-documentation";

export function DocsExplorer({ baseUrl }: { baseUrl: string }) {
  const { t, isEnglish } = useSiteLocale();
  const [data, setData] = useState<DocumentationResult>({ operations: [], sources: [], warnings: [] });
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("全部");
  const [provider, setProvider] = useState<DocumentationSource | "all">("all");
  const [selected, setSelected] = useState<ApiOperation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    loadApiDocumentation(fetch, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        const requestedProvider = new URLSearchParams(window.location.search).get("provider");
        setProvider(requestedProvider === "studio" ? "tokenhub" : requestedProvider === "gateway" ? "apimart" : requestedProvider === "data" ? "tikhub" : requestedProvider === "selected" ? "selected" : requestedProvider === "tokenhub" || requestedProvider === "tikhub" || requestedProvider === "apimart" ? requestedProvider : "all");
        setData(result);
        if (!result.sources.some(source => source.loaded)) setError("接口文档暂时无法读取，请根据下方提示检查登录或稍后刷新。");
      })
      .catch(() => { if (!controller.signal.aborted) setError("文档加载失败，请稍后刷新。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, []);

  const sourceOperations = useMemo(() => data.operations.filter(operation => provider === "all" || operation.source === provider), [data.operations, provider]);
  const operationCopy = (operation: ApiOperation) => isEnglish ? englishApiOperation(operation) : operation;
  const tags = useMemo(() => ["全部", ...Array.from(new Set(sourceOperations.flatMap(operation => operation.tags))).sort()], [sourceOperations]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sourceOperations.filter(operation => (tag === "全部" || operation.tags.includes(tag)) && (!normalized || `${operation.path} ${operation.summary} ${operation.description} ${isEnglish ? JSON.stringify(englishApiOperation(operation)) : JSON.stringify(operation.requestBody || {})}`.toLowerCase().includes(normalized)));
  }, [sourceOperations, query, tag, isEnglish]);
  const selectedOperation = selected && filtered.includes(selected) ? selected : filtered[0] || null;
  const active = selectedOperation ? operationCopy(selectedOperation) : null;
  const example = active ? requestBodyExample(active) : undefined;
  const schema = active ? requestBodySchema(active) : undefined;

  if (loading) return <div className="docs-status">{t("正在加载 tokvilo 接口文档…", "Loading tokvilo API documentation…")}</div>;

  return <>
    <div className="docs-source-status" aria-label={t("文档来源状态", "Documentation status")}>{data.sources.map(source => <span className={source.loaded ? "is-loaded" : ""} key={source.id}>{isEnglish ? ({tikhub:"tokvilo Data",tokenhub:"tokvilo Multimodal",apimart:"tokvilo Models",selected:"tokvilo Select"}[source.id]) : displayServiceText(source.label)}<strong>{source.loaded ? t(`${source.count} 个操作`, `${source.count} operations`) : t("未加载", "Not loaded")}</strong></span>)}</div>
    {data.warnings.length ? <div className="docs-source-notices" role="status">{data.warnings.map(message => <p key={message}>{isEnglish ? "Documentation for one service could not be loaded. Check your login or try again later." : displayServiceText(message)}</p>)}</div> : null}
    {error ? <div className="docs-status error" role="alert">{isEnglish ? "Documentation could not be loaded. Check your login or try again later." : displayServiceText(error)}</div> : null}
    <div className="docs-explorer">
      <aside className="docs-index">
        <div className="docs-controls">
          <input aria-label={t("搜索接口或模型 ID", "Search endpoints or model IDs")} onChange={event => setQuery(event.target.value)} placeholder={t("搜索路径、名称或模型 ID", "Search paths, names or model IDs")} type="search" value={query} />
          <select aria-label={t("按接口来源筛选", "Filter by service")} onChange={event => { setProvider(event.target.value as DocumentationSource | "all"); setTag("全部"); }} value={provider}>
            <option value="all">{t("全部服务", "All services")}</option><option value="tikhub">{t("数据接口", "Data API")}</option><option value="tokenhub">{t("tokvilo 多模态", "tokvilo Multimodal")}</option><option value="apimart">{t("tokvilo 模型服务", "tokvilo Models")}</option><option value="selected">{t("tokvilo 精选", "tokvilo Select")}</option>
          </select>
          <select aria-label={t("按分类筛选", "Filter by category")} onChange={event => setTag(event.target.value)} value={tag}>{tags.map(item => <option key={item} value={item}>{item === "全部" ? t("全部", "All") : isEnglish ? englishApiDocText(item) : item}</option>)}</select>
        </div>
        <div className="docs-count">{filtered.length.toLocaleString()} {t("个接口操作", "API operations")}</div>
        <div className="endpoint-list">
          {filtered.map(operation => <button className={selectedOperation === operation ? "selected" : ""} key={`${operation.source}:${operation.method}:${operation.path}`} onClick={() => setSelected(operation)} type="button">
            <span className={`method method-${operation.method.toLowerCase()}`}>{operation.method}</span><span><strong>{operationCopy(operation).summary}</strong><code>{operation.path}</code></span>
          </button>)}
        </div>
      </aside>
      <article className="endpoint-detail">
        {active ? <>
          <div className="endpoint-heading"><span className={`method method-${active.method.toLowerCase()}`}>{active.method}</span><div><h2>{active.summary}</h2><code>{active.path}</code></div></div>
          <p className="docs-count">{active.source === "tokenhub" ? t("tokvilo 多模态 · 模型 API", "tokvilo Multimodal · Model API") : active.source === "apimart" ? t("tokvilo 模型服务 · 模型 API", "tokvilo Models · Model API") : active.source === "selected" ? t("tokvilo 精选 · 模型 API", "tokvilo Select · Model API") : t("tokvilo 数据接口", "tokvilo Data API")} · <a href={active.source === "tokenhub" ? "/api/private/studio-openapi" : active.source === "apimart" ? "/api/private/gateway-openapi" : active.source === "selected" ? "/api/private/selected-openapi" : "/api/private/openapi"} download>{t("下载此来源 OpenAPI JSON", "Download OpenAPI JSON")}</a></p>
          {active.description ? <p className="endpoint-description">{active.description}</p> : null}
          <section><h3>{t("请求地址", "Request URL")}</h3><pre><code>{`${baseUrl.replace(/\/+$/, "")}${active.path}`}</code></pre></section>
          <section><h3>{t("认证", "Authentication")}</h3><pre><code>Authorization: Bearer tk_live_your_api_key</code></pre>{active.source !== "tikhub" ? <p>{t("使用当前账户创建的 tokvilo API Key，会员从余额按量扣费。上游密钥由后台保存；不要放入客户端请求。", "Use a tokvilo API key created in your account. Usage is billed to your balance. Service credentials are managed on the server.")}</p> : null}</section>
          {active.parameters.length ? <section><h3>{t("参数", "Parameters")}</h3><div className="parameter-table">{active.parameters.map((parameter, index) => <div key={`${parameter.name || "parameter"}:${index}`}><code>{parameter.name || "parameter"}</code><span>{parameter.in || "query"}</span><span>{parameter.required ? t("必填", "Required") : t("可选", "Optional")}</span><p>{parameter.description || "—"}</p></div>)}</div></section> : null}
          {active.requestBody ? <section><h3>{t("JSON 请求体", "JSON request body")}</h3>{example !== undefined ? <pre><code>{JSON.stringify(example, null, 2)}</code></pre> : <p>{t("此来源未提供请求体示例，请参考下方结构填写。", "No example is available for this request. Use the schema below.")}</p>}{schema ? <details><summary>{t("参数结构与当前参考模型 ID", "Parameter schema and reference model IDs")}</summary><pre><code>{JSON.stringify(schema, null, 2)}</code></pre></details> : <pre><code>{JSON.stringify(active.requestBody, null, 2)}</code></pre>}</section> : null}
          <section><h3>{t("cURL 示例", "cURL example")}</h3><p>{t("替换示例密钥和参数后再运行。", "Replace the example key and parameters before running.")}{active.parameters.some(parameter => parameter.name === "Idempotency-Key") ? t("每次新请求的编号必须唯一，相同内容重试沿用原编号。", "Use a unique ID for each new request. Reuse the original ID when retrying the same content.") : ""}</p><pre><code>{apiCurlExample(baseUrl, active)}</code></pre></section>
          {active.responses ? <section><details><summary>{t("响应状态与结构", "Response statuses and schemas")}</summary><pre><code>{JSON.stringify(active.responses, null, 2)}</code></pre></details></section> : null}
        </> : <div className="docs-status">{sourceOperations.length ? t("没有匹配的接口，请调整筛选条件。", "No matching endpoints. Adjust your filters.") : t("当前来源尚无可查看接口。其他来源可独立选择。", "No endpoints are available for this service. You can select another service.")}</div>}
      </article>
    </div>
  </>;
}
