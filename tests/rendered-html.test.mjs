import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("replaces starter metadata and publishes a real read-only catalogue example", async () => {
  const [page, landing, layout, packageJson] = await Promise.all([
    source("../app/page.tsx"),
    source("../components/PublicLanding.tsx"),
    source("../app/layout.tsx"),
    source("../package.json"),
  ]);
  assert.match(`${page}\n${landing}`, /进入控制台/);
  assert.match(landing, /无需登录即可读取公开目录/);
  assert.match(landing, /Read the public catalogue without signing in/);
  assert.match(layout, /tokvilo/);
  assert.match(layout, /siteMetadata\(requestHeaders\.get\(SITE_PATH_HEADER\)/);
  assert.doesNotMatch(`${page}\n${layout}\n${packageJson}`, /codex-preview|react-loading-skeleton|SkeletonPreview/i);
  assert.doesNotMatch(page, /eco_live_your_api_key|curl --request|\/api\/v1\//i);
  assert.doesNotMatch(landing, /eco_live_[a-z0-9]{12,}/i);
  assert.match(landing, /https:\/\/tokvilo\.com\/api\/model-catalog/);
  assert.doesNotMatch(landing, /\/api\/v1\/ENDPOINT|Authorization: Bearer|href="\/admin"/);
  const catalogueRoute = await source("../app/api/model-catalog/route.ts");
  assert.match(catalogueRoute, /export async function GET/);
  assert.match(catalogueRoute, /Response\.json\(directory/);
});

test("keeps the OpenAPI document behind a server-side session check", async () => {
  const [route, sanitizer] = await Promise.all([
    source("../app/api/private/openapi/route.ts"),
    source("../lib/openapi.ts"),
  ]);
  const authCheck = route.indexOf("await getPortalUser()");
  const upstreamFetch = route.indexOf("await fetch(");
  assert.ok(authCheck >= 0);
  assert.ok(upstreamFetch > authCheck);
  assert.match(route, /Unauthorized/);
  assert.match(route, /private, no-store/);
  assert.match(route, /Documentation is not enabled/);
  assert.match(route, /sanitizeOpenApiDocument/);
  assert.match(route, /hasOpenApiSanitizationConfig/);
  assert.match(sanitizer, /operationId/);
  assert.match(sanitizer, /HIDDEN_PATHS/);
  assert.match(sanitizer, /if \(isManagementPath\) continue/);
  assert.match(sanitizer, /EXTERNAL_FINGERPRINT_URL/);
  assert.match(sanitizer, /API document sanitization failed/);
});

test("fails closed by default and ships D1 migrations", async () => {
  const [example, proxy, hosting, migration, guardMigration, authMigration] = await Promise.all([
    source("../.env.example"),
    source("../lib/proxy.ts"),
    source("../wrangler.jsonc"),
    source("../drizzle/0000_lumpy_naoko.sql"),
    source("../drizzle/0001_silky_gamma_corps.sql"),
    source("../drizzle/0002_milky_dragon_man.sql"),
  ]);
  assert.match(example, /SERVICE_ENABLED=false/);
  assert.match(proxy, /service_locked/);
  const hostingConfig = JSON.parse(hosting);
  assert.equal(hostingConfig.name, "eco-geo-api");
  assert.equal(hostingConfig.d1_databases[0].binding, "DB");
  assert.equal(hostingConfig.assets.binding, "ASSETS");
  assert.match(migration, /CREATE TABLE `users`/);
  assert.match(migration, /CREATE TABLE `api_keys`/);
  assert.match(migration, /CREATE TABLE `usage_daily`/);
  assert.match(guardMigration, /CREATE TABLE `endpoint_prices`/);
  assert.match(guardMigration, /CREATE TABLE `spend_guard`/);
  assert.match(authMigration, /CREATE TABLE `login_rate_limits`/);
  assert.match(proxy, /pricing_unavailable/);
  assert.doesNotMatch(proxy, /UPSTREAM_UNKNOWN_COST_USD/);
});

test("spend reservation rejects a first request above the one dollar ceiling", async () => {
  const proxy = await source("../lib/proxy.ts");
  const sql = proxy.match(
    /`(INSERT INTO spend_guard[\s\S]*?RETURNING reserved_microusd)`/,
  )?.[1];
  assert.ok(sql, "spend reservation SQL should be present");

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE spend_guard (
      id TEXT PRIMARY KEY NOT NULL,
      reserved_microusd INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const reserve = database.prepare(sql);
  assert.equal(reserve.get(1_000_001, 1_000_001, 1_000_000, 1_000_000), undefined);
  assert.equal(
    reserve.get(1_000_000, 1_000_000, 1_000_000, 1_000_000).reserved_microusd,
    1_000_000,
  );
  assert.equal(reserve.get(1, 1, 1_000_000, 1_000_000), undefined);
  database.close();
});

test("zero-limit users cannot consume a first request", async () => {
  const proxy = await source("../lib/proxy.ts");
  const sql = proxy.match(
    /`(INSERT INTO usage_daily[\s\S]*?RETURNING calls)`/,
  )?.[1];
  assert.ok(sql, "per-user reservation SQL should be present");

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE usage_daily (
      user_id TEXT NOT NULL,
      day TEXT NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0,
      successes INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      bytes_in INTEGER NOT NULL DEFAULT 0,
      bytes_out INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, day)
    )
  `);
  const reserve = database.prepare(sql);
  assert.equal(reserve.get("user", "2026-07-10", 0, 0, 0), undefined);
  assert.equal(reserve.get("user", "2026-07-10", 0, 1, 1).calls, 1);
  assert.equal(reserve.get("user", "2026-07-10", 0, 1, 1), undefined);
  database.close();
});

test("meters every authenticated request before pricing and blocks unbounded routes", async () => {
  const proxy = await source("../lib/proxy.ts");
  const quotaCheck = proxy.indexOf("await reserveRequestQuota(");
  const priceCheck = proxy.indexOf("await endpointCostMicrousd(");
  assert.ok(quotaCheck >= 0 && quotaCheck < priceCheck);
  assert.match(proxy, /BLOCKED_UNBOUNDED_ENDPOINTS\.has\(upstreamPath\)/);
  assert.match(proxy, /upstreamPath === PER_ROOM_ENDPOINT/);
  assert.match(proxy, /searchParams\.getAll\("room_ids"\)/);
  assert.match(proxy, /MAX_REQUEST_COST_MULTIPLIERS/);
  assert.match(proxy, /unitCostMicrousd \* multiplier/);
  assert.match(proxy, /rewrites\.some\(\(\[, target\]\)/);
  assert.doesNotMatch(proxy, /FROM endpoint_prices/);
  assert.doesNotMatch(proxy, /startsWith\("\/api\/v1\/demo\/"\)/);
});

test("ships no configured upstream identity or credential in application source", async () => {
  const files = [
    "../lib/proxy.ts",
    "../lib/sanitize.ts",
    "../lib/openapi.ts",
    "../app/page.tsx",
    "../app/dashboard/docs/page.tsx",
    "../.env.example",
  ];
  const contents = await Promise.all(files.map(source));
  for (const content of contents) {
    assert.doesNotMatch(content, /UPSTREAM_BASE_URL=https?:\/\//i);
    assert.doesNotMatch(content, /UPSTREAM_API_TOKEN=\S+/i);
  }
});


test("homepage renders native Chinese and English content with working localized discovery links", async () => {
  const [{ default: React }, { renderToStaticMarkup }, { default: ts }, { default: vm }, { createRequire }, { resolve, dirname }] = await Promise.all([
    import("react"), import("react-dom/server"), import("typescript"), import("node:vm"), import("node:module"), import("node:path"),
  ]);
  const require = createRequire(import.meta.url), root = new URL("../", import.meta.url).pathname, cache = new Map();
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const contents = await readFile(file, "utf8"), ast = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), dependencies = {};
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      const name = statement.moduleSpecifier.text;
      if (name === "next/link") dependencies[name] = { default: ({ children, ...props }) => React.createElement("a", props, children) };
      else if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(file), name);
        let target;
        for (const extension of [".tsx", ".ts"]) { try { await readFile(base + extension); target = base + extension; break; } catch {} }
        assert.ok(target, `Unresolved ${name}`);
        dependencies[name] = await load(target);
      }
    }
    const compiled = { exports: {} };
    vm.runInNewContext(ts.transpileModule(contents, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
      { module: compiled, exports: compiled.exports, URL, URLSearchParams, require: name => dependencies[name] || require(name) }, { filename: file });
    cache.set(file, compiled.exports); return compiled.exports;
  }
  const { PublicLanding } = await load(resolve(root, "components/PublicLanding.tsx"));
  const { LocaleProvider } = await load(resolve(root, "components/LocaleProvider.tsx"));
  const { ProductMarket } = await load(resolve(root, "components/ProductMarket.tsx"));
  const render = (component, locale) => renderToStaticMarkup(React.createElement(LocaleProvider, { locale }, React.createElement(component)));
  const zh = render(PublicLanding, "zh"), en = render(PublicLanding, "en");
  const visible = html => html.replace(/<[^>]+>/g, "");
  assert.match(visible(zh), /选对模型.*让想法成形/s);
  assert.match(visible(en), /Find your model.*Create what/);
  assert.match(visible(zh), /\$1 = 35 积分.*同一笔服务余额/);
  assert.match(visible(en), /\$1 = 35 credits.*same service balance/);
  assert.match(en, /href="\/en\/models\?provider=OPENAI&amp;family=gpt&amp;category=text"/);
  assert.match(en, /href="\/en\/products"/);
  assert.match(en, /href="\/dashboard\/docs\?lang=en"/);
  assert.match(zh, /href="\/models\?provider=OPENAI&amp;family=gpt&amp;category=text"/);
  assert.doesNotMatch(visible(en).replace("中文", ""), /[\u4e00-\u9fff]/);
  assert.match(en, /provider-logos\/claude\.svg/);
  assert.match(en, /provider-logos\/gemini\.svg/);
  const englishProducts = visible(render(ProductMarket, "en"));
  assert.match(englishProducts, /Philippines.*Chile/s);
  assert.match(englishProducts, /24 hours/);
  assert.match(englishProducts, /¥/);
  assert.doesNotMatch(englishProducts, /API credits/);
  assert.doesNotMatch(englishProducts, /[\u4e00-\u9fff]/);
});
