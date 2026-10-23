import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../lib/site-locale.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: mod, exports: mod.exports, URL });
const { localizedHref } = mod.exports;
test('public language changes preserve model filters and anchors in both directions', () => {
  const original = '/models?provider=OPENAI&family=gpt&category=text#results';
  assert.equal(localizedHref(original, 'en'), '/en' + original);
  assert.equal(localizedHref('/en' + original, 'zh'), original);
  assert.equal(localizedHref('/#faq', 'en'), '/en#faq');
  assert.equal(localizedHref('/en/products?lang=en', 'zh'), '/products');
});
test('auth and workspace language links keep return destinations and recovery fields intact', () => {
  const input = '/login?next=%2Fplayground%3Fmodel%3Dgpt-5.2';
  const output = localizedHref(input, 'en');
  assert.equal(output, input + '&lang=en');
  assert.equal(localizedHref(output, 'zh'), input);
  assert.equal(localizedHref('/reset-password?code=opaque#type=recovery', 'en'), '/reset-password?code=opaque&lang=en#type=recovery');
  assert.equal(localizedHref('/playground?model=gpt-5.2', 'en'), '/playground?model=gpt-5.2&lang=en');
});
test('external and mail links are unchanged', () => {
  for (const value of ['mailto:yt.feng@foxmail.com', 'https://example.com/', '//example.com/']) {
    assert.equal(localizedHref(value, 'en'), value);
  }
});
test('blog language links preserve the same article, query and section', () => {
  const path = '/blog/getting-started-with-model-apis?ref=guide#prepare-your-account';
  assert.equal(localizedHref('/blog', 'en'), '/en/blog');
  assert.equal(localizedHref(path, 'en'), '/en' + path);
  assert.equal(localizedHref('/en' + path, 'zh'), path);
  assert.equal(localizedHref('/en/blog/comparing-models-for-your-workflow?lang=en', 'zh'), '/blog/comparing-models-for-your-workflow');
});
