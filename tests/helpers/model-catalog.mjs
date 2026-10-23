import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

async function load(path, mocks = {}) {
  const file = new URL(path, import.meta.url), compiledModule = { exports: {} };
  const code = ts.transpileModule(await readFile(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: name => {
    if (name in mocks) return mocks[name];
    throw Error(`Unexpected dependency ${name}`);
  } });
  return compiledModule.exports;
}
export const catalog = await load("../../lib/model-catalog.ts", {
  "./tokenhub-model-reference": await load("../../lib/tokenhub-model-reference.ts"),
  "./model-id": await load("../../lib/model-id.ts"),
  "./model-request-kind": await load("../../lib/model-request-kind.ts"),
  "./model-directory-snapshot.json": { default: JSON.parse(await readFile(new URL("../../lib/model-directory-snapshot.json", import.meta.url), "utf8")) },
});
