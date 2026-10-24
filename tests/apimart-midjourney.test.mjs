import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const mod = { exports: {} };
const code = ts.transpileModule(await readFile(new URL('../lib/apimart-midjourney.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class PricingError extends Error { constructor(message, status) { super(message); this.status = status; } }
vm.runInNewContext(code, { module: mod, exports: mod.exports, URL,
  require: name => { assert.equal(name, './pricing'); return { PricingError }; },
});
const { normalizeMidjourneyRequest: normalize, midjourneyPriceDimension: dimension } = mod.exports;
const body = { model: 'midjourney', prompt: 'A quiet mountain lake' };
const source = JSON.parse(await readFile(new URL('./fixtures/apimart-pricing-20261020.json', import.meta.url), 'utf8'));
const rates = source.data.models.image.find(model => model.id === 'midjourney').fixed_prices.items;

test('each supported version and speed resolves to its actual published billing key', () => {
  for (const version of ['5.1', '5.2', '6.1', '7', '8.1', '8.2']) for (const speed of ['relax', 'fast', 'turbo']) {
    assert.ok(rates.some(rate => rate.key === dimension({ ...body, version, speed })));
  }
  for (const version of ['6', '7']) for (const speed of ['relax', 'fast', 'turbo']) {
    const key = dimension({ ...body, version, speed, niji: true });
    assert.ok(rates.some(rate => rate.key === key));
    assert.match(key, /imagine-niji/);
  }
  assert.equal(dimension(body), 'imagine-v7');
});

test('one task defaults are deterministic and generic image count is not forwarded', () => {
  const value = normalize({ ...body, n: 1 });
  assert.equal(value.version, '7'); assert.equal(value.speed, 'relax'); assert.equal(value.size, '1:1');
  assert.equal(value.n, undefined);
  assert.deepEqual(normalize(value), value);
  assert.equal(body.version, undefined);
});

test('native price overrides, repeat jobs and unsupported follow-up actions are rejected before billing', () => {
  for (const extra of [
    { prompt: 'mountains --turbo' }, { prompt: 'mountains --repeat 40' },
    { prompt: 'a {red,blue} bird' }, { negative_prompt: 'dark --v 8.2' },
    { repeat: 40 }, { extra: '--fast' }, { hd: true }, { draft: true }, { quality: '2' },
    { nsfw_check: true }, { task_id: 'someone-elses-task' }, { n: 4 }, { resolution: '2k' },
    { version: '6', niji: false }, { version: '8.2', niji: true }, { speed: 'auto' }, { niji: 'true' },
    { seed: 4294967296 }, { size: '1024x1024' }, { speed: ['turbo'] }, { size: ['1:1'] },
  ]) assert.throws(() => normalize({ ...body, ...extra }), PricingError);
});

test('bounded reference URLs and creative parameters remain supported without extra task actions', () => {
  const value = normalize({ ...body, version: '6.1', speed: 'fast', size: '16:9',
    image_urls: ['https://example.com/reference.png'], seed: 4294967295,
    stylize: 750, chaos: 10, weird: 50, tile: false, raw: true, negative_prompt: 'blurry',
  });
  assert.equal(dimension(value), 'imagine-v6.1-fast');
  for (const image_urls of [[], ['http://example.com/a.png'], ['https://user:pass@example.com/a.png'],
    ['https://example.com/image.jpg --repeat 40'], ['https://example.com/{a,b}.jpg'],
    ['https://example.com/%7Ba,b%7D.jpg'], ['https://example.com/%2D%2Drepeat%2040'],
    Array(5).fill('https://example.com/a.png')]) {
    assert.throws(() => normalize({ ...body, image_urls }), PricingError);
  }
});
