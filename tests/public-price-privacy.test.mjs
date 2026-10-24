import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(path, mocks = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, { module: mod, exports: mod.exports, require(name) {
    if (Object.hasOwn(mocks, name)) return mocks[name]; throw Error(`Unexpected dependency ${name}`);
  }, TextEncoder });
  return mod.exports;
}
const internal = await load("../lib/products.ts");
const published = await load("../lib/public-products.ts");
const pricing = await load("../lib/pricing.ts", { "./model-id": await load("../lib/model-id.ts") });

test("client catalogue contains only final prices and stays synchronized with internal settlement products", () => {
  assert.equal(published.digitalProducts.length, internal.digitalProducts.length);
  for (const product of published.digitalProducts) {
    const server = internal.digitalProducts.find(item => item.id === product.id);
    assert.ok(server);
    assert.equal(product.retailCents, server.retailCents);
    assert.equal(product.retailCents, Math.ceil(server.upstreamCents * 6 / 5));
    for (const key of ["id", "name", "category", "variant", "soldOut", "description"]) assert.deepEqual(product[key], server[key]);
    assert.equal(product.delivery, server.sourceDelivery);
    assert.deepEqual(Object.keys(product).sort(), ["id", "name", "category", "variant", "retailCents", "delivery", "soldOut", "description"].sort());
  }
  assert.doesNotMatch(JSON.stringify(published.digitalProducts), /upstream|source|源头|源价|加价|20%|xiaoxin/i);
});

test("client components cannot import the internal product catalogue", async () => {
  async function files(directory) {
    const entries = await readdir(new URL(directory, import.meta.url), { withFileTypes: true });
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) :
      /\.(tsx?|jsx?)$/.test(entry.name) ? [`${directory}/${entry.name}`] : []))).flat();
  }
  const clientSafeSource = await readFile(new URL("../lib/public-products.ts", import.meta.url), "utf8");
  assert.doesNotMatch(clientSafeSource, /^\s*import\s/m);
  for (const file of await files("../components")) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    if (/^[\s]*["']use client["']/m.test(source)) assert.doesNotMatch(source, /from\s+["'][^"']*(?:\/products|\/pricing|\/apimart-pricing)["']/, file);
  }
});

test("public relay metadata drops source charges and saved markup but preserves generated JSON verbatim", () => {
  const content = { cost: 9, markupPercent: 20, upstreamMicrousd: 30 };
  const raw = {
    cost: 2, markupPercent: 20,
    data: { id: "task_1", status: "completed", cost: 0.014, credits_cost: 14,
      usage: { prompt_tokens: 20, completion_tokens: 10, total_cost: 0.01 },
      choices: [{ message: { content: JSON.stringify(content) } }], result: { images: ["https://example.invalid/result.png"] } },
    tokvilo_billing: { markupPercent: 20, chargedMicrousd: 16800, currency: "USD", status: "settled" },
  };
  const safe = pricing.publicRelayResponse(raw);
  assert.equal(safe.cost, undefined); assert.equal(safe.markupPercent, undefined);
  assert.equal(safe.data.cost, undefined); assert.equal(safe.data.credits_cost, undefined);
  assert.equal(safe.data.usage.total_cost, undefined); assert.equal(safe.data.usage.prompt_tokens, 20);
  assert.equal(safe.tokvilo_billing.markupPercent, undefined); assert.equal(safe.tokvilo_billing.chargedMicrousd, 16800);
  assert.equal(safe.data.choices[0].message.content, JSON.stringify(content));
  assert.deepEqual(safe.data.result, raw.data.result);
  assert.equal(raw.data.cost, 0.014);
});

test("public OpenAPI descriptions disclose retail settlement without supplier prices or markup", async () => {
  const reference = await load("../lib/tokenhub-model-reference.ts");
  const studio = await load("../lib/tokenhub-openapi.ts", { "./tokenhub-model-reference": reference });
  const gateway = await load("../lib/apimart-openapi.ts");
  for (const document of [studio.tokenHubOpenApi("https://tokvilo.com"), gateway.apimartOpenApi("https://tokvilo.com")]) {
    assert.doesNotMatch(JSON.stringify(document), /源价|源头|加价|上游价格|20\s*%|×\s*1\.20|markupPercent|upstreamMicrousd/);
    assert.match(JSON.stringify(document), /tokvilo 售价/);
  }
});
