import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

const filename = new URL("../components/SelectedPlayground.tsx", import.meta.url).pathname;
const code = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";
function find(node, predicate) {
  if (Array.isArray(node)) { for (const item of node) { const result = find(item, predicate); if (result) return result; } }
  else if (node?.props) { if (predicate(node)) return node; return find(node.props.children, predicate); }
  return null;
}
async function fixture(options = {}) {
  const hooks = [], effects = [], calls = []; let cursor = 0, tree;
  const model = options.model || "same-model", kind = options.kind || "chat";
  const react = {
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { value: initial }; return [hooks[i].value, value => { hooks[i].value = typeof value === "function" ? value(hooks[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useEffect(effect) { const i = cursor++; if (!(i in hooks)) { hooks[i] = {}; effects.push(effect); } },
  };
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, crypto: webcrypto, URL,
    require(name) { if (name === "./LocaleProvider") return { useSiteLocale: () => ({ isEnglish: options.english === true, t: (zh, en) => options.english ? en : zh, href: path => options.english ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path }) }; if (name === "react") return react; if (name === "react/jsx-runtime") return jsx; if (name === "next/link") return { default: "a" }; if (name === "./PriceTable") return { PriceTable: () => null }; throw Error(name); },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url === "/api/pricing") return Response.json({ models: [
        { provider: "apimart", model, name: "Other service model", kind, billingReady: true },
        { provider: "selected", model, name: "Selected model", kind, billingReady: options.ready !== false },
      ] });
      if (url === "/api/pricing/quote") return options.quote ? options.quote(url, init) : Response.json({ provider: "selected", model, mode: kind, currency: "USD", reservedMicrousd: 12000 });
      if (url === "/api/selected/v1/requests") return options.history ? options.history(url, init) : Response.json({ data: [] });
      if (url.startsWith("/api/selected/v1/requests/")) return options.receipt ? options.receipt(url, init) : Response.json({ choices: [{ message: { content: "Recovered result" } }], tokvilo_billing: { status: "settled", chargedMicrousd: 3000 } });
      return options.generate ? options.generate(url, init) : Response.json({ choices: [{ message: { content: "Finished" } }], tokvilo_billing: { status: "settled", chargedMicrousd: 3000 } });
    },
  }, { filename });
  function render() { cursor = 0; tree = mod.exports.SelectedPlayground({ initialModel: model }); for (const effect of effects.splice(0)) effect(); return tree; }
  async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  const prompt = value => { find(tree, node => node.props["aria-label"] === (options.english ? "Select prompt" : "精选提示词")).props.onChange({ target: { value } }); render(); };
  const primary = () => find(tree, node => node.props.className === "playground-run");
  render(); await flush(); render(); prompt("Explain this model");
  return { calls, render, flush, prompt, primary, tree: () => tree };
}

for (const kind of ["chat", "image"]) test(`selected ${kind} displays quote then submits precisely that request to its own service`, async () => {
  const f = await fixture({ kind });
  assert.doesNotMatch(text(f.tree()), /Other service model|rkapi|源价|加价/i);
  assert.equal(f.primary().props.disabled, false);
  await f.primary().props.onClick(); f.render();
  assert.match(text(f.primary()), /确认预留 \$0\.012000/);
  assert.equal(f.calls.filter(call => call.url.startsWith("/api/selected/") && call.init?.method === "POST").length, 0);
  await f.primary().props.onClick(); f.render();
  const quoted = JSON.parse(f.calls.find(call => call.url === "/api/pricing/quote").init.body);
  const sent = f.calls.find(call => call.url.startsWith("/api/selected/") && call.init?.method === "POST");
  assert.equal(quoted.provider, "selected"); assert.equal(quoted.mode, kind);
  assert.equal(sent.url, kind === "chat" ? "/api/selected/v1/chat/completions" : "/api/selected/v1/images/generations");
  assert.deepEqual(JSON.parse(sent.init.body), quoted.body);
  assert.equal(sent.init.headers["X-Tokvilo-Max-Reserve-Microusd"], "12000");
  assert.ok(sent.init.headers["Idempotency-Key"]);
  if (kind === "image") assert.deepEqual(quoted.body, { model: "same-model", prompt: "Explain this model", size: "1024x1024", n: 1 });
  else assert.equal(quoted.body.max_tokens, 1024);
});

test("a model available in another service cannot activate an unverified selected route", async () => {
  const f = await fixture({ ready: false });
  assert.equal(f.primary().props.disabled, true);
  assert.match(text(f.tree()), /价格已列示，服务待开通/);
  await f.primary().props.onClick();
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
});

test("changing the request or receiving a stale quote cannot submit using an older reservation", async () => {
  const f = await fixture();
  await f.primary().props.onClick(); f.render();
  f.prompt("Another task");
  assert.equal(text(f.primary()), "获取准确报价");
  assert.doesNotMatch(text(f.tree()), /本次预留/);
  let resolve;
  const delayed = await fixture({ quote: () => new Promise(done => { resolve = done; }) });
  const request = delayed.primary().props.onClick();
  delayed.prompt("Changed during quote");
  resolve(Response.json({ provider: "selected", model: "same-model", mode: "chat", currency: "USD", reservedMicrousd: 12000 }));
  await request; delayed.render();
  assert.equal(text(delayed.primary()), "获取准确报价");
  assert.equal(delayed.calls.filter(call => call.url.startsWith("/api/selected/") && call.init?.method === "POST").length, 0);
});

test("uncertain selected responses preserve the same idempotency key when retrying identical content", async () => {
  const f = await fixture({ generate: async () => Response.json({ error: { message: "结果尚待核对。" } }, { status: 502 }) });
  await f.primary().props.onClick(); f.render();
  await f.primary().props.onClick(); f.render();
  await f.primary().props.onClick(); f.render();
  const calls = f.calls.filter(call => call.url.startsWith("/api/selected/") && call.init?.method === "POST");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers["Idempotency-Key"], calls[1].init.headers["Idempotency-Key"]);
  assert.equal(calls[0].init.body, calls[1].init.body);
});

test("a selected reserve increase invalidates confirmation before another paid request", async () => {
  const f = await fixture({ generate: async () => Response.json({ error: { code: "reservation_limit_exceeded", message: "请重新获取报价。" } }, { status: 409 }) });
  await f.primary().props.onClick(); f.render();
  await f.primary().props.onClick(); f.render();
  assert.equal(text(f.primary()), "获取准确报价");
  await f.primary().props.onClick(); f.render();
  assert.equal(f.calls.filter(call => call.url.startsWith("/api/selected/") && call.init?.method === "POST").length, 1);
});

test("an in-flight request exposes its ID and an HTTP error preserves billing plus GET-only recovery", async () => {
  let finish;
  const f = await fixture({ generate: () => new Promise(resolve => { finish = resolve; }), receipt: async () => Response.json({ error: { message: "此请求结果尚待核对。" }, tokvilo_billing: { status: "awaiting_reconciliation", reservedMicrousd: 12000, chargedMicrousd: null } }, { status: 409 }) });
  await f.primary().props.onClick(); f.render();
  const generating = f.primary().props.onClick(); f.render();
  const sent = f.calls.find(call => call.url.endsWith("/chat/completions"));
  const id = sent.init.headers["Idempotency-Key"];
  assert.ok(text(f.tree()).includes(id), "ID must be visible before the response arrives");
  assert.equal(find(f.tree(), node => node.type === "button" && text(node) === "查询此请求").props.disabled, true);
  finish(Response.json({ error: { message: "结果尚待核对。" }, tokvilo_billing: { status: "awaiting_reconciliation", reservedMicrousd: 12000 } }, { status: 502 }));
  await generating; f.render();
  assert.match(text(f.tree()), /awaiting_reconciliation/);
  assert.match(text(f.tree()), /reservedMicrousd/);
  const posts = f.calls.filter(call => call.init?.method === "POST").length;
  await find(f.tree(), node => node.type === "button" && text(node) === "查询此请求").props.onClick(); f.render();
  const read = f.calls.at(-1);
  assert.equal(read.url, `/api/selected/v1/requests/${id}`);
  assert.equal(read.init.method, "GET");
  assert.equal(read.init.body, undefined);
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, posts);
  assert.ok(text(f.tree()).includes(id));
  assert.match(text(f.tree()), /此请求结果尚待核对/);
  assert.match(text(f.tree()), /chargedMicrousd/);
  // Querying an unresolved receipt must not replace the original generation ID.
  const retry = f.primary().props.onClick();
  const retried = f.calls.at(-1);
  assert.equal(retried.init.headers["Idempotency-Key"], id);
  finish(Response.json({ error: { message: "仍在核对。" } }, { status: 502 }));
  await retry;
});

test("a fresh page loads account request history and retrieves a previous result without generation", async () => {
  const id = "older_request_001";
  const f = await fixture({ history: async () => Response.json({ data: [{ id, model: "older-model", state: "completed", created_at: "2026-10-20 10:00:00" }] }) });
  assert.equal(f.calls.find(call => call.url === "/api/selected/v1/requests").init.method, "GET");
  assert.match(text(f.tree()), /older-model · 已完成/);
  await find(f.tree(), node => node.props["aria-label"] === `查询请求 ${id}`).props.onClick(); f.render();
  assert.equal(f.calls.at(-1).url, `/api/selected/v1/requests/${id}`);
  assert.equal(f.calls.at(-1).init.method, "GET");
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  assert.match(text(f.tree()), /Recovered result/);
  assert.ok(text(f.tree()).includes(id));
});

test("history failure can be retried independently and never submits the prompt", async () => {
  let attempts = 0;
  const f = await fixture({ history: async () => ++attempts === 1 ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json({ data: [] }) });
  assert.match(text(f.tree()), /最近请求暂时无法加载/);
  await find(f.tree(), node => node.type === "button" && text(node) === "刷新记录").props.onClick(); f.render();
  assert.equal(attempts, 2);
  assert.match(text(f.tree()), /暂无请求记录/);
  assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
});

test("successful content awaiting billing reconciliation retains its original request ID", async () => {
  const f = await fixture({ generate: async () => Response.json({ choices: [{ message: { content: "Output saved" } }], tokvilo_billing: { status: "awaiting_reconciliation" } }) });
  await f.primary().props.onClick(); f.render();
  await f.primary().props.onClick(); f.render();
  await f.primary().props.onClick(); f.render();
  await f.primary().props.onClick(); f.render();
  const calls = f.calls.filter(call => call.url.endsWith("/chat/completions"));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers["Idempotency-Key"], calls[1].init.headers["Idempotency-Key"]);
});

test("viewing a settled historical request cannot clear a different unresolved request ID", async () => {
  const oldId = "settled_history_001";
  const f = await fixture({ history: async () => Response.json({ data: [{ id: oldId, model: "older-model", state: "completed" }] }), generate: async () => Response.json({ error: { message: "正在核对。" } }, { status: 502 }) });
  await f.primary().props.onClick(); f.render();
  await f.primary().props.onClick(); f.render();
  const original = f.calls.find(call => call.url.endsWith("/chat/completions")).init.headers["Idempotency-Key"];
  await find(f.tree(), node => node.props["aria-label"] === `查询请求 ${oldId}`).props.onClick(); f.render();
  await f.primary().props.onClick(); f.render();
  assert.equal(f.calls.at(-1).init.headers["Idempotency-Key"], original);
});

test("English selected playground keeps generated content and request identity unchanged", async () => {
  const f = await fixture({ english: true, generate: async () => Response.json({ choices: [{ message: { content: "原始中文回答" } }], tokvilo_billing: { status: "settled", chargedMicrousd: 3000 } }) });
  assert.doesNotMatch(text(f.tree()), /[\u4e00-\u9fff]/);
  f.prompt("不翻译这段用户提示词");
  await f.primary().props.onClick(); f.render();
  assert.match(text(f.primary()), /Reserve \$0\.012000 & generate/);
  await f.primary().props.onClick(); f.render();
  const paid = f.calls.find(call => call.url === "/api/selected/v1/chat/completions");
  const quoted = JSON.parse(f.calls.find(call => call.url === "/api/pricing/quote").init.body);
  assert.deepEqual(JSON.parse(paid.init.body), quoted.body);
  assert.equal(JSON.parse(paid.init.body).messages[0].content, "不翻译这段用户提示词");
  assert.match(text(f.tree()), /原始中文回答/);
});
