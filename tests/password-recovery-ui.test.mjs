import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

const filename = new URL("../components/PasswordRecoveryForm.tsx", import.meta.url).pathname;
const code = ts.transpileModule(await readFile(filename, "utf8"), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
function find(node, predicate) {
  if (Array.isArray(node)) { for (const item of node) { const result = find(item, predicate); if (result) return result; } }
  else if (node?.props) { if (predicate(node)) return node; return find(node.props.children, predicate); }
  return null;
}
const authModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL("../components/AuthForm.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { module: authModule, exports: authModule.exports, require: name => name === "react/jsx-runtime" ? jsx : {} });
const tokenHash = "private-recovery-hash-" + "a".repeat(35);
async function fixture({ mode = "reset", href = `https://tokvilo.com/reset-password#token_hash=${tokenHash}&type=recovery`, fetcher } = {}) {
  const hooks = [], effects = [], calls = [], navigations = [], cleanups = [];
  let cursor = 0, tree;
  const location = { href, assign: value => navigations.push(value) };
  const compiled = { exports: {} };
  vm.runInNewContext(code, {
    module: compiled, exports: compiled.exports, URL, URLSearchParams, queueMicrotask,
    window: { location, history: { replaceState: (state, title, url) => { cleanups.push(url); location.href = new URL(url, location.href).href; } } },
    require(name) {
      if (name === "react") return {
        useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: initial }; return [hooks[index].value, value => { hooks[index].value = value; }]; },
        useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial }; },
        useEffect(effect) { const index = cursor++; if (!hooks[index]) { hooks[index] = {}; effects.push(effect); } },
      };
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/link") return { default: "a" };
      if (name === "./AuthForm") return { authMessageEnglish: authModule.exports.authMessageEnglish };
      if (name === "./LocaleProvider") return { useSiteLocale: () => ({ isEnglish: new URL(location.href).searchParams.get("lang") === "en", t: (zh,en) => new URL(location.href).searchParams.get("lang") === "en" ? en : zh, href: path => new URL(location.href).searchParams.get("lang") === "en" ? path + "?lang=en" : path }) };
      if (name === "./Icon") return { Icon: () => null };
      throw Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); calls.push({ url, init, body });
      if (fetcher) return fetcher(url, init, body);
      return Response.json(url.endsWith("forgot-password") ? { ok: true } : body.password ? { ok: true, passwordReset: true } : { ok: true, ready: true });
    },
  }, { filename });
  function render() { cursor = 0; tree = compiled.exports.PasswordRecoveryForm({ mode }); for (const effect of effects.splice(0)) effect(); return tree; }
  function fill(name, value) { find(tree, node => node.props.name === name).props.onChange({ target: { value } }); render(); }
  const submit = () => find(tree, node => node.type === "form").props.onSubmit({ preventDefault() {} });
  const verify = () => find(tree, node => node.type === "button" && /验证|verification/.test(text(node))).props.onClick();
  render();
  for (let index = 0; index < 15; index++) await Promise.resolve();
  render();
  return { calls, navigations, cleanups, location, render, fill, submit, verify, tree: () => tree };
}

test("forgot-password submits only the email, shows a generic receipt and prevents duplicate requests", async () => {
  let finish;
  const f = await fixture({ mode: "forgot", href: "https://tokvilo.com/forgot-password", fetcher: () => new Promise(resolve => { finish = resolve; }) });
  assert.equal(f.calls.length, 0);
  f.fill("email", " Buyer@Example.com ");
  const pending = f.submit(); await f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/auth/forgot-password");
  assert.deepEqual(f.calls[0].body, { email: "buyer@example.com" });
  finish(Response.json({ ok: true, message: "No account existence is revealed." }));
  await pending; f.render();
  assert.match(text(f.tree()), /如果该邮箱已注册.*重置邮件/);
  await f.submit(); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.navigations, []);
});

test("recovery links are cleared immediately but only an explicit click redeems them", async () => {
  for (const separator of ["#", "?"]) {
    const f = await fixture({ href: `https://tokvilo.com/reset-password${separator}token_hash=${tokenHash}&type=recovery` });
    assert.deepEqual(f.cleanups, ["/reset-password"]);
    assert.equal(f.location.href, "https://tokvilo.com/reset-password");
    assert.equal(f.calls.length, 0, "loading an email link must not consume it");
    assert.doesNotMatch(JSON.stringify(f.tree()), /private-recovery/);
    assert.match(text(f.tree()), /继续验证/);
    await f.verify(); f.render();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "/api/auth/reset-password");
    assert.deepEqual(f.calls[0].body, { tokenHash });
    assert.equal(f.calls[0].init.referrerPolicy, "no-referrer");
    assert.equal(f.calls[0].init.redirect, "error");
    assert.equal(find(f.tree(), node => node.props.name === "password").props.autoComplete, "new-password");
  }
});

test("reset passwords must match and meet registration length rules before changing through the recovery cookie", async () => {
  const f = await fixture();
  await f.verify(); f.render();
  for (const password of ["short", "x".repeat(513)]) {
    f.fill("password", password); f.fill("confirmPassword", password); await f.submit(); f.render();
    assert.equal(f.calls.length, 1);
    assert.match(text(f.tree()), /10–512/);
  }
  f.fill("password", "A-new-password-123"); f.fill("confirmPassword", "A-different-password-123");
  await f.submit(); f.render(); assert.equal(f.calls.length, 1);
  assert.match(text(f.tree()), /不一致/);
  f.fill("confirmPassword", "A-new-password-123"); await f.submit(); f.render();
  assert.deepEqual(f.calls[1].body, { password: "A-new-password-123" });
  assert.doesNotMatch(f.calls[1].init.body, /tokenHash|access_token|refresh_token/);
  assert.deepEqual(f.navigations, ["/login"]);
  assert.equal(find(f.tree(), node => node.props.name === "password"), null);
  assert.match(text(f.tree()), /密码已更新/);
});

test("refresh checks only an existing recovery cookie without submitting a link or password", async () => {
  const f = await fixture({ href: "https://tokvilo.com/reset-password" });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].body, {});
  assert.ok(find(f.tree(), node => node.props.name === "password"));
  const expired = await fixture({ href: "https://tokvilo.com/reset-password", fetcher: async () => Response.json({ error: "Expired" }, { status: 401 }) });
  assert.match(text(expired.tree()), /无效或已过期/);
  assert.equal(find(expired.tree(), node => node.props.name === "password"), null);
});

test("ordinary authentication tokens and invalid recovery links are cleared without any exchange", async () => {
  for (const suffix of [`#access_token=private-access&refresh_token=private-refresh&type=recovery`, `?token_hash=${tokenHash}&type=signup`, "?token_hash=short&type=recovery"]) {
    const f = await fixture({ href: "https://tokvilo.com/reset-password" + suffix });
    assert.equal(f.calls.length, 0);
    assert.match(text(f.tree()), /无效或已过期/);
    assert.doesNotMatch(JSON.stringify(f.tree()), /private-access|private-refresh|private-recovery/);
    assert.equal(f.location.href, "https://tokvilo.com/reset-password");
  }
});

test("a concurrent confirmation consumes a recovery link only once and failures retain a recovery action", async () => {
  let finish;
  const f = await fixture({ fetcher: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.verify(); await f.verify(); assert.equal(f.calls.length, 1);
  finish(Response.json({ error: "重置链接已失效，请重新申请。" }, { status: 401 }));
  await pending; f.render();
  assert.match(text(f.tree()), /重置链接已失效/);
  assert.ok(find(f.tree(), node => node.props.href === "/forgot-password"));
  assert.equal(find(f.tree(), node => node.props.name === "password"), null);
});

test("English reset preserves language, strips token and retains pending recovery across a local language switch", async () => {
  const f = await fixture({ href: `https://tokvilo.com/reset-password?lang=en#token_hash=${tokenHash}&type=recovery` });
  assert.deepEqual(f.cleanups, ["/reset-password?lang=en"]);
  assert.equal(f.calls.length, 0);
  assert.match(text(f.tree()), /Continue verification/);
  f.location.href = "https://tokvilo.com/reset-password?lang=zh"; f.render();
  assert.match(text(f.tree()), /继续验证/);
  await f.verify(); f.render();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].body, { tokenHash });
});

test("language-only reset query checks the recovery cookie and preserves English login navigation", async () => {
  const f = await fixture({ href: "https://tokvilo.com/reset-password?lang=en" });
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].body, {});
  assert.match(text(f.tree()), /New password/);
  f.fill("password", "A-new-password-123"); f.fill("confirmPassword", "A-new-password-123");
  await f.submit(); f.render();
  assert.deepEqual(f.navigations, ["/login?lang=en"]);
  assert.match(text(f.tree()), /Your password has been updated/);
});

test("English recovery keeps account existence generic and never echoes unknown server errors", async () => {
  const f = await fixture({ mode: "forgot", href: "https://tokvilo.com/forgot-password?lang=en" });
  f.fill("email", "buyer@example.com"); await f.submit(); f.render();
  assert.match(text(f.tree()), /If an account exists for this email/);
  const failure = await fixture({ mode: "forgot", href: "https://tokvilo.com/forgot-password?lang=en", fetcher: async () => Response.json({ error: "private-provider-detail" }, { status: 503 }) });
  failure.fill("email", "buyer@example.com"); await failure.submit(); failure.render();
  assert.match(text(failure.tree()), /could not complete this request/);
  assert.doesNotMatch(text(failure.tree()), /private-provider-detail/);
});
