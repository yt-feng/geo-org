import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const route = await source("../app/api/private/openapi/route.ts");
  const authCheck = route.indexOf("await getPortalUser()");
  const upstreamFetch = route.indexOf("await fetch(");
  assert.ok(authCheck >= 0);
  assert.ok(upstreamFetch > authCheck);
  assert.match(route, /Unauthorized/);
  assert.match(route, /private, no-store/);
  assert.match(route, /Documentation is not enabled/);
});

test("fails closed by default and ships a D1 migration", async () => {
  const [example, proxy, hosting, migration] = await Promise.all([
    source("../.env.example"),
    source("../lib/proxy.ts"),
    source("../dist/.openai/hosting.json"),
    source("../drizzle/0000_lumpy_naoko.sql"),
  ]);
  assert.match(example, /SERVICE_ENABLED=false/);
  assert.match(proxy, /service_locked/);
  const hostingConfig = JSON.parse(hosting);
  assert.equal(hostingConfig.d1, "DB");
  assert.equal(hostingConfig.r2, null);
  assert.match(hostingConfig.project_id, /^appgprj_/);
  assert.match(migration, /CREATE TABLE `users`/);
  assert.match(migration, /CREATE TABLE `api_keys`/);
  assert.match(migration, /CREATE TABLE `usage_daily`/);
});

test("ships no configured upstream identity or credential in application source", async () => {
  const files = [
    "../lib/proxy.ts",
    "../lib/sanitize.ts",
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
