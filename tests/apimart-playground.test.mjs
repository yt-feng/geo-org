import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import { brandDisplay } from "./helpers/brand-display.mjs";

const optionsSource = ts.transpileModule(await readFile(new URL("../lib/apimart-video-options.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const optionsModule = { exports: {} }; vm.runInNewContext(optionsSource, { module: optionsModule, exports: optionsModule.exports });
const filename = new URL("../components/Playground.tsx", import.meta.url).pathname;
const code = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const catalog = {
  modelCatalog: [{ id: "gpt-image-2", name: "GPT Image 2", provider: "OPENAI", category: "image" }],
  modelCategories: [{ id: "image", label: "图片", icon: "image" }, { id: "video", label: "视频", icon: "video" }, { id: "audio", label: "音乐", icon: "music" }], providerInitials: () => "O",
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
      if (name === "@/lib/apimart-video-options") return optionsModule.exports;
      if (name === "@/lib/brand-display") return brandDisplay;
      if (name === "./LocaleProvider") return { useSiteLocale: () => ({ isEnglish: options.english === true, t: (zh, en) => options.english ? en : zh, href: path => options.english ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path }) };
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/link") return { default: "a" };
      if (name === "./Icon") return { Icon: () => null };
      if (name === "@/lib/model-catalog") return options.initialCatalog ? { ...catalog, modelCatalog: options.initialCatalog } : catalog;
      if (name === "@/lib/price-copy") return { englishPriceText: value => value };
      throw Error(`Unexpected dependency ${name}`);
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url === "/api/model-catalog" && options.directoryRequest) return options.directoryRequest();
      if (url === "/api/model-catalog") return Response.json({ models: options.models || catalog.modelCatalog.map(model => ({ ...model, upstream: "apimart" })) });
      if (url === "/api/pricing" && options.pricingRequest) return options.pricingRequest();
      if (url === "/api/pricing") return Response.json({ models: options.prices || [{ provider: "apimart", model: "gpt-image-2", kind: "image", billingReady: true, rates: [{ dimension: "2k", unit: "image", retailMicrousd: 18000 }] }] });
      if (url === "/api/gateway/v1/tasks") return Response.json({ data: [] });
      if (url === "/api/pricing/quote") return options.quote ? options.quote(url, init) : Response.json({ provider: "apimart", model: "gpt-image-2", mode: "image", currency: "USD", reservedMicrousd: 18000, observedAt: "2026-10-20T00:00:00Z" });
      return options.generate ? options.generate(url, init) : Response.json({ data: [{ task_id: "new_task", status: "submitted" }] });
    },
  }, { filename });
  function render() {
    cursor = 0; tree = compiled.exports.Playground({ isAdmin: false, ...options.props });
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
  assert.doesNotMatch(text(f.tree()), /源价|源头|加价|上游价格|20\s*%|×\s*1\.20/);
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

for (const mode of ["video", "audio"]) test(`dynamic ${mode} models preserve exact parameters through quote then confirmation`, async () => {
  const id = mode === "video" ? "veo3.1-fast" : "flowmusic";
  const f = await fixture({ props: { initialModel: id, initialCategory: mode },
    models: [{ id, name: "Dynamic model", provider: "MODEL", category: mode, upstream: "apimart" }],
    prices: [{ provider: "apimart", model: id, kind: mode, billingReady: true, rates: [{ dimension: "default", unit: mode === "video" ? "second" : "call", retailMicrousd: 12000 }] }],
    quote: async (_url, init) => { const input = JSON.parse(init.body); assert.equal(input.mode, mode); return Response.json({ provider: "apimart", model: id, currency: "USD", reservedMicrousd: 96000 }); },
  });
  assert.equal(f.primary().props.disabled, false);
  assert.ok(find(f.tree(), node => node.type === "option" && node.props.value === id));
  await f.primary().props.onClick(); f.render();
  await f.primary().props.onClick(); f.render();
  const quoted = JSON.parse(f.calls.find(call => call.url === "/api/pricing/quote").init.body).body;
  const paid = f.calls.find(call => call.url.includes(mode === "video" ? "/videos/generations" : "/music/generations"));
  assert.deepEqual(JSON.parse(paid.init.body), quoted);
  if (mode === "video") { assert.equal(quoted.duration, 8); assert.equal(quoted.resolution, "720p"); }
  else { assert.equal(quoted.sound_prompt, "A tree in morning light"); assert.equal(quoted.prompt, undefined); }
});

test("advanced JSON is the sole quoted payload and edits invalidate the confirmation", async () => {
  const f = await fixture();
  find(f.tree(), node => node.type === "button" && text(node) === "编辑完整 JSON 参数").props.onClick(); f.render();
  const edit = body => { find(f.tree(), node => node.props["aria-label"] === "完整 JSON 参数").props.onChange({ target: { value: JSON.stringify(body) } }); f.render(); };
  edit({ model: "gpt-image-2", prompt: "From JSON", resolution: "4k", n: 1 });
  await f.primary().props.onClick(); f.render();
  assert.equal(JSON.parse(f.calls.find(call => call.url === "/api/pricing/quote").init.body).body.prompt, "From JSON");
  edit({ model: "gpt-image-2", prompt: "Changed JSON", resolution: "2k" });
  assert.equal(text(f.primary()), "获取准确报价");
  assert.doesNotMatch(text(f.tree()), /本次预留/);
  edit({ model: "wrong", prompt: "No" });
  assert.equal(f.primary().props.disabled, true);
});

test("priced discovery without a completed billing adapter stays disabled", async () => {
  const f = await fixture({ prices: [{ provider: "apimart", model: "gpt-image-2", kind: "image", billingReady: false, rates: [] }] });
  assert.equal(f.primary().props.disabled, true);
  await f.primary().props.onClick();
  assert.equal(f.calls.some(call => call.url === "/api/pricing/quote"), false);
});

test("video model selection uses legal defaults and requires reference images for image-only models", async () => {
  for (const id of ["MiniMax-H3", "MiniMax-Hailuo-02", "MiniMax-Hailuo-2.3", "kling-v2-6", "wan2.6-i2v-flash", "wan2.7-r2v"]) {
    const defaults = optionsModule.exports.VIDEO_DEFAULTS[id];
    const f = await fixture({ props: { initialModel: id, initialCategory: "video" },
      models: [{ id, name: id, provider: "MODEL", category: "video", upstream: "apimart" }],
      prices: [{ provider: "apimart", model: id, kind: "video", billingReady: true, rates: [{ dimension: "default", unit: "second", retailMicrousd: 12000 }] }],
    });
    if (defaults.referenceRequired) {
      assert.equal(f.primary().props.disabled, true);
      const reference = find(f.tree(), node => node.props["aria-label"] === "视频参考图片 URL");
      reference.props.onChange({ target: { value: "https://example.com/first.png" } }); f.render();
    }
    assert.equal(f.primary().props.disabled, false);
    await f.primary().props.onClick();
    const body = JSON.parse(f.calls.find(call => call.url === "/api/pricing/quote").init.body).body;
    assert.ok(defaults.durations.includes(body.duration), id);
    if (defaults.mode) assert.ok(defaults.modes.includes(body.mode), id);
    else assert.ok(defaults.resolutions.includes(body.resolution), id);
    if (id === "wan2.7-r2v") {
      assert.equal(body.image_urls, undefined);
      assert.deepEqual(body.image_with_roles, [{ url: "https://example.com/first.png", role: "reference_image" }]);
    }
  }
});

test("Midjourney displays one task and its default price, while image quality choices follow available prices", async () => {
  const f = await fixture({ props: { initialModel: "midjourney", initialCategory: "image" },
    models: [{ id: "midjourney", name: "Midjourney", provider: "MIDJOURNEY", category: "image", upstream: "apimart" }],
    prices: [{ provider: "apimart", model: "midjourney", kind: "image", billingReady: true, rates: [
      { dimension: "imagine-v7", unit: "call", retailMicrousd: 12000 },
      { dimension: "imagine-v7-turbo", unit: "call", retailMicrousd: 24000 },
    ] }],
  });
  assert.match(text(f.tree()), /1 个任务.*四宫格/); assert.doesNotMatch(text(f.tree()), /imagine-v7-turbo/);
  const quality = await fixture({ prices: [{ provider: "apimart", model: "gpt-image-2", kind: "image", billingReady: true, rates: [
    { dimension: "1k@low", unit: "image", retailMicrousd: 12000 }, { dimension: "1k@medium", unit: "image", retailMicrousd: 24000 },
  ] }] });
  const selector = find(quality.tree(), node => node.props["aria-label"] === "图片质量");
  assert.match(text(selector), /lowmedium/); assert.doesNotMatch(text(selector), /high/);
});

test("English model playground translates controls without rewriting the prompt, output or quote", async () => {
  const f = await fixture({ english: true, generate: async () => Response.json({ choices: [{ message: { content: "原始中文输出" } }] }) });
  assert.doesNotMatch(text(f.tree()), /[\u4e00-\u9fff]/);
  f.prompt("原样保留中文提示词");
  await f.primary().props.onClick(); f.render();
  assert.match(text(f.primary()), /Reserve \$0\.018000 & generate/);
  await f.primary().props.onClick(); f.render();
  const quote = JSON.parse(f.calls.find(call => call.url === "/api/pricing/quote").init.body);
  const paid = f.calls.find(call => call.url.includes("images/generations"));
  assert.deepEqual(JSON.parse(paid.init.body), quote.body);
  assert.equal(JSON.parse(paid.init.body).prompt, "原样保留中文提示词");
  assert.match(text(f.tree()), /原始中文输出/);
});

const defaultModels = [
  { id: "dall-e-3", name: "DALL-E 3", category: "image", upstream: "apimart", provider: "OPENAI" },
  { id: "gpt-image-2", name: "GPT Image 2", category: "image", upstream: "apimart", provider: "OPENAI" },
  { id: "veo3.1-fast", name: "Veo", category: "video", upstream: "apimart", provider: "GOOGLE" },
];
const defaultPrices = [
  { provider: "apimart", model: "dall-e-3", kind: "image", billingReady: false, rates: [] },
  { provider: "apimart", model: "gpt-image-2", kind: "image", billingReady: true, rates: [{ dimension: "2k", unit: "image", retailMicrousd: 18000 }] },
];
const selectedModel = f => find(f.tree(), node => node.props["aria-label"] === "选择模型").props.value;
test("plain playground initially selects the first billing-ready model instead of an unavailable catalogue entry", async () => {
  for (const deferredDirectory of [false, true]) {
    let finishDirectory;
    const f = await fixture({ initialCatalog: [defaultModels[0]], models: defaultModels, prices: defaultPrices,
      ...(deferredDirectory ? { directoryRequest: () => new Promise(resolve => { finishDirectory = resolve; }) } : {}) });
    if (deferredDirectory) { assert.equal(selectedModel(f), "dall-e-3"); finishDirectory(Response.json({ models: defaultModels })); await f.flush(); f.render(); }
    assert.equal(selectedModel(f), "gpt-image-2");
    assert.equal(f.primary().props.disabled, false);
    assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  }
});
test("an explicit unavailable model deep link is preserved", async () => {
  const f = await fixture({ initialCatalog: defaultModels, models: defaultModels, prices: defaultPrices, props: { initialModel: "dall-e-3", initialCategory: "image" } });
  assert.equal(selectedModel(f), "dall-e-3");
  assert.equal(f.primary().props.disabled, true);
});
test("late pricing cannot overwrite a user model, custom ID or category selection", async () => {
  for (const selection of ["model", "custom", "category"]) {
    let finishPricing;
    const f = await fixture({ initialCatalog: defaultModels, models: defaultModels, pricingRequest: () => new Promise(resolve => { finishPricing = resolve; }) });
    if (selection === "model") find(f.tree(), node => node.props["aria-label"] === "选择模型").props.onChange({ target: { value: "dall-e-3" } });
    else if (selection === "custom") find(f.tree(), node => node.props.placeholder === "填写模型 ID").props.onChange({ target: { value: "custom-model-id" } });
    else find(f.tree(), node => node.type === "button" && node.props.role === "tab" && text(node) === "视频").props.onClick();
    f.render();
    finishPricing(Response.json({ models: defaultPrices })); await f.flush(); f.render();
    const id = find(f.tree(), node => node.props.placeholder === "填写模型 ID").props.value;
    assert.equal(id, selection === "model" ? "dall-e-3" : selection === "custom" ? "custom-model-id" : "veo3.1-fast");
    assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  }
});
