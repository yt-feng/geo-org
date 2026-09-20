import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeEach, test } from 'node:test';
import { catalog, cnCatalog, getOptionalServices, OVERSEAS_LANGUAGES } from '../package-advisor/catalog.mjs';
import { createRecommendation, customizePlan, validateInput } from '../package-advisor/planner.mjs';
import { estimateServiceUnitPrice, estimateServicePricing } from '../package-advisor/pricing.mjs';
import { analyze, validateAnalysis } from '../advisor-service/worker.mjs';
import worker from '../advisor-service/worker.mjs';
import { buildContactSummary } from '../package-advisor/handoff.mjs';

const INPUT = { market: 'overseas', budget: 50000, goal: 'visibility', stage: 'growing' };
const ANALYSIS = { prioritize: ['W08'], exclude: [], reuseFacts: false, summary: '建议先核对已有事实和产品资料，再确认所选语种的本地表达、渠道适配与审校范围。具体交付以所选套餐明细为准。' };
beforeEach(t => t.mock.method(globalThis, 'fetch', async () => { throw new Error('test_network_disabled'); }));
const response = (analysis = ANALYSIS) => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }] });
function checkAmounts(plan) {
  assert.equal(plan.pricingStatus, 'estimate');
  assert.equal(plan.estimated, true);
  assert.equal(plan.quoteRequired, false);
  assert.deepEqual(plan.pendingItems, []);
  assert.equal(plan.total, plan.items.reduce((sum, item) => sum + item.total, 0));
  for (const item of plan.items) {
    assert.ok(Number.isSafeInteger(item.unitPrice) && item.unitPrice > 0);
    assert.equal(item.total, item.unitPrice * item.quantity);
    assert.ok(item.pricingDetails.length > 0);
    assert.equal(item.pricingDetails.reduce((sum, part) => sum + part.amount, 0), item.total);
    for (const part of item.pricingDetails) assert.equal(part.amount, part.unitPrice * part.quantity);
  }
}

test('language selection defaults by market, deduplicates allowed codes and rejects cross-market or malformed values', () => {
  assert.deepEqual(validateInput(INPUT).languages, ['en']);
  assert.deepEqual(validateInput({ ...INPUT, market: 'cn' }).languages, ['zh']);
  assert.deepEqual(validateInput({ ...INPUT, languages: ['en', 'ar', 'en'] }).languages, ['en', 'ar']);
  for (const languages of [null, [], 'en', ['zh'], ['EN'], ['it'], ['en', { price: 1 }], [true]]) assert.throws(() => validateInput({ ...INPUT, languages }));
  for (const languages of [['en'], ['zh', 'en'], [], null]) assert.throws(() => validateInput({ ...INPUT, market: 'cn', languages }));
});

test('every supported overseas language is available without opening a collapsed language disclosure', async () => {
  const page = await readFile(new URL('../package-advisor/index.html', import.meta.url), 'utf8');
  for (const language of OVERSEAS_LANGUAGES) assert.match(page, new RegExp(`name="service-language"[^>]*value="${language}"`));
  const disclosure = page.match(/<details\b[^>]*class="[^"]*\blanguage-more\b[^"]*"[^>]*>/)?.[0];
  if (disclosure) assert.match(disclosure, /\bopen(?:\s|=|>)/);
});

test('English W10 remains 1500 per article and quoted quantities count articles directly', () => {
  const adaptation = catalog.find(item => item.id === 'W10');
  assert.equal(adaptation.price, 1500); assert.equal(adaptation.unit, '篇');
  assert.doesNotMatch(JSON.stringify(adaptation), /3条包|3条实质/);
  const result = createRecommendation(INPUT);
  assert.equal(result.plans[1].items.find(item => item.id === 'W10').quantity, 3);
  assert.equal(result.plans[1].items.find(item => item.id === 'W10').total, 4500);
  for (const quantity of [1, 3, 5]) for (const plan of createRecommendation({ ...INPUT, modules: { W10: quantity } }).plans) {
    const line = plan.items.find(item => item.id === 'W10');
    assert.equal(line.quantity, quantity); assert.equal(line.total, 1500 * quantity); checkAmounts(plan);
  }
});

test('channel execution charges each selected language while original content reuses its research', () => {
  for (const [languages, expected] of [
    [['en'], 1500], [['ar'], 2250], [['fr'], 1950], [['ru'], 2100], [['other'], 2400],
    [['en', 'ar'], 3750], [['ar', 'ja'], 4500], [OVERSEAS_LANGUAGES, 20550],
  ]) {
    const input = { ...INPUT, languages };
    assert.equal(estimateServiceUnitPrice('W10', input), expected);
    const estimate = estimateServicePricing('W10', input, 3);
    assert.equal(estimate.unitPrice, expected);
    assert.equal(estimate.pricingDetails.reduce((sum, part) => sum + part.amount, 0), expected * 3);
  }
  assert.equal(estimateServiceUnitPrice('W08', { ...INPUT, languages: ['en', 'ar', 'fr'] }), 15600);
});

test('language selection order and duplicates cannot change the estimate or charge shared research repeatedly', () => {
  const variants = [['en', 'ar', 'fr'], ['fr', 'ar', 'en'], ['ar', 'en', 'fr', 'ar']];
  for (const id of ['W08', 'W10', 'MON_90_15']) {
    const prices = variants.map(languages => estimateServiceUnitPrice(id, { ...INPUT, languages }));
    assert.equal(new Set(prices).size, 1);
  }
  assert.equal(estimateServiceUnitPrice('W10', { ...INPUT, languages: ['fr', 'ar'] }), estimateServiceUnitPrice('W10', { ...INPUT, languages: ['ar', 'fr'] }));
  for (const id of ['W01', 'W03', 'W04', 'W05', 'W06', 'W19', 'W21', 'W22', 'W23', 'W24', 'W27', 'W28', 'W29', 'W30', 'W31', 'PITCH_SETUP']) {
    assert.equal(estimateServiceUnitPrice(id, { ...INPUT, languages: OVERSEAS_LANGUAGES }), catalog.find(item => item.id === id).price);
  }
});

test('monitoring charges each actual language and scales planned observations without multiplying deduplicated questions', () => {
  const monitor = catalog.find(item => item.id === 'MON_90_15');
  assert.equal(estimateServiceUnitPrice(monitor.id, { ...INPUT, languages: ['en', 'ar'] }), monitor.price * 2.5);
  const plan = customizePlan(createRecommendation(INPUT).plans[1], { ...INPUT, languages: ['en', 'ar'] });
  checkAmounts(plan);
  assert.equal(plan.sampling.questions, monitor.sampling.questions);
  assert.equal(plan.sampling.languageCount, 2);
  assert.deepEqual(new Set(plan.sampling.languages), new Set(['en', 'ar']));
  assert.equal(plan.sampling.plannedAnswersPerLanguage, monitor.sampling.plannedAnswers);
  assert.equal(plan.sampling.plannedAnswers, monitor.sampling.plannedAnswers * 2);
});

test('mixed-language preliminary totals include every selected language and preserve exact line sums', () => {
  const input = { ...INPUT, languages: ['en', 'ar', 'fr'] };
  const english = createRecommendation({ ...INPUT, languages: ['en'] });
  const mixed = { plans: english.plans.map(plan => customizePlan(plan, input)) };
  for (let i = 0; i < 3; i++) {
    const plan = mixed.plans[i]; checkAmounts(plan);
    assert.ok(plan.total > english.plans[i].total);
    assert.doesNotMatch(plan.totalLabel, /英语部分/);
    assert.equal(plan.withinBudget, plan.total <= input.budget);
    assert.equal(plan.remainingBudget, input.budget - plan.total);
    assert.deepEqual(customizePlan(plan, input, {}), plan);
  }
});

test('only non-English services have numeric estimates and retain editable module IDs and quantities', () => {
  const input = { ...INPUT, languages: ['ar', 'ja'], modules: { W08: 2, W10: 5 } };
  for (const plan of createRecommendation(input).plans) {
    checkAmounts(plan); assert.ok(plan.total > 0);
    assert.equal(plan.items.find(item => item.id === 'W10').quantity, 5);
    assert.equal(plan.items.find(item => item.id === 'W10').total, 4500 * 5);
    assert.deepEqual(customizePlan(plan, input, input.modules), plan);
    const changed = customizePlan(plan, input, { W08: 0, W10: 2 });
    assert.ok(!changed.items.some(item => item.id === 'W08'));
    assert.equal(changed.items.find(item => item.id === 'W10').quantity, 2);
    checkAmounts(changed);
  }
});

test('switching languages restores trusted amounts without losing manual selections or core minimums', () => {
  const englishInput = { ...INPUT, languages: ['en'], modules: { W08: 2, W10: 4 } };
  const base = createRecommendation(englishInput).plans[1];
  const localizedInput = { ...englishInput, languages: ['ar'] };
  const localized = customizePlan(base, localizedInput, englishInput.modules);
  assert.ok(localized.total > base.total); assert.deepEqual(localized.coreMinimums, base.coreMinimums);
  assert.throws(() => customizePlan(localized, localizedInput, { W04: 0 }), /core_service_locked/);
  const restored = customizePlan(localized, englishInput, englishInput.modules);
  assert.equal(restored.total, base.total); assert.deepEqual(restored.items, base.items); assert.deepEqual(restored.pendingItems, []);
  assert.deepEqual(customizePlan(restored, englishInput, englishInput.modules), restored);
});

test('manually added localized research stays optional and reversible after repeated customization', () => {
  const input = { ...INPUT, budget: 20000, goal: 'content', languages: ['ar'] };
  const base = createRecommendation(input).plans[0];
  for (const id of ['W01', 'W04', 'MON_BASE_15']) {
    const added = customizePlan(base, input, { [id]: 1 });
    assert.equal(added.items.find(item => item.id === id).required, false);
    assert.deepEqual(customizePlan(added, input, { [id]: 1 }), added);
    const removed = customizePlan(added, input, { [id]: 0 }); assert.ok(!removed.items.some(item => item.id === id));
    assert.equal(removed.total, base.total);
  }
});

test('retired W20 aliases stay hidden and cannot add a second localization fee', () => {
  assert.equal(getOptionalServices('overseas').find(item => item.id === 'W20').optional, false);
  for (const languages of [['en'], ['en', 'ar'], ['ar']]) {
    const input = { ...INPUT, languages };
    const base = createRecommendation(input);
    const legacyInput = { ...input, modules: { W20: 1 } };
    createRecommendation(legacyInput).plans.forEach((plan, index) => {
      checkAmounts(plan); assert.ok(!plan.items.some(item => item.id === 'W20'));
      assert.equal(plan.total, base.plans[index].total);
      assert.deepEqual(customizePlan(plan, legacyInput, legacyInput.modules), plan);
    });
  }
});

test('Chinese plans remain fixed to Chinese and Chinese adaptation names do not inherit the English label', () => {
  const input = { ...INPUT, market: 'cn', languages: ['zh'] };
  for (const plan of createRecommendation(input).plans) { assert.equal(plan.total, 50000); assert.deepEqual(plan.languages, ['zh']); checkAmounts(plan); }
  assert.doesNotMatch(cnCatalog.find(item => item.id === 'CN_W10').name, /英文/);
});

test('AI receives canonical languages but cannot override them, and fallback retains manual quantities and estimates', async t => {
  const input = { ...INPUT, languages: ['en', 'ar'], modules: { W10: 4 } };
  let body;
  await analyze(input, { DEEPSEEK_API_KEY: 'test-only-placeholder' }, async (_url, options) => { body = JSON.parse(options.body); return response(); });
  assert.deepEqual(JSON.parse(body.messages[1].content).languages, ['en', 'ar']);
  assert.throws(() => validateAnalysis({ ...ANALYSIS, languages: ['en'] }));
  t.mock.method(globalThis, 'fetch', async () => response({ ...ANALYSIS, languages: ['en'] }));
  const request = new Request('https://recommend.eco-geo.org/api/recommend', { method: 'POST', headers: { Origin: 'https://eco-geo.org', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10' }, body: JSON.stringify(input) });
  const result = await (await worker.fetch(request, { DEEPSEEK_API_KEY: 'test-only-placeholder', ADVISOR_RATE_LIMIT: { async limit() { return { success: true }; } } })).json();
  assert.equal(result.source, 'rules'); assert.deepEqual(result.languages, ['en', 'ar']);
  for (const plan of result.plans) { assert.equal(plan.items.find(item => item.id === 'W10').quantity, 4); checkAmounts(plan); }
});

test('consultation summaries carry the full preliminary estimate and never label all languages as an English subtotal', () => {
  for (const languages of [['en', 'ar', 'other'], ['ar']]) {
    const input = { ...INPUT, languages, notes: '其他语种是泰语；已有事实资料可复用。' };
    const result = createRecommendation(input), plan = result.plans[1];
    const summary = buildContactSummary(input, plan, result);
    assert.match(summary, /服务语种：/); assert.match(summary, /阿拉伯语/); assert.match(summary, /泰语/);
    assert.ok(summary.includes(`¥${plan.total.toLocaleString('zh-CN')}`));
    assert.match(summary, /初步|预估|估价/);
    assert.doesNotMatch(summary, /英语部分服务费小计|尚未形成报价|已定价部分：¥0/);
  }
});
