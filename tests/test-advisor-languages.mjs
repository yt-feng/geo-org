import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { catalog, cnCatalog, getOptionalServices } from '../package-advisor/catalog.mjs';
import { createRecommendation, customizePlan, validateInput } from '../package-advisor/planner.mjs';
import { analyze, validateAnalysis } from '../advisor-service/worker.mjs';
import worker from '../advisor-service/worker.mjs';
import { buildContactSummary } from '../package-advisor/handoff.mjs';

const INPUT = { market: 'overseas', budget: 50000, goal: 'visibility', stage: 'growing' };
const ANALYSIS = { prioritize: ['W08'], exclude: [], reuseFacts: false, summary: '建议先核对已有事实和产品资料，再确认所选语种的本地表达、渠道适配与审校范围。具体交付以所选套餐明细为准。' };
beforeEach(t => t.mock.method(globalThis, 'fetch', async () => { throw new Error('test_network_disabled'); }));
const response = (analysis = ANALYSIS) => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }] });
function checkAmounts(plan) {
  assert.equal(plan.total, plan.items.reduce((sum, item) => sum + item.total, 0));
  for (const item of plan.items) assert.equal(item.total, item.unitPrice * item.quantity);
  for (const item of plan.pendingItems) { assert.equal(item.total, null); assert.equal(item.unitPrice, null); }
}

test('language selection defaults by market, deduplicates allowed codes and rejects cross-market or malformed values', () => {
  assert.deepEqual(validateInput(INPUT).languages, ['en']);
  assert.deepEqual(validateInput({ ...INPUT, market: 'cn' }).languages, ['zh']);
  assert.deepEqual(validateInput({ ...INPUT, languages: ['en', 'ar', 'en'] }).languages, ['en', 'ar']);
  for (const languages of [null, [], 'en', ['zh'], ['EN'], ['it'], ['en', { price: 1 }], [true]]) assert.throws(() => validateInput({ ...INPUT, languages }));
  for (const languages of [['en'], ['zh', 'en'], [], null]) assert.throws(() => validateInput({ ...INPUT, market: 'cn', languages }));
});

test('W10 has an English per-article price and planner recipes preserve three articles rather than multiplying displayed quantity', () => {
  const adaptation = catalog.find(item => item.id === 'W10');
  assert.equal(adaptation.price, 1500); assert.equal(adaptation.unit, '篇'); assert.match(adaptation.name, /英文/);
  assert.doesNotMatch(JSON.stringify(adaptation), /3条包|3条实质/);
  const result = createRecommendation(INPUT);
  assert.equal(result.plans[1].items.find(item => item.id === 'W10').quantity, 3);
  assert.equal(result.plans[1].items.find(item => item.id === 'W10').total, 4500);
  for (const quantity of [1, 3, 5]) for (const plan of createRecommendation({ ...INPUT, modules: { W10: quantity } }).plans) {
    const line = plan.items.find(item => item.id === 'W10');
    assert.equal(line.quantity, quantity); assert.equal(line.total, 1500 * quantity); checkAmounts(plan);
  }
  assert.equal(catalog.find(item => item.id === 'W19').price, 11000, 'SKU path module is not the withdrawn language fee');
});

test('English plus additional languages retains only the English subtotal and one incremental language quotation', () => {
  const english = createRecommendation({ ...INPUT, languages: ['en'] });
  const mixedInput = { ...INPUT, languages: ['en', 'ar', 'fr'] };
  const mixed = createRecommendation(mixedInput);
  for (let i = 0; i < 3; i++) {
    const plan = mixed.plans[i]; checkAmounts(plan);
    assert.equal(plan.total, english.plans[i].total); assert.equal(plan.pricingLanguageBasis, 'multilingual');
    assert.equal(plan.totalLabel, '英语部分服务费小计'); assert.equal(plan.withinBudget, null); assert.equal(plan.remainingBudget, null);
    assert.equal(plan.pendingItems.filter(item => item.id === 'LANGUAGE_SCOPE').length, 1);
    const scope = plan.pendingItems.find(item => item.id === 'LANGUAGE_SCOPE');
    assert.deepEqual(scope.parameters.languages, ['ar', 'fr']);
    assert.equal(scope.parameters.modules.find(item => item.id === 'W10').quantity, plan.items.find(item => item.id === 'W10').quantity);
    assert.match(scope.reason, /共享研究.*复用/); assert.match(scope.reason, /专业术语.*审校/);
    assert.doesNotMatch(scope.details.join(' '), /英文渠道适配/);
    assert.deepEqual(customizePlan(plan, mixedInput, {}), plan);
  }
});

test('only non-English services keep editable IDs and quantities while all amounts remain explicitly unpriced', () => {
  const input = { ...INPUT, languages: ['ar', 'ja'], modules: { W08: 2, W10: 5 } };
  const result = createRecommendation(input);
  for (const plan of result.plans) {
    checkAmounts(plan); assert.equal(plan.total, 0); assert.equal(plan.items.length, 0);
    assert.equal(plan.pricingStatus, 'quote_required'); assert.equal(plan.pricingLanguageBasis, 'localized');
    assert.equal(plan.withinBudget, null); assert.equal(plan.remainingBudget, null); assert.equal(plan.configurationRequired, false);
    assert.equal(plan.pendingItems.find(item => item.id === 'W10').quantity, 5);
    for (const line of plan.pendingItems) { assert.doesNotMatch(line.name, /英文/); assert.deepEqual(line.parameters.languages, ['ar', 'ja']); }
    assert.deepEqual(customizePlan(plan, input, input.modules), plan);
    const changed = customizePlan(plan, input, { W08: 0, W10: 2 });
    assert.ok(!changed.pendingItems.some(item => item.id === 'W08')); assert.equal(changed.pendingItems.find(item => item.id === 'W10').quantity, 2);
  }
});

test('switching between English and other languages restores trusted amounts without losing manual selections or core minimums', () => {
  const englishInput = { ...INPUT, languages: ['en'], modules: { W08: 2, W10: 4 } };
  const base = createRecommendation(englishInput).plans[1];
  const localizedInput = { ...englishInput, languages: ['ar'] };
  const localized = customizePlan(base, localizedInput, englishInput.modules);
  assert.equal(localized.total, 0); assert.deepEqual(localized.coreMinimums, base.coreMinimums);
  assert.throws(() => customizePlan(localized, localizedInput, { W04: 0 }), /core_service_locked/);
  const restored = customizePlan(localized, englishInput, englishInput.modules);
  assert.equal(restored.total, base.total); assert.deepEqual(restored.items, base.items); assert.deepEqual(restored.pendingItems, []);
  assert.equal(restored.totalLabel, '当前方案服务费合计'); assert.equal(restored.pricingLanguageBasis, 'english');
  assert.deepEqual(customizePlan(restored, englishInput, englishInput.modules), restored);
});

test('manually added localized research stays optional and reversible after repeated customization', () => {
  const input = { ...INPUT, budget: 20000, goal: 'content', languages: ['ar'] };
  const base = createRecommendation(input).plans[0];
  for (const id of ['W01', 'W04', 'MON_BASE_15']) {
    const added = customizePlan(base, input, { [id]: 1 });
    assert.equal(added.pendingItems.find(item => item.id === id).required, false);
    assert.deepEqual(customizePlan(added, input, { [id]: 1 }), added);
    const removed = customizePlan(added, input, { [id]: 0 }); assert.ok(!removed.pendingItems.some(item => item.id === id));
  }
});

test('the retired W20 fixed multi-language price stays unpriced, hidden, and never duplicates LANGUAGE_SCOPE', () => {
  assert.equal(catalog.find(item => item.id === 'W20').price, null);
  assert.equal(getOptionalServices('overseas').find(item => item.id === 'W20').optional, false);
  for (const languages of [['en'], ['en', 'ar'], ['ar']]) {
    const input = { ...INPUT, languages, modules: { W20: 1 } };
    for (const plan of createRecommendation(input).plans) {
      checkAmounts(plan); assert.ok(!plan.items.some(item => item.id === 'W20'));
      const legacy = plan.pendingItems.find(item => item.id === 'W20'); assert.ok(legacy);
      assert.ok(!plan.pendingItems.some(item => item.id === 'LANGUAGE_SCOPE'));
      assert.match(`${legacy.reason} ${legacy.details.join(' ')}`, /复用.*本地化.*审校/);
      assert.deepEqual(customizePlan(plan, input, input.modules), plan);
    }
  }
});

test('Chinese plans remain fixed to Chinese and Chinese adaptation names do not inherit the English label', () => {
  const input = { ...INPUT, market: 'cn', languages: ['zh'] };
  for (const plan of createRecommendation(input).plans) { assert.equal(plan.total, 50000); assert.deepEqual(plan.languages, ['zh']); assert.ok(!plan.pendingItems.length); }
  assert.doesNotMatch(cnCatalog.find(item => item.id === 'CN_W10').name, /英文/);
});

test('AI receives canonical selected languages and cannot return an override; provider failure preserves the selection', async t => {
  const input = { ...INPUT, languages: ['en', 'ar'], modules: { W10: 4 } };
  let body;
  await analyze(input, { DEEPSEEK_API_KEY: 'test-only-placeholder' }, async (_url, options) => { body = JSON.parse(options.body); return response(); });
  assert.deepEqual(JSON.parse(body.messages[1].content).languages, ['en', 'ar']);
  assert.match(body.messages[0].content, /languages.*不得增加、删除、更换/);
  assert.throws(() => validateAnalysis({ ...ANALYSIS, languages: ['en'] }));
  t.mock.method(globalThis, 'fetch', async () => response({ ...ANALYSIS, languages: ['en'] }));
  const request = new Request('https://recommend.eco-geo.org/api/recommend', { method: 'POST', headers: { Origin: 'https://eco-geo.org', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10' }, body: JSON.stringify(input) });
  const result = await (await worker.fetch(request, { DEEPSEEK_API_KEY: 'test-only-placeholder', ADVISOR_RATE_LIMIT: { async limit() { return { success: true }; } } })).json();
  assert.equal(result.source, 'rules'); assert.deepEqual(result.languages, ['en', 'ar']);
  for (const plan of result.plans) { assert.equal(plan.items.find(item => item.id === 'W10').quantity, 4); assert.ok(plan.pendingItems.some(item => item.id === 'LANGUAGE_SCOPE')); }
});

test('consultation summaries identify service languages and distinguish the English subtotal from additional language quotations', () => {
  const input = { ...INPUT, languages: ['en', 'ar', 'other'], notes: '其他语种是泰语；已有事实资料可复用。' };
  const result = createRecommendation(input), plan = result.plans[1];
  const summary = buildContactSummary(input, plan, result);
  assert.match(summary, /服务语种：英语、阿拉伯语、其他语种/);
  assert.match(summary, /英语部分服务费小计/); assert.match(summary, /不是完整报价/); assert.match(summary, /泰语/);
  const localizedInput = { ...INPUT, languages: ['ar'] };
  const localized = buildContactSummary(localizedInput, createRecommendation(localizedInput).plans[1]);
  assert.match(localized, /服务语种：阿拉伯语/); assert.match(localized, /尚未形成报价/); assert.doesNotMatch(localized, /已定价部分：¥0/);
});
