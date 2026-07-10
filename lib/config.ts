import { env } from "cloudflare:workers";

export type RuntimeEnv = {
  DB?: D1Database;
  PUBLIC_BASE_URL?: string;
  PUBLIC_BRAND_NAME?: string;
  AUTH_BASE_URL?: string;
  AUTH_ANON_KEY?: string;
  ADMIN_EMAIL?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  UPSTREAM_BASE_URL?: string;
  UPSTREAM_OPENAPI_URL?: string;
  UPSTREAM_PRICE_ENDPOINT?: string;
  UPSTREAM_API_TOKEN?: string;
  UPSTREAM_MARKERS?: string;
  UPSTREAM_REPLACEMENTS_JSON?: string;
  UPSTREAM_PATH_REWRITES?: string;
  UPSTREAM_TIMEOUT_MS?: string;
  UPSTREAM_SPEND_LIMIT_USD?: string;
  GLOBAL_PROXY_DAILY_LIMIT?: string;
  DEFAULT_USER_DAILY_LIMIT?: string;
  MAX_ACTIVE_KEYS_PER_USER?: string;
  SERVICE_ENABLED?: string;
};

export function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export function requiredEnv(name: keyof RuntimeEnv): string {
  const value = runtimeEnv()[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing runtime configuration: ${name}`);
  }
  return value.trim();
}

export function numericEnv(
  name: keyof RuntimeEnv,
  fallback: number,
  minimum = 1,
): number {
  const raw = runtimeEnv()[name];
  const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= minimum
    ? Math.floor(parsed)
    : fallback;
}

export function decimalEnv(
  name: keyof RuntimeEnv,
  fallback: number,
  minimum = 0,
): number {
  const raw = runtimeEnv()[name];
  const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export function publicBaseUrl(): string {
  return (runtimeEnv().PUBLIC_BASE_URL || "https://api.eco-geo.com").replace(
    /\/+$/,
    "",
  );
}

export function publicBrandName(): string {
  return runtimeEnv().PUBLIC_BRAND_NAME?.trim() || "Eco Geo API";
}

export function isServiceEnabled(): boolean {
  return runtimeEnv().SERVICE_ENABLED?.toLowerCase() === "true";
}

export function getD1(): D1Database {
  const database = runtimeEnv().DB;
  if (!database) {
    throw new Error("Database binding is unavailable");
  }
  return database;
}
