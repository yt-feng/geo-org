import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { catalog } from "./helpers/model-catalog.mjs";

async function load(path, mocks = {}, globals = {}) {
  const filename = new URL(path, import.meta.url).pathname, compiledModule = { exports: {} };
  const code = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, URL, URLSearchParams,
    require: name => { if (name in mocks) return mocks[name]; throw Error(name); }, ...globals });
  return compiledModule.exports;
}
const returnPaths = await load("../lib/auth-return-path.ts");
const { localizedHref } = await load("../lib/site-locale.ts");

test("login destinations retain exact catalogue selections and only public workspace parameters", () => {
  for (const model of catalog.allModelCatalog) {
    const expected = new URL(catalog.modelWorkbenchUrl(model), "https://tokvilo.com");
    const destination = returnPaths.safeAuthReturnPath(`${expected.pathname}${expected.search}&lang=en&access_token=secret&password=private#refresh_token=secret`);
    const result = new URL(destination, "https://tokvilo.com");
    assert.equal(result.searchParams.get("model"), model.id);
    assert.equal(result.searchParams.get("service"), expected.searchParams.get("service"));
    assert.equal(result.searchParams.get("category"), model.category);
    assert.equal(result.searchParams.get("lang"), "en");
    assert.deepEqual([...result.searchParams.keys()], ["service", "model", "category", "lang"]);
    assert.equal(result.hash, "");
    assert.doesNotMatch(destination, /secret|private|access_token|refresh_token|password/);
  }
});

test("redirect validation rejects external destinations and removes malformed or ambiguous selection fields", () => {
  for (const destination of [undefined, "https://example.invalid/playground", "//example.invalid/playground", "/admin", "/playground/../admin", "/playground\\\\example.invalid", "/%70layground", "javascript:alert(1)"]) {
    assert.equal(returnPaths.safeAuthReturnPath(destination), null, String(destination));
  }
  assert.equal(returnPaths.safeAuthReturnPath("/playground?service=studio&service=selected&model=a&model=b&category=bad&lang=bad&token=secret"), "/playground");
  assert.equal(returnPaths.safeAuthReturnPath("/playground?model=tenant%2Fmodel%3Av2&service=selected&category=text&lang=en"), "/playground?service=selected&model=tenant%2Fmodel%3Av2&category=text&lang=en");
});

test("advisor sign-in destinations allow only exact bilingual routes and remove all query and fragment material", () => {
  for (const path of ["/advisor", "/en/advisor"]) {
    assert.equal(returnPaths.safeAuthReturnPath(path), path);
    assert.equal(returnPaths.safeAuthReturnPath(`${path}?lang=en&next=https://example.invalid&access_token=secret&email=private#refresh_token=secret`), path);
    assert.equal(returnPaths.safeAuthReturnPath(`${path}#access_token=secret`), path);
  }
  for (const path of ["/advisor/", "/advisor/extra", "/en/advisor/extra", "/advisory", "/advisor/../advisor", "/en/../advisor", "/advisor\\\\example.invalid", "/%61dvisor", "//example.invalid/advisor", "https://example.invalid/en/advisor", `/advisor?${"x".repeat(2048)}`]) {
    assert.equal(returnPaths.safeAuthReturnPath(path), null, path);
  }
});

async function login(destination, english = false) {
  const loginUrl = new URL("https://tokvilo.com/login");
  if (destination !== undefined) loginUrl.searchParams.set("next", destination);
  if (english) loginUrl.searchParams.set("lang", "en");
  const assigned = [], calls = [];
  const form = await load("../components/AuthForm.tsx", {
    "react": { useState: value => [value, () => {}], useEffect() {} },
    "react/jsx-runtime": jsx, "next/link": { default: "a" }, "@/components/Icon": { Icon: () => null },
    "@/lib/auth-return-path": returnPaths,
    "./LocaleProvider": { useSiteLocale: () => ({ isEnglish: english, t: (zh, en) => english ? en : zh,
      href: path => localizedHref(path, english ? "en" : "zh") }) },
  }, {
    window: { location: { href: loginUrl.href, assign: value => assigned.push(value) } },
    FormData: class { get(name) { return name === "email" ? "test@example.invalid" : "test-value"; } },
    fetch: async (url, options) => { calls.push({ url, options }); return Response.json({ authenticated: true }); },
  });
  await form.AuthForm({ mode: "login" }).props.onSubmit({ preventDefault() {}, currentTarget: {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/auth/login");
  assert.equal(assigned.length, 1);
  return assigned[0];
}

test("successful login returns to the selected model and service, retaining English without credentials", async () => {
  assert.equal(await login("/playground?service=selected&model=gpt-image-2&category=image&access_token=secret#refresh_token=secret", true),
    "/playground?service=selected&model=gpt-image-2&category=image&lang=en");
  assert.equal(await login("/playground?service=studio&model=glm-5&category=text"), "/playground?service=studio&model=glm-5&category=text");
});

test("successful advisor login returns to the requested page in the active language", async () => {
  assert.equal(await login("/advisor?access_token=secret#refresh_token=secret"), "/advisor");
  assert.equal(await login("/en/advisor?next=https://example.invalid&email=private#access_token=secret", true), "/en/advisor");
  assert.equal(await login("/advisor", true), "/en/advisor");
  assert.equal(await login("/en/advisor"), "/advisor");
  assert.equal(await login("/advisor/../advisor", true), "/dashboard?lang=en");
});

test("ordinary login and untrusted next destinations retain the dashboard fallback", async () => {
  assert.equal(await login(undefined), "/dashboard");
  assert.equal(await login(undefined, true), "/dashboard?lang=en");
  assert.equal(await login("//example.invalid/playground", true), "/dashboard?lang=en");
  assert.equal(await login("/api/gateway/v1/chat/completions"), "/dashboard");
});

test("payment sign-in preserves only the exact wallet route, English, and a public UUID order", async () => {
  const order = "5b1aa5c8-1195-4c64-9e32-0c879f30ee4d";
  const expected = `/dashboard/wallet?lang=en&paddle_order=${order}`;
  assert.equal(returnPaths.safeAuthReturnPath(`/dashboard/wallet?lang=en&paddle_order=${order}&_ptxn=txn_private&access_token=secret&email=private#refresh_token=secret`), expected);
  const returned = new URL(await login(`/dashboard/wallet?paddle_order=${order}&_ptxn=txn_untrusted&password=private`, true), "https://tokvilo.com");
  assert.equal(returned.pathname, "/dashboard/wallet");
  assert.deepEqual(Object.fromEntries(returned.searchParams), { paddle_order: order, lang: "en" });
  assert.equal(returned.hash, "");
  assert.equal(returnPaths.safeAuthReturnPath("/dashboard/wallet?lang=en&lang=zh&paddle_order=not-a-uuid&token=secret"), "/dashboard/wallet");
  assert.equal(returnPaths.safeAuthReturnPath(`/dashboard/wallet?paddle_order=${order}&paddle_order=${order}`), "/dashboard/wallet");
  for (const value of ["/dashboard/wallet/extra", "/dashboard/wallet/../orders", "//evil.example/dashboard/wallet", "/dashboard/wallet\\\\evil.example", "/dashboard/orders"]) assert.equal(returnPaths.safeAuthReturnPath(value), null, value);
});

test("wallet page forwards a sanitized payment return path to the sign-in guard", async () => {
  const calls = [];
  const page = await load("../app/dashboard/wallet/page.tsx", {
    "react/jsx-runtime": jsx,
    "@/components/DashboardShell": { DashboardShell: "DashboardShell" },
    "@/components/WalletPanel": { WalletPanel: "WalletPanel" },
    "@/components/LocaleProvider": { LocaleProvider: "LocaleProvider" },
    "@/lib/auth": { requirePortalUser: async (...args) => { calls.push(args); return { id: "buyer", email: "buyer@example.invalid", isAdmin: false }; } },
    "@/lib/auth-return-path": returnPaths,
    "../../wallet.css": {},
  });
  const order = "5b1aa5c8-1195-4c64-9e32-0c879f30ee4d";
  await page.default({ searchParams: Promise.resolve({ lang: "en", paddle_order: order, _ptxn: "txn_untrusted", access_token: "secret" }) });
  assert.deepEqual(calls[0], ["en", `/dashboard/wallet?lang=en&paddle_order=${order}`]);
  await page.default({ searchParams: Promise.resolve({ lang: "en", paddle_order: [order, order] }) });
  assert.deepEqual(calls[1], ["en", "/dashboard/wallet?lang=en"]);
});
