import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import { credits, billingSummary } from "./helpers/credit-display.mjs";

const quoteFingerprint = "a".repeat(64);

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
    require(name) {
      if (name === "@/lib/credits") return credits;
      if (name === "./PlaygroundBillingSummary") return billingSummary; if (name === "./LocaleProvider") return { useSiteLocale: () => ({ locale: options.english ? "en" : "zh", isEnglish: options.english === true, t: (zh, en) => options.english ? en : zh, href: path => options.english ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path }) }; if (name === "react") return react; if (name === "react/jsx-runtime") return jsx; if (name === "next/link") return { default: "a" }; if (name === "./PriceTable") return { PriceTable: () => null }; throw Error(name); },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url === "/api/playground/status?service=selected") return options.status ? options.status(url, init) : Response.json({ service: "selected", authenticated: true, serviceEnabled: true, configured: true, accountActive: true, balanceMicrousd: 1_000_000, currency: "USD", code: "configuration_available", checks: "configuration_only" });
      if (url === "/api/pricing") return Response.json({ models: [
        { provider: "apimart", model, name: "Other service model", kind, billingReady: true },
        { provider: "selected", model, name: "Selected model", kind, billingReady: options.ready !== false },
      ] });
      if (url === "/api/pricing/quote") return options.quote ? options.quote(url, init) : Response.json({ quoteFingerprint, provider: "selected", model, mode: kind, currency: "USD", reservedMicrousd: 12000 });
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
  assert.match(text(f.primary()), /确认预留 0\.42 积分 \(\$0\.012\)/);
  assert.equal(f.calls.filter(call => call.url.startsWith("/api/selected/") && call.init?.method === "POST").length, 0);
  await f.primary().props.onClick(); f.render();
  const quoted = JSON.parse(f.calls.find(call => call.url === "/api/pricing/quote").init.body);
  const sent = f.calls.find(call => call.url.startsWith("/api/selected/") && call.init?.method === "POST");
  assert.equal(quoted.provider, "selected"); assert.equal(quoted.mode, kind);
  assert.equal(sent.url, kind === "chat" ? "/api/selected/v1/chat/completions" : "/api/selected/v1/images/generations");
  assert.deepEqual(JSON.parse(sent.init.body), quoted.body);
  assert.equal(sent.init.headers["X-Tokvilo-Max-Reserve-Microusd"], "12000");
  assert.equal(sent.init.headers["X-Tokvilo-Quote-Fingerprint"], quoteFingerprint);
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
  resolve(Response.json({ quoteFingerprint, provider: "selected", model: "same-model", mode: "chat", currency: "USD", reservedMicrousd: 12000 }));
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

test("selected rejects absent or invalid quote fingerprints without any generation", async () => {
  for (const invalid of [undefined, null, "", "a".repeat(63), "g".repeat(64), 123]) {
    const f = await fixture({ quote: () => Response.json({ provider: "selected", model: "same-model", mode: "chat", currency: "USD", reservedMicrousd: 12000, quoteFingerprint: invalid }) });
    await f.primary().props.onClick(); f.render();
    assert.equal(text(f.primary()), "获取准确报价");
    await f.primary().props.onClick(); f.render();
    assert.equal(f.calls.filter(call => call.url.startsWith("/api/selected/") && call.init?.method === "POST").length, 0);
  }
});

test("selected replaces a changed quote fingerprint and requires reconfirmation at an unchanged total", async () => {
  let quotes = 0, attempts = 0;
  const f = await fixture({
    quote: () => Response.json({ provider: "selected", model: "same-model", mode: "chat", currency: "USD", reservedMicrousd: 12000, quoteFingerprint: ++quotes === 1 ? quoteFingerprint : "b".repeat(64) }),
    generate: () => ++attempts === 1 ? Response.json({ error: { code: "quote_changed", message: "价格已更新，请重新获取报价。" } }, { status: 409 }) : Response.json({ choices: [{ message: { content: "New quote confirmed" } }], tokvilo_billing: { status: "settled", chargedMicrousd: 3000 } }),
  });
  await f.primary().props.onClick(); f.render(); await f.primary().props.onClick(); f.render();
  assert.equal(text(f.primary()), "获取准确报价");
  await f.primary().props.onClick(); f.render(); assert.equal(attempts, 1);
  await f.primary().props.onClick(); f.render();
  const paid = f.calls.filter(call => call.url.startsWith("/api/selected/") && call.init?.method === "POST");
  assert.equal(paid.length, 2);
  assert.equal(paid[0].init.headers["X-Tokvilo-Quote-Fingerprint"], quoteFingerprint);
  assert.equal(paid[1].init.headers["X-Tokvilo-Quote-Fingerprint"], "b".repeat(64));
  assert.equal(paid[0].init.body, paid[1].init.body);
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
  assert.equal(f.calls.filter(call => call.url.endsWith("/chat/completions")).at(-1).init.headers["Idempotency-Key"], original);
});

test("English selected playground keeps generated content and request identity unchanged", async () => {
  const f = await fixture({ english: true, generate: async () => Response.json({ choices: [{ message: { content: "原始中文回答" } }], tokvilo_billing: { status: "settled", chargedMicrousd: 3000 } }) });
  assert.doesNotMatch(text(f.tree()), /[\u4e00-\u9fff]/);
  f.prompt("不翻译这段用户提示词");
  await f.primary().props.onClick(); f.render();
  assert.match(text(f.primary()), /Reserve 0\.42 credits \(\$0\.012\) & generate/);
  await f.primary().props.onClick(); f.render();
  const paid = f.calls.find(call => call.url === "/api/selected/v1/chat/completions");
  const quoted = JSON.parse(f.calls.find(call => call.url === "/api/pricing/quote").init.body);
  assert.deepEqual(JSON.parse(paid.init.body), quoted.body);
  assert.equal(JSON.parse(paid.init.body).messages[0].content, "不翻译这段用户提示词");
  assert.match(text(f.tree()), /原始中文回答/);
});

const accountStatus = overrides => ({ service: "selected", authenticated: true, serviceEnabled: true, configured: true, accountActive: true,
  balanceMicrousd: 1_000_000, currency: "USD", code: "configuration_available", checks: "configuration_only", ...overrides });

test("zero balance permits a quote but prevents generation, then refreshing funded balance restores confirmation", async () => {
  let balance = 0;
  const f = await fixture({ status: async () => Response.json(accountStatus({ balanceMicrousd: balance })) });
  assert.match(text(f.tree()), /可用余额 0 积分 \(\$0\)/);
  assert.match(text(f.tree()), /1 获取准确报价 → 2 确认金额并生成/);
  assert.equal(f.primary().props.disabled, false, "a quote does not charge an empty wallet");
  await f.primary().props.onClick(); f.render();
  assert.equal(f.primary().props.disabled, true);
  assert.match(text(f.tree()), /还需充值 0\.42 积分 \(\$0\.012\)/);
  await f.primary().props.onClick();
  assert.equal(f.calls.filter(call => call.url.endsWith("/chat/completions")).length, 0);
  balance = 50_000;
  await find(f.tree(), node => node.type === "button" && text(node) === "刷新余额与状态").props.onClick(); f.render();
  assert.equal(f.primary().props.disabled, false);
  await f.primary().props.onClick(); f.render();
  assert.equal(f.calls.filter(call => call.url.endsWith("/chat/completions")).length, 1);
});

test("a priced model cannot submit with missing service configuration", async () => {
  const f = await fixture({ status: async () => Response.json(accountStatus({ configured: false, code: "service_not_configured" })) });
  assert.match(text(f.tree()), /此服务暂未开通生成/);
  assert.doesNotMatch(text(f.tree()), /当前模型已开通此接口/);
  await f.primary().props.onClick(); f.render();
  assert.equal(f.primary().props.disabled, true);
  await f.primary().props.onClick();
  assert.equal(f.calls.filter(call => call.url.endsWith("/chat/completions")).length, 0);
  assert.ok(find(f.tree(), node => node.type === "summary" && text(node) === "查看 JSON 请求参数"), "parameters remain available");
});

test("session expiry is actionable in both languages before any quote or generation", async () => {
  for (const english of [false, true]) {
    const f = await fixture({ english, status: async () => Response.json({ code: "login_required", authenticated: false }, { status: 401 }) });
    assert.match(text(f.tree()), english ? /Your session has expired/ : /登录已过期/);
    assert.ok(find(f.tree(), node => node.props.href?.startsWith("/login")));
    assert.equal(f.primary().props.disabled, true);
    if (english) assert.doesNotMatch(text(f.tree()), /[\u4e00-\u9fff]/);
    assert.equal(f.calls.filter(call => call.init?.method === "POST").length, 0);
  }
});

test("generation is blocked when account status cannot be read and can recover with refresh", async () => {
  let unavailable = true;
  const f = await fixture({ status: async () => unavailable ? Response.json({ code: "status_unavailable" }, { status: 503 }) : Response.json(accountStatus()) });
  assert.match(text(f.tree()), /暂时无法读取账户状态/);
  await f.primary().props.onClick(); f.render();
  assert.equal(f.primary().props.disabled, true);
  unavailable = false;
  await find(f.tree(), node => node.type === "button" && text(node) === "刷新余额与状态").props.onClick(); f.render();
  assert.equal(f.primary().props.disabled, false);
});

test("quote failure is displayed beside the action button", async () => {
  const f = await fixture({ quote: async () => Response.json({ error: "报价暂不可用。" }, { status: 503 }) });
  await f.primary().props.onClick(); f.render();
  const runArea = find(f.tree(), node => node.props.className === "playground-run-area");
  const alert = find(runArea, node => node.props.role === "alert");
  assert.ok(alert);
  assert.match(text(alert), /报价暂不可用/);
  assert.equal(f.calls.filter(call => call.url.endsWith("/chat/completions")).length, 0);
});

for (const english of [false, true]) test(`Select credits preserve exact one-microdollar amounts and token counts (${english ? "en" : "zh"})`, async () => {
  const receipt = { choices: [{ message: { content: "Exact reply" } }], usage: { prompt_tokens: 900, completion_tokens: 11, total_tokens: 911 }, tokvilo_billing: { currency: "USD", status: "settled", reservedMicrousd: 1, chargedMicrousd: 1 } };
  const original = JSON.stringify(receipt);
  const f = await fixture({ english, quote: () => Response.json({ quoteFingerprint, provider: "selected", model: "same-model", mode: "chat", currency: "USD", reservedMicrousd: 1 }), generate: () => Response.json(receipt) });
  assert.match(text(f.tree()), english ? /\$1 = 35 credits/ : /\$1 = 35 积分/);
  assert.match(text(f.tree()), english ? /35 credits \(\$1\)/ : /35 积分 \(\$1\)/);
  await f.primary().props.onClick(); f.render();
  assert.match(text(f.primary()), english ? /0\.000035 credits \(\$0\.000001\)/ : /0\.000035 积分 \(\$0\.000001\)/);
  await f.primary().props.onClick(); f.render();
  const sent = f.calls.find(call => call.url.startsWith("/api/selected/") && call.init?.method === "POST");
  assert.equal(sent.init.headers["X-Tokvilo-Max-Reserve-Microusd"], "1");
  assert.equal(sent.init.headers["X-Tokvilo-Quote-Fingerprint"], quoteFingerprint);
  assert.deepEqual(JSON.parse(sent.init.body), JSON.parse(f.calls.find(call => call.url === "/api/pricing/quote").init.body).body);
  const summary = find(f.tree(), node => node.type === billingSummary.PlaygroundBillingSummary);
  assert.ok(summary); assert.equal(summary.props.locale, english ? "en" : "zh");
  assert.match(text(summary.type(summary.props)), english ? /Actual charge0\.000035 credits \(\$0\.000001\)/ : /实际费用0\.000035 积分 \(\$0\.000001\)/);
  assert.match(text(f.tree()), /"total_tokens": 911/);
  assert.equal(JSON.stringify(receipt), original);
});
