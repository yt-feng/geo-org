import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const filename = new URL("../lib/model-guidance.ts", import.meta.url);
const source = await readFile(filename, "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const compiled = { exports: {} };
vm.runInNewContext(output, { module: compiled, exports: compiled.exports, require(name) { throw new Error(`Public guidance must not import ${name}`); } });
const { getModelGuidance, modelGuidanceProfiles, recommendModels, isGuidanceAnswers, defaultGuidanceAnswers } = compiled.exports;
const answer = overrides => ({ ...defaultGuidanceAnswers, ...overrides });
const model = (id, overrides = {}) => ({ id, name: id, provider: getModelGuidance(id)?.family ?? "Unknown", category: "text", requestKind: "chat", available: true, service: "gateway", ...overrides });
const price = (modelId, input = 1, output = 1, service = "gateway") => ({ modelId, inputUsdPerMillion: input, outputUsdPerMillion: output, service });
const ids = result => Array.from(result.recommendations, row => row.model.id);
const fullCatalog = Array.from(modelGuidanceProfiles, profile => model(profile.modelId));

test("all curated records map to real catalogue IDs and contain source-attributed bilingual evidence", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../lib/model-directory-snapshot.json", import.meta.url), "utf8"));
  const catalogueIds = new Set(snapshot.models.map(row => row.id));
  assert.ok(modelGuidanceProfiles.length >= 25);
  assert.equal(new Set(modelGuidanceProfiles.map(row => row.family)).size, 9);
  const officialHosts = new Set(["developers.openai.com", "platform.claude.com", "ai.google.dev", "github.com", "huggingface.co", "api-docs.deepseek.com", "help.aliyun.com", "docs.z.ai", "docs.x.ai", "www.kimi.com", "www.minimax.io"]);
  for (const profile of modelGuidanceProfiles) {
    assert.ok(catalogueIds.has(profile.modelId), `Not in catalogue: ${profile.modelId}`);
    assert.equal(profile.sources.every(item => item.reviewedAt === "2026-10-24"), true);
    assert.ok(profile.positioning.zh && profile.positioning.en);
    assert.deepEqual(Object.keys(profile.dimensions).sort(), ["coding", "creative", "math", "reasoning", "speed", "writing"]);
    for (const item of profile.sources) assert.ok(officialHosts.has(new URL(item.url).hostname));
    for (const dimension of Object.values(profile.dimensions)) {
      assert.ok(dimension.label.zh && dimension.label.en && dimension.detail.zh && dimension.detail.en);
      if (dimension.basis === "official") {
        assert.ok(dimension.sourceIds.length > 0);
        for (const id of dimension.sourceIds) assert.ok(profile.sources.some(item => item.id === id));
      } else assert.equal(dimension.sourceIds.length, 0);
    }
    for (const benchmark of profile.benchmarks) {
      assert.ok(Number.isFinite(benchmark.value));
      assert.ok(benchmark.condition.zh.length > 20 && benchmark.condition.en.length > 20);
      assert.ok(profile.sources.some(item => item.id === benchmark.sourceId));
    }
  }
  assert.doesNotMatch(JSON.stringify(modelGuidanceProfiles), /tokenhub|apimart|rkapi|xiaoxincodex|inputUsdPerMillion|outputUsdPerMillion/i);
});

test("exact identity mapping never fabricates snapshots, thinking aliases or ambiguous redirected versions", () => {
  for (const id of ["constructor", "__proto__", "gpt-6-astra-thinking", "gpt-6-astra-2099-01-01", "claude-fable-5.1", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-r1-250528", "does-not-exist"]) assert.equal(getModelGuidance(id), null);
  assert.equal(getModelGuidance("gpt-4.1-2025-04-14").generation, "4.1");
  assert.equal(getModelGuidance("qwen3.8-max-0902").generation, "3.8 Max · 2026-09-02");
  assert.equal(getModelGuidance("deepseek-r1").benchmarks[0].value, 79.8);
  assert.equal(getModelGuidance("deepseek-r1-0528").benchmarks[0].value, 91.4);
  assert.notEqual(getModelGuidance("deepseek-r1").benchmarks[0].condition.en, getModelGuidance("deepseek-r1-0528").benchmarks[0].condition.en);
});

test("only explicitly available text chat routes can be recommended", () => {
  const catalog = [model("gpt-6-astra", { available: undefined }), model("gpt-6-luna", { available: false }), model("gemini-4-argon", { requestKind: undefined }), model("kimi-k3", { requestKind: "embedding" }), model("minimax-m3", { category: "image" }), model("unknown"), model("glm-5.3")];
  const result = recommendModels(answer(), catalog);
  assert.deepEqual(ids(result), ["glm-5.3"]);
  assert.equal(result.excludedCounts.unavailable, 2); assert.equal(result.excludedCounts.unsupported, 3); assert.equal(result.excludedCounts.unverified, 1);
  assert.equal(recommendModels(answer(), []).recommendations.length, 0);
});

test("image recommendations require both official and platform route support", () => {
  const candidates = [model("gpt-6-astra"), model("gpt-6-luna", { inputModalities: ["text"] }), model("glm-5.3", { inputModalities: ["text", "image"] }), model("gemini-4-argon", { inputModalities: ["text", "image"] })];
  const result = recommendModels(answer({ input: "image" }), candidates);
  assert.deepEqual(ids(result), ["gemini-4-argon"]); assert.equal(result.excludedCounts.modality, 3);
});

test("long context respects the smaller known platform cap, unknown official limits and invalid caps", () => {
  const candidates = [model("gpt-6-astra", { contextTokens: 16_000 }), model("gpt-6-luna", { contextTokens: NaN }), model("kimi-k3", { contextTokens: 0 }), model("kimi-k2.5", { contextTokens: 1_000_000 }), model("deepseek-r1"), model("gemini-4-argon", { contextTokens: 129_000 })];
  const result = recommendModels(answer({ context: "long" }), candidates);
  assert.equal(result.excludedCounts.context, 5);
  assert.deepEqual(new Set(ids(result)), new Set(["gemini-4-argon"]));
  assert.ok(result.recommendations.every(row => row.reasons.some(text => text.en.includes("128,000"))));
});

test("economy uses retail token-mix cost, never missing, invalid, conflicting or other-route prices as free", () => {
  const candidates = [model("gpt-6-luna"), model("gemini-2.5-flash"), model("qwen3.8-flash"), model("claude-haiku-5-5"), model("kimi-k3")];
  const result = recommendModels(answer({ priority: "economy" }), candidates, [
    price("gpt-6-luna", 0.1, 30), price("gemini-2.5-flash", 1, 1),
    price("qwen3.8-flash", 0, 0, "selected"), price("claude-haiku-5-5", -1, 0),
    price("kimi-k3", 0.01, 0.01), price("kimi-k3", 1, 1),
  ]);
  assert.deepEqual(ids(result).slice(0, 2), ["gemini-2.5-flash", "gpt-6-luna"]);
  assert.ok(result.recommendations[2].tradeoffs.some(text => text.en.includes("rates are missing")));
  assert.ok(result.recommendations[0].reasons.some(text => text.en.includes("2,000 input + 1,000 output")));
  const nan = recommendModels(answer({ priority: "economy" }), [model("gpt-6-luna"), model("gemini-2.5-flash")], [price("gpt-6-luna", NaN, 0), price("gemini-2.5-flash", 100, 100)]);
  assert.equal(ids(nan)[0], "gemini-2.5-flash");
});

test("long-context pricing uses the declared 128,000 + 1,000 token mix", () => {
  const catalog = [model("gpt-6-luna"), model("gemini-2.5-flash")];
  const rates = [price("gpt-6-luna", 0.1, 10), price("gemini-2.5-flash", 1, 1)];
  assert.equal(ids(recommendModels(answer({ priority: "economy" }), catalog, rates))[0], "gemini-2.5-flash");
  const long = recommendModels(answer({ priority: "economy", context: "long" }), catalog, rates);
  assert.equal(ids(long)[0], "gpt-6-luna");
  assert.ok(long.recommendations[0].reasons.some(text => text.en.includes("128,000 input + 1,000 output")));
});

test("officially shut-down models remain comparable but cannot be recommended", () => {
  assert.ok(getModelGuidance("gpt-4.1-nano"));
  assert.ok(getModelGuidance("gpt-4.1-nano-2025-04-14"));
  assert.deepEqual(ids(recommendModels(answer(), [model("gpt-4.1-nano"), model("gpt-4.1-nano-2025-04-14"), model("gpt-4.1-mini")])), ["gpt-4.1-mini"]);
});

test("recommendation is deterministic independent of catalogue order and does not mutate inputs", () => {
  const initial = JSON.stringify(fullCatalog);
  for (const priority of ["quality", "balanced", "speed", "economy"]) {
    const a = recommendModels(answer({ task: "coding", priority }), fullCatalog);
    const b = recommendModels(answer({ task: "coding", priority }), [...fullCatalog].reverse());
    assert.deepEqual(ids(a), ids(b));
    assert.equal(a.recommendations.length, 3);
    assert.equal(new Set(a.recommendations.map(row => row.guidance.family)).size, 3);
    assert.ok(a.recommendations.every(row => row.reasons.length > 0 && row.tradeoffs.length > 0));
  }
  assert.equal(JSON.stringify(fullCatalog), initial);
});

test("same-family alternatives obey the exact same availability, modality and context constraints", () => {
  const catalog = [model("gpt-6-astra", { inputModalities: ["image"] }), model("gpt-6-luna", { available: false, inputModalities: ["image"] }), model("gpt-6.1-sol", { inputModalities: ["image"] }), model("gpt-4.1", { inputModalities: ["text"] }), model("gpt-5-mini", { inputModalities: ["image"], contextTokens: 1000 })];
  const result = recommendModels(answer({ input: "image", context: "long" }), catalog);
  for (const row of result.recommendations) {
    assert.equal(row.sameFamilyAlternatives.length, 1);
    assert.ok(["gpt-6-astra", "gpt-6.1-sol"].includes(row.sameFamilyAlternatives[0].modelId));
    assert.notEqual(row.sameFamilyAlternatives[0].modelId, row.model.id);
  }
});

test("identical routes deduplicate while distinct service entries retain their identity", () => {
  const a = model("gpt-6-luna");
  const result = recommendModels(answer(), [a, { ...a }, { ...a, service: "selected" }]);
  assert.equal(result.excludedCounts.duplicate, 1); assert.equal(result.recommendations.length, 2);
  assert.equal(new Set(result.recommendations.map(row => row.model.service)).size, 2);
});

test("answer validation rejects invalid primitive types and leaves no silent broadening of preferences", () => {
  assert.equal(isGuidanceAnswers(answer()), true);
  for (const invalid of [null, [], {}, answer({ task: "image" }), answer({ priority: "cheapest" }), answer({ input: "audio" }), answer({ task: ["coding"] }), answer({ context: new String("long") })]) {
    assert.equal(isGuidanceAnswers(invalid), false);
    assert.throws(() => recommendModels(invalid, fullCatalog), /Invalid model-selection answers/);
  }
});
