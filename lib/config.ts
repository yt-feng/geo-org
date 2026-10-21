import { env } from "cloudflare:workers";

export type AuthEmailMessage = {
  to: string;
  from: { email: string; name: string };
  subject: string;
  text: string;
};

export type RuntimeEnv = {
  DB?: D1Database;
  AUDIT_MEDIA?: AuditMediaBucket;
  PRODUCT_INQUIRY_EMAIL?: { send(message: import("cloudflare:email").EmailMessage): Promise<unknown> };
  PRODUCT_INQUIRY_FROM?: string;
  PRODUCT_INQUIRY_EMAIL_ENABLED?: string;
  PUBLIC_BASE_URL?: string;
  PUBLIC_BRAND_NAME?: string;
  AUTH_BASE_URL?: string;
  AUTH_ANON_KEY?: string;
  AUTH_EMAIL_HOOK_SECRET?: string;
  AUTH_EMAIL?: { send(message: AuthEmailMessage): Promise<{ messageId: string }> };
  ADMIN_EMAIL?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  APIMART_API_KEY?: string;
  RKAPI_ROUTES_JSON?: string;
  TOKENHUB_API_KEY?: string;
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
  USD_CNY?: string;
  LIANDONG_SALES_ENABLED?: string;
  REDEMPTION_ENABLED?: string;
  REDEMPTION_ISSUANCE_ENABLED?: string;
  LIANDONG_STORE_URL?: string;
  LIANDONG_PRODUCT_30_URL?: string;
  LIANDONG_PRODUCT_90_URL?: string;
  LIANDONG_PRODUCT_300_URL?: string;
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
  return (runtimeEnv().PUBLIC_BASE_URL || "https://tokvilo.com").replace(
    /\/+$/,
    "",
  );
}

export function publicBrandName(): string {
  return runtimeEnv().PUBLIC_BRAND_NAME?.trim() || "tokvilo";
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
