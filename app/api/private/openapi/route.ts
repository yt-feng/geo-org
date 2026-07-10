import { getPortalUser } from "@/lib/auth";
import { requiredEnv, runtimeEnv } from "@/lib/config";
import {
  hasOpenApiSanitizationConfig,
  sanitizeOpenApiDocument,
} from "@/lib/openapi";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await getPortalUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const current = runtimeEnv();
  if (!hasOpenApiSanitizationConfig(current)) {
    return Response.json({ error: "Documentation is not enabled." }, { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(requiredEnv("UPSTREAM_OPENAPI_URL"), {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: "Documentation is unavailable." }, { status: 503 });
  }
  if (!upstream.ok) {
    return Response.json({ error: "Documentation is unavailable." }, { status: 502 });
  }

  let document: unknown;
  try {
    document = await upstream.json();
  } catch {
    return Response.json({ error: "Documentation is unavailable." }, { status: 502 });
  }

  try {
    return Response.json(sanitizeOpenApiDocument(document, current), {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Documentation is unavailable." }, { status: 503 });
  }
}
