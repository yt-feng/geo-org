import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(await readFile(new URL("../components/paddle-checkout-client.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

test("SDK URL control parameters are removed before script loading and Initialize, so only the verified transaction opens", async () => {
  const steps = [], compiledModule = { exports: {} };
  const location = { href: "https://tokvilo.com/dashboard/wallet?lang=en&paddle_order=owned-order&_ptxn=txn_untrusted&paddle_env=sandbox&_paction=update_payment_details&__pw_iic=retained&__pw=retained#?paddle_env=staging&_ptxn=txn_fragment" };
  const assertClean = () => {
    const url = new URL(location.href);
    assert.equal(url.searchParams.get("lang"), "en");
    assert.equal(url.searchParams.get("paddle_order"), "owned-order");
    assert.equal(url.hash, "");
    for (const key of ["_ptxn", "paddle_env", "_paction", "__pw_iic", "__pw"]) assert.equal(url.searchParams.has(key), false);
  };
  const client = {
    Initialize(options) { assertClean(); steps.push({ action: "initialize", token: options.token }); },
    Environment: { set(value) { steps.push({ action: "environment", value }); } },
    Checkout: { open(options) { assertClean(); steps.push({ action: "open", transactionId: options.transactionId }); } },
  };
  const browser = { location, history: { state: { fixture: true }, replaceState(state, unused, value) { assert.deepEqual(state, { fixture: true }); location.href = new URL(value, location.href).href; steps.push({ action: "sanitize" }); } }, setTimeout, clearTimeout };
  const document = {
    createElement: () => ({ src: "", async: false, onload: null, onerror: null, remove() {} }),
    head: { appendChild(script) { assertClean(); assert.equal(script.src, "https://cdn.paddle.com/paddle/v2/paddle.js"); steps.push({ action: "load" }); browser.Paddle = client; script.onload(); } },
  };
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, window: browser, document, URL });
  await compiledModule.exports.openPaddleCheckout({ environment: "production", clientToken: "live_public", transactionId: "txn_verified" });
  assert.deepEqual(steps.map(value => value.action), ["sanitize", "load", "initialize", "open"]);
  assert.equal(steps.at(-1).transactionId, "txn_verified");
  await compiledModule.exports.openPaddleCheckout({ environment: "production", clientToken: "live_public", transactionId: "txn_verified_again" });
  assert.equal(steps.filter(value => value.action === "initialize").length, 1);
  assert.equal(steps.at(-1).transactionId, "txn_verified_again");
});
