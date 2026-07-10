import { getD1 } from "./config";
import { sha256Hex } from "./crypto";

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS_PER_WINDOW = 20;

export async function consumeLoginAttempt(request: Request): Promise<boolean> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowId = Math.floor(nowSeconds / WINDOW_SECONDS);
  const ip =
    request.headers.get("cf-connecting-ip")?.trim() ||
    "unknown";
  const id = await sha256Hex(`${ip}|${windowId}`);
  const expiresAt = new Date((windowId + 1) * WINDOW_SECONDS * 1000).toISOString();
  const row = await getD1()
    .prepare(
      `INSERT INTO login_rate_limits (id, attempts, expires_at, updated_at)
       VALUES (?, 1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         attempts = login_rate_limits.attempts + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE login_rate_limits.attempts < ?
       RETURNING attempts`,
    )
    .bind(id, expiresAt, MAX_ATTEMPTS_PER_WINDOW)
    .first<{ attempts: number }>();
  return Boolean(row);
}
