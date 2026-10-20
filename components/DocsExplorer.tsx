"use client";

import { useEffect, useMemo, useState } from "react";
import { apiCurlExample, loadApiDocumentation, requestBodyExample, requestBodySchema, type ApiOperation, type DocumentationResult, type DocumentationSource } from "@/lib/api-documentation";

export function DocsExplorer({ baseUrl }: { baseUrl: string }) {
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
        setProvider(requestedProvider === "tokenhub" || requestedProvider === "tikhub" || requestedProvider === "apimart" ? requestedProvider : "all");
        setData(result);
        if (!result.sources.some(source => source.loaded)) setError("接口文档暂时无法读取，请根据下方提示检查登录或稍后刷新。");
      })
      .catch(() => { if (!controller.signal.aborted) setError("文档加载失败，请稍后刷新。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, []);

  const sourceOperations = useMemo(() => data.operations.filter(operation => provider === "all" || operation.source === provider), [data.operations, provider]);
  const tags = useMemo(() => ["全部", ...Array.from(new Set(sourceOperations.flatMap(operation => operation.tags))).sort()], [sourceOperations]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sourceOperations.filter(operation => (tag === "全部" || operation.tags.includes(tag)) && (!normalized || `${operation.path} ${operation.summary} ${operation.description} ${JSON.stringify(operation.requestBody || {})}`.toLowerCase().includes(normalized)));
  }, [sourceOperations, query, tag]);
  const active = selected && filtered.includes(selected) ? selected : filtered[0] || null;
  const example = active ? requestBodyExample(active) : undefined;
  const schema = active ? requestBodySchema(active) : undefined;

  if (loading) return <div className="docs-status">正在独立加载数据接口与 TokenHub 文档…</div>;

  return <>
    <div className="docs-source-status" aria-label="文档来源状态">{data.sources.map(source => <span className={source.loaded ? "is-loaded" : ""} key={source.id}>{source.label}<strong>{source.loaded ? `${source.count} 个操作` : "未加载"}</strong></span>)}</div>
    {data.warnings.length ? <div className="docs-source-notices" role="status">{data.warnings.map(message => <p key={message}>{message}</p>)}</div> : null}
    {error ? <div className="docs-status error" role="alert">{error}</div> : null}
    <div className="docs-explorer">
      <aside className="docs-index">
        <div className="docs-controls">
          <input aria-label="搜索接口或模型 ID" onChange={event => setQuery(event.target.value)} placeholder="搜索路径、名称或模型 ID" type="search" value={query} />
          <select aria-label="按接口来源筛选" onChange={event => { setProvider(event.target.value as DocumentationSource | "all"); setTag("全部"); }} value={provider}>
            <option value="all">全部来源</option><option value="tikhub">数据接口</option><option value="tokenhub">TokenHub</option><option value="apimart">APIMart</option>
          </select>
          <select aria-label="按分类筛选" onChange={event => setTag(event.target.value)} value={tag}>{tags.map(item => <option key={item}>{item}</option>)}</select>
        </div>
        <div className="docs-count">{filtered.length.toLocaleString()} 个接口操作</div>
        <div className="endpoint-list">
          {filtered.map(operation => <button className={active === operation ? "selected" : ""} key={`${operation.source}:${operation.method}:${operation.path}`} onClick={() => setSelected(operation)} type="button">
            <span className={`method method-${operation.method.toLowerCase()}`}>{operation.method}</span><span><strong>{operation.summary}</strong><code>{operation.path}</code></span>
          </button>)}
        </div>
      </aside>
      <article className="endpoint-detail">
        {active ? <>
          <div className="endpoint-heading"><span className={`method method-${active.method.toLowerCase()}`}>{active.method}</span><div><h2>{active.summary}</h2><code>{active.path}</code></div></div>
          <p className="docs-count">{active.source === "tokenhub" ? "TokenHub · 模型 API" : active.source === "apimart" ? "APIMart · 模型 API" : "tokvilo 数据接口"} · <a href={active.source === "tokenhub" ? "/api/private/tokenhub-openapi" : active.source === "apimart" ? "/api/private/apimart-openapi" : "/api/private/openapi"} download>下载此来源 OpenAPI JSON</a></p>
          {active.description ? <p className="endpoint-description">{active.description}</p> : null}
          <section><h3>请求地址</h3><pre><code>{`${baseUrl.replace(/\/+$/, "")}${active.path}`}</code></pre></section>
          <section><h3>认证</h3><pre><code>Authorization: Bearer tk_live_your_api_key</code></pre>{active.source !== "tikhub" ? <p>使用当前账户创建的 tokvilo API Key，会员从余额按量扣费。上游密钥由后台保存；不要放入客户端请求。</p> : null}</section>
          {active.parameters.length ? <section><h3>参数</h3><div className="parameter-table">{active.parameters.map((parameter, index) => <div key={`${parameter.name || "parameter"}:${index}`}><code>{parameter.name || "parameter"}</code><span>{parameter.in || "query"}</span><span>{parameter.required ? "必填" : "可选"}</span><p>{parameter.description || "—"}</p></div>)}</div></section> : null}
          {active.requestBody ? <section><h3>JSON 请求体</h3>{example !== undefined ? <pre><code>{JSON.stringify(example, null, 2)}</code></pre> : <p>此来源未提供请求体示例，请参考下方结构填写。</p>}{schema ? <details><summary>参数结构与当前参考模型 ID</summary><pre><code>{JSON.stringify(schema, null, 2)}</code></pre></details> : <pre><code>{JSON.stringify(active.requestBody, null, 2)}</code></pre>}</section> : null}
          <section><h3>cURL 示例</h3><p>替换示例密钥和参数后再运行。{active.parameters.some(parameter => parameter.name === "Idempotency-Key") ? "视频任务的新请求编号必须唯一，同一任务重试沿用原编号。" : ""}</p><pre><code>{apiCurlExample(baseUrl, active)}</code></pre></section>
          {active.responses ? <section><details><summary>响应状态与结构</summary><pre><code>{JSON.stringify(active.responses, null, 2)}</code></pre></details></section> : null}
        </> : <div className="docs-status">{sourceOperations.length ? "没有匹配的接口，请调整筛选条件。" : "当前来源尚无可查看接口。其他来源可独立选择。"}</div>}
      </article>
    </div>
  </>;
}
