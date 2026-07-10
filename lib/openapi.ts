import {
  publicBaseUrl,
  publicBrandName,
  type RuntimeEnv,
} from "./config";
import { buildReplacements, sanitizeText } from "./sanitize";

const LOCAL_MANAGEMENT_BASE = "/api/v1/gateway";

const HIDDEN_PATHS = new Set([
  "/api/v1/tiktok/web/tiktok_live_room",
  "/api/v1/douyin/web/douyin_live_room",
]);

const OMITTED_KEYS = new Set([
  "contact",
  "description",
  "example",
  "examples",
  "externalDocs",
  "license",
  "operationId",
  "termsOfService",
]);

const EXTERNAL_FINGERPRINT_URL =
  /https?:\/\/(?:www\.)?(?:discord\.gg|github\.com|(?:[a-z0-9-]+\.)?github\.io|apifox\.com)\/[^\s)\]}>"']*/gi;

export function hasOpenApiSanitizationConfig(current: RuntimeEnv): boolean {
  const markers = (current.UPSTREAM_MARKERS || "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (
    !current.UPSTREAM_BASE_URL?.trim() ||
    !current.UPSTREAM_OPENAPI_URL?.trim() ||
    markers.length === 0
  ) {
    return false;
  }
  try {
    const rewrites = JSON.parse(current.UPSTREAM_PATH_REWRITES || "") as Record<
      string,
      string
    >;
    return Object.entries(rewrites).some(
      ([publicPath, upstreamPath]) =>
        publicPath === LOCAL_MANAGEMENT_BASE && upstreamPath.startsWith("/"),
    );
  } catch {
    return false;
  }
}

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
  const scrubbedValue = scrubValue(
    input,
    replacements,
    publicBase,
  );
  if (
    !scrubbedValue ||
    typeof scrubbedValue !== "object" ||
    Array.isArray(scrubbedValue)
  ) {
    throw new Error("Invalid API document");
  }
  const scrubbed = scrubbedValue as Record<string, unknown>;

  const paths = scrubbed.paths;
  if (paths && typeof paths === "object" && !Array.isArray(paths)) {
    const filtered: Record<string, unknown> = {};
    for (const [path, operation] of Object.entries(paths)) {
      const isManagementPath =
        path === LOCAL_MANAGEMENT_BASE ||
        path.startsWith(`${LOCAL_MANAGEMENT_BASE}/`);
      if (HIDDEN_PATHS.has(path)) continue;
      if (isManagementPath) continue;
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

  const serialized = JSON.stringify(scrubbed).toLowerCase();
  const forbidden = [
    current.UPSTREAM_BASE_URL || "",
    current.UPSTREAM_OPENAPI_URL || "",
    ...(current.UPSTREAM_MARKERS || "").split(/[\n,]/),
  ]
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (forbidden.some((entry) => serialized.includes(entry))) {
    throw new Error("API document sanitization failed");
  }
  return scrubbed;
}
