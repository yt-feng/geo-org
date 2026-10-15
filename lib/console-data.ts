import { getD1 } from "./config";

export type DailyUsage = { day: string; calls: number; successes: number; errors: number };
export type UsageEvent = { request_id: string; method: string; path: string; status: number; latency_ms: number; created_at: string };

export async function getUsageTrend(userId: string): Promise<DailyUsage[]> {
  const today = new Date();
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - 29 + index);
    return date.toISOString().slice(0, 10);
  });
  const result = await getD1().prepare(
    `SELECT day, calls, successes, errors FROM usage_daily
     WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day ASC`,
  ).bind(userId, days[0], days[29]).all<DailyUsage>();
  const records = new Map((result.results || []).map((row) => [row.day, row]));
  return days.map((day) => records.get(day) || { day, calls: 0, successes: 0, errors: 0 });
}

export async function getUsageEvents(userId: string, options: { limit?: number; query?: string; status?: string } = {}): Promise<UsageEvent[]> {
  const query = (options.query || "").trim().slice(0, 100);
  const status = options.status === "4xx" ? 400 : options.status === "5xx" ? 500 : 0;
  const requestedLimit = typeof options.limit === "number" && Number.isFinite(options.limit) ? Math.floor(options.limit) : 50;
  const limit = Math.max(1, Math.min(100, requestedLimit));
  const result = await getD1().prepare(
    `SELECT request_id, method, path, status, latency_ms, created_at FROM usage_events
     WHERE user_id = ? AND (? = '' OR instr(path, ?) > 0 OR instr(request_id, ?) > 0)
       AND (? = 0 OR (status >= ? AND status < ?))
     ORDER BY created_at DESC LIMIT ?`,
  ).bind(userId, query, query, query, status, status, status + 100, limit).all<UsageEvent>();
  return result.results || [];
}

export function displayTimestamp(value: string | null): string {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}
