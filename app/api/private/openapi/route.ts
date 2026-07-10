import { getPortalUser } from "@/lib/auth";
import { requiredEnv, runtimeEnv } from "@/lib/config";
import { buildReplacements, sanitizeTextStream } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await getPortalUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const current = runtimeEnv();
  if (!current.UPSTREAM_MARKERS && !current.UPSTREAM_REPLACEMENTS_JSON) {
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
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "Documentation is unavailable." }, { status: 502 });
  }

  return new Response(
    sanitizeTextStream(upstream.body, buildReplacements(current)),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
