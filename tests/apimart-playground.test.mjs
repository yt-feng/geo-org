import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

const filename = new URL("../components/Playground.tsx", import.meta.url).pathname;
const code = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const catalog = {
  modelCatalog: [{ id: "gpt-image-2", name: "GPT Image 2", provider: "OPENAI", category: "image" }],
  modelCategories: [{ id: "image", label: "图片", icon: "image" }], providerInitials: () => "O",
};
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
function find(node, predicate) {
  if (Array.isArray(node)) { for (const item of node) { const result = find(item, predicate); if (result) return result; } }
  else if (node?.props) { if (predicate(node)) return node; return find(node.props.children, predicate); }
  return null;
}
async function fixture(options = {}) {
  const hooks = [], effects = [], calls = []; let cursor = 0, tree;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
      return [hooks[index].value, value => { hooks[index].value = typeof value === "function" ? value(hooks[index].value) : value; }];
    },
    useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++, previous = hooks[index];
      if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) {
        hooks[index] = { deps }; effects.push(effect);
      }
    },
  };
  const compiled = { exports: {} };
  vm.runInNewContext(code, {
    module: compiled, exports: compiled.exports, crypto: webcrypto, URL, setTimeout: () => 1, clearTimeout() {},
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/link") return { default: "a" };
      if (name === "./Icon") return { Icon: () => null };
      if (name === "@/lib/model-catalog") return catalog;
      throw Error(`Unexpected dependency ${name}`);
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url === "/api/pricing") return Response.json({ models: [{ provider: "apimart", model: "gpt-image-2", rates: [{ dimension: "2k", unit: "image", retailMicrousd: 18000 }] }] });
      if (url === "/api/apimart/v1/tasks") return Response.json({ data: [] });
      if (url === "/api/pricing/quote") return options.quote ? options.quote(url, init) : Response.json({ provider: "apimart", model: "gpt-image-2", mode: "image", currency: "USD", reservedMicrousd: 18000, observedAt: "2026-10-20T00:00:00Z" });
      return options.generate ? options.generate(url, init) : Response.json({ data: [{ task_id: "new_task", status: "submitted" }] });
    },
  }, { filename });
  function render() {
    cursor = 0; tree = compiled.exports.Playground({ isAdmin: false });
    for (const effect of effects.splice(0)) effect();
    return tree;
  }
  async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
  function prompt(value) { find(tree, node => node.type === "textarea").props.onChange({ target: { value } }); render(); }
  const primary = () => find(tree, node => node.type === "button" && node.props.className === "playground-run");
  render(); await flush(); render(); prompt("A tree in morning light");
  return { calls, render, flush, prompt, primary, tree: () => tree };
}

test("APIMart requires a displayed exact quote before confirming a paid request with the same body and cap", async () => {
  const f = await fixture();
  assert.equal(text(f.primary()), "获取准确报价");
  await f.primary().props.onClick(); f.render();
  assert.equal(f.calls.filter(call => call.url.includes("images/generations")).length, 0);
  assert.match(text(f.tree()), /本次预留 \$0\.018000/);
  assert.match(text(f.primary()), /确认预留 \$0\.018000 并生成/);
  await f.primary().props.onClick(); f.render();
  const quote = f.calls.find(call => call.url === "/api/pricing/quote");
  const paid = f.calls.find(call => call.url.includes("images/generations"));
  assert.deepEqual(JSON.parse(paid.init.body), JSON.parse(quote.init.body).body);
  assert.equal(paid.init.headers["X-Tokvilo-Max-Reserve-Microusd"], "18000");
  assert.ok(paid.init.headers["Idempotency-Key"]);
  assert.equal(text(f.primary()), "获取准确报价");
});

test("changing a quoted request invalidates its confirmation and never submits the changed body at the old quote", async () => {
  const f = await fixture();
  await f.primary().props.onClick(); f.render();
  f.prompt("A completely different picture");
  assert.equal(text(f.primary()), "获取准确报价");
  assert.doesNotMatch(text(f.tree()), /本次预留/);
  await f.primary().props.onClick(); f.render();
  assert.equal(f.calls.filter(call => call.url.includes("images/generations")).length, 0);
  assert.equal(JSON.parse(f.calls.filter(call => call.url === "/api/pricing/quote")[1].init.body).body.prompt, "A completely different picture");
});

test("an asynchronously returned quote cannot confirm a body edited while pricing was loading", async () => {
  let resolve;
  const f = await fixture({ quote: async () => new Promise(done => { resolve = done; }) });
  const pending = f.primary().props.onClick();
  f.prompt("Edited while waiting");
  resolve(Response.json({ provider: "apimart", model: "gpt-image-2", currency: "USD", reservedMicrousd: 18000 }));
  await pending; f.render();
  assert.equal(text(f.primary()), "获取准确报价");
  assert.equal(f.calls.filter(call => call.url.includes("images/generations")).length, 0);
});

test("a server price increase clears the confirmation and requires a fresh quote", async () => {
  const f = await fixture({ generate: async () => Response.json({ error: { code: "reservation_limit_exceeded", message: "请重新报价" } }, { status: 409 }) });
  await f.primary().props.onClick(); f.render();
  await f.primary().props.onClick(); f.render();
  assert.equal(text(f.primary()), "获取准确报价");
  assert.match(text(f.tree()), /请重新报价/);
  await f.primary().props.onClick(); f.render();
  assert.equal(f.calls.filter(call => call.url.includes("images/generations")).length, 1);
  assert.equal(f.calls.filter(call => call.url === "/api/pricing/quote").length, 2);
});
