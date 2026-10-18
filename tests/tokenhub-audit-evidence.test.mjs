import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const ID = "11111111-2222-4333-8444-555555555555", OTHER = "99999999-2222-4333-8444-555555555555";
const BASE = "https://api.eco-geo.org/api/admin/tokenhub-audit/evidence";
async function load(path, mocks = {}) {
  const filename = new URL(path, import.meta.url).pathname;
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const compiled = { exports: {} };
  vm.runInNewContext(outputText, { module: compiled, exports: compiled.exports, require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; throw new Error(`Unexpected dependency ${name}`); }, URL, URLSearchParams, Request, Response, atob, fetch() { throw new Error("Evidence reads must never call inference"); } }, { filename });
  return compiled.exports;
}
const media = await load("../lib/tokenhub-audit-media.ts");
const evidence = await load("../lib/tokenhub-audit-evidence.ts", { "./tokenhub-audit-media": media });
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function request(params = `campaign=${ID}&slot=0&caseId=old-model%3Ashort`) { return new Request(`${BASE}?${params}`); }
function digest(text) { return createHash("sha256").update(text).digest("hex"); }
async function setup(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(await readFile(new URL("../drizzle/0005_tokenhub_audit.sql", import.meta.url), "utf8"));
  sqlite.exec(await readFile(new URL("../drizzle/0007_tokenhub_audit_media.sql", import.meta.url), "utf8"));
  t.after(() => sqlite.close());
  sqlite.prepare("INSERT INTO tokenhub_audit_campaigns(id,state,started_at,ends_at,budget_micros,encrypted_key,key_hint,catalog_json,catalog_hash,plan_version) VALUES(?,'active','2026-10-17T19:40:45.512Z','2026-10-24T19:40:45.512Z',5000000,'NEVER_EXPORT_THIS_SECRET','key_hint_is_not_evidence','{}','hash','tokenhub-audit-v3')").run(ID);
  sqlite.prepare("INSERT INTO tokenhub_audit_campaigns(id,state,started_at,ends_at,budget_micros,encrypted_key,key_hint,catalog_json,catalog_hash,plan_version) VALUES(?,'completed','2026-10-01','2026-10-08',5000000,'OTHER_SECRET','private_hint','{}','hash','tokenhub-audit-v1')").run(OTHER);
  const calls = [];
  const env = { DB: { prepare(sql) {
    calls.push(sql);
    assert.match(sql, /^SELECT /, "Read-only evidence must never mutate storage");
    assert.doesNotMatch(sql, /SELECT\s+\*|encrypted_key|key_hint|provider_settings/i);
    const stmt = sqlite.prepare(sql);
    return { bind(...args) { return { async first() { return stmt.get(...args) ?? null; }, async all() { return { results: stmt.all(...args) }; } }; } };
  } } };
  const route = await load("../app/api/admin/tokenhub-audit/evidence/route.ts", {
    "@/lib/auth": { getPortalUser: async () => options.user === undefined ? { id: "admin", isAdmin: true } : options.user },
    "@/lib/config": { runtimeEnv() { calls.push("env"); if (options.envError) throw new Error("NEVER_EXPORT_THIS_SECRET"); return env; } },
    "@/lib/tokenhub-audit-evidence": evidence,
  });
  function insert(overrides = {}) {
    const rawRequest = JSON.stringify({ model: "old-model", messages: [{ role: "user", content: "Original question\n<script>alert(1)</script>" }], max_tokens: 4096 });
    const rawResponse = JSON.stringify({ model: "old-model", choices: [{ message: { content: '{"answers":[1,2,3,4]}', reasoning_content: "Exact stored reasoning\n<iframe>untrusted</iframe>" }, finish_reason: "stop" }], usage: { prompt_tokens: 14, completion_tokens: 8 } });
    const data = { campaign_id: ID, slot: 0, case_id: "old-model:short", kind: "chat", model: "old-model", state: "succeeded", reserved_micros: 10000,
      request_json: rawRequest, request_hash: digest(rawRequest), expected_json: '{"protocolVersion":"tokenhub-audit-v1","answers":[1,2,3,4]}', price_json: '{"originalPrice":1}', price_hash: "original-price-hash",
      response_json: rawResponse, response_hash: digest(rawResponse), creation_json: '{"id":"original-create-response"}',
      headers_json: '{"x-request-id":"trace-123","Authorization":"Bearer NEVER_EXPORT_THIS_SECRET","Set-Cookie":"private"}', http_status: 200, latency_ms: 123,
      usage_json: '{"prompt_tokens":14,"completion_tokens":8}', returned_model: "old-model", derived_cost_micros: 12, grading_json: '{"score":100,"status":"passed"}', flags_json: '["model_identity_unverified"]',
      independent_analysis_json: '{"tokenVerification":"exact","recordedResponseHash":"original"}', billing_actual_micros: 12, billing_evidence_json: '{"receipt":"ledger-1"}', task_id: null, poll_count: 0, next_poll_at: null,
      submitted_at: "2026-10-17T19:40:45.512Z", updated_at: "2026-10-17T20:00:00.000Z", ...overrides };
    const columns = Object.keys(data);
    sqlite.prepare(`INSERT INTO tokenhub_audit_cases (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(data));
    return data;
  }
  return { sqlite, env, calls, insert, ...route };
}

test("evidence access requires administrator session before parameters, runtime or storage", async t => {
  for (const [user, status] of [[null, 401], [{ id: "member", isAdmin: false }, 403]]) {
    const f = await setup(t, { user });
    const response = await f.GET(request("invalid=1"));
    assert.equal(response.status, status); assert.deepEqual(f.calls, []);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("strict evidence query rejects missing, duplicate, ambiguous and out-of-range identifiers before storage", async t => {
  const f = await setup(t);
  for (const query of ["", `campaign=${ID}&slot=0`, `campaign=nope&slot=0&caseId=test`, `campaign=${ID}&slot=14&caseId=test`, `campaign=${ID}&slot=-1&caseId=test`, `campaign=${ID}&slot=00&caseId=test`, `campaign=${ID}&slot=0.0&caseId=test`, `campaign=${ID}&slot=1e0&caseId=test`, `campaign=${ID}&slot=0&caseId=test&caseId=other`, `campaign=${ID}&slot=0&caseId=test&campaign=${OTHER}`, `campaign=${ID}&slot=0&caseId=..%2Ftest`, `campaign=${ID}&slot=0&caseId=%3Cscript%3E`, `campaign=${ID}&slot=0&caseId=test&download=0`, `campaign=${ID}&slot=0&caseId=test&extra=1`]) {
    assert.equal((await f.GET(request(query))).status, 400, query);
  }
  assert.deepEqual(f.calls, []);
});

test("single-case evidence preserves historical request and results instead of regenerating current questions", async t => {
  const f = await setup(t), original = f.insert();
  const before = f.sqlite.prepare("SELECT * FROM tokenhub_audit_cases").all();
  const response = await f.GET(request()), data = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-disposition"), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(data.campaign, { id: ID, startedAt: "2026-10-17T19:40:45.512Z", endsAt: "2026-10-24T19:40:45.512Z", planVersion: "tokenhub-audit-v3" });
  assert.equal(data.case.planVersion, "tokenhub-audit-v1"); assert.equal(data.case.maxOutputTokens, 4096);
  assert.equal(data.case.requestHash, digest(original.request_json)); assert.equal(data.case.responseHash, digest(original.response_json));
  for (const [field, column] of [["request","request_json"],["response","response_json"],["expected","expected_json"],["creationResponse","creation_json"],["grading","grading_json"],["usage","usage_json"],["billingEvidence","billing_evidence_json"],["independentAnalysis","independent_analysis_json"]]) assert.deepEqual(data.case[field], JSON.parse(original[column]));
  assert.equal(data.case.wasSubmitted, true); assert.equal(data.case.submittedAt, original.submitted_at);
  assert.equal(data.case.tokenVerification, "exact"); assert.equal(data.case.billingVerification, "recorded");
  assert.deepEqual(data.case.headers, { "x-request-id": "trace-123" });
  assert.equal(JSON.stringify(data).includes("NEVER_EXPORT_THIS_SECRET"), false);
  assert.equal(JSON.stringify(data).includes("key_hint_is_not_evidence"), false);
  assert.deepEqual(data.media, []); assert.deepEqual(f.sqlite.prepare("SELECT * FROM tokenhub_audit_cases").all(), before);
  assert.equal(f.calls.length, 4); // Runtime plus one campaign, one case and its archive metadata read.
});

test("prepared-but-unsent requests remain accessible without claiming they were asked", async t => {
  const f = await setup(t);
  for (const [slot, state] of ["price_blocked", "reserved", "window_expired"].entries()) {
    f.insert({ slot, state, response_json: null, response_hash: null, creation_json: null });
    const data = await (await f.GET(request(`campaign=${ID}&slot=${slot}&caseId=old-model%3Ashort`))).json();
    assert.equal(data.case.wasSubmitted, false); assert.equal(data.case.submittedAt, null); assert.ok(data.case.request.messages[0].content);
    assert.equal(data.case.response, null); assert.equal(data.case.creationResponse, null); assert.deepEqual(data.media, []);
  }
});

test("missing planned cases and cross-campaign selections never synthesize or return another case", async t => {
  const f = await setup(t); f.insert();
  for (const query of [`campaign=${OTHER}&slot=0&caseId=old-model%3Ashort`, `campaign=${ID}&slot=1&caseId=old-model%3Ashort`, `campaign=${ID}&slot=0&caseId=nonexistent`, "campaign=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&slot=0&caseId=old-model%3Ashort"]) {
    const response = await f.GET(request(query)); assert.equal(response.status, 404); assert.equal((await response.text()).includes("Original question"), false);
  }
});

test("per-case JSON download is private and contains only the selected persisted row", async t => {
  const f = await setup(t); f.insert(); f.insert({ slot: 2, case_id: "different", request_json: '{"prompt":"DO_NOT_INCLUDE_OTHER_CASE"}' });
  const response = await f.GET(request(`campaign=${ID}&slot=0&caseId=old-model%3Ashort&download=1`));
  assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition"), /^attachment; filename="eco-geo-audit-day-1-slot-0-old-model-short.json"$/);
  assert.equal((await response.text()).includes("DO_NOT_INCLUDE_OTHER_CASE"), false);
});

test("unexpected errors do not expose underlying error text", async t => {
  const f = await setup(t, { envError: true }); const response = await f.GET(request());
  assert.equal(response.status, 503); assert.equal((await response.text()).includes("NEVER_EXPORT_THIS_SECRET"), false);
});

test("known media fields preserve real URLs, identify source, deduplicate and ignore generated prose", () => {
  const url = "https://media.example/result.mp4?signature=kept", frame = "https://media.example/frame.png";
  const found = plain(evidence.extractAuditEvidenceMedia("video", { data: { content: { video_url: url, last_frame_url: frame }, video_url: url, last_frame_url: frame } }, { content: { video_url: url }, choices: [{ message: { content: "https://evil.example/generated-link" } }] }));
  assert.deepEqual(found, [{ kind: "video", url, sourcePath: "response.data.content.video_url", label: "生成视频" }, { kind: "image", url: frame, sourcePath: "response.data.content.last_frame_url", label: "视频尾帧" }]);
  assert.deepEqual(plain(evidence.extractAuditEvidenceMedia("chat", { choices: [{ message: { content: url } }], content: { video_url: url }, data: [{ url: frame }] })), []);
  const image = plain(evidence.extractAuditEvidenceMedia("image", { data: { data: [{ url: frame }, { url: frame }] } }));
  assert.equal(image.length, 1); assert.equal(image[0].sourcePath, "response.data.data[0].url");
});

test("media rendering excludes executable, credential-bearing, malformed and arbitrary data URLs", () => {
  for (const url of ["javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,PHNjcmlwdD4=", "file:///tmp/private", "http://media.example/image.png", "https://user:secret@media.example/image.png", "https://media.example/a\nb.png", " https://media.example/image.png", "https://media.example/image.png ", "//media.example/image.png"]) {
    assert.deepEqual(plain(evidence.extractAuditEvidenceMedia("image", { data: [{ url }] })), [], url);
    assert.deepEqual(plain(evidence.extractAuditEvidenceMedia("video", { content: { video_url: url } })), [], url);
  }
  const png = Buffer.from("\x89PNG\r\n\x1a\n1234", "binary").toString("base64"), jpg = Buffer.from("\xff\xd8\xff123456789", "binary").toString("base64"), webp = Buffer.from("RIFF1234WEBP").toString("base64");
  const images = plain(evidence.extractAuditEvidenceMedia("image", { data: [{ b64_json: png }, { b64_json: jpg }, { b64_json: webp }, { b64_json: Buffer.from("<svg><script>bad</script></svg>").toString("base64") }] }));
  assert.equal(images.length, 3); assert.ok(images[0].url.startsWith("data:image/png;base64,")); assert.ok(images[1].url.startsWith("data:image/jpeg;base64,")); assert.ok(images[2].url.startsWith("data:image/webp;base64,"));
  assert.deepEqual(plain(evidence.extractAuditEvidenceMedia("video", { video_url: images[0].url })), []);
});


test("matching archived media use the authenticated local route and keep original evidence intact", async t => {
  const f = await setup(t), source = "https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com/video.mp4?X-Tos-Date=20261018T000000Z&X-Tos-Expires=3600", asset = "a".repeat(64);
  const original = f.insert({ kind: "video", case_id: "seedance-video", response_json: JSON.stringify({ content: { video_url: source } }), response_hash: "original-media-response-hash" });
  f.sqlite.prepare("INSERT INTO tokenhub_audit_media(asset_id,campaign_id,slot,case_id,kind,source_path,source_url,source_expires_at,state,next_attempt_at,mime_type,size_bytes,sha256,archived_at,attempt_count,updated_at) VALUES(?,?,0,'seedance-video','video','response.content.video_url',?,'2026-10-18T01:00:00.000Z','archived','2026-10-18T00:00:00.000Z','video/mp4',42,'media-hash','2026-10-18T00:10:00.000Z',1,'2026-10-18T00:10:00.000Z')").run(asset, ID, source);
  const result = await (await f.GET(request(`campaign=${ID}&slot=0&caseId=seedance-video`))).json();
  assert.equal(result.media.length, 1); assert.equal(result.media[0].url, `/api/admin/tokenhub-audit/media?asset=${asset}`);
  assert.equal(result.media[0].sourceUrl, source); assert.equal(result.media[0].sourceExpiresAt, "2026-10-18T01:00:00.000Z");
  assert.equal(result.media[0].storage, "archived"); assert.equal(result.media[0].archive.state, "archived"); assert.equal(result.media[0].archive.sha256, "media-hash"); assert.equal(result.media[0].archive.sizeBytes, 42);
  assert.equal(result.archiveStatus, "available"); assert.equal(result.archives.length, 1);
  assert.deepEqual(result.case.response, JSON.parse(original.response_json)); assert.equal(result.case.responseHash, original.response_hash);
  assert.equal(f.sqlite.prepare("SELECT response_json FROM tokenhub_audit_cases").get().response_json, original.response_json);
});

test("archive with same path but different source URL cannot replace the current saved media", async t => {
  const f = await setup(t), source = "https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com/new.mp4?X-Tos-Date=20261018T000000Z&X-Tos-Expires=3600";
  f.insert({ kind: "video", case_id: "seedance-video", response_json: JSON.stringify({ content: { video_url: source } }) });
  f.sqlite.prepare("INSERT INTO tokenhub_audit_media(asset_id,campaign_id,slot,case_id,kind,source_path,source_url,state,next_attempt_at,updated_at) VALUES(?,?,0,'seedance-video','video','response.content.video_url','https://media.example/old.mp4','archived','2026-10-18','2026-10-18')").run("b".repeat(64), ID);
  const result = await (await f.GET(request(`campaign=${ID}&slot=0&caseId=seedance-video`))).json();
  assert.equal(result.media[0].url, source); assert.equal(result.media[0].archive, null); assert.equal(result.media[0].sourceExpiresAt, "2026-10-18T01:00:00.000Z");
});

test("unavailable archive metadata never hides stored questions or responses", async t => {
  const f = await setup(t); f.insert(); f.sqlite.exec("DROP TABLE tokenhub_audit_media");
  const response = await f.GET(request()), result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.archiveStatus, "unavailable"); assert.deepEqual(result.archives, []);
  assert.ok(result.case.request.messages[0].content.includes("Original question")); assert.equal(result.case.response.choices[0].finish_reason, "stop");
});


test("embedded image data remains durable in the saved response without expiring source semantics", async t => {
  const f = await setup(t), png = Buffer.from("\x89PNG\r\n\x1a\n1234", "binary").toString("base64");
  f.insert({ kind: "image", case_id: "seedream-image", response_json: JSON.stringify({ data: [{ b64_json: png }] }) });
  const result = await (await f.GET(request(`campaign=${ID}&slot=0&caseId=seedream-image`))).json();
  assert.equal(result.media[0].storage, "embedded"); assert.equal(result.media[0].url, `data:image/png;base64,${png}`);
  assert.equal(result.media[0].sourceExpiresAt, null); assert.equal(result.media[0].archive, null);
  assert.equal(result.case.response.data[0].b64_json, png);
});
