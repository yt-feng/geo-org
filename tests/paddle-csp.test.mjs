import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const code = compile(await readFile(new URL("../worker/index.ts", import.meta.url), "utf8"));
async function response(path, environment = "production", contentType = "text/html; charset=utf-8") {
  const compiledModule = { exports: {} };
  vm.runInNewContext(code, {
    module: compiledModule, exports: compiledModule.exports, URL, Headers, Response,
    require(name) {
      if (name === "vinext/server/app-router-entry") return { default: { fetch: async () => new Response("fixture", { headers: { "content-type": contentType, "x-app-header": "preserved" } }) } };
      if (name === "vinext/server/image-optimization") return { DEFAULT_DEVICE_SIZES: [], DEFAULT_IMAGE_SIZES: [] };
      if (name.startsWith("../lib/")) return {};
      throw Error(name);
    },
  });
  return compiledModule.exports.default.fetch(new Request(`https://tokvilo.com${path}`), { PADDLE_ENVIRONMENT: environment }, {});
}
const directives = policy => new Map(policy.split(";").map(value => { const [key, ...values] = value.trim().split(/\s+/); return [key, values]; }));
const baseline = "default-src 'self'; img-src 'self' data: https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com https://upload.apimart.ai https://cdn.apimart.ai; media-src 'self' https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com https://upload.apimart.ai https://cdn.apimart.ai; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

test("only English payment documents allow the explicit Paddle SDK, API and checkout origins", async () => {
  const result = await response("/dashboard/wallet?lang=en");
  const csp = result.headers.get("content-security-policy"), policy = directives(csp);
  assert.deepEqual(policy.get("script-src"), ["'self'", "'unsafe-inline'", "https://cdn.paddle.com"]);
  assert.deepEqual(policy.get("connect-src"), ["'self'", "https://api.paddle.com"]);
  assert.deepEqual(policy.get("frame-src"), ["'self'", "https://buy.paddle.com", "https://cdn.paddle.com"]);
  assert.ok(policy.get("style-src").includes("https://cdn.paddle.com"));
  assert.ok(policy.get("img-src").includes("https://cdn.paddle.com"));
  assert.doesNotMatch(csp, /\*|unsafe-eval|sandbox-|profitwell/);
  for (const key of ["default-src", "media-src", "frame-ancestors", "base-uri", "form-action"]) assert.deepEqual(policy.get(key), directives(baseline).get(key));
  assert.equal(result.headers.get("referrer-policy"), "no-referrer");
  assert.equal(result.headers.get("x-frame-options"), "DENY");
  assert.equal(result.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal(result.headers.get("x-app-header"), "preserved");
});

test("sandbox allows only sandbox checkout/API assets while retaining the official shared SDK CDN", async () => {
  const csp = directives((await response("/dashboard/wallet?lang=en&paddle_order=public-reference", "sandbox")).headers.get("content-security-policy"));
  assert.deepEqual(csp.get("script-src"), ["'self'", "'unsafe-inline'", "https://cdn.paddle.com"]);
  assert.deepEqual(csp.get("connect-src"), ["'self'", "https://sandbox-api.paddle.com"]);
  assert.deepEqual(csp.get("frame-src"), ["'self'", "https://sandbox-buy.paddle.com", "https://sandbox-cdn.paddle.com"]);
  assert.ok(csp.get("style-src").includes("https://sandbox-cdn.paddle.com"));
});

test("normal HTML pages keep the original policy and JSON responses retain their normal headers", async () => {
  for (const path of ["/", "/en", "/en/billing", "/en/pricing", "/dashboard", "/dashboard/wallet", "/dashboard/wallet?lang=zh", "/dashboard/wallet?lang=en&lang=zh", "/dashboard/wallet/other?lang=en", "/login?lang=en"]) {
    assert.equal((await response(path)).headers.get("content-security-policy"), baseline, path);
  }
  const json = await response("/api/billing/paddle/config", "production", "application/json");
  assert.equal(json.headers.has("content-security-policy"), false);
  assert.equal(json.headers.get("x-content-type-options"), "nosniff");
  assert.equal(json.headers.get("x-app-header"), "preserved");
});

test("all literal wallet links load the payment document instead of inheriting another page CSP", async () => {
  const files = ["components/PublicLanding.tsx", "components/BillingInformation.tsx", "components/Playground.tsx", "components/SelectedPlayground.tsx", "components/TokenHubPlayground.tsx", "app/pricing/page.tsx", "app/en/pricing/page.tsx"];
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /<Link\b[^>]*dashboard\/wallet/, file);
    assert.match(source, /<a\b[^>]*dashboard\/wallet/, file);
  }
  const dashboard = await readFile(new URL("../components/DashboardShell.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /item\.key === "wallet" \? <a /);
});
