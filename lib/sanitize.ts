import {
  publicBaseUrl,
  publicBrandName,
  runtimeEnv,
  type RuntimeEnv,
} from "./config";

type Replacement = { from: string; to: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildReplacements(current = runtimeEnv()): Replacement[] {
  const brand = current.PUBLIC_BRAND_NAME?.trim() || publicBrandName();
  const publicBase = (current.PUBLIC_BASE_URL || publicBaseUrl()).replace(
    /\/+$/,
    "",
  );
  const upstreamBase = current.UPSTREAM_BASE_URL?.replace(/\/+$/, "");
  const upstreamSpec = current.UPSTREAM_OPENAPI_URL?.trim();
  const replacements: Replacement[] = [];

  if (upstreamBase) {
    replacements.push({ from: upstreamBase, to: `${publicBase}/api/v1` });
    try {
      replacements.push({
        from: new URL(upstreamBase).origin,
        to: publicBase,
      });
    } catch {
      // Configuration is validated by the proxy before use.
    }
  }
  if (upstreamSpec) replacements.push({ from: upstreamSpec, to: `${publicBase}/api/private/openapi` });

  if (current.UPSTREAM_REPLACEMENTS_JSON) {
    try {
      const custom = JSON.parse(current.UPSTREAM_REPLACEMENTS_JSON) as Array<{
        from?: string;
        to?: string;
      }>;
      for (const entry of custom) {
        if (entry.from?.trim() && entry.to?.trim()) {
          replacements.push({ from: entry.from.trim(), to: entry.to.trim() });
        }
      }
    } catch {
      // Invalid optional replacement config is ignored; required origin rewrites remain active.
    }
  }

  for (const marker of (current.UPSTREAM_MARKERS || "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    replacements.push({ from: marker, to: brand });
  }

  const seen = new Set<string>();
  return replacements.filter((replacement) => {
    const key = replacement.from.toLowerCase();
    if (!replacement.from || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sanitizeText(
  input: string,
  replacements = buildReplacements(),
): string {
  return replacements.reduce(
    (output, replacement) =>
      output.replace(
        new RegExp(escapeRegExp(replacement.from), "gi"),
        replacement.to,
      ),
    input,
  );
}

export function sanitizeLocation(
  value: string,
  current: RuntimeEnv = runtimeEnv(),
): string {
  return sanitizeText(value, buildReplacements(current));
}

export function sanitizeTextStream(
  source: ReadableStream<Uint8Array>,
  replacements = buildReplacements(),
): ReadableStream<Uint8Array> {
  const longest = Math.max(
    64,
    ...replacements.map((replacement) => replacement.from.length + 8),
  );
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let carry = "";

  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const combined = carry + decoder.decode(chunk, { stream: true });
        const splitAt = Math.max(0, combined.length - longest);
        const safe = combined.slice(0, splitAt);
        carry = combined.slice(splitAt);
        if (safe) controller.enqueue(encoder.encode(sanitizeText(safe, replacements)));
      },
      flush(controller) {
        carry += decoder.decode();
        if (carry) controller.enqueue(encoder.encode(sanitizeText(carry, replacements)));
      },
    }),
  );
}

export function isTextualContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("javascript") ||
    normalized.includes("x-www-form-urlencoded")
  );
}
