import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
async function load(path, mocks = {}, globals = {}) {
  const filename = new URL(path, import.meta.url).pathname;
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const compiled = { exports: {} };
  vm.runInNewContext(outputText, { module: compiled, exports: compiled.exports, require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; throw new Error(`Unexpected dependency ${name}`); }, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Request, Response, Headers, AbortSignal, btoa, atob, fetch() { throw new Error("Unexpected network request"); }, ...globals }, { filename });
  return compiled.exports;
}
const helpers = await load("../lib/provider-settings.ts"), fixtures = await load("../lib/tokenhub-audit-cases.ts");
const media = await load("../lib/tokenhub-audit-media.ts");
const catalog = await load("../lib/tokenhub-audit-catalog.ts", { "./tokenhub-audit-cases": fixtures });
const SECRET = "test-audit-encryption-secret-over-32-characters", KEY = "sk-audit-fake-credential-never-send";
const schema = (await Promise.all((await readdir(new URL("../drizzle/", import.meta.url))).filter(f => f.endsWith(".sql")).sort().map(f => readFile(new URL(`../drizzle/${f}`, import.meta.url), "utf8")))).join("\n");
function rate(value) { return { amount: { currencyCode: "USD", units: String(value), exactUnits: String(value), unitsMicros: Math.round(value * 1e6) }, display: `USD ${value} / 1M tokens` }; }
function prices() {
  return { currencyCode: "USD", data: [
    ...fixtures.AUDIT_CHAT_MODELS.map((id, index) => {
      const [input, output, cached] = [[.15,.5,.03],[1.4,4.4,.26],[1.74,3.48,.145],[.14,.28,.028]][index];
      return { id, deployments: [{ enabled: true, pricing: { input: rate(input), output: rate(output), cacheRead: rate(cached), cacheWrite: rate(0) } }] };
    }),
    { id: "dola-seedream-5-0-pro-260628", deployments: [{ enabled: true, pricing: { fixed: { ...rate(.09), priceUnit: "image", display: "USD 0.09 / image" } } }] },
    ...Object.keys(fixtures.AUDIT_VIDEO_POLICIES).map(id => ({ id, deployments: [{ enabled: true, pricing: { video: { withoutVideo480p: rate(id.includes("2-5") ? 10.7 : 7) } } }] })),
  ] };
}
async function setup(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec(schema); t.after(() => sqlite.close());
  const DB = { prepare(query) { const statement = sqlite.prepare(query); const execute = (args = []) => ({ bind(...next) { return execute(next); }, async first() { const result = statement.get(...args) || null; options.onFirst?.(query, args, result); return result; }, async all() { return { results: statement.all(...args) }; }, async run() { return { success: true, meta: { changes: statement.run(...args).changes } }; } }); return execute(); } };
  const calls = [], timeouts = [], env = { DB, ADMIN_SESSION_SECRET: SECRET, SERVICE_ENABLED: "true", ...options.env };
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (options.fetcher) { const custom = await options.fetcher(url, init, sqlite); if (custom) return custom; }
    if (url.endsWith("/api/v1/models")) return Response.json({ object: "list", data: fixtures.AUDIT_CHAT_MODELS.map(id => ({ id })) });
    if (url.endsWith("/api/pricing")) return Response.json(prices());
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      if (url.endsWith("chat/completions")) {
        const row = sqlite.prepare("SELECT expected_json FROM tokenhub_audit_cases WHERE request_json=? LIMIT 1").get(init.body);
        const expected = JSON.parse(row.expected_json);
        return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify({ answers: expected.answers, nonce: expected.nonce }) }, finish_reason: "stop" }], usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 } });
      }
      if (url.endsWith("images/generations")) return Response.json({ model: body.model, data: [{ url: "https://media.example/image.png" }] });
      return Response.json({ id: "audit-video-123", status: "submitted", model: body.model });
    }
    return Response.json({ id: "audit-video-123", status: "succeeded", model: "dreamina-seedance-2-0-260128", usage: { completion_tokens: 40000, total_tokens: 40000 }, content: { video_url: "https://media.example/video.mp4" } });
  };
  const ClockDate = options.clock ? class extends Date {
    constructor(...args) { if (args.length) super(...args); else super(options.clock()); }
    static now() { return options.clock(); }
  } : Date;
  const api = await load("../lib/tokenhub-audit.ts", { "./provider-settings": helpers, "./tokenhub-audit-cases": fixtures, "./tokenhub-audit-catalog": catalog, "./tokenhub-audit-media": options.media ?? media }, { fetch: fetcher, Date: ClockDate, AbortSignal: { timeout(ms) { timeouts.push(ms); return AbortSignal.timeout(ms); } } });
  return { ...api, sqlite, calls, timeouts, env, now: new Date(), async start(now = new Date()) { return api.startAudit(env, { apiKey: KEY, budgetMicros: 5_000_000 }, now); } };
}
function noSecret(value) { const text = JSON.stringify(value); for (const secret of [KEY, SECRET]) assert.ok(!text.includes(secret), "Credential exposed"); }

test("fixed seven-day plan has bounded prompts, 63 calls covering all nine models, four subitems, paired answers, changing nonce and fixed anchors", () => {
  const plan = Array.from({ length: 14 }, (_, slot) => fixtures.auditCases("campaign-fixture", slot)).flat();
  assert.equal(plan.length, 63); assert.equal(plan.reduce((n, c) => n + c.reservedMicros, 0), 4_780_000);
  for (let slot = 0; slot < 14; slot++) {
    const cases = fixtures.auditCases("campaign-fixture", slot);
    if (!fixtures.AUDIT_CHAT_SLOTS.includes(slot)) continue;
    for (let m = 0; m < 4; m++) {
      const [short, long] = cases.slice(m * 2, m * 2 + 2);
      assert.equal(JSON.stringify(short.expected), JSON.stringify(long.expected));
      assert.equal(short.expected.answers.length, 4); assert.equal(short.body.max_tokens, 8192);
      assert.ok(new TextEncoder().encode(JSON.stringify(long.body.messages)).length <= 4096);
      assert.ok(long.body.messages[0].content.length > short.body.messages[0].content.length);
    }
  }
  const anchor0 = fixtures.auditCases("campaign-fixture", 0)[0], anchor2 = fixtures.auditCases("campaign-fixture", 4)[0];
  assert.equal(JSON.stringify(anchor0.expected.answers), JSON.stringify(anchor2.expected.answers));
  assert.notEqual(anchor0.expected.nonce, anchor2.expected.nonce);
  assert.equal(anchor0.expected.suite, "anchor"); assert.equal(fixtures.auditCases("campaign-fixture", 3)[0].expected.suite, "fresh");
});
test("grading separates empty/truncated from incorrect, and gives objective item scores", () => {
  const expected = { answers: [1, 2, 3, 4], nonce: "nonce" };
  assert.equal(fixtures.gradeAuditAnswer('{"answers":[1,2,0,4],"nonce":"nonce"}', expected, "stop").score, 75);
  for (const [content, reason, status] of [["", "stop", "empty"], ["anything", "length", "truncated"]]) {
    const grade = fixtures.gradeAuditAnswer(content, expected, reason); assert.equal(grade.status, status); assert.equal(grade.total, 0); assert.equal(grade.score, null);
  }
});
test("start validates dedicated credentials, stores isolated ciphertext, fixes seven days, refuses concurrent campaign restart", async t => {
  const f = await setup(t); const first = await f.start(f.now);
  assert.equal(first.campaign.plannedReservationMicros, 4_780_000);
  assert.equal(new Date(first.campaign.endsAt) - new Date(first.campaign.startedAt), 7 * 86400000);
  const row = f.sqlite.prepare("SELECT * FROM tokenhub_audit_campaigns").get();
  assert.equal(await helpers.decryptProviderKey(row.encrypted_key, SECRET, "eco-geo/audit/tokenhub/v1"), KEY);
  await assert.rejects(helpers.decryptProviderKey(row.encrypted_key, SECRET, "eco-geo/provider/tokenhub/v1")); noSecret(first);
  await assert.rejects(f.start(), error => error.status === 409);
  assert.equal(f.calls.length, 1);
  const modelCall = f.calls[0]; assert.equal(modelCall.init.redirect, "manual"); assert.equal(modelCall.init.headers.Authorization, `Bearer ${KEY}`);
});
test("global business key is rejected before network access", async t => {
  const f = await setup(t, { env: { TOKENHUB_API_KEY: KEY } });
  await assert.rejects(f.start(), error => error.status === 400); assert.equal(f.calls.length, 0);
});
test("simultaneous ticks claim each case once and cannot exceed the atomically constrained reservation", async t => {
  const f = await setup(t); await f.start(f.now);
  f.sqlite.prepare("UPDATE tokenhub_audit_campaigns SET budget_micros=10000").run();
  // Isolate one remaining planned case under a one-call budget; other cases are
  // already blocked without charge. Concurrent callers still race the same claim.
  const campaign = f.sqlite.prepare("SELECT id FROM tokenhub_audit_campaigns").get().id;
  for (let slot = 0; slot < 14; slot++) for (const spec of fixtures.auditCases(campaign, slot)) {
    if (slot === 0 && spec.id === `${fixtures.AUDIT_CHAT_MODELS[0]}:short`) continue;
    f.sqlite.prepare("INSERT INTO tokenhub_audit_cases(campaign_id,slot,case_id,kind,model,state,reserved_micros,request_json,request_hash,expected_json,price_json,price_hash,submitted_at,updated_at) VALUES(?,?,?,?,?,'price_blocked',0,?,'fixture',?,'{}','fixture',?,?)")
      .run(campaign, slot, spec.id, spec.kind, spec.model, JSON.stringify(spec.body), JSON.stringify(spec.expected), f.now.toISOString(), f.now.toISOString());
  }
  await Promise.all(Array.from({ length: 8 }, () => f.runAuditTick(f.env, { now: f.now, maxCases: 2 })));
  const posts = f.calls.filter(call => call.init.method === "POST"); assert.equal(posts.length, 1);
  assert.equal(f.sqlite.prepare("SELECT SUM(reserved_micros) AS total FROM tokenhub_audit_cases").get().total, 10000);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM tokenhub_audit_cases WHERE reserved_micros>0").get().n, 1);
});
test("unknown charged outcome retains reservation, cannot retry, and never leaks exceptions", async t => {
  const f = await setup(t, { fetcher(url, init) { if (init.method === "POST") throw new Error(KEY); } });
  await f.start(f.now); await f.runAuditTick(f.env, { now: f.now, maxCases: 1 });
  const first = f.sqlite.prepare("SELECT * FROM tokenhub_audit_cases").get();
  assert.equal(first.state, "outcome_unknown"); assert.equal(first.reserved_micros, 10000); noSecret(first);
  await f.runAuditTick(f.env, { now: f.now, maxCases: 1 });
  const posts = f.calls.filter(call => call.init.method === "POST"); assert.equal(posts.length, 2); assert.notEqual(posts[0].init.headers["Idempotency-Key"], posts[1].init.headers["Idempotency-Key"]);
  noSecret(await f.getAuditStatus(f.env, true));
});
test("pricing missing, foreign currency, conflicting deployments or excessive rates pause before any paid call", async t => {
  for (const mutation of [p => { p.currencyCode = "CNY"; }, p => { p.data[0].deployments[0].pricing.output = rate(6); }, p => { p.data[0].deployments.push({ enabled: true, pricing: { ...p.data[0].deployments[0].pricing, input: rate(.1) } }); }, p => { p.data = []; }]) {
    const f = await setup(t, { fetcher(url) { if (url.endsWith("/api/pricing")) { const p = prices(); mutation(p); return Response.json(p); } } });
    await f.start(f.now); const status = await f.runAuditTick(f.env, { now: f.now });
    assert.equal(status.campaign.state, "paused"); assert.equal(status.campaign.reservedMicros, 0); assert.equal(status.counts.price_blocked, 1);
    assert.equal(f.calls.filter(call => call.init.method === "POST").length, 0);
  }
});
test("successful evidence includes exact request, response, hashes, rates, grading and sanitized trace data", async t => {
  const f = await setup(t, { fetcher(url, init, sqlite) {
    if (url.endsWith("chat/completions")) {
      const expected = JSON.parse(sqlite.prepare("SELECT expected_json FROM tokenhub_audit_cases WHERE request_json=?").get(init.body).expected_json);
      return Response.json({ model: JSON.parse(init.body).model, secretEcho: KEY, choices: [{ message: { content: JSON.stringify(expected) }, finish_reason: "stop" }], usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 } }, { headers: { "x-request-id": `trace-${KEY}`, "set-cookie": KEY } });
    }
  } });
  await f.start(f.now); await f.runAuditTick(f.env, { now: f.now, maxCases: 1 });
  const status = await f.getAuditStatus(f.env, true), item = status.cases.find(item => item.state === "succeeded"); noSecret(status);
  assert.equal(item.grading.score, 100); assert.equal(item.grading.total, 4); assert.equal(item.derivedExpectedCostMicros, 125);
  assert.equal(item.request.max_tokens, 8192); assert.equal(item.priceSnapshot.data.currencyCode, "USD");
  assert.match(item.requestHash, /^[a-f0-9]{64}$/); assert.match(item.responseHash, /^[a-f0-9]{64}$/);
  assert.equal(item.headers["set-cookie"], undefined); assert.equal(item.headers["x-request-id"], "trace-[redacted]");
  assert.equal(item.billingVerification, "pending"); assert.equal(status.campaign.identityVerification, "unverified");
});
test("ticks do not catch up missed slots and no paid call occurs after expiry", async t => {
  const f = await setup(t), old = new Date(f.now.getTime() - 37 * 3600000); await f.start(old);
  await f.runAuditTick(f.env, { now: f.now, maxCases: 10 });
  assert.equal(f.sqlite.prepare("SELECT MIN(slot) AS n FROM tokenhub_audit_cases").get().n, 3);
  const before = f.calls.filter(call => call.init.method === "POST").length;
  const status = await f.runAuditTick(f.env, { now: new Date(old.getTime() + 7 * 86400000), maxCases: 10 });
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, before); assert.equal(status.campaign.state, "completed");
  assert.equal(status.counts.missed, 11);
});
test("video query is free recovery after campaign end and preserves creation plus final usage", async t => {
  const f = await setup(t); await f.start(f.now); await f.runAuditTick(f.env, { now: f.now, maxCases: 10 });
  assert.equal(f.sqlite.prepare("SELECT state FROM tokenhub_audit_cases WHERE kind='video'").get().state, "pending_video");
  await f.runAuditTick(f.env, { now: new Date(f.now.getTime() + 7 * 86400000) });
  const row = f.sqlite.prepare("SELECT * FROM tokenhub_audit_cases WHERE kind='video'").get();
  assert.equal(row.state, "succeeded"); assert.equal(row.derived_cost_micros, 280000); assert.equal(JSON.parse(row.creation_json).status, "submitted"); assert.equal(JSON.parse(row.response_json).status, "succeeded");
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, 10);
});
test("pause prevents new charges while explicit analysis and billing evidence remain visible", async t => {
  const f = await setup(t); await f.start(f.now); await f.runAuditTick(f.env, { now: f.now, maxCases: 1 }); await f.pauseAudit(f.env);
  f.sqlite.prepare("UPDATE tokenhub_audit_cases SET independent_analysis_json=?,billing_actual_micros=1140,billing_evidence_json=?").run(JSON.stringify({ status: "provisional", tokenVerification: "provisional_local_counts_not_model_authentication" }), JSON.stringify({ ledgerId: "receipt-test" }));
  const status = await f.runAuditTick(f.env, { now: f.now, maxCases: 10 });
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, 1); assert.equal(status.campaign.tokenVerification, "provisional");
  const row = status.cases.find(item => item.state === "succeeded"); assert.equal(row.billingActualMicros, 1140); assert.equal(row.billingVerification, "recorded");
});

test("nonce mismatch is excluded from capability score while mathematical subitems remain inspectable", () => {
  const grade = fixtures.gradeAuditAnswer('{"answers":[1,2,3,4],"nonce":"old"}', { answers: [1,2,3,4], nonce: "fresh" }, "stop");
  assert.equal(grade.status, "stale_or_mismatched_nonce"); assert.equal(grade.correct, 0); assert.equal(grade.total, 0); assert.equal(grade.score, null);
  assert.equal(grade.subitems.every(Boolean), true); assert.equal(grade.nonceMatches, false);
});
test("a long first response cannot dispatch a second paid request after the seven-day deadline", async t => {
  let clock = Date.now();
  const f = await setup(t, { clock: () => clock, fetcher(_url, init) { if (init.method === "POST") clock += 2000; } });
  await f.start(new Date(clock - 7 * 86400000 + 1000));
  const status = await f.runAuditTick(f.env, { maxCases: 2 });
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, 1);
  assert.equal(status.campaign.state, "completed"); assert.equal(status.campaign.reservedMicros, 120000);
});
test("a long response cannot dispatch another case from a slot that has just ended", async t => {
  let clock = Date.now();
  const f = await setup(t, { clock: () => clock, fetcher(_url, init) { if (init.method === "POST") clock += 2000; } });
  await f.start(new Date(clock - 12 * 3600000 + 1000));
  await f.runAuditTick(f.env, { maxCases: 2 });
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, 1);
  assert.equal(f.sqlite.prepare("SELECT slot FROM tokenhub_audit_cases").get().slot, 0);
  await f.runAuditTick(f.env, { maxCases: 1 });
  assert.equal(f.sqlite.prepare("SELECT MAX(slot) AS n FROM tokenhub_audit_cases").get().n, 0); // New slot 1 has no paid probes.
  clock += 12 * 3600000;
  await f.runAuditTick(f.env, { maxCases: 1 });
  assert.equal(f.sqlite.prepare("SELECT MAX(slot) AS n FROM tokenhub_audit_cases").get().n, 2);
});
test("deadline passing during final D1 claim prevents fetch and retains its reservation", async t => {
  let clock = Date.now(), advance = false;
  const f = await setup(t, { clock: () => clock, onFirst(query, _args, result) { if (advance && result && query.startsWith("UPDATE tokenhub_audit_cases SET state='submitting'")) clock += 2000; } });
  await f.start(new Date(clock - 7 * 86400000 + 1000)); advance = true;
  const status = await f.runAuditTick(f.env, { maxCases: 2 });
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, 0);
  assert.equal(status.campaign.state, "completed"); assert.equal(status.campaign.reservedMicros, 120000);
  const row = f.sqlite.prepare("SELECT * FROM tokenhub_audit_cases").get();
  assert.equal(row.state, "window_expired"); assert.equal(row.reserved_micros, 120000);
  assert.equal(status.cases.find(item => item.state === "window_expired").submittedAt, null);
});

test("v3 reservation uses actual locked v1 records and preserves their original evidence and output limits", async t => {
  const f = await setup(t); await f.start(f.now); await f.runAuditTick(f.env, { now: f.now, maxCases: 2 });
  const records = f.sqlite.prepare("SELECT * FROM tokenhub_audit_cases").all();
  for (const row of records) {
    const body = JSON.parse(row.request_json); body.max_tokens = 4096;
    const expected = JSON.parse(row.expected_json); delete expected.protocolVersion;
    f.sqlite.prepare("UPDATE tokenhub_audit_cases SET reserved_micros=30000,request_json=?,expected_json=? WHERE campaign_id=? AND slot=? AND case_id=?")
      .run(JSON.stringify(body), JSON.stringify(expected), row.campaign_id, row.slot, row.case_id);
  }
  f.sqlite.prepare("UPDATE tokenhub_audit_campaigns SET plan_version='tokenhub-audit-v1'").run();
  const before = await f.getAuditStatus(f.env, true);
  assert.equal(before.campaign.plannedReservationMicros, 4_820_000);
  const prior = before.cases.filter(item => item.state === "succeeded");
  assert.equal(prior.length, 2); assert.ok(prior.every(item => item.maxOutputTokens === 4096 && item.planVersion === "tokenhub-audit-v1" && item.request.max_tokens === 4096 && item.reservedMicros === 30000));
  const after = await f.runAuditTick(f.env, { now: f.now, maxCases: 1 });
  assert.equal(after.campaign.planVersion, "tokenhub-audit-v3"); assert.equal(after.campaign.plannedReservationMicros, 4_820_000);
  const fresh = after.cases.find(item => item.requestedModel === fixtures.AUDIT_CHAT_MODELS[1] && item.state === "succeeded");
  assert.equal(fresh.maxOutputTokens, 8192); assert.equal(fresh.reservedMicros, 50000); assert.equal(fresh.planVersion, "tokenhub-audit-v3");
  const storedOld = f.sqlite.prepare("SELECT request_json,reserved_micros FROM tokenhub_audit_cases WHERE model=?").all(fixtures.AUDIT_CHAT_MODELS[0]);
  assert.ok(storedOld.every(row => JSON.parse(row.request_json).max_tokens === 4096 && row.reserved_micros === 30000));
});
test("model-specific caps cover 4608 input and 8192 output tokens under each reservation", () => {
  for (const policy of Object.values(fixtures.AUDIT_CHAT_POLICIES)) {
    assert.equal(policy.maxOutputTokens, 8192);
    assert.ok(Math.ceil((4608 * policy.inputMicros + 8192 * policy.outputMicros) / 1e6) <= policy.reservedMicros);
    assert.ok(policy.cacheReadMicros <= policy.inputMicros);
  }
});

test("new paid requests wait up to five minutes while catalog and price reads keep short timeouts", async t => {
  const f = await setup(t); await f.start(f.now); await f.runAuditTick(f.env, { now: f.now, maxCases: 1 });
  assert.equal(f.AUDIT_PAID_TIMEOUT_MS, 300000);
  assert.deepEqual(f.timeouts, [10000, 10000, 10000, 10000, 300000]);
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, 1);
});

test("daily free observation unions the four-model API with all nine pricing entries and is idempotent", async t => {
  const f = await setup(t); await f.start(f.now);
  await Promise.all(Array.from({ length: 6 }, () => f.refreshAuditCatalog(f.env, f.now)));
  const status = await f.getAuditStatus(f.env);
  assert.equal(f.calls.length, 3); // One key verification, then two free catalog reads.
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, 0);
  assert.equal(status.catalogModels.length, 9); assert.equal(status.catalogObservations.length, 1);
  assert.equal(status.catalogObservations[0].status, "succeeded");
  assert.ok(status.days.every(day => day.models.length === 9));
  assert.ok(status.days[0].models.every(model => model.catalogObserved));
  assert.equal(status.campaign.plannedCalls, 63);
  assert.deepEqual([...new Set(status.catalogModels.map(model => model.kind))].sort(), ["chat", "image", "video"]);
  const evidence = await f.getAuditStatus(f.env, true);
  assert.equal(evidence.catalogObservations[0].modelsResponse.data.length, 4);
  assert.equal(evidence.catalogObservations[0].pricingResponse.data.length, 9);
  assert.match(evidence.catalogObservations[0].pricingHash, /^[a-f0-9]{64}$/);
  assert.equal(status.catalogObservations[0].pricingResponse, undefined);
  await f.refreshAuditCatalog(f.env, new Date(f.now.getTime() + 86400000));
  assert.equal(f.calls.length, 5); assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM tokenhub_audit_catalog_snapshots").get().n, 2);
});

test("new catalog models stay visible on all days without acquiring unapproved paid adapters or invented scores", async t => {
  const f = await setup(t, { fetcher(url) {
    if (url.endsWith("/api/pricing")) { const p = prices(); p.data.push({ id: "future-audio-model", label: "Future audio", secretEcho: KEY, deployments: [] }); return Response.json(p); }
  } });
  await f.start(f.now); const status = await f.refreshAuditCatalog(f.env, f.now);
  const extra = status.catalogModels.find(model => model.model === "future-audio-model");
  assert.equal(extra.paidAdapterSupported, false); assert.equal(extra.plannedCalls, 0); assert.equal(extra.kind, "unknown");
  assert.ok(status.days.every(day => day.models.find(model => model.model === extra.model).inferenceState === "adapter_pending"));
  assert.ok(status.days.every(day => day.models.find(model => model.model === extra.model).score === null));
  assert.equal(status.campaign.plannedReservationMicros, 4_780_000);
  const evidence = await f.getAuditStatus(f.env, true); noSecret(evidence);
  assert.equal(evidence.catalogObservations[0].pricingResponse.data.at(-1).secretEcho, "[redacted]");
  await f.runAuditTick(f.env, { now: f.now, maxCases: 1 });
  assert.equal(f.calls.filter(call => call.init.method === "POST" && JSON.parse(call.init.body).model === extra.model).length, 0);
});

test("empty or failed catalog sources cannot erase known models and daily read retries are bounded", async t => {
  let fail = false;
  const f = await setup(t, { fetcher(url) { if (!fail) return; if (url.endsWith("/api/pricing")) return Response.json({ currencyCode: "USD", data: [] }); if (url.endsWith("/api/v1/models")) return new Response("Unavailable", { status: 503 }); } });
  await f.start(f.now); await f.refreshAuditCatalog(f.env, f.now); fail = true;
  let at = new Date(f.now.getTime() + 86400000), status;
  for (let attempt = 0; attempt < 8; attempt++) {
    status = await f.refreshAuditCatalog(f.env, at);
    const snapshot = status.catalogObservations.at(-1);
    assert.equal(snapshot.attemptCount, attempt + 1); assert.equal(snapshot.status, "failed");
    at = new Date(snapshot.nextAttemptAt);
  }
  assert.equal(status.catalogModels.length, 9); assert.ok(status.catalogModels.every(model => model.catalogState === "present"));
  const count = f.calls.length; await f.refreshAuditCatalog(f.env, at); assert.equal(f.calls.length, count);
  const row = f.sqlite.prepare("SELECT * FROM tokenhub_audit_catalog_snapshots WHERE day=1").get();
  assert.equal(JSON.parse(row.pricing_json).data.length, 0); assert.match(row.pricing_hash, /^[a-f0-9]{64}$/);
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, 0);
});

test("disappeared models require a complete daily catalog and retain their earlier observation", async t => {
  let remove = false;
  const removed = "dreamina-seedance-2-0-fast-260128";
  const f = await setup(t, { fetcher(url) { if (remove && url.endsWith("/api/pricing")) { const p = prices(); p.data = p.data.filter(item => item.id !== removed); return Response.json(p); } } });
  await f.start(f.now); await f.refreshAuditCatalog(f.env, f.now); remove = true;
  const status = await f.refreshAuditCatalog(f.env, new Date(f.now.getTime() + 86400000));
  const model = status.catalogModels.find(item => item.model === removed);
  assert.equal(model.catalogState, "disappeared"); assert.equal(model.observedDays, 1);
  assert.equal(status.days[0].models.find(item => item.model === removed).catalogState, "present");
  assert.equal(status.days[1].models.find(item => item.model === removed).catalogState, "absent");
  assert.equal(status.catalogObservations.length, 2); assert.equal(status.cases.filter(item => item.requestedModel === removed).length, 1);
});

test("v3 retains orphaned earlier-plan cases, every original hash and reservation, and includes them in its budget check", async t => {
  const f = await setup(t); await f.start(f.now); await f.runAuditTick(f.env, { now: f.now, maxCases: 1 });
  const original = f.sqlite.prepare("SELECT * FROM tokenhub_audit_cases").get();
  f.sqlite.prepare(`INSERT INTO tokenhub_audit_cases SELECT campaign_id,1,case_id,kind,model,state,300000,request_json,request_hash,expected_json,price_json,price_hash,response_json,response_hash,creation_json,headers_json,http_status,latency_ms,usage_json,returned_model,derived_cost_micros,grading_json,flags_json,independent_analysis_json,billing_actual_micros,billing_evidence_json,task_id,poll_count,next_poll_at,submitted_at,updated_at FROM tokenhub_audit_cases`).run();
  const before = await f.getAuditStatus(f.env, true), orphan = before.cases.find(item => item.slot === 1);
  assert.equal(before.campaign.plannedCalls, 64); assert.equal(before.campaign.plannedReservationMicros, 5_080_000);
  assert.equal(orphan.retainedFromEarlierPlan, true); assert.equal(orphan.requestHash, original.request_hash); assert.equal(orphan.responseHash, original.response_hash); assert.equal(orphan.reservedMicros, 300000);
  assert.equal(JSON.stringify(orphan.request), original.request_json); assert.equal(JSON.stringify(orphan.expected), original.expected_json);
  const status = await f.runAuditTick(f.env, { now: f.now, maxCases: 10 });
  assert.equal(status.campaign.state, "paused"); assert.equal(f.calls.filter(call => call.init.method === "POST").length, 1);
});

test("every known video has one paid adapter while unknown media prices remain blocked", async t => {
  const plan = Array.from({ length: 14 }, (_, slot) => fixtures.auditCases("all-models", slot)).flat(), videos = plan.filter(item => item.kind === "video");
  assert.equal(videos.length, 5); assert.equal(new Set(plan.map(item => item.model)).size, 9);
  const f = await setup(t), p = prices(), spec = videos.find(item => item.model === "dreamina-seedance-2-5-260628");
  assert.equal(f.auditPriceRates(p, spec).video, 10_700_000);
  assert.equal(spec.body.return_last_frame, undefined); assert.equal(spec.body.duration, 4); assert.equal(spec.body.resolution, "480p");
  p.data.find(item => item.id === spec.model).deployments[0].pricing.video.withoutVideo480p = rate(11.1);
  assert.throws(() => f.auditPriceRates(p, spec), error => error.status === 409);
  p.data.push({ id: "future-video", deployments: [{ enabled: true, pricing: { video: { withoutVideo480p: rate(1) } } }] });
  assert.throws(() => f.auditPriceRates(p, { kind: "video", model: "future-video" }), error => error.status === 409);
});


test("artifact archive errors preserve successful model evidence and never trigger repeated generation", async t => {
  const f = await setup(t, { env: { AUDIT_MEDIA: {} }, media: { async archiveAuditCaseMedia() { throw new Error("storage unavailable"); }, async archiveAuditMediaBackfill() { throw new Error("storage unavailable"); } } });
  await f.start(f.now);
  await f.runAuditTick(f.env, { maxCases: 10, now: f.now });
  const image = f.sqlite.prepare("SELECT state,response_hash FROM tokenhub_audit_cases WHERE kind='image'").get();
  assert.equal(image.state, "succeeded"); assert.ok(image.response_hash);
  const postCount = f.calls.filter(call => call.init.method === "POST").length;
  await f.runAuditTick(f.env, { maxCases: 10, now: new Date(f.now.getTime() + 6 * 60_000) });
  const video = f.sqlite.prepare("SELECT state,response_hash FROM tokenhub_audit_cases WHERE kind='video'").get();
  assert.equal(video.state, "succeeded"); assert.ok(video.response_hash);
  assert.equal(f.calls.filter(call => call.init.method === "POST").length, postCount);
});
