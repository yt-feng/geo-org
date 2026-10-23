import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import { brandDisplay } from "./helpers/brand-display.mjs";

const filename = new URL("../components/TokenHubPlayground.tsx", import.meta.url).pathname;
const code = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const content = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(content).join("") : value?.props ? content(value.props.children) : "";
function find(node, predicate) {
  if (Array.isArray(node)) { for (const item of node) { const found = find(item, predicate); if (found) return found; } }
  else if (node?.props) { if (predicate(node)) return node; return find(node.props.children, predicate); }
  return null;
}
async function fixture(options = {}) {
  const hooks = [], effects = [], calls = []; let cursor = 0, tree;
  const react = {
    useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial }; return [hooks[index].value, value => { hooks[index].value = typeof value === "function" ? value(hooks[index].value) : value; }]; },
    useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial }; },
    useMemo(compute, deps) { const index = cursor++, previous = hooks[index]; if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) hooks[index] = { deps, value: compute() }; return hooks[index].value; },
    useEffect(effect, deps) { const index = cursor++, previous = hooks[index]; if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) { previous?.cleanup?.(); hooks[index] = { deps }; effects.push(() => { hooks[index].cleanup = effect(); }); } },
  };
  const compiled = { exports: {} };
  vm.runInNewContext(code, {
    module: compiled, exports: compiled.exports, crypto: webcrypto, URL, URLSearchParams, AbortController, TextEncoder,
    window: { location: { search: "" } }, setTimeout: () => 1, clearTimeout() {},
    require(name) {
      if (name === "@/lib/brand-display") return brandDisplay;
      if (name === "./LocaleProvider") return { useSiteLocale: () => ({ isEnglish: options.english === true, t: (zh, en) => options.english ? en : zh, href: path => options.english ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path }) };
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/link") return { default: "a" };
      if (name === "next/image") return { default: "img" };
      if (name === "./Icon") return { Icon: () => null };
      throw new Error(`Unexpected dependency ${name}`);
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url === "/api/studio/v1/models") return Response.json({ data: [
        { id: "dreamina-seedance-2-0-260128", modelType: "video", category: ["video"] },
        { id: "dola-seedream-5-0-pro-260628", modelType: "image", category: ["image"] },
        { id: "chat-model", modelType: "chat", category: ["chat"] },
      ], catalog: { complete: true } });
      if (url === "/api/pricing/quote") return options.quote ? options.quote(url, init) : Response.json({ reservedMicrousd: 2_000_000 });
      if (init?.method === "POST") return options.generate ? options.generate(url, init) : Response.json(url.includes("/images/") ? { data: [{ url: "https://media.example/image.png" }] } : { id: "video-created", status: "queued" });
      throw new Error(`Unexpected request ${url}`);
    },
  }, { filename });
  function render() { cursor = 0; tree = compiled.exports.TokenHubPlayground({ isAdmin: false }); for (const effect of effects.splice(0)) effect(); return tree; }
  async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
  const primary = () => find(tree, node => node.type === "button" && node.props.className === "playground-run");
  function prompt(value) { find(tree, node => node.props["aria-label"] === (options.english ? "tokvilo Multimodal prompt" : "tokvilo 多模态 提示词")).props.onChange({ target: { value } }); render(); }
  function mode(value) { const name = (options.english ? { video: "Video", image: "Image", chat: "Chat" } : { video: "视频", image: "图像", chat: "对话" })[value]; find(tree, node => node.type === "button" && node.props.role === "tab" && content(node).startsWith(name)).props.onClick(); render(); }
  function advanced(body) { const toggle = find(tree, node => String(node.props.className || "").includes("tokenhub-advanced-toggle")); if (!toggle.props["aria-pressed"]) { toggle.props.onClick(); render(); } find(tree, node => node.props["aria-label"] === (options.english ? "tokvilo Multimodal JSON request" : "tokvilo 多模态 JSON 请求")).props.onChange({ target: { value: JSON.stringify(body, null, 2) } }); render(); }
  render(); await flush(); render(); prompt("A peaceful forest");
  return { calls, render, flush, primary, prompt, mode, advanced, tree: () => tree, paid: () => calls.filter(call => call.init?.method === "POST" && call.url !== "/api/pricing/quote") };
}
test("TokenHub separates quoting from confirmation and sends the exact confirmed body and reserve ceiling", async () => {
  const f = await fixture();
  assert.equal(content(f.primary()), "查看预留金额");
  await f.primary().props.onClick(); f.render();
  assert.equal(f.paid().length, 0); assert.match(content(f.tree()), /本次最多预留 \$2\.000000/);
  assert.doesNotMatch(content(f.tree()), /源价|源头|加价|上游价格|20\s*%|×\s*1\.20/);
  assert.equal(content(f.primary()), "确认并生成");
  await f.primary().props.onClick(); f.render();
  const quoted = JSON.parse(f.calls.find(call => call.url === "/api/pricing/quote").init.body);
  assert.deepEqual(JSON.parse(f.paid()[0].init.body), quoted.body);
  assert.equal(f.paid()[0].init.headers["X-Tokvilo-Max-Reserve-Microusd"], "2000000");
  assert.ok(f.paid()[0].init.headers["Idempotency-Key"]);
  assert.equal(content(f.primary()), "查看预留金额");
});
test("editing the prompt or changing model mode invalidates an existing confirmation", async () => {
  const f = await fixture();
  await f.primary().props.onClick(); f.render(); f.prompt("A different forest");
  assert.equal(content(f.primary()), "查看预留金额"); assert.doesNotMatch(content(f.tree()), /本次最多预留/);
  await f.primary().props.onClick(); f.render(); f.mode("image");
  assert.equal(content(f.primary()), "查看预留金额");
  await f.primary().props.onClick(); f.render();
  assert.equal(f.paid().length, 0);
  assert.equal(JSON.parse(f.calls.filter(call => call.url === "/api/pricing/quote").at(-1).init.body).mode, "image");
});
test("a quote returned after a body edit cannot authorize the edited body", async () => {
  let finish;
  const f = await fixture({ quote: async () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.primary().props.onClick();
  f.prompt("Changed while quote was pending");
  finish(Response.json({ reservedMicrousd: 2_000_000 }));
  await pending; f.render();
  assert.equal(content(f.primary()), "查看预留金额");
  assert.doesNotMatch(content(f.tree()), /本次最多预留/); assert.equal(f.paid().length, 0);
});
test("two confirmation events while generation is in flight send only one paid request", async () => {
  let finish;
  const f = await fixture({ generate: async () => new Promise(resolve => { finish = resolve; }) });
  await f.primary().props.onClick(); f.render();
  const handler = f.primary().props.onClick, pending = handler();
  await handler();
  assert.equal(f.paid().length, 1);
  finish(Response.json({ id: "only-once", status: "queued" })); await pending; f.render();
});
test("repricing clears confirmation and retains the idempotency key for the same request", async () => {
  let attempts = 0, quotes = 0;
  const f = await fixture({
    quote: async () => Response.json({ reservedMicrousd: ++quotes * 2_000_000 }),
    generate: async () => ++attempts === 1 ? Response.json({ error: { message: "请重新获取报价后提交。" } }, { status: 409 }) : Response.json({ id: "repriced", status: "queued" }),
  });
  await f.primary().props.onClick(); f.render(); await f.primary().props.onClick(); f.render();
  assert.equal(content(f.primary()), "查看预留金额"); assert.match(content(f.tree()), /重新获取报价/);
  await f.primary().props.onClick(); f.render(); assert.equal(f.paid().length, 1);
  await f.primary().props.onClick(); f.render();
  assert.equal(f.paid()[0].init.headers["Idempotency-Key"], f.paid()[1].init.headers["Idempotency-Key"]);
  assert.equal(f.paid()[1].init.headers["X-Tokvilo-Max-Reserve-Microusd"], "4000000");
});
test("changing interface mode creates a different idempotency identity even for identical advanced JSON", async () => {
  const f = await fixture({ generate: async () => Response.json({ error: { message: "结果暂未确认" } }, { status: 502 }) });
  const body = { model: "multi-model", prompt: "A forest", content: [{ type: "text", text: "A forest" }] };
  f.advanced(body); await f.primary().props.onClick(); f.render(); await f.primary().props.onClick(); f.render();
  f.mode("image"); f.advanced(body); await f.primary().props.onClick(); f.render(); await f.primary().props.onClick(); f.render();
  assert.equal(f.paid().length, 2);
  assert.equal(f.paid()[0].init.body, f.paid()[1].init.body);
  assert.notEqual(f.paid()[0].init.headers["Idempotency-Key"], f.paid()[1].init.headers["Idempotency-Key"]);
  assert.notEqual(f.paid()[0].url, f.paid()[1].url);
});

test("English multimodal controls retain exact Chinese user content and billing confirmation", async () => {
  const f = await fixture({ english: true, generate: async () => Response.json({ choices: [{ message: { content: "原始中文回复" } }] }) });
  assert.doesNotMatch(content(f.tree()), /[\u4e00-\u9fff]/);
  f.mode("chat"); f.prompt("保留中文用户输入");
  await f.primary().props.onClick(); f.render();
  assert.equal(content(f.primary()), "Confirm & generate");
  await f.primary().props.onClick(); f.render();
  const quoted = JSON.parse(f.calls.find(call => call.url === "/api/pricing/quote").init.body);
  assert.deepEqual(JSON.parse(f.paid()[0].init.body), quoted.body);
  assert.equal(JSON.parse(f.paid()[0].init.body).messages[0].content, "保留中文用户输入");
  assert.match(content(f.tree()), /原始中文回复/);
});
