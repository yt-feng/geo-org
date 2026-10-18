import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(path, mocks = {}) {
  const filename = new URL(path, import.meta.url).pathname;
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const compiled = { exports: {} };
  vm.runInNewContext(outputText, { module: compiled, exports: compiled.exports, Response, URLSearchParams, AbortSignal,
    require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; throw new Error(`Unexpected dependency ${name}`); },
    fetch() { throw new Error("Documentation tests must not access a network"); } }, { filename });
  return compiled.exports;
}
const reference = await load("../lib/tokenhub-model-reference.ts");
const docs = await load("../lib/tokenhub-openapi.ts", { "./tokenhub-model-reference": reference });
const viewer = await load("../lib/api-documentation.ts");
const BASE = "https://api.eco-geo.org";
const spec = docs.tokenHubOpenApi(BASE);
const plain = value => JSON.parse(JSON.stringify(value));

function dataSpec() { return { paths: { "/api/v1/example": { get: { summary: "Existing data endpoint", tags: ["Data"] } } } }; }

test("TokenHub OpenAPI covers all relay operations and exact nine model references without taking TikHub paths", () => {
  const operations = viewer.parseApiOperations(spec, "tokenhub");
  assert.equal(operations.length, 7);
  assert.equal(Object.keys(spec.paths).length, 5);
  assert.ok(operations.every(operation => operation.path.startsWith("/api/tokenhub/")));
  const expected = reference.TOKENHUB_REFERENCE_MODELS.map(model => model.id);
  const documented = operations.flatMap(operation => viewer.requestBodySchema(operation)?.properties?.model?.enum || []);
  assert.equal(new Set(documented).size, 9);
  assert.deepEqual([...documented].sort(), [...expected].sort());
  for (const operation of operations.filter(operation => operation.method === "POST")) {
    const example = viewer.requestBodyExample(operation), schema = viewer.requestBodySchema(operation);
    assert.ok(schema.properties.model.enum.includes(example.model));
    assert.ok(operation.description.includes("管理员"));
    assert.ok(operation.description.includes("/api/tokenhub/v1/models"));
  }
  const serialized = JSON.stringify(spec);
  assert.doesNotMatch(serialized, /ai-tokenhub\.ai|sk-[a-zA-Z0-9]/);
  assert.match(serialized, /integrationStatus/);
  assert.match(serialized, /accountAccess/);
  assert.match(serialized, /catalog\.complete/);
});

test("local TokenHub OpenAPI requires an administrator and never depends on provider access", async () => {
  let configurationReads = 0;
  for (const [user, expected] of [[null, 401], [{ id: "member", isAdmin: false }, 403], [{ id: "admin", isAdmin: true }, 200]]) {
    const route = await load("../app/api/private/tokenhub-openapi/route.ts", {
      "@/lib/auth": { getPortalUser: async () => user },
      "@/lib/config": { publicBaseUrl: () => { configurationReads++; return BASE; } },
      "@/lib/tokenhub-openapi": docs,
    });
    const response = await route.GET();
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    if (expected === 200) assert.equal((await response.json()).info.title, "ECO-GEO TokenHub API");
    else assert.equal(configurationReads, 0);
  }
  assert.equal(configurationReads, 1);
});

test("a failed data specification does not hide TokenHub docs, and the reverse remains usable", async () => {
  for (const unavailable of ["tikhub", "tokenhub"]) {
    const calls = [];
    const result = await viewer.loadApiDocumentation(async (url, init) => {
      calls.push(url); assert.equal(init.cache, "no-store"); assert.ok(init.signal);
      const isTokenHub = url.includes("tokenhub-openapi");
      return (isTokenHub ? "tokenhub" : "tikhub") === unavailable ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json(isTokenHub ? spec : dataSpec());
    });
    assert.equal(calls.length, 2);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.sources.filter(source => source.loaded).length, 1);
    assert.equal(result.operations.length, unavailable === "tikhub" ? 7 : 1);
    assert.ok(result.operations.every(operation => operation.source !== unavailable));
  }
});

test("nonadministrator sees data docs with an explicit TokenHub access note; malformed or failed sources never look loaded", async () => {
  const member = await viewer.loadApiDocumentation(async url => url.includes("tokenhub-openapi") ? Response.json({}, { status: 403 }) : Response.json(dataSpec()));
  assert.equal(member.operations.length, 1);
  assert.match(member.warnings[0], /管理员权限/);
  const broken = await viewer.loadApiDocumentation(async url => { if (url.includes("tokenhub")) throw Error("transport details must not be displayed"); return Response.json({ notAnApi: true }); });
  assert.equal(broken.operations.length, 0);
  assert.equal(broken.warnings.length, 2);
  assert.ok(broken.sources.every(source => !source.loaded));
  assert.doesNotMatch(broken.warnings.join(" "), /transport details/);
});

test("curl examples contain usable JSON bodies, content type, unique-video placeholder, and owned task path", () => {
  const operations = viewer.parseApiOperations(spec, "tokenhub");
  const create = operations.find(operation => operation.summary === "创建 TokenHub 视频任务");
  const command = viewer.apiCurlExample(BASE, create);
  assert.match(command, /Content-Type: application\/json/);
  assert.match(command, /Idempotency-Key: replace_with_unique_request_id/);
  assert.match(command, /--data-raw/);
  assert.match(command, /dreamina-seedance-2-0-fast-260128/);
  const chat = operations.find(operation => operation.summary === "TokenHub 文本对话");
  assert.equal(viewer.requestBodyExample(chat).stream, false);
  assert.doesNotMatch(viewer.apiCurlExample(BASE, chat), /Idempotency-Key/);
  const query = operations.find(operation => operation.summary === "查询 TokenHub 视频任务");
  assert.match(viewer.apiCurlExample(BASE, query), /\/tasks\/task_id_from_create_response/);
  assert.doesNotMatch(viewer.apiCurlExample(BASE, query), /\{task_id\}|--data-raw/);
});

test("upstream examples remain quoted display data, preserve inherited parameters, and cannot replace the ECO-GEO auth placeholder", () => {
  const hostile = "a'$(touch /tmp/SHOULD_NOT_EXIST) `id`\nline";
  const operations = viewer.parseApiOperations({ paths: { "/api/v1/items/{id}": {
    parameters: [{ name: "id", in: "path", required: true, example: "example-id" }],
    post: { parameters: [{ name: "Authorization", in: "header", required: true, example: "untrusted-secret" }], requestBody: { content: { "application/json": { examples: { sample: { value: { text: hostile } } } } } } },
  } } }, "tikhub");
  const example = viewer.requestBodyExample(operations[0]);
  assert.deepEqual(plain(example), { text: hostile });
  const command = viewer.apiCurlExample(BASE, operations[0]);
  assert.match(command, /\/items\/example-id/);
  assert.match(command, /'"'"'/);
  assert.match(command, /eco_live_your_api_key/);
  assert.doesNotMatch(command, /untrusted-secret/);
});
