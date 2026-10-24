import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

async function load(path, mocks = {}, globals = {}) {
  const file = new URL(`../${path}`, import.meta.url), compiledModule = { exports: {} };
  const code = ts.transpileModule(await readFile(file, 'utf8'), { fileName: file.pathname, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, URL, URLSearchParams, Intl, Date, Error, AbortController, require(name) {
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'next/link') return { default: 'a' };
    if (name in mocks) return mocks[name];
    throw Error(`Unexpected dependency: ${name}`);
  }, ...globals });
  return compiledModule.exports;
}
const site = await load('lib/site-locale.ts');
const apiDocCopy = await load('lib/api-doc-copy.ts');
const locale = { useSiteLocale: () => ({ locale: 'en', isEnglish: true, t: (zh, en) => en, href: path => site.localizedHref(path, 'en') }), LanguageSwitcher: 'language-switch', LocaleProvider: 'locale-provider' };
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : '';
function findAll(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(item => findAll(item, predicate));
  if (!node?.props) return [];
  return [...(predicate(node) ? [node] : []), ...findAll(node.props.children, predicate)];
}
const hooks = { useState: value => [value, () => {}], useRef: value => ({ current: value }), useMemo: callback => callback(), useEffect: () => {} };
const user = { id: 'member-1', displayName: 'Member', email: 'member@example.invalid', isAdmin: false };

test('English console navigation preserves language and hides admin links for members', async () => {
  const compiledModule = await load('components/DashboardShell.tsx', { react: hooks, './LocaleProvider': locale, './Brand': { Brand: 'brand' }, './Icon': { Icon: 'icon' }, './ThemeToggle': { ThemeToggle: 'theme-toggle' }, './LogoutButton': { LogoutButton: 'logout' } });
  const tree = compiledModule.DashboardShell({ user, active: 'keys', children: 'workspace-content' });
  assert.match(text(tree), /Dashboard.*Balance & top up.*Orders.*API keys.*Request logs.*API documentation/);
  const links = findAll(tree, node => node.type === 'a').map(node => node.props.href);
  for (const path of ['/dashboard?lang=en', '/dashboard/keys?lang=en', '/dashboard/docs?lang=en', '/selected?lang=en', '/en/models']) assert.ok(links.includes(path), path);
  assert.ok(!links.some(path => path.startsWith('/admin')));
});

test('English key management renders human text without changing stored labels or status values', async () => {
  const compiledModule = await load('components/ApiKeysPanel.tsx', { react: hooks, './LocaleProvider': locale, './Icon': { Icon: 'icon' } });
  const tree = compiledModule.ApiKeysPanel({ initialKeys: [{ id: 'key-1', label: '用户标签', key_prefix: 'tk_live_1234', created_at: '2026-10-23 01:00:00', last_used_at: null, revoked_at: null }] });
  assert.match(text(tree), /API keys.*Create API key/);
  assert.match(text(tree), /用户标签/);
  assert.match(text(tree), /Never used/);
  assert.doesNotMatch(text(tree), /尚未使用|创建密钥|停用/);
  assert.deepEqual(findAll(tree, node => node.type === 'option').map(node => node.props.value), ['all', 'active', 'revoked']);
});

test('English docs retain request paths, raw schema, source identifiers and category values', async () => {
  const operation = { source: 'selected', method: 'POST', path: '/api/selected/v1/chat/completions', summary: '原始模型文档', description: '原始说明', tags: ['模型'], parameters: [{ name: 'Idempotency-Key', in: 'header', required: true }], requestBody: { model: 'glm-5' }, responses: { 200: { description: '原始响应' } } };
  const data = { operations: [operation], sources: [{ id: 'selected', label: 'tokvilo 精选', loaded: true, count: 1 }], warnings: [] };
  let index = 0;
  const compiledModule = await load('components/DocsExplorer.tsx', { react: { ...hooks, useState: initial => [index++ === 0 ? data : typeof initial === 'boolean' ? false : initial, () => {}] }, './LocaleProvider': locale, '@/lib/brand-display': { displayServiceText: x => x }, '@/lib/api-doc-copy': apiDocCopy, '@/lib/api-documentation': { loadApiDocumentation: () => { throw Error('No network request allowed'); }, requestBodyExample: () => ({ model: 'glm-5' }), requestBodySchema: () => ({ type: 'object' }), apiCurlExample: (base, op) => `${base}${op.path}` } });
  const tree = compiledModule.DocsExplorer({ baseUrl: 'https://tokvilo.com' });
  assert.match(text(tree), /tokvilo Select.*1 operations/);
  assert.match(text(tree), /原始模型文档|原始说明/);
  assert.match(text(tree), /Request URL.*Authentication.*Parameters.*Required/);
  assert.ok(findAll(tree, node => node.type === 'option').some(node => node.props.value === '全部' && text(node) === 'All'));
  assert.ok(findAll(tree, node => node.type === 'a').some(node => node.props.href === '/api/private/selected-openapi'));
  assert.match(text(tree), /https:\/\/tokvilo.com\/api\/selected\/v1\/chat\/completions/);
});

test('English usage filters preserve language while passing the original query/status to data access', async () => {
  const calls = [], summary = { callsToday: 2, successesToday: 1, errorsToday: 1 };
  const compiledModule = await load('app/dashboard/usage/page.tsx', { '@/components/LocaleProvider': locale, '@/components/DashboardShell': { DashboardShell: 'dashboard-shell' }, '@/components/Icon': { Icon: 'icon' }, '@/lib/auth': { requirePortalUser: async lang => { calls.push(['auth', lang]); return user; } }, '@/lib/console-data': { displayTimestamp: x => x, getUsageEvents: async (id, options) => { calls.push(['usage', id, options]); return []; } }, '@/lib/store': { getUserSummary: async () => summary } });
  const tree = await compiledModule.default({ searchParams: Promise.resolve({ lang: 'en', q: '/v1/models', status: '4xx' }) });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['auth', 'en'], ['usage', user.id, { query: '/v1/models', status: '4xx', limit: 100 }]]);
  assert.match(text(tree), /Request logs.*View API usage/);
  assert.ok(findAll(tree, node => node.type === 'input').some(node => node.props.name === 'lang' && node.props.value === 'en'));
  assert.equal(findAll(tree, node => node.type === 'form')[0].props.action, '/dashboard/usage');
});

test('English logout keeps its existing POST endpoint and returns to English login', async () => {
  const calls = [], navigations = [];
  const compiledModule = await load('components/LogoutButton.tsx', { react: hooks, './LocaleProvider': locale, './Icon': { Icon: 'icon' } }, { Event, window: { dispatchEvent: () => {}, location: { assign: path => navigations.push(path) } }, fetch: async (path, init) => { calls.push([path, init.method]); return { ok: true }; } });
  const tree = compiledModule.LogoutButton();
  assert.equal(tree.props['aria-label'], 'Log out');
  await tree.props.onClick();
  assert.deepEqual(calls, [['/api/auth/logout', 'POST']]);
  assert.deepEqual(navigations, ['/login?lang=en']);
});
