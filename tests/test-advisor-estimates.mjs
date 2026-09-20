import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecommendation, customizePlan, PREFERENCE_SERVICES } from '../package-advisor/planner.mjs';
import { estimateServiceUnitPrice } from '../package-advisor/pricing.mjs';
import { OVERSEAS_LANGUAGES, getOptionalServices } from '../package-advisor/catalog.mjs';

const INPUT = { market: 'overseas', languages: ['en'], budget: 1000000, budgetMode: 'amount', goal: 'visibility', stage: 'growing', notes: '', scope: { productLines: 1, scenarios: 3, audiences: 3, intents: 30 } };
const SCOPE_TEMPLATE = { id: 'recommended', name: '范围服务', description: '按所选范围配置季度服务。', items: [], coreMinimums: {}, enterprise: true };
const LISTENING = { enabled: true, platforms: ['reddit'], depth: 'mentions', cadence: 'monthly', markets: 1, languages: 1 };
function check(plan, input) {
  assert.equal(plan.total, plan.items.reduce((sum, item) => sum + item.total, 0));
  assert.equal(plan.pricingStatus, 'estimate');
  assert.equal(plan.estimated, true);
  assert.equal(plan.quoteRequired, false);
  assert.deepEqual(plan.pendingItems, []);
  assert.equal(plan.withinBudget, input.budget === null ? null : plan.total <= input.budget);
  assert.equal(plan.remainingBudget, input.budget === null ? null : input.budget - plan.total);
  for (const item of plan.items) {
    assert.ok(Number.isSafeInteger(item.total) && item.total > 0);
    assert.equal(item.total, item.quantity * item.unitPrice);
    assert.equal(item.pricingDetails.reduce((sum, part) => sum + part.amount, 0), item.total);
    for (const part of item.pricingDetails) assert.equal(part.amount, part.quantity * part.unitPrice);
  }
}

test('social listening quarterly estimates use bounded parameters, deduplicated platforms and upward hundred-yuan rounding', () => {
  const depthRates = { mentions: 15000, insights: 45000, strategy: 120000 };
  const cadenceFactors = { monthly: 1, weekly: 2, daily: 4, realtime: 8 };
  for (const [depth, rate] of Object.entries(depthRates)) for (const [cadence, cadenceFactor] of Object.entries(cadenceFactors)) {
    const listening = { ...LISTENING, platforms: ['reddit', 'reddit', 'linkedin'], depth, cadence, markets: 2, languages: 2 };
    const input = { ...INPUT, listening };
    const expected = Math.ceil(2 * rate * cadenceFactor * 1.55 / 100) * 100;
    for (const plan of createRecommendation(input).plans) {
      const row = plan.items.find(item => item.id === 'SOCIAL_LISTENING');
      assert.equal(row.total, expected);
      assert.equal(plan.items.filter(item => item.id === row.id).length, 1);
      check(plan, input);
      const removed = customizePlan(plan, input, { SOCIAL_LISTENING: 0 });
      assert.equal(removed.total, plan.total - expected);
      assert.ok(!removed.items.some(item => item.id === 'SOCIAL_LISTENING'));
    }
  }
});

test('enterprise estimates depend on declared scope and chosen modules rather than the available budget', () => {
  const reference = createRecommendation(INPUT).plans;
  for (const budget of [320001, 1000000, 25000000, Number.MAX_SAFE_INTEGER]) {
    const input = { ...INPUT, budget };
    for (const [index, plan] of createRecommendation(input).plans.entries()) {
      assert.ok(plan.total > 30000, 'enterprise work also includes its listed execution modules');
      assert.equal(plan.total, reference[index].total);
      assert.equal(plan.items.filter(item => item.id === 'OVERSEAS_SCOPE').length, 0, 'the template already covers the first scope unit');
      check(plan, input);
    }
  }
  const input = { ...INPUT, modules: { W08: 2, W10: 3 } };
  for (const plan of createRecommendation(input).plans) {
    assert.equal(plan.items.find(item => item.id === 'W08').quantity, 2);
    assert.equal(plan.items.find(item => item.id === 'W10').quantity, 3);
    assert.equal(plan.total, reference[0].total - 4500);
    check(plan, input);
    assert.deepEqual(customizePlan(plan, input, input.modules), plan);
  }
});

test('enterprise scope combines matrix and intent units with max rather than adding the two coverage measures', () => {
  for (const [scope, units] of [
    [{ productLines: 1, scenarios: 3, audiences: 3, intents: 31 }, 2],
    [{ productLines: 2, scenarios: 4, audiences: 4, intents: 90 }, 8],
    [{ productLines: 1, scenarios: 3, audiences: 3, intents: 90 }, 3],
    [{ productLines: 100, scenarios: 100, audiences: 100, intents: 1000 }, 115600],
  ]) {
    const input = { ...INPUT, scope, budget: Number.MAX_SAFE_INTEGER };
    const plan = customizePlan(SCOPE_TEMPLATE, input);
    assert.equal(plan.total, 30000 * units); check(plan, input);
  }
});

test('scope estimates deduct already-selected research and coordination without hiding requested excess quantities', () => {
  const scope = { ...INPUT.scope, productLines: 2 };
  const input = { ...INPUT, scope };
  for (const modules of [{ W04: 1 }, { W05: 2, W22: 3 }, { W04: 2, W05: 2, W22: 6 }, { W04: 3, W05: 2, W22: 6 }]) {
    const configured = { ...input, modules };
    for (const plan of [customizePlan(SCOPE_TEMPLATE, configured)]) {
      const remaining = Math.max(0, 2 - (modules.W04 || 0)) * 8500 + Math.max(0, 2 - (modules.W05 || 0)) * 11000 + Math.max(0, 6 - (modules.W22 || 0)) * 3500;
      const scopeLine = plan.items.find(item => item.id === 'OVERSEAS_SCOPE');
      assert.equal(scopeLine?.total || 0, remaining);
      if (!remaining) assert.equal(scopeLine, undefined, 'zero remainder must not create an extra scope fee');
      const manual = Object.entries(modules).reduce((sum, [id, quantity]) => sum + estimateServiceUnitPrice(id, configured) * quantity, 0);
      assert.equal(plan.total, manual + remaining);
      check(plan, configured);
      assert.deepEqual(customizePlan(plan, configured, modules), plan);
    }
  }
});

test('explicit scope-component exclusions are not secretly restored by the enterprise scope estimate', () => {
  const input = { ...INPUT, modules: { W04: 0 } };
  for (const plan of [customizePlan(SCOPE_TEMPLATE, input)]) {
    assert.equal(plan.total, 21500);
    assert.ok(!plan.items.some(item => item.id === 'W04'));
    check(plan, input);
  }
  const empty = { ...INPUT, modules: { W04: 0, W05: 0, W22: 0 } };
  for (const plan of [customizePlan(SCOPE_TEMPLATE, empty)]) {
    assert.deepEqual(plan.items, []); assert.equal(plan.total, 0);
    assert.equal(plan.configurationRequired, true); assert.equal(plan.quoteRequired, true);
    assert.equal(plan.withinBudget, null); assert.equal(plan.remainingBudget, null);
    assert.match(plan.description, /尚未形成报价|不是免费/);
  }
});

test('open budgets still receive scope-based estimates while budget comparison stays unavailable', () => {
  const input = { ...INPUT, budget: null, budgetMode: 'discuss', languages: ['en', 'ar'], modules: { W10: 3 } };
  const finite = createRecommendation({ ...input, budget: 1000000, budgetMode: 'amount' });
  for (const [index, plan] of createRecommendation(input).plans.entries()) {
    assert.ok(plan.total > 0);
    assert.equal(plan.total, finite.plans[index].total);
    check(plan, input);
    assert.equal(plan.pricedSubtotalWithinBudget, null);
  }
});

test('removed scope components remain excluded across later customization and can be explicitly restored', () => {
  const input = { ...INPUT, scope: { ...INPUT.scope, productLines: 2 } };
  const base = createRecommendation(input).plans[1];
  const removed = customizePlan(base, input, { W05: 0, W22: 0 });
  assert.ok(!removed.items.some(item => ['W05', 'W22'].includes(item.id)));
  for (const item of removed.items) for (const component of item.scopeComponents || []) assert.ok(!['W05', 'W22'].includes(component.id));
  assert.deepEqual(customizePlan(removed, input), removed);
  assert.deepEqual(customizePlan(removed, input, {}), removed);
  const restored = customizePlan(removed, input, { W05: 2, W22: 6 });
  assert.equal(restored.items.find(item => item.id === 'W05').quantity, 2);
  assert.equal(restored.items.find(item => item.id === 'W22').quantity, 6);
  assert.equal(restored.total - removed.total, 43000);
  check(restored, input);
});

test('a budget below every eligible multilingual service still receives the smallest executable numeric estimate', () => {
  const input = { ...INPUT, budget: 5000, languages: [...OVERSEAS_LANGUAGES] };
  const result = createRecommendation(input);
  for (const plan of result.plans) {
    assert.deepEqual(plan.items.map(item => [item.id, item.quantity]), [['W04', 1]]);
    assert.equal(plan.total, 8500);
    assert.equal(plan.withinBudget, false);
    assert.equal(plan.remainingBudget, -3500);
    assert.ok(plan.highlights.some(value => /超出.*预算/.test(value)));
    check(plan, input);
  }
});

test('the over-budget fallback never restores explicitly removed or preference-excluded candidates', () => {
  const input = { ...INPUT, budget: 5000, languages: [...OVERSEAS_LANGUAGES], modules: { W04: 0 } };
  const result = createRecommendation(input, { exclude: PREFERENCE_SERVICES });
  for (const plan of result.plans) {
    assert.deepEqual(plan.items.map(item => item.id), ['MON_BASE_15']);
    assert.equal(plan.total, estimateServiceUnitPrice('MON_BASE_15', input));
    assert.equal(plan.withinBudget, false);
    assert.ok(plan.assumptions.some(value => /题库|问题/.test(value)));
    check(plan, input);
  }
});

test('explicitly removing every available service keeps all small-budget goals unconfigured', () => {
  const modules = Object.fromEntries(getOptionalServices('overseas').map(item => [item.id, 0]));
  for (const goal of ['visibility', 'content', 'authority']) {
    const input = { ...INPUT, budget: 5000, languages: [...OVERSEAS_LANGUAGES], goal, modules };
    for (const plan of createRecommendation(input).plans) {
      assert.deepEqual(plan.items, []);
      assert.deepEqual(plan.pendingItems, []);
      assert.equal(plan.total, 0);
      assert.equal(plan.configurationRequired, true);
      assert.equal(plan.pricingStatus, 'quote_required');
      assert.equal(plan.quoteRequired, true);
      assert.equal(plan.withinBudget, null);
      assert.equal(plan.remainingBudget, null);
      assert.match(plan.description, /尚未形成报价|不是免费/);
    }
  }
});
