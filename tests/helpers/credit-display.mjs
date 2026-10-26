import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const filename = new URL(path, import.meta.url).pathname;
  const code = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require(name) {
    if (name === "react/jsx-runtime") return jsx;
    if (dependencies[name]) return dependencies[name];
    throw new Error(`Unexpected credit display dependency ${name}`);
  } }, { filename });
  return compiledModule.exports;
}
export const credits = await load("../../lib/credits.ts");
export const billingSummary = await load("../../components/PlaygroundBillingSummary.tsx", { "@/lib/credits": credits });
