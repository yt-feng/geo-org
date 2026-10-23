import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { catalog } from "./helpers/model-catalog.mjs";

const file = new URL("../app/playground/page.tsx", import.meta.url);
const code = ts.transpileModule(await readFile(file, "utf8"), { fileName: file.pathname,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const components = { Playground() {}, TokenHubPlayground() {}, SelectedPlayground() {}, DashboardShell() {}, LocaleProvider() {} };
const selectedSnapshot = JSON.parse(await readFile(new URL("../lib/rkapi-catalog-snapshot.json", import.meta.url), "utf8"));
async function render(params) {
  let locale, next;
  const compiledModule = { exports: {} };
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, URLSearchParams, require(name) {
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/lib/auth") return { requirePortalUser: async (value, destination) => { locale = value; next = destination; return { isAdmin: false }; } };
    if (name.startsWith("@/components/")) { const key = name.split("/").at(-1); return { [key]: components[key] }; }
    throw Error(name);
  } });
  const tree = await compiledModule.exports.default({ searchParams: Promise.resolve(params) });
  return { locale, next, tree, shell: tree.props.children, workspace: tree.props.children.props.children };
}

test("every catalogue entry has one universal entry with its exact service, model and category", () => {
  const selected = selectedSnapshot.models.map(row => ({ id: row.id, category: row.category, upstream: "selected" }));
  const models = [...catalog.allModelCatalog, ...selected];
  const destinations = new Set();
  for (const model of models) {
    const link = catalog.modelWorkbenchUrl(model), url = new URL(link, "https://tokvilo.com");
    assert.equal(url.pathname, "/playground");
    assert.equal(url.searchParams.get("model"), model.id);
    assert.equal(url.searchParams.get("category"), model.category);
    assert.equal(url.searchParams.get("service"), model.upstream === "tokenhub" ? "studio" : model.upstream === "selected" ? "selected" : "gateway");
    assert.equal(destinations.has(link), false);
    destinations.add(link);
  }
  assert.equal(destinations.size, models.length);
});

test("universal playground dispatches each service to its own request builder without changing explicit IDs", async () => {
  for (const [service, component] of [["gateway", "Playground"], ["studio", "TokenHubPlayground"], ["selected", "SelectedPlayground"]]) {
    const result = await render({ service, model: "gpt-image-2", category: "image", lang: "en" });
    assert.equal(result.workspace.type, components[component]);
    assert.equal(result.shell.props.active, "playground");
    assert.equal(result.locale, "en");
    assert.equal(result.next, `/playground?service=${service}&model=gpt-image-2&category=image&lang=en`);
    assert.equal(result.workspace.key, `${service}:gpt-image-2:image`);
    if (service !== "studio") assert.equal(result.workspace.props.initialModel, "gpt-image-2");
    if (service === "gateway") assert.equal(result.workspace.props.initialCategory, "image");
  }
});

test("legacy playground URLs keep gateway behaviour and malformed service selectors cannot choose another builder", async () => {
  for (const service of [undefined, "unknown", "constructor", ["studio", "selected"]]) {
    const { workspace, locale } = await render({ service, model: "gemini-3.8-flash", category: "text" });
    assert.equal(workspace.type, components.Playground);
    assert.equal(workspace.props.initialModel, "gemini-3.8-flash");
    assert.equal(workspace.props.initialCategory, "text");
    assert.equal(locale, "zh");
  }
});

test("the workspace login return URL includes selection and language without copying arbitrary query data", async () => {
  const result = await render({ service: "studio", model: "deepseek-v3.2", category: "text", lang: "en", access_token: "secret", password: "private", next: "//example.invalid" });
  assert.equal(result.next, "/playground?service=studio&model=deepseek-v3.2&category=text&lang=en");
});
