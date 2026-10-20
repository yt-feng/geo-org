import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function moduleAt(name, mocks, globals = {}) {
  const filename = new URL(`../lib/${name}.ts`, import.meta.url).pathname, compiled = { exports: {} };
  const { outputText } = ts.transpileModule(await readFile(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInNewContext(outputText, {
    module: compiled, exports: compiled.exports, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array,
    Headers, Response, AbortSignal, atob, btoa,
    require(dependency) { assert.ok(Object.hasOwn(mocks, dependency), dependency); return mocks[dependency]; },
    ...globals,
  }, { filename });
  return compiled.exports;
}

async function fixture(key = "sb_publishable_test") {
  const env = {
    AUTH_BASE_URL: "https://project.supabase.co", AUTH_ANON_KEY: key,
    ADMIN_EMAIL: "allowlisted@example.invalid", ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "test-admin-password", ADMIN_SESSION_SECRET: "test-only-secret-value-with-at-least-32-chars",
  };
  const helpers = await moduleAt("crypto", {});
  const calls = [];
  const auth = await moduleAt("auth", {
    "next/headers": { cookies: async () => ({ get: () => undefined }) },
    "next/navigation": { redirect: () => { throw new Error("redirect"); } },
    "./config": { runtimeEnv: () => env }, "./crypto": helpers,
    "./local-auth": { verifyLocalSession: async () => ({ id: "local_user", isAdmin: false }) },
  }, {
    async fetch(url, options) {
      calls.push({ url, options });
      return Response.json({ id: "provider-user", email: env.ADMIN_EMAIL, user_metadata: { display_name: "Member", isAdmin: true, role: "admin" } });
    },
  });
  return { auth, env, calls };
}

test("new provider identities never inherit administrator authority from email or user metadata", async () => {
  const f = await fixture();
  const user = await f.auth.verifyAccessToken("test-user-access");
  assert.equal(user.email, f.env.ADMIN_EMAIL);
  assert.equal(user.isAdmin, false);
  assert.equal(f.calls[0].options.headers.authorization, "Bearer test-user-access");
  assert.equal(f.calls[0].options.redirect, "manual");
});

test("publishable keys are apikey only while legacy anonymous JWT configuration remains supported", async () => {
  const published = await fixture();
  assert.equal(published.auth.authRequestHeaders().get("apikey"), "sb_publishable_test");
  assert.equal(published.auth.authRequestHeaders().get("authorization"), null);
  const legacy = await fixture("test.legacy.jwt");
  assert.equal(legacy.auth.authRequestHeaders().get("authorization"), "Bearer test.legacy.jwt");
});

test("the existing signed administrator flow and historical local sessions remain independently supported", async () => {
  const f = await fixture();
  const signed = await f.auth.createAdminSession("admin", f.env.ADMIN_PASSWORD);
  assert.equal((await f.auth.verifyAccessToken(signed)).isAdmin, true);
  assert.equal(await f.auth.createAdminSession("admin", "wrong"), null);
  assert.equal((await f.auth.verifyAccessToken("tk_session_test")).isAdmin, false);
  assert.equal(f.calls.length, 0);
});
