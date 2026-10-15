import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/console-data.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const now = "2026-10-15T23:50:00Z";
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
}

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE usage_daily (user_id TEXT, day TEXT, calls INTEGER, successes INTEGER, errors INTEGER, PRIMARY KEY(user_id, day));
    CREATE TABLE usage_events (request_id TEXT PRIMARY KEY, user_id TEXT, method TEXT, path TEXT, status INTEGER, latency_ms INTEGER, created_at TEXT);
  `);
  const database = {
    prepare(query) {
      const statement = sqlite.prepare(query);
      return { bind(...parameters) { return { async all() { return { results: statement.all(...parameters) }; } }; } };
    },
  };
  const compiledModule = { exports: {} };
  vm.runInNewContext(outputText, {
    module: compiledModule, exports: compiledModule.exports, Date: FixedDate, Intl,
    require(specifier) {
      assert.equal(specifier, "./config");
      return { getD1: () => database };
    },
  });
  const daily = (user, day, calls, successes = calls, errors = 0) => sqlite.prepare("INSERT INTO usage_daily VALUES (?, ?, ?, ?, ?)").run(user, day, calls, successes, errors);
  const event = (id, { user = "alice", path = "/api/v1/test", status = 500, at = "2026-10-15 12:00:00" } = {}) => sqlite.prepare("INSERT INTO usage_events VALUES (?, ?, 'GET', ?, ?, 42, ?)").run(id, user, path, status, at);
  return { api: compiledModule.exports, daily, event, sqlite, database };
}

const plain = value => JSON.parse(JSON.stringify(value));

test("usage trend returns 30 UTC days including exact date boundaries and isolates the signed-in user", async t => {
  const { api, daily } = fixture(t);
  daily("alice", "2026-09-15", 900);
  daily("alice", "2026-09-16", 7, 5, 2);
  daily("alice", "2026-10-15", 3, 2, 1);
  daily("alice", "2026-10-16", 800);
  daily("bob", "2026-10-15", 600);
  const trend = plain(await api.getUsageTrend("alice"));
  assert.equal(trend.length, 30);
  assert.deepEqual(trend[0], { day: "2026-09-16", calls: 7, successes: 5, errors: 2 });
  assert.deepEqual(trend[29], { day: "2026-10-15", calls: 3, successes: 2, errors: 1 });
  assert.deepEqual(trend[1], { day: "2026-09-17", calls: 0, successes: 0, errors: 0 });
  assert.equal(trend.reduce((sum, day) => sum + day.calls, 0), 10);
  assert.equal(new Set(trend.map(day => day.day)).size, 30);
});

test("accounts without usage receive zero totals and no invented request history", async t => {
  const { api, daily, event } = fixture(t);
  daily("bob", "2026-10-15", 123);
  event("another-account", { user: "bob" });
  const trend = await api.getUsageTrend("alice");
  assert.ok(trend.every(day => day.calls === 0 && day.successes === 0 && day.errors === 0));
  assert.deepEqual(plain(await api.getUsageEvents("alice")), []);
});

test("request history is ordered, bounded to at most 100 rows and never returns another account", async t => {
  const { api, event } = fixture(t);
  for (let index = 0; index < 110; index++) event(`alice-${index}`, { at: new Date(Date.parse(now) + index * 1000).toISOString() });
  event("bob-latest", { user: "bob", at: "2027-01-01 00:00:00" });
  const events = plain(await api.getUsageEvents("alice", { limit: 9999 }));
  assert.equal(events.length, 100);
  assert.equal(events[0].request_id, "alice-109");
  assert.equal(events[99].request_id, "alice-10");
  assert.ok(events.every(row => row.request_id.startsWith("alice-")));
  assert.deepEqual(Object.keys(events[0]).sort(), ["created_at", "latency_ms", "method", "path", "request_id", "status"]);
  assert.equal((await api.getUsageEvents("alice")).length, 50);
  assert.equal((await api.getUsageEvents("alice", { limit: 0 })).length, 1);
  assert.equal((await api.getUsageEvents("alice", { limit: -2 })).length, 1);
  assert.equal((await api.getUsageEvents("alice", { limit: 2.8 })).length, 2);
  assert.equal((await api.getUsageEvents("alice", { limit: Number.NaN })).length, 50);
  assert.equal((await api.getUsageEvents("alice", { limit: Infinity })).length, 50);
});

test("HTTP status filters include only their correct hundred-code interval", async t => {
  const { api, event } = fixture(t);
  for (const status of [399, 400, 499, 500, 599, 600]) event(`status-${status}`, { status });
  const codes = async status => (await api.getUsageEvents("alice", { status })).map(event => event.status).sort();
  assert.deepEqual(plain(await codes("4xx")), [400, 499]);
  assert.deepEqual(plain(await codes("5xx")), [500, 599]);
  assert.equal((await codes("not-a-filter")).length, 6);
});

test("search binds literal path and request-ID text without SQL or wildcard interpretation", async t => {
  const { api, event } = fixture(t);
  event("needle-id", { path: "/api/v1/ordinary" });
  event("path-match", { path: "/api/v1/needle" });
  event("percent", { path: "/api/v1/100%" });
  event("private", { user: "bob", path: "/api/v1/needle" });
  const matching = plain(await api.getUsageEvents("alice", { query: " needle " }));
  assert.deepEqual(matching.map(event => event.request_id).sort(), ["needle-id", "path-match"]);
  assert.deepEqual(plain(await api.getUsageEvents("alice", { query: "%" })).map(event => event.request_id), ["percent"]);
  assert.deepEqual(plain(await api.getUsageEvents("alice", { query: "' OR 1=1 --" })), []);
  event("long-path", { path: `/api/v1/${"x".repeat(100)}` });
  assert.deepEqual(plain(await api.getUsageEvents("alice", { query: "x".repeat(110) })).map(event => event.request_id), ["long-path"]);
});

test("timestamps explicitly treat D1 values as UTC and display Beijing local time", t => {
  const { api } = fixture(t);
  assert.equal(api.displayTimestamp(null), "—");
  assert.equal(api.displayTimestamp("not-a-date"), "not-a-date");
  assert.equal(api.displayTimestamp("2026-10-15 23:50:00"), "2026/10/16 07:50");
  assert.equal(api.displayTimestamp("2026-10-15T23:50:00Z"), "2026/10/16 07:50");
});

test("key inventory retains every active key and only the user's latest 20 revoked keys", async t => {
  const { sqlite, database } = fixture(t);
  sqlite.exec("CREATE TABLE api_keys (id TEXT PRIMARY KEY, user_id TEXT, label TEXT, key_prefix TEXT, created_at TEXT, last_used_at TEXT, revoked_at TEXT)");
  const insert = sqlite.prepare("INSERT INTO api_keys VALUES (?, ?, ?, 'eco_test_', ?, NULL, ?)");
  for (let index = 0; index < 25; index++) {
    insert.run(`active-${index}`, "alice", `Active ${index}`, `2020-01-${String(index + 1).padStart(2, "0")} 00:00:00`, null);
  }
  for (let index = 0; index < 30; index++) {
    const created = `2026-09-${String(index + 1).padStart(2, "0")} 00:00:00`;
    insert.run(`revoked-${index}`, "alice", `Revoked ${index}`, created, "2026-10-01 00:00:00");
    insert.run(`bob-revoked-${index}`, "bob", `Bob revoked ${index}`, created, "2026-10-01 00:00:00");
  }
  insert.run("bob-active", "bob", "Bob active", "2027-01-01 00:00:00", null);
  const storeSource = await readFile(new URL("../lib/store.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(storeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const compiledModule = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module: compiledModule, exports: compiledModule.exports,
    require(specifier) {
      assert.equal(specifier, "./config");
      return { getD1: () => database };
    },
  });
  const keys = plain(await compiledModule.exports.listApiKeys("alice"));
  assert.equal(keys.length, 45);
  assert.equal(keys.filter(key => key.revoked_at === null).length, 25);
  assert.equal(keys[0].id, "active-24");
  assert.equal(keys[24].id, "active-0", "the oldest active key must remain visible and revocable");
  assert.equal(keys[25].id, "revoked-29");
  assert.equal(keys[44].id, "revoked-10");
  assert.ok(keys.every(key => !key.id.startsWith("bob-")));
  assert.deepEqual(plain(await compiledModule.exports.listApiKeys("new-account")), []);
  sqlite.prepare("UPDATE api_keys SET revoked_at = '2026-10-15 12:00:00' WHERE id = 'active-0'").run();
  const afterRevokingOldKey = plain(await compiledModule.exports.listApiKeys("alice"));
  assert.equal(afterRevokingOldKey.length, 44);
  assert.ok(afterRevokingOldKey.some(key => key.id === "active-0" && key.revoked_at), "recently revoking an old key keeps it in the recent revoked inventory");
  assert.ok(!afterRevokingOldKey.some(key => key.id === "revoked-10"));
});
