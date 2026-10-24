import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiledModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../scripts/vinext-search-params-compat.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: compiledModule, exports: compiledModule.exports });
const plugin = compiledModule.exports.vinextSearchParamsCompat();
const vinextDist = dirname(fileURLToPath(import.meta.resolve('vinext')));
const generator = await readFile(resolve(vinextDist, 'entries/app-rsc-entry.js'), 'utf8');
const collectorSource = await readFile(resolve(vinextDist, 'server/app-page-head.js'), 'utf8');
const collector = collectorSource.match(/function collectAppPageSearchParams\(searchParams\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(collector, 'installed framework collector is available for the regression');
const context = { URLSearchParams };
vm.runInNewContext(collector, context);
const expression = generator.match(/__collectAppPageSearchParams\(searchParams\)\.(?:searchParamsObject|pageSearchParams)/)?.[0];
assert.ok(expression, 'installed framework probe should pass a recognized search-parameter collection');

test('installed framework pre-render probe receives lang and all query values after compatibility transform', async () => {
  const code = `const values = ${expression}; values;`;
  const fixed = plugin.transform(code, '\0virtual:vinext-rsc-entry');
  const params = new URLSearchParams('lang=en&model=gpt-6.1-sol&q=%2Fv1%2Fmodels&status=4xx&tag=a&tag=b');
  const run = value => vm.runInNewContext(value, { searchParams: params, __collectAppPageSearchParams: context.collectAppPageSearchParams });
  if (expression.endsWith('.searchParamsObject')) assert.equal(run(code), undefined, 'reproduce the installed 0.0.50 failure');
  const actual = run(fixed?.code || code);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), { lang: 'en', model: 'gpt-6.1-sol', q: '/v1/models', status: '4xx', tag: ['a', 'b'] });
  const page = async ({ searchParams }) => (await searchParams).lang === 'en' ? '/login?lang=en' : '/login';
  assert.equal(await page({ searchParams: Promise.resolve(actual) }), '/login?lang=en');
});

test('compatibility transform changes only the known generated entry and becomes a no-op upstream', () => {
  const broken = '__collectAppPageSearchParams(searchParams).searchParamsObject';
  assert.equal(plugin.transform(broken, '/app/dashboard/page.tsx'), null);
  assert.equal(plugin.transform(broken, '\0virtual:vinext-ssr-entry'), null);
  const fixed = '__collectAppPageSearchParams(searchParams).pageSearchParams';
  assert.equal(plugin.transform(fixed, '\0virtual:vinext-rsc-entry'), null);
  assert.equal(plugin.transform(broken, '\0virtual:vinext-rsc-entry').code, fixed);
});
