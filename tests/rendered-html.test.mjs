import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("replaces all starter metadata and keeps public copy documentation-free", async () => {
  const [page, layout, packageJson] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/layout.tsx"),
    source("../package.json"),
  ]);
  assert.match(page, /进入控制台/);
  assert.match(page, /文档与调用凭证不对外公开/);
  assert.match(layout, /Eco Geo API/);
  assert.match(layout, /index:\s*false/);
  assert.doesNotMatch(`${page}\n${layout}\n${packageJson}`, /codex-preview|react-loading-skeleton|SkeletonPreview/i);
  assert.doesNotMatch(page, /eco_live_your_api_key|curl --request|\/api\/v1\//i);
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
