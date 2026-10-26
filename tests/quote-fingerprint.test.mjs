import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/quote-fingerprint.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiled = { exports: {} };
vm.runInNewContext(outputText, { module: compiled, exports: compiled.exports, crypto: webcrypto, TextEncoder, Uint8Array });
const { quoteFingerprint, assertQuoteFingerprint, QuoteChangedError } = compiled.exports;
const quote = { model: "model", kind: "chat", reservedMicrousd: 100, observedAt: "old", price: { quotedAt: 1, retailPolicyVersion: "v1", tiers: [{ max: 128000, rates: { input: 1, cached_input: .1, output: 2 } }] } };

test("fingerprints ignore only refresh timestamps and recursively normalize object key order", async () => {
  const reordered = { price: { tiers: [{ rates: { output: 2, input: 1, cached_input: .1 }, max: 128000 }], retailPolicyVersion: "v1", quotedAt: 9 }, observedAt: "new", reservedMicrousd: 100, kind: "chat", model: "model" };
  assert.match(await quoteFingerprint(quote), /^[a-f0-9]{64}$/);
  assert.equal(await quoteFingerprint(quote), await quoteFingerprint(reordered));
});

test("equal total reservations cannot hide changed rate buckets, tiers, policy, units, model or time windows", async () => {
  const baseline = await quoteFingerprint(quote);
  const changes = [
    q => { q.price.tiers[0].rates.cached_input = .2; }, q => { q.price.tiers[0].max = 256000; },
    q => { q.price.retailPolicyVersion = "v2"; }, q => { q.model = "other"; },
    q => { q.price.unit = "image"; }, q => { q.price.nextSwitchAt = 123; },
  ];
  for (const change of changes) { const changed = structuredClone(quote); change(changed); assert.notEqual(await quoteFingerprint(changed), baseline); }
  await assert.rejects(quoteFingerprint({ amount: Number.NaN }));
});

test("optional legacy requests pass while malformed or changed accepted fingerprints require a new quote", async () => {
  const request = fingerprint => new Request("https://tokvilo.com/api/gateway/v1/chat/completions", { headers: fingerprint === undefined ? {} : { "X-Tokvilo-Quote-Fingerprint": fingerprint } });
  await assertQuoteFingerprint(request(), quote);
  await assertQuoteFingerprint(request(await quoteFingerprint(quote)), quote);
  for (const wrong of ["", "x".repeat(64), "A".repeat(64), "a".repeat(64), "123"]) {
    await assert.rejects(assertQuoteFingerprint(request(wrong), quote), error => error instanceof QuoteChangedError && error.status === 409 && error.code === "quote_changed");
  }
});
