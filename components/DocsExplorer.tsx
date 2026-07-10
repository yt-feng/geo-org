"use client";

import { useEffect, useMemo, useState } from "react";

type Operation = {
  method: string;
  path: string;
  summary: string;
  description: string;
  tags: string[];
  parameters: Array<{ name?: string; in?: string; required?: boolean; description?: string }>;
  requestBody?: unknown;
};

type OpenApiSpec = {
  info?: { title?: string; version?: string; description?: string };
  paths?: Record<string, Record<string, Record<string, unknown>>>;
};

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

export function DocsExplorer({ baseUrl }: { baseUrl: string }) {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("全部");
  const [selected, setSelected] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/private/openapi", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("接口目录尚未启用。");
        return (await response.json()) as OpenApiSpec;
      })
      .then((spec) => {
        if (cancelled) return;
        const next: Operation[] = [];
        for (const [path, pathItem] of Object.entries(spec.paths || {})) {
          for (const [method, raw] of Object.entries(pathItem || {})) {
            if (!HTTP_METHODS.has(method.toLowerCase())) continue;
            const operation = raw as Record<string, unknown>;
            next.push({
              method: method.toUpperCase(),
              path,
              summary: String(operation.summary || operation.operationId || path),
              description: String(operation.description || ""),
              tags: Array.isArray(operation.tags) ? operation.tags.map(String) : ["Other"],
              parameters: Array.isArray(operation.parameters)
                ? (operation.parameters as Operation["parameters"])
                : [],
              requestBody: operation.requestBody,
            });
          }
        }
        next.sort((left, right) => left.path.localeCompare(right.path));
        setOperations(next);
        setSelected(next[0] || null);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "文档加载失败。"))
      .finally(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const tags = useMemo(
    () => ["全部", ...Array.from(new Set(operations.flatMap((operation) => operation.tags))).sort()],
    [operations],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return operations.filter((operation) => {
      const matchesTag = tag === "全部" || operation.tags.includes(tag);
      const matchesQuery =
        !normalized ||
        operation.path.toLowerCase().includes(normalized) ||
        operation.summary.toLowerCase().includes(normalized);
      return matchesTag && matchesQuery;
    });
  }, [operations, query, tag]);

  if (loading) return <div className="docs-status">正在加载私有接口目录…</div>;
  if (error) return <div className="docs-status error">{error}</div>;

  return (
    <div className="docs-explorer">
      <aside className="docs-index">
        <div className="docs-controls">
          <input
            aria-label="搜索接口"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索路径或名称"
            type="search"
            value={query}
          />
          <select aria-label="按分类筛选" onChange={(event) => setTag(event.target.value)} value={tag}>
            {tags.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        <div className="docs-count">{filtered.length.toLocaleString()} 个接口</div>
        <div className="endpoint-list">
          {filtered.map((operation) => (
            <button
              className={selected === operation ? "selected" : ""}
              key={`${operation.method}:${operation.path}`}
              onClick={() => setSelected(operation)}
              type="button"
            >
              <span className={`method method-${operation.method.toLowerCase()}`}>{operation.method}</span>
              <span>
                <strong>{operation.summary}</strong>
                <code>{operation.path}</code>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <article className="endpoint-detail">
        {selected ? (
          <>
            <div className="endpoint-heading">
              <span className={`method method-${selected.method.toLowerCase()}`}>{selected.method}</span>
              <div>
                <h2>{selected.summary}</h2>
                <code>{selected.path}</code>
              </div>
            </div>
            {selected.description ? <p className="endpoint-description">{selected.description}</p> : null}
            <section>
              <h3>请求地址</h3>
              <pre><code>{`${baseUrl}${selected.path}`}</code></pre>
            </section>
            <section>
              <h3>认证</h3>
              <pre><code>Authorization: Bearer eco_live_your_api_key</code></pre>
            </section>
            {selected.parameters.length ? (
              <section>
                <h3>参数</h3>
                <div className="parameter-table">
                  {selected.parameters.map((parameter, index) => (
                    <div key={`${parameter.name || "parameter"}:${index}`}>
                      <code>{parameter.name || "parameter"}</code>
                      <span>{parameter.in || "query"}</span>
                      <span>{parameter.required ? "必填" : "可选"}</span>
                      <p>{parameter.description || "—"}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <section>
              <h3>cURL 示例</h3>
              <pre><code>{`curl --request ${selected.method} \\\n+  --url '${baseUrl}${selected.path}' \\\n+  --header 'Authorization: Bearer eco_live_your_api_key'`}</code></pre>
            </section>
          </>
        ) : (
          <div className="docs-status">请选择一个接口。</div>
        )}
      </article>
    </div>
  );
}
