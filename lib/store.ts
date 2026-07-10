import type { PortalUser } from "./auth";
import { decimalEnv, getD1, numericEnv } from "./config";

export type ApiKeyRow = {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type UserSummary = {
  dailyLimit: number;
  callsToday: number;
  successesToday: number;
  errorsToday: number;
  activeKeys: number;
};

export async function ensureUser(user: PortalUser): Promise<void> {
  const dailyLimit = numericEnv("DEFAULT_USER_DAILY_LIMIT", 100);
  await getD1()
    .prepare(
      `INSERT INTO users (id, email, display_name, status, daily_limit)
       VALUES (?, ?, ?, 'active', ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(user.id, user.email, user.displayName, dailyLimit)
    .run();
}

export async function listApiKeys(userId: string): Promise<ApiKeyRow[]> {
  const result = await getD1()
    .prepare(
      `SELECT id, label, key_prefix, created_at, last_used_at, revoked_at
       FROM api_keys
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
    )
    .bind(userId)
    .all<ApiKeyRow>();
  return result.results || [];
}

export async function getUserSummary(user: PortalUser): Promise<UserSummary> {
  await ensureUser(user);
  const day = new Date().toISOString().slice(0, 10);
  const row = await getD1()
    .prepare(
      `SELECT
         u.daily_limit AS daily_limit,
         COALESCE(d.calls, 0) AS calls_today,
         COALESCE(d.successes, 0) AS successes_today,
         COALESCE(d.errors, 0) AS errors_today,
         (SELECT COUNT(*) FROM api_keys k
          WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS active_keys
       FROM users u
       LEFT JOIN usage_daily d ON d.user_id = u.id AND d.day = ?
       WHERE u.id = ?`,
    )
    .bind(day, user.id)
    .first<Record<string, number>>();

  return {
    dailyLimit: Number(row?.daily_limit || 0),
    callsToday: Number(row?.calls_today || 0),
    successesToday: Number(row?.successes_today || 0),
    errorsToday: Number(row?.errors_today || 0),
    activeKeys: Number(row?.active_keys || 0),
  };
}

export async function getAdminOverview(): Promise<{
  users: Array<Record<string, string | number | null>>;
  callsToday: number;
  globalLimit: number;
  reservedSpendUsd: number;
  spendLimitUsd: number;
}> {
  const database = getD1();
  const day = new Date().toISOString().slice(0, 10);
  const [usersResult, globalRow, spendRow] = await Promise.all([
    database
      .prepare(
        `SELECT
           u.id, u.email, u.display_name, u.status, u.daily_limit, u.created_at,
           COALESCE(d.calls, 0) AS calls_today,
           (SELECT COUNT(*) FROM api_keys k
            WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS active_keys
         FROM users u
         LEFT JOIN usage_daily d ON d.user_id = u.id AND d.day = ?
         ORDER BY u.created_at DESC
         LIMIT 100`,
      )
      .bind(day)
      .all<Record<string, string | number | null>>(),
    database
      .prepare("SELECT calls FROM global_usage WHERE day = ?")
      .bind(day)
      .first<{ calls: number }>(),
    database
      .prepare("SELECT reserved_microusd FROM spend_guard WHERE id = 'relay'")
      .first<{ reserved_microusd: number }>(),
  ]);
  return {
    users: usersResult.results || [],
    callsToday: Number(globalRow?.calls || 0),
    globalLimit: numericEnv("GLOBAL_PROXY_DAILY_LIMIT", 5000),
    reservedSpendUsd: Number(spendRow?.reserved_microusd || 0) / 1_000_000,
    spendLimitUsd: decimalEnv("UPSTREAM_SPEND_LIMIT_USD", 1),
  };
}
