import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function signupFixture(upstream) {
  const filename = new URL("../app/api/auth/register/route.ts", import.meta.url).pathname;
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const calls = [];
  const compiled = { exports: {} };
  const mocks = {
    "@/lib/auth": {
      authBaseUrl: () => "https://auth.example.invalid",
      authRequestHeaders: () => new Headers({ apikey: "test-anon-key" }),
    },
    "@/lib/config": { publicBaseUrl: () => "https://tokvilo.com" },
  };
  vm.runInNewContext(outputText, {
    module: compiled, exports: compiled.exports, Request, Response, Headers,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    async fetch(url, options) {
      calls.push({ url, options });
      return Response.json(upstream);
    },
  }, { filename });
  return {
    calls,
    signup: () => compiled.exports.POST(new Request("https://tokvilo.com/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: "qa@example.invalid", password: "example-password-only" }),
    })),
  };
}

test("raw GoTrue auto-confirm response lets users proceed to login without exposing tokens", async () => {
  const f = await signupFixture({
    access_token: "private-test-access",
    refresh_token: "private-test-refresh",
    user: { id: "test-user", email_confirmed_at: "2026-10-20T00:00:00Z" },
  });
  const response = await f.signup();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, requiresEmailVerification: false });
  assert.equal(f.calls.length, 1);
  const target = new URL(f.calls[0].url);
  assert.equal(target.origin, "https://auth.example.invalid");
  assert.equal(target.pathname, "/auth/v1/signup");
  assert.equal(target.searchParams.get("redirect_to"), "https://tokvilo.com/login?verified=1");
});

test("unconfirmed raw GoTrue users retain the email verification hint", async () => {
  for (const upstream of [
    { id: "test-user", confirmation_sent_at: "2026-10-20T00:00:00Z" },
    { user: { id: "test-user" }, session: null },
    { user: { id: "test-user" }, access_token: "" },
  ]) {
    const f = await signupFixture(upstream);
    assert.deepEqual(await (await f.signup()).json(), { ok: true, requiresEmailVerification: true });
  }
});

test("SDK-compatible wrapped sessions remain supported without returning credentials", async () => {
  const f = await signupFixture({ session: { access_token: "private-test-access" } });
  assert.deepEqual(await (await f.signup()).json(), { ok: true, requiresEmailVerification: false });
});
