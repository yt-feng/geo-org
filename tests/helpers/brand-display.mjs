import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const filename = new URL("../../lib/brand-display.ts", import.meta.url).pathname;
const compiledModule = { exports: {} };
const code = ts.transpileModule(await readFile(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports }, { filename });
export const brandDisplay = compiledModule.exports;
