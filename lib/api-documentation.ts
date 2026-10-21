export type DocumentationSource = "tikhub" | "tokenhub" | "apimart" | "selected";
type Json = Record<string, unknown>;
export type ApiParameter = { name?: string; in?: string; required?: boolean; description?: string; example?: unknown; schema?: unknown };
export type ApiOperation = { source: DocumentationSource; method: string; path: string; summary: string; description: string; tags: string[]; parameters: ApiParameter[]; requestBody?: unknown; responses?: unknown };
export type DocumentationResult = { operations: ApiOperation[]; sources: Array<{ id: DocumentationSource; label: string; loaded: boolean; count: number }>; warnings: string[] };
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const SOURCES: Array<{ id: DocumentationSource; label: string; url: string }> = [
  { id: "tikhub", label: "数据接口", url: "/api/private/openapi" },
  { id: "tokenhub", label: "tokvilo 多模态", url: "/api/private/studio-openapi" },
  { id: "apimart", label: "tokvilo 模型服务", url: "/api/private/gateway-openapi" },
  { id: "selected", label: "tokvilo 精选", url: "/api/private/selected-openapi" },
];
function object(value: unknown): Json { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {}; }
function parameters(value: unknown): ApiParameter[] { return Array.isArray(value) ? value.filter(item => item !== null && typeof item === "object" && !Array.isArray(item)) as ApiParameter[] : []; }

export function parseApiOperations(document: unknown, source: DocumentationSource): ApiOperation[] {
  const spec = object(document);
  if (!spec.paths || typeof spec.paths !== "object" || Array.isArray(spec.paths)) throw new Error("接口文档格式不正确。");
  return Object.entries(object(spec.paths)).flatMap(([path, rawItem]) => {
    const pathItem = object(rawItem);
    return Object.entries(pathItem).flatMap(([method, raw]) => {
      if (!HTTP_METHODS.has(method.toLowerCase())) return [];
      const operation = object(raw);
      return [{ source, method: method.toUpperCase(), path, summary: String(operation.summary || operation.operationId || path), description: String(operation.description || ""),
        tags: Array.isArray(operation.tags) ? operation.tags.filter((item): item is string => typeof item === "string") : ["Other"],
        parameters: [...parameters(pathItem.parameters), ...parameters(operation.parameters)], requestBody: operation.requestBody, responses: operation.responses }];
    });
  });
}

export async function loadApiDocumentation(fetcher: typeof fetch = fetch, signal?: AbortSignal, timeoutMs = 20_000): Promise<DocumentationResult> {
  const results = await Promise.allSettled(SOURCES.map(async source => {
    const timeout = AbortSignal.timeout(timeoutMs), requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetcher(source.url, { cache: "no-store", signal: requestSignal });
    if (!response.ok) {
      if (response.status === 401) throw new Error(`${source.label}：登录已过期，请重新登录。`);
      if (response.status === 403) throw new Error(`${source.label}：当前账户无法访问，其他来源仍可查看。`);
      throw new Error(`${source.label}：文档暂不可用，其他来源仍可查看。`);
    }
    return parseApiOperations(await response.json(), source.id);
  }));
  const operations: ApiOperation[] = [], warnings: string[] = [];
  const sources = SOURCES.map((source, index) => {
    const result = results[index];
    if (result.status === "fulfilled") operations.push(...result.value);
    else warnings.push(result.reason instanceof Error && result.reason.message.startsWith(source.label + "：") ? result.reason.message : `${source.label}：读取未完成，其他来源仍可查看。`);
    return { id: source.id, label: source.label, loaded: result.status === "fulfilled", count: result.status === "fulfilled" ? result.value.length : 0 };
  });
  operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return { operations, sources, warnings };
}

export function requestBodyExample(operation: ApiOperation): unknown {
  const media = object(object(object(operation.requestBody).content)["application/json"]);
  if (media.example !== undefined) return media.example;
  for (const value of Object.values(object(media.examples))) {
    const example = object(value);
    if (example.value !== undefined) return example.value;
  }
  return object(media.schema).example;
}

export function requestBodySchema(operation: ApiOperation): unknown {
  return object(object(object(operation.requestBody).content)["application/json"]).schema;
}

function shellQuote(value: string): string { return "'" + value.replaceAll("'", "'\"'\"'") + "'"; }
function parameterExample(parameter: ApiParameter): string {
  const example = parameter.example ?? object(parameter.schema).example;
  return typeof example === "string" ? example : example !== undefined ? JSON.stringify(example) : `replace_${parameter.name || "value"}`;
}

export function apiCurlExample(baseUrl: string, operation: ApiOperation): string {
  let path = operation.path;
  for (const parameter of operation.parameters) if (parameter.in === "path" && parameter.name) path = path.replaceAll(`{${parameter.name}}`, encodeURIComponent(parameterExample(parameter)));
  const query = new URLSearchParams();
  for (const parameter of operation.parameters) if (parameter.in === "query" && parameter.required && parameter.name) query.append(parameter.name, parameterExample(parameter));
  const url = baseUrl.replace(/\/+$/, "") + path + (query.size ? `?${query}` : "");
  const lines = [`curl --request ${operation.method}`, `  --url ${shellQuote(url)}`, "  --header 'Authorization: Bearer tk_live_your_api_key'"];
  for (const parameter of operation.parameters) if (parameter.in === "header" && parameter.required && parameter.name && /^[A-Za-z0-9-]+$/.test(parameter.name) && !/^(authorization|content-type|x-api-key)$/i.test(parameter.name)) lines.push(`  --header ${shellQuote(parameter.name + ": " + parameterExample(parameter))}`);
  const example = requestBodyExample(operation);
  if (example !== undefined) lines.push("  --header 'Content-Type: application/json'", `  --data-raw ${shellQuote(JSON.stringify(example, null, 2))}`);
  return lines.join(" \\\n");
}
