/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import type { RuntimeEnv } from "../lib/config";
import { runAuditTick } from "../lib/tokenhub-audit";
import { reconcileApimartTasks } from "../lib/apimart-relay";
import { reconcileTokenHubTasks } from "../lib/tokenhub-relay";

interface Env extends RuntimeEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async scheduled(_event: { scheduledTime: number }, env: Env, ctx: ExecutionContext): Promise<void> {
    // The D1 campaign controls the seven-day window and atomically claims each
    // paid case. Cron ticks never start a campaign or retry an uncertain charge.
    ctx.waitUntil(runAuditTick(env, { maxCases: 2 }).catch(() => {
      // Do not expose provider responses or credentials in infrastructure logs.
      console.error("TokenHub audit tick failed; inspect the audit ledger.");
    }));
    // Reconciliation only reads previously created, owner-bound tasks. It never
    // submits a new generation request, and wallet settlement is idempotent.
    ctx.waitUntil(Promise.allSettled([
      reconcileApimartTasks(env, { maxTasks: 10 }),
      reconcileTokenHubTasks(env, { maxTasks: 10 }),
    ]).then(results => {
      if (results.some(result => result.status === "rejected")) console.error("Wallet task reconciliation incomplete; inspect pending reservations.");
    }));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    headers.set("referrer-policy", "no-referrer");
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-frame-options", "DENY");
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if ((headers.get("content-type") || "").includes("text/html")) {
      headers.set(
        "content-security-policy",
        "default-src 'self'; img-src 'self' data: https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com https://upload.apimart.ai; media-src 'self' https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      headers.set("cache-control", "private, no-store");
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

export default worker;
