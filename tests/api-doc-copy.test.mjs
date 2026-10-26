import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
const root = new URL("../lib/", import.meta.url).pathname, cache = new Map();
async function load(name) {
  const file = resolve(root, `${name}.ts`);
  if (cache.has(file)) return cache.get(file);
  const contents = await readFile(file, "utf8"), dependencies = {};
  const ast = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true);
  for (const item of ast.statements) {
    if (!ts.isImportDeclaration(item) || item.importClause?.isTypeOnly) continue;
    const path = item.moduleSpecifier.text;
    if (path.startsWith("./")) dependencies[path] = await load(resolve(dirname(file), path));
  }
  const compiledModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(contents, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiledModule, exports: compiledModule.exports, URL, URLSearchParams, require: name => dependencies[name] }, { filename: file });
  cache.set(file, compiledModule.exports); return compiledModule.exports;
}
const { englishApiDocText, englishApiSchemaCopy, englishApiOperation } = await load("api-doc-copy");
const { parseApiOperations, requestBodyExample, apiCurlExample } = await load("api-documentation");
const factories = [
  ["apimart", (await load("apimart-openapi")).apimartOpenApi],
  ["tokenhub", (await load("tokenhub-openapi")).tokenHubOpenApi],
  ["selected", (await load("selected-openapi")).selectedOpenApi],
];
const literal = new Set(["example", "examples", "enum", "default", "const", "$ref", "required"]);
const narrative = new Set(["description", "summary", "title"]);
function descriptions(value, key = "") {
  if (literal.has(key)) return [];
  if (typeof value === "string") return narrative.has(key) || key === "tags" ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(item => descriptions(item, key));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([name, item]) => descriptions(item, name));
}
function semanticProjection(value, key = "") {
  if (literal.has(key)) return value;
  if (typeof value === "string" && narrative.has(key)) return "<description>";
  if (key === "tags") return "<tags>";
  if (Array.isArray(value)) return value.map(item => semanticProjection(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, semanticProjection(item, name)]));
}

test("all authored model-service summaries, descriptions and schema text have complete English projections", () => {
  const distinct = new Set(); let operations = 0;
  for (const [source, create] of factories) {
    const spec = create("https://tokvilo.com"), original = JSON.stringify(spec), projected = englishApiSchemaCopy(spec);
    descriptions(spec).filter(text => /[\u4e00-\u9fff]/.test(text)).forEach(text => distinct.add(text));
    assert.doesNotMatch(descriptions(projected).join("\n"), /[\u4e00-\u9fff]/, source);
    assert.deepEqual(semanticProjection(projected), semanticProjection(spec), `${source}: schema constraints must not change`);
    assert.equal(JSON.stringify(spec), original, `${source}: original API document must not mutate`);
    for (const operation of parseApiOperations(spec, source)) {
      const view = englishApiOperation(operation); operations++;
      assert.doesNotMatch(descriptions(view).join("\n"), /[\u4e00-\u9fff]/, `${source} ${operation.path}`);
      assert.deepEqual(requestBodyExample(view), requestBodyExample(operation));
      assert.equal(apiCurlExample("https://tokvilo.com", view), apiCurlExample("https://tokvilo.com", operation));
      assert.equal(view.path, operation.path); assert.equal(view.method, operation.method);
    }
  }
  assert.equal(distinct.size, 110);
  assert.equal(operations, 17);
});

test("documentation examples and arbitrary enum/default text are never translated", () => {
  const value = { description: "请求参数无效。", properties: { description: { type: "string", description: "请求参数无效。" } },
    enum: ["请求参数无效。"], default: "请求参数无效。", const: "请求参数无效。", required: ["description"],
    example: { description: "请求参数无效。", user: "原文" }, examples: { x: { summary: "请求参数无效。", value: { prompt: "原文" } } } };
  const projected = englishApiSchemaCopy(value);
  assert.equal(projected.description, "Invalid request parameters.");
  assert.equal(projected.properties.description.description, "Invalid request parameters.");
  for (const key of literal) if (key in value) assert.equal(projected[key], value[key]);
});

test("dynamic documentation hosts, reference dates and counts are preserved", () => {
  const spec = factories[1][1]("https://custom.example:8443");
  const views = parseApiOperations(spec, "tokenhub").map(englishApiOperation);
  const chat = views.find(item => item.path.endsWith("/chat/completions"));
  assert.match(chat.description, /base_url=https:\/\/custom\.example:8443\/api\/studio\/v1/);
  assert.doesNotMatch(chat.description, /tokvilo\.com/);
  const original = parseApiOperations(factories[1][1]("https://tokvilo.com"), "tokenhub");
  const model = original.find(item => item.path.endsWith("/models"));
  const changed = model.description.replace("共 9 个模型", "共 123 个模型");
  assert.match(englishApiDocText(changed), /includes 123 models/);
  const modelDescription = original.find(item => item.path.endsWith("/chat/completions")).description.replaceAll("2026-10-18", "2027-01-02");
  assert.match(englishApiDocText(modelDescription), /dated 2027-01-02/);
});

test("external data-service prose and generated/example content remain unchanged", () => {
  const operation = { source: "tikhub", path: "/api/v1/data", method: "GET", summary: "请求参数无效。", description: "来源原文", tags: ["分类"], parameters: [] };
  assert.equal(englishApiOperation(operation), operation);
  assert.equal(englishApiDocText("Unrecognized external narrative 原始资料"), "Unrecognized external narrative 原始资料");
});

test("documentation UI uses the projection for active operations, search and category labels", async () => {
  const source = await readFile(new URL("../components/DocsExplorer.tsx", import.meta.url), "utf8");
  assert.match(source, /selectedOperation \? operationCopy\(selectedOperation\)/);
  assert.match(source, /operationCopy\(operation\)\.summary/);
  assert.match(source, /JSON\.stringify\(englishApiOperation\(operation\)\)/);
  assert.match(source, /englishApiDocText\(item\)/);
});
