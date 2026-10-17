import type { RuntimeEnv } from "./config";

const ORIGIN = "https://api.apimart.ai";
const DEFAULT_CONTEXT = "eco-geo/provider/apimart/v1";
type StoredProvider = {
  encrypted_key: string;
  key_hint: string;
  updated_at: string;
  verified_at: string;
};
export class ProviderError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
export type ProviderStatus = {
  configured: boolean;
  source: "saved" | "environment" | "none";
  keyHint: string | null;
  updatedAt: string | null;
  verifiedAt: string | null;
};
export type ProviderQuota = { remaining: number | null; unlimited: boolean };

function keyHint(key: string) { return `••••${key.slice(-4)}`; }
function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""));
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
async function encryptionKey(secret: string | undefined, context: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new ProviderError("服务端加密配置尚未完成，请联系管理员。");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: context, info: context }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptProviderKey(value: string, secret: string | undefined, purpose = DEFAULT_CONTEXT): Promise<string> {
  const context = new TextEncoder().encode(purpose);
  const key = await encryptionKey(secret, context), iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: context }, key, new TextEncoder().encode(value));
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function decryptProviderKey(value: string, secret: string | undefined, purpose = DEFAULT_CONTEXT): Promise<string> {
  try {
    const [version, nonce, ciphertext, extra] = value.split(".");
    if (version !== "v1" || !nonce || !ciphertext || extra) throw new Error();
    const context = new TextEncoder().encode(purpose);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(nonce), additionalData: context }, await encryptionKey(secret, context), decode(ciphertext));
    return new TextDecoder().decode(decrypted);
  } catch { throw new ProviderError("已保存密钥暂不可读取，请重新填写并保存。"); }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new ProviderError("APIMart 返回了无效响应，请稍后重试。", 502);
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
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new ProviderError("APIMart 返回了无效响应，请稍后重试。", 502); }
  finally { reader.releaseLock(); }
}

export function createProviderSettings(env: RuntimeEnv, fetcher: typeof fetch = fetch) {
  function db() {
    if (!env.DB) throw new ProviderError("配置存储暂不可用，请稍后重试。");
    return env.DB;
  }
  async function stored(): Promise<StoredProvider | null> {
    return db().prepare("SELECT encrypted_key, key_hint, updated_at, verified_at FROM provider_settings WHERE provider = 'apimart'").first<StoredProvider>();
  }
  function fromRow(row: StoredProvider | null): ProviderStatus {
    if (row) return { configured: true, source: "saved", keyHint: row.key_hint, updatedAt: row.updated_at, verifiedAt: row.verified_at };
    const key = env.APIMART_API_KEY?.trim();
    return { configured: !!key, source: key ? "environment" : "none", keyHint: key ? keyHint(key) : null, updatedAt: null, verifiedAt: null };
  }
  async function credential() {
    const row = await stored();
    const key = row ? await decryptProviderKey(row.encrypted_key, env.ADMIN_SESSION_SECRET) : env.APIMART_API_KEY?.trim();
    if (!key) throw new ProviderError("请先填写并保存 APIMart API Key。", 409);
    return { key, row };
  }
  async function upstream(path: "/v1/balance" | "/v1/models?expand=category", key: string) {
    let response: Response;
    try {
      response = await fetcher(ORIGIN + path, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    } catch { throw new ProviderError("暂时无法连接 APIMart，请稍后重试。", 502); }
    if (response.status === 401 || response.status === 403) throw new ProviderError("APIMart 密钥无效或没有访问权限，请检查后重试。", 422);
    if (response.status === 429) throw new ProviderError("APIMart 请求频率已达上限，请稍后重试。", 429);
    if (!response.ok) throw new ProviderError("APIMart 服务暂不可用，请稍后重试。", 502);
    const data = await readJson(response);
    if (data.success === false || data.error) throw new ProviderError("APIMart 未通过验证，请检查密钥及其权限。", 422);
    return data;
  }
  async function balance(key: string): Promise<ProviderQuota> {
    const data = await upstream("/v1/balance", key);
    if (data.success !== true || typeof data.unlimited_quota !== "boolean" || typeof data.remain_balance !== "number" || !Number.isFinite(data.remain_balance) || (!data.unlimited_quota && data.remain_balance < 0)) throw new ProviderError("APIMart 余额响应不完整，配置尚未验证。", 502);
    return { remaining: data.unlimited_quota ? null : data.remain_balance, unlimited: data.unlimited_quota };
  }
  return {
    async status() { return { upstream: { configured: !!(env.UPSTREAM_BASE_URL?.trim() && env.UPSTREAM_API_TOKEN?.trim()) }, apimart: fromRow(await stored()) }; },
    async save(value: unknown) {
      if (typeof value !== "string" || !/^[\x21-\x7e]{12,512}$/.test(value.trim())) throw new ProviderError("请输入完整的 APIMart API Key（12–512 位，不含空白）。", 400);
      const key = value.trim();
      // Check encryption availability before any upstream call. Invalid replacements never overwrite a working key.
      const encrypted = await encryptProviderKey(key, env.ADMIN_SESSION_SECRET);
      const quota = await balance(key), now = new Date().toISOString();
      await db().prepare(`INSERT INTO provider_settings (provider, encrypted_key, key_hint, updated_at, verified_at)
        VALUES ('apimart', ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET encrypted_key=excluded.encrypted_key, key_hint=excluded.key_hint, updated_at=excluded.updated_at, verified_at=excluded.verified_at`).bind(encrypted, keyHint(key), now, now).run();
      return { ok: true, apimart: fromRow({ encrypted_key: encrypted, key_hint: keyHint(key), updated_at: now, verified_at: now }), quota };
    },
    async test() {
      const { key, row } = await credential(), quota = await balance(key);
      if (row) await db().prepare("UPDATE provider_settings SET verified_at = ? WHERE provider = 'apimart' AND encrypted_key = ?").bind(new Date().toISOString(), row.encrypted_key).run();
      return { ok: true, quota };
    },
    async models() {
      const { key } = await credential(), data = await upstream("/v1/models?expand=category", key);
      if (!Array.isArray(data.data)) throw new ProviderError("APIMart 模型列表格式不正确，请稍后重试。", 502);
      const models = data.data.filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof m.id === "string").map(m => ({ id: String(m.id).slice(0, 200), provider: typeof m.owned_by === "string" ? m.owned_by.slice(0, 100) : "", category: (Array.isArray(m.category) ? m.category : typeof m.category === "string" ? [m.category] : []).filter((c): c is string => typeof c === "string").map(c => c.slice(0, 80)) }));
      return { ok: true, models };
    },
  };
}
