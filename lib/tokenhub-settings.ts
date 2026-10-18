import type { RuntimeEnv } from "./config";
import { mergeTokenHubCatalog, validTokenHubCatalog } from "./tokenhub-catalog";
export type { TokenHubModel } from "./tokenhub-catalog";
import { decryptProviderKey, encryptProviderKey, ProviderError, type ProviderStatus } from "./provider-settings";

export const TOKENHUB_ORIGIN = "https://ai-tokenhub.ai";
const CONTEXT = "eco-geo/provider/tokenhub/v1";
type StoredProvider = { encrypted_key: string; key_hint: string; updated_at: string; verified_at: string };
function keyHint(key: string) { return `••••${key.slice(-4)}`; }
function sanitize(value: unknown, key: string): unknown {
  if (typeof value === "string") return value.replaceAll(key, "[redacted]").replaceAll(encodeURIComponent(key), "[redacted]");
  if (Array.isArray(value)) return value.map(item => sanitize(item, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [String(sanitize(name, key)), sanitize(item, key)]));
  return value;
}

async function readCatalog(response: Response, source: "models_api" | "pricing", key: string): Promise<Record<string, unknown>> {
  if (!response.body) throw new ProviderError("TokenHub 返回了无效响应，请稍后重试。", 502);
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2_000_000) { await reader.cancel(); throw new Error(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data = sanitize(JSON.parse(new TextDecoder().decode(bytes)), key);
    if (!validTokenHubCatalog(data, source)) throw new Error();
    return data;
  } catch { throw new ProviderError("TokenHub 模型列表格式不正确，请稍后重试。", 502); }
  finally { reader.releaseLock(); }
}

export function createTokenHubSettings(env: RuntimeEnv, fetcher: typeof fetch = fetch) {
  function db() {
    if (!env.DB) throw new ProviderError("配置存储暂不可用，请稍后重试。");
    return env.DB;
  }
  async function stored(): Promise<StoredProvider | null> {
    return db().prepare("SELECT encrypted_key, key_hint, updated_at, verified_at FROM provider_settings WHERE provider = 'tokenhub'").first<StoredProvider>();
  }
  function fromRow(row: StoredProvider | null): ProviderStatus {
    if (row) return { configured: true, source: "saved", keyHint: row.key_hint, updatedAt: row.updated_at, verifiedAt: row.verified_at || null };
    const key = env.TOKENHUB_API_KEY?.trim();
    return { configured: !!key, source: key ? "environment" : "none", keyHint: key ? keyHint(key) : null, updatedAt: null, verifiedAt: null };
  }
  async function credentialWithRow() {
    const row = await stored();
    const key = row ? await decryptProviderKey(row.encrypted_key, env.ADMIN_SESSION_SECRET, CONTEXT) : env.TOKENHUB_API_KEY?.trim();
    if (!key) throw new ProviderError("请先填写并保存 TokenHub API Key。", 409);
    return { key, row };
  }
  async function upstreamModels(key: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      // The public catalog permits anonymous requests, but validates an explicitly supplied Bearer key.
      // Never omit Authorization: an anonymous 200 response cannot verify this credential.
      response = await fetcher(`${TOKENHUB_ORIGIN}/api/v1/models`, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    } catch (cause) {
      const details = cause && typeof cause === "object" ? cause as { name?: unknown; message?: unknown } : {};
      const sanitize = (value: unknown, fallback: string) => typeof value === "string"
        ? value.replaceAll(key, "[redacted]").replaceAll(JSON.stringify(key).slice(1, -1), "[redacted]").replaceAll(encodeURIComponent(key), "[redacted]").slice(0, 500)
        : fallback;
      console.error("[tokenhub] model discovery failed", { name: sanitize(details.name, "UnknownError"), message: sanitize(details.message, "No diagnostic message") });
      throw new ProviderError("暂时无法连接 TokenHub，请稍后重试。", 502);
    }
    if (response.status === 401 || response.status === 403) throw new ProviderError("TokenHub 密钥无效或没有访问权限，请检查后重试。", 422);
    if (response.status === 429) throw new ProviderError("TokenHub 请求频率已达上限，请稍后重试。", 429);
    if (!response.ok) throw new ProviderError("TokenHub 服务暂不可用，请稍后重试。", 502);
    return readCatalog(response, "models_api", key);
  }
  async function discoverModels(key: string) {
    // Authenticate against the credential-aware endpoint before reading the public
    // prices. A public catalog must never make an invalid credential look valid.
    const listed = await upstreamModels(key);
    let pricing: Record<string, unknown> | null = null;
    try {
      const response = await fetcher(`${TOKENHUB_ORIGIN}/api/pricing`, { method: "GET", headers: { Accept: "application/json" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (response.ok) pricing = await readCatalog(response, "pricing", key);
    } catch { /* Return an explicitly incomplete catalog; never invent media IDs. */ }
    const models = mergeTokenHubCatalog(listed, pricing);
    return { models, catalog: { complete: pricing !== null, observedAt: new Date().toISOString(),
      sources: [{ source: "models_api", status: "ok", modelCount: models.filter(model => model.sources.includes("models_api")).length }, { source: "pricing", status: pricing ? "ok" : "unavailable", modelCount: models.filter(model => model.sources.includes("pricing")).length }],
      warnings: pricing ? [] : ["公开价格目录暂不可用；当前仅列出认证模型接口返回的模型，图片和视频目录可能不完整。"],
    } };
  }
  return {
    async status(): Promise<ProviderStatus> { return fromRow(await stored()); },
    // Used only by server-side relay code. This value must never be returned from a route.
    async credential(): Promise<string> { return (await credentialWithRow()).key; },
    async save(value: unknown) {
      if (typeof value !== "string" || !/^[\x21-\x7e]{12,512}$/.test(value.trim())) throw new ProviderError("请输入完整的 TokenHub API Key（12–512 位，不含空白）。", 400);
      const key = value.trim();
      const encrypted = await encryptProviderKey(key, env.ADMIN_SESSION_SECRET, CONTEXT);
      const discovered = await discoverModels(key), now = new Date().toISOString();
      await db().prepare(`INSERT INTO provider_settings (provider, encrypted_key, key_hint, updated_at, verified_at)
        VALUES ('tokenhub', ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET encrypted_key=excluded.encrypted_key, key_hint=excluded.key_hint, updated_at=excluded.updated_at, verified_at=excluded.verified_at`).bind(encrypted, keyHint(key), now, now).run();
      return { ok: true, tokenhub: fromRow({ encrypted_key: encrypted, key_hint: keyHint(key), updated_at: now, verified_at: now }), modelCount: discovered.models.length, catalog: discovered.catalog };
    },
    async test() {
      const { key, row } = await credentialWithRow(), discovered = await discoverModels(key), now = new Date().toISOString();
      if (row) await db().prepare("UPDATE provider_settings SET verified_at = ? WHERE provider = 'tokenhub' AND encrypted_key = ?").bind(now, row.encrypted_key).run();
      return { ok: true, verifiedAt: now, modelCount: discovered.models.length, catalog: discovered.catalog };
    },
    async models() {
      const { key } = await credentialWithRow();
      return { ok: true, ...await discoverModels(key) };
    },
  };
}
