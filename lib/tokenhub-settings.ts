import type { RuntimeEnv } from "./config";
import { decryptProviderKey, encryptProviderKey, ProviderError, type ProviderStatus } from "./provider-settings";

export const TOKENHUB_ORIGIN = "https://ai-tokenhub.ai";
const CONTEXT = "eco-geo/provider/tokenhub/v1";
type StoredProvider = { encrypted_key: string; key_hint: string; updated_at: string; verified_at: string };
export type TokenHubModel = { id: string; name: string; provider: string; category: string[]; capabilities: string[] };

function keyHint(key: string) { return `••••${key.slice(-4)}`; }
function stringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 80).slice(0, 32);
}

async function readModels(response: Response): Promise<TokenHubModel[]> {
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
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data) || data.error || data.success === false || data.object !== "list" || !Array.isArray(data.data)) throw new Error();
    return data.data.filter((model: unknown): model is Record<string, unknown> => !!model && typeof model === "object" && typeof (model as Record<string, unknown>).id === "string" && String((model as Record<string, unknown>).id).length > 0 && String((model as Record<string, unknown>).id).length <= 200).map((model: Record<string, unknown>) => {
      const capabilities = stringList(model.capabilities);
      return {
        id: String(model.id),
        name: typeof model.name === "string" ? model.name.slice(0, 200) : String(model.id),
        provider: typeof model.provider === "string" ? model.provider.slice(0, 100) : typeof model.owned_by === "string" ? model.owned_by.slice(0, 100) : "",
        category: stringList(model.modelType).length ? stringList(model.modelType) : capabilities,
        capabilities,
      };
    });
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
  async function upstreamModels(key: string): Promise<TokenHubModel[]> {
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
    return readModels(response);
  }
  return {
    async status(): Promise<ProviderStatus> { return fromRow(await stored()); },
    // Used only by server-side relay code. This value must never be returned from a route.
    async credential(): Promise<string> { return (await credentialWithRow()).key; },
    async save(value: unknown) {
      if (typeof value !== "string" || !/^[\x21-\x7e]{12,512}$/.test(value.trim())) throw new ProviderError("请输入完整的 TokenHub API Key（12–512 位，不含空白）。", 400);
      const key = value.trim();
      const encrypted = await encryptProviderKey(key, env.ADMIN_SESSION_SECRET, CONTEXT);
      const models = await upstreamModels(key), now = new Date().toISOString();
      await db().prepare(`INSERT INTO provider_settings (provider, encrypted_key, key_hint, updated_at, verified_at)
        VALUES ('tokenhub', ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET encrypted_key=excluded.encrypted_key, key_hint=excluded.key_hint, updated_at=excluded.updated_at, verified_at=excluded.verified_at`).bind(encrypted, keyHint(key), now, now).run();
      return { ok: true, tokenhub: fromRow({ encrypted_key: encrypted, key_hint: keyHint(key), updated_at: now, verified_at: now }), modelCount: models.length };
    },
    async test() {
      const { key, row } = await credentialWithRow(), models = await upstreamModels(key), now = new Date().toISOString();
      if (row) await db().prepare("UPDATE provider_settings SET verified_at = ? WHERE provider = 'tokenhub' AND encrypted_key = ?").bind(now, row.encrypted_key).run();
      return { ok: true, verifiedAt: now, modelCount: models.length };
    },
    async models() {
      const { key } = await credentialWithRow();
      return { ok: true, models: await upstreamModels(key) };
    },
  };
}
