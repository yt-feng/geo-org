import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const path = new URL('../lib/model-identity.ts', import.meta.url);
const compiledModule = { exports: {} };
const code = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, Intl, Map });
const { providerIdentity, modelProvider, modelFamily, compareModelVersions, groupModels } = compiledModule.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const model = (id, extra = {}) => ({ id, provider: modelProvider(id), ...extra });

test('manufacturer identities are shared across canonical names, names in links, and product aliases', () => {
  assert.equal(providerIdentity('OPENAI').id, 'openai');
  assert.equal(providerIdentity('ChatGPT').id, 'openai');
  assert.equal(providerIdentity('Black Forest Labs').id, providerIdentity('black-forest-labs').id);
  assert.equal(providerIdentity('Claude').id, 'anthropic');
  assert.equal(providerIdentity('Qwen').id, 'alibaba');
  assert.equal(providerIdentity('未知厂商').name, '未知厂商');
  assert.equal(providerIdentity('未知厂商').logo, undefined);
  assert.equal(providerIdentity('ALIBABA').nameEn, 'Alibaba');
  assert.equal(providerIdentity('其他').nameEn, 'Other');
  assert.equal(modelFamily(model('wan2.7')).nameEn, 'Wan');
});

test('manufacturer classification covers separate modalities and preserves unknown identity', () => {
  for (const id of ['sora-2', 'whisper-1', 'tts-1', 'codex-auto-review', 'gpt-image-2', 'text-embedding-3-small']) assert.equal(modelProvider(id), 'OPENAI');
  for (const id of ['dreamina-3.1', 'seedream-5-0', 'seedance-2.0']) assert.equal(modelProvider(id), 'BYTEDANCE');
  assert.equal(modelProvider('hy-image-v3.5-preview'), 'TENCENT');
  assert.equal(modelProvider('MiniMax-Hailuo-2.3'), 'MINIMAX');
  assert.equal(modelProvider('future-unknown-model'), '其他');
});

test('families keep generations together while separating incompatible capabilities', () => {
  for (const id of ['gpt-3.5-turbo', 'gpt-4o', 'gpt-5.4', 'gpt-6.1-sol']) assert.equal(modelFamily(model(id)).id, 'gpt');
  for (const id of ['claude-sonnet-4-5-20250929', 'claude-opus-4-7', 'claude-haiku-5-5']) assert.equal(modelFamily(model(id)).id, 'claude');
  assert.equal(modelFamily(model('gpt-image-2')).id, 'gpt-image');
  assert.equal(modelFamily(model('gpt-4o-realtime-preview')).id, 'gpt-realtime');
  assert.equal(modelFamily(model('gemini-3.5-flash')).id, 'gemini');
  assert.equal(modelFamily(model('gemini-3-pro-image-preview')).id, 'gemini-image');
  assert.equal(modelFamily(model('gemini-omni-flash-preview')).id, 'gemini-omni');
  assert.equal(modelFamily(model('qwen3.8-flash')).id, 'qwen');
  assert.equal(modelFamily(model('qwen-image-3.0')).id, 'qwen-image');
  assert.equal(modelFamily(model('grok-imagine-video-1.5')).id, 'grok-video');
  assert.equal(modelFamily(model('grok-imagine-image-2.0')).id, 'grok-image');
});

test('generation ordering is numeric, handles hyphenated decimals, and excludes context size', () => {
  const sorted = ids => ids.map(id => model(id)).sort(compareModelVersions).map(row => row.id);
  assert.deepEqual(sorted(['glm-4.9', 'glm-4.10', 'glm-5']), ['glm-5', 'glm-4.10', 'glm-4.9']);
  assert.deepEqual(sorted(['seedream-4-5', 'seedream-5-0', 'seedream-4-0']), ['seedream-5-0', 'seedream-4-5', 'seedream-4-0']);
  assert.deepEqual(sorted(['gpt-4-32k', 'gpt-4.1', 'gpt-4.10', 'gpt-4.9']), ['gpt-4.10', 'gpt-4.9', 'gpt-4.1', 'gpt-4-32k']);
  assert.deepEqual(sorted(['claude-opus-4-5-20251101', 'claude-opus-4-6', 'claude-opus-5-5']), ['claude-opus-5-5', 'claude-opus-4-6', 'claude-opus-4-5-20251101']);
});

test('dated variants sort within their generation without treating an older generation date as newest', () => {
  const ids = ['gpt-4o-2024-05-13', 'gpt-5', 'gpt-4o-2024-11-20', 'gpt-4o'];
  assert.deepEqual(ids.map(id => model(id)).sort(compareModelVersions).map(row => row.id), ['gpt-5', 'gpt-4o-2024-11-20', 'gpt-4o-2024-05-13', 'gpt-4o']);
});

test('grouping retains all objects including same model through two services without mutating input', () => {
  const rows = Object.freeze([
    Object.freeze(model('glm-4.7', { upstream: 'tokenhub' })),
    Object.freeze(model('gpt-5', { upstream: 'apimart' })),
    Object.freeze(model('gpt-6.1-sol', { upstream: 'selected' })),
    Object.freeze(model('glm-4.7', { upstream: 'apimart' })),
    Object.freeze(model('gpt-image-2', { category: 'image' })),
  ]);
  const grouped = groupModels(rows);
  const flattened = grouped.flatMap(group => group.models);
  assert.equal(flattened.length, rows.length);
  assert.equal(new Set(flattened).size, rows.length);
  assert.ok(rows.every(row => flattened.includes(row)));
  assert.equal(grouped[0].provider, 'OPENAI');
  assert.equal(grouped.find(group => group.family.id === 'gpt').models[0].id, 'gpt-6.1-sol');
  assert.equal(grouped.find(group => group.family.id === 'glm').models.length, 2);
  assert.deepEqual(plain(groupModels([...rows].reverse())), plain(grouped));
});

test('complete catalog grouping neither drops nor combines different products', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../lib/model-directory-snapshot.json', import.meta.url), 'utf8'));
  const rows = snapshot.models.map(row => model(row.id, row));
  const groups = groupModels(rows);
  assert.equal(groups.flatMap(group => group.models).length, rows.length);
  assert.ok(groups.every(group => group.models.length > 0));
  const logoProviders = [...new Set(rows.map(row => row.provider))].map(providerIdentity).filter(row => row.logo);
  for (const provider of logoProviders) {
    const svg = await readFile(new URL(`../public${provider.logo}`, import.meta.url), 'utf8');
    assert.match(svg, /<svg\b/);
    assert.match(svg, /<path\b/);
    assert.doesNotMatch(svg, /<script|onload=|href=["']https?:/i);
  }
});
