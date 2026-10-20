import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { brandDisplay } from "./helpers/brand-display.mjs";

const require = createRequire(import.meta.url);
async function load(path, mocks = {}, expose = "") {
  const filename = new URL(path, import.meta.url).pathname;
  const compiled = { exports: {} };
  const source = await readFile(filename, "utf8");
  const { outputText } = ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  vm.runInNewContext(outputText + expose, { module: compiled, exports: compiled.exports, URLSearchParams, require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; if (name === "react" || name === "react/jsx-runtime") return require(name); throw new Error(`Unexpected dependency: ${name}`); } }, { filename });
  return compiled.exports;
}
const references = await load("../lib/tokenhub-model-reference.ts");
const catalog = await load("../lib/model-catalog.ts", { "./tokenhub-model-reference": references });
const workbench = await load("../components/TokenHubPlayground.tsx", { "@/lib/brand-display": brandDisplay, "next/link": { default: () => null }, "next/image": { default: () => null }, "./Icon": { Icon: () => null } }, "\nmodule.exports.helpers = { parseModels, modelMatches, modelLabel, selectionFromSearch, endpoint };" );

test("all nine TokenHub reference models select the correct gateway workbench and exact version", () => {
  assert.equal(catalog.tokenhubModelCatalog.length, 9);
  assert.equal(catalog.allModelCatalog.length, catalog.modelCatalog.length + 9);
  assert.equal(catalog.modelCatalog.filter(item => item.upstream === "tokenhub").length, 0, "APIMart's request builder must not receive TokenHub entries");
  for (const reference of references.TOKENHUB_REFERENCE_MODELS) {
    const entries = catalog.tokenhubModelCatalog.filter(item => item.id === reference.id);
    assert.equal(entries.length, 1);
    const model = entries[0], url = new URL(catalog.modelWorkbenchUrl(model), "https://api.eco-geo.org");
    assert.equal(model.upstream, "tokenhub");
    assert.equal(model.docs, "/dashboard/docs?provider=studio");
    assert.equal(url.pathname, "/studio");
    assert.equal(url.searchParams.get("model"), reference.id);
    const selection = workbench.helpers.selectionFromSearch(url.search);
    assert.equal(selection.model, reference.id);
    assert.equal(selection.mode, reference.kind);
    assert.ok(workbench.helpers.endpoint[selection.mode].startsWith("/api/studio/"));
  }
  assert.equal(new URL(catalog.modelWorkbenchUrl(catalog.modelCatalog[0]), "https://api.eco-geo.org").pathname, "/playground");
});

test("live workbench discovery groups four chat, one image and four video models without static fallback", () => {
  const models = workbench.helpers.parseModels(references.TOKENHUB_REFERENCE_MODELS.map(model => ({ ...model, modelType: model.kind, category: [model.kind] })));
  for (const [mode, count] of [["chat", 4], ["image", 1], ["video", 4]]) assert.equal(models.filter(model => workbench.helpers.modelMatches(model, mode)).length, count);
  assert.equal(workbench.helpers.parseModels(null).length, 0);
  assert.equal(workbench.helpers.parseModels([]).length, 0);
  const added = workbench.helpers.parseModels([{ id: "future-image-version", modelType: "image", category: ["image"] }, { id: "unknown-video-sounding-model", modelType: "unknown", category: [] }]);
  assert.equal(workbench.helpers.modelMatches(added[0], "image"), true);
  assert.equal(workbench.helpers.modelMatches(added[1], "video"), false, "Unknown endpoint types must not be advertised as a supported route by name alone");
  assert.equal(workbench.helpers.modelLabel({ id: "dreamina-seedance-2-0-fast-260128", category: ["video"] }), "Seedance 2.0 Fast");
});

test("deep links preserve custom exact IDs but reject unknown interface selectors and excessive IDs", () => {
  const selected = workbench.helpers.selectionFromSearch("?model=custom%2Fv2&category=text");
  assert.equal(selected.model, "custom/v2");
  assert.equal(selected.mode, "chat");
  assert.equal(workbench.helpers.selectionFromSearch("?model=other&category=arbitrary-route").mode, undefined);
  assert.equal(workbench.helpers.selectionFromSearch(`?model=${"x".repeat(201)}&category=video`).model, "");
});
