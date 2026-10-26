/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import type { RuntimeEnv } from "../lib/config";
import { runAuditTick } from "../lib/tokenhub-audit";
import { reconcileApimartTasks } from "../lib/apimart-relay";
import { reconcileTokenHubTasks } from "../lib/tokenhub-relay";
import { reconcileProductInquiries } from "../lib/product-inquiries";
import { discoveryResponse, robotsTag, SITE_PATH_HEADER, siteLocaleForPath } from "../lib/site-seo";

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

const BASE_CONTENT_SECURITY_POLICY = "default-src 'self'; img-src 'self' data: https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com https://upload.apimart.ai https://cdn.apimart.ai; media-src 'self' https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com https://upload.apimart.ai https://cdn.apimart.ai; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function contentSecurityPolicy(url: URL, env: Env): string {
  // Payment navigation loads a new document, so only the English wallet needs
  // these origins. Normal pages keep the original policy byte-for-byte.
  if (url.pathname !== "/dashboard/wallet" || url.searchParams.get("lang") !== "en" || url.searchParams.getAll("lang").length !== 1) return BASE_CONTENT_SECURITY_POLICY;
  const sandbox = env.PADDLE_ENVIRONMENT === "sandbox";
  const cdn = sandbox ? "https://sandbox-cdn.paddle.com" : "https://cdn.paddle.com";
  const api = sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
  const checkout = sandbox ? "https://sandbox-buy.paddle.com" : "https://buy.paddle.com";
  // CDN URL: https://developer.paddle.com/paddle-js/about/include-paddlejs/
  // Runtime checkout/CSS/error-frame origins verified in the official SDK:
  // https://cdn.paddle.com/paddle/v2/paddle.js (2.10.2, 2026-10-23).
  // Checkout providers inside Paddle's cross-origin frame use Paddle's policy.
  return BASE_CONTENT_SECURITY_POLICY
    .replace("img-src 'self' data:", `img-src 'self' data: ${cdn}`)
    .replace("style-src 'self' 'unsafe-inline'", `style-src 'self' 'unsafe-inline' ${cdn}`)
    .replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' https://cdn.paddle.com")
    .replace("connect-src 'self'", `connect-src 'self' ${api}`)
    + `; frame-src 'self' ${checkout} ${cdn}`;
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
    ctx.waitUntil(reconcileProductInquiries(env, { maxInquiries: 10 }).catch(() => {
      console.error("Product inquiry notifications remain pending; inspect the inquiry queue.");
    }));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const discovery = discoveryResponse(request);
    if (discovery) return discovery;

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

    // Layouts receive the real URL even during RSC navigation. Overwrite any
    // caller-supplied value; query strings are never used in canonical URLs.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(SITE_PATH_HEADER, url.pathname + url.search);
    const response = await handler.fetch(new Request(request, { headers: requestHeaders }), env, ctx);
    const headers = new Headers(response.headers);
    headers.set("referrer-policy", "no-referrer");
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-frame-options", "DENY");
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    headers.set("x-robots-tag", robotsTag(url, response));
    if ((headers.get("content-type") || "").includes("text/html")) {
      headers.set("content-language", siteLocaleForPath(url.pathname + url.search) === "en" ? "en" : "zh-CN");
      headers.set(
        "content-security-policy",
        contentSecurityPolicy(url, env),
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
