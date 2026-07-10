import {
  publicBaseUrl,
  publicBrandName,
  type RuntimeEnv,
} from "./config";
import { buildReplacements, sanitizeText } from "./sanitize";

const LOCAL_MANAGEMENT_BASE = "/api/v1/gateway";

const LOCAL_MANAGEMENT_PATHS = new Set([
  `${LOCAL_MANAGEMENT_BASE}/user/get_user_info`,
  `${LOCAL_MANAGEMENT_BASE}/user/get_user_daily_usage`,
  `${LOCAL_MANAGEMENT_BASE}/user/calculate_price`,
  `${LOCAL_MANAGEMENT_BASE}/user/get_tiered_discount_info`,
  `${LOCAL_MANAGEMENT_BASE}/user/get_endpoint_info`,
  `${LOCAL_MANAGEMENT_BASE}/user/get_all_endpoints_info`,
  `${LOCAL_MANAGEMENT_BASE}/downloader/version`,
]);

const HIDDEN_PATHS = new Set([
  "/api/v1/tiktok/web/tiktok_live_room",
  "/api/v1/douyin/web/douyin_live_room",
]);

const OMITTED_KEYS = new Set([
  "contact",
  "externalDocs",
  "license",
  "operationId",
  "termsOfService",
]);

const EXTERNAL_FINGERPRINT_URL =
  /https?:\/\/(?:www\.)?(?:discord\.gg|github\.com|apifox\.com)\/[^\s)\]}>"']*/gi;

function scrubValue(
  value: unknown,
  replacements: ReturnType<typeof buildReplacements>,
  publicBase: string,
): unknown {
  if (typeof value === "string") {
    return sanitizeText(value, replacements).replace(
      EXTERNAL_FINGERPRINT_URL,
      publicBase,
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, replacements, publicBase));
  }
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [rawKey, entry] of Object.entries(value)) {
    if (OMITTED_KEYS.has(rawKey) || rawKey.toLowerCase().startsWith("x-")) {
      continue;
    }
    const key = sanitizeText(rawKey, replacements);
    output[key] = scrubValue(entry, replacements, publicBase);
  }
  return output;
}

export function sanitizeOpenApiDocument(
  input: unknown,
  current: RuntimeEnv,
): Record<string, unknown> {
  const publicBase = (current.PUBLIC_BASE_URL || publicBaseUrl()).replace(
    /\/+$/,
    "",
  );
  const brand = current.PUBLIC_BRAND_NAME?.trim() || publicBrandName();
  const replacements = buildReplacements(current);
  const scrubbed = scrubValue(
    input,
    replacements,
    publicBase,
  ) as Record<string, unknown>;

  const paths = scrubbed.paths;
  if (paths && typeof paths === "object" && !Array.isArray(paths)) {
    const filtered: Record<string, unknown> = {};
    for (const [path, operation] of Object.entries(paths)) {
      const isManagementPath =
        path === LOCAL_MANAGEMENT_BASE ||
        path.startsWith(`${LOCAL_MANAGEMENT_BASE}/`);
      if (HIDDEN_PATHS.has(path)) continue;
      if (isManagementPath && !LOCAL_MANAGEMENT_PATHS.has(path)) continue;
      filtered[path] = operation;
    }
    scrubbed.paths = filtered;
  }

  scrubbed.info = {
    title: `${brand} Private API`,
    version: "1.0.0",
    description: "Private API reference for authenticated members.",
  };
  scrubbed.servers = [{ url: publicBase }];
  return scrubbed;
}
