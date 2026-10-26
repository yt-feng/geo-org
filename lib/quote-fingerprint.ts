/** Stable pricing identity. Fetch/quote timestamps are intentionally excluded;
 * model, units, tiers, exact rates, policy and reservation bounds remain bound. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key, entry]) => !["observedAt", "quotedAt"].includes(key) && entry !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => [key, canonical(entry)]));
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Invalid quote amount");
  return value;
}
export async function quoteFingerprint(quote: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(quote))));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}
export class QuoteChangedError extends Error {
  readonly status = 409;
  readonly code = "quote_changed";
  constructor() { super("费率或计费条件已更新，请重新获取报价后确认。尚未发送生成请求或预留金额。"); this.name = "QuoteChangedError"; }
}
/** Legacy API clients can omit the header. Browser clients require it before
 * submission; an accepted idempotent receipt is recovered before this check. */
export async function assertQuoteFingerprint(request: Request, quote: unknown): Promise<void> {
  const accepted = request.headers.get("X-Tokvilo-Quote-Fingerprint");
  if (accepted !== null && (!/^[a-f0-9]{64}$/.test(accepted) || accepted !== await quoteFingerprint(quote))) throw new QuoteChangedError();
}
