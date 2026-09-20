import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as planner from '../package-advisor/planner.mjs';
import * as pricing from '../package-advisor/catalog.mjs';
import worker from '../advisor-service/worker.mjs';
import {
  budgetToPosition, positionToBudget, SCALE_MIN, SCALE_REFERENCE_MAX,
  SCALE_FINITE_POSITION, SCALE_DISCUSS_POSITION, MAX_SAFE_BUDGET,
} from '../package-advisor/budget-ui.mjs';

const INPUT = { budget: 50000, budgetMode: 'amount', market: 'cn', scope: { productLines: 1, scenarios: 3, audiences: 3, intents: 30 }, goal: 'visibility', stage: 'growing', notes: '' };
const LISTENING = { enabled: true, platforms: ['微信公众号', '小红书'], depth: 'insights', cadence: 'weekly', markets: 1, languages: 1 };
const API = 'https://recommend.eco-geo.org/api/recommend';

beforeEach(t => t.mock.method(globalThis, 'fetch', async () => { throw new Error('test_network_disabled'); }));

function request(input) {
  return new Request(API, {
    method: 'POST',
    headers: { Origin: 'https://eco-geo.org', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
    body: JSON.stringify(input),
  });
}

function env() {
  return { ADVISOR_RATE_LIMIT: { async limit() { return { success: true }; } } };
}

function assertSubtotal(plan) {
  const priced = plan.items.filter(item => Number.isFinite(item.total));
  assert.equal(plan.total, priced.reduce((sum, item) => sum + item.total, 0));
  for (const item of priced) {
    assert.ok(Number.isSafeInteger(item.quantity) && item.quantity > 0);
    assert.equal(item.total, item.quantity * item.unitPrice);
  }
  for (const item of plan.pendingItems || []) {
    assert.equal(item.unitPrice, null);
    assert.equal(item.total, null);
  }
}

test('scale budget positions increase logarithmically and reserve a distinct discuss endpoint', () => {
  assert.equal(budgetToPosition(SCALE_MIN), 0);
  assert.equal(budgetToPosition(SCALE_REFERENCE_MAX), SCALE_FINITE_POSITION);
  assert.equal(positionToBudget(0), SCALE_MIN);
  assert.equal(positionToBudget(SCALE_FINITE_POSITION), SCALE_REFERENCE_MAX);
  assert.equal(budgetToPosition(null), SCALE_DISCUSS_POSITION);
  assert.equal(positionToBudget(SCALE_FINITE_POSITION + 1), null);
  assert.equal(positionToBudget(SCALE_DISCUSS_POSITION), null);
  let previous = 0;
  for (let position = 0; position <= SCALE_FINITE_POSITION; position += 10) {
    const value = positionToBudget(position);
    assert.ok(value >= previous);
    assert.ok(value >= SCALE_MIN && value <= SCALE_REFERENCE_MAX);
    assert.ok(Math.abs(budgetToPosition(value) - position) < 2);
    previous = value;
  }
  for (const value of [1000001, 2000000, 10000000, 25000000, MAX_SAFE_BUDGET]) {
    assert.ok(Number.isFinite(budgetToPosition(value)));
    assert.ok(budgetToPosition(value) <= SCALE_FINITE_POSITION);
  }
});

test('amount budgets above one million stay exact while discussion budgets stay null', () => {
  for (const budget of [1000001, 25000000, Number.MAX_SAFE_INTEGER]) {
    assert.equal(planner.validateInput({ ...INPUT, budget }).budget, budget);
    const result = planner.createRecommendation({ ...INPUT, budget });
    for (const plan of result.plans) {
      assertSubtotal(plan);
      assert.equal(plan.remainingBudget, plan.quoteRequired ? null : budget - plan.total);
    }
  }
  for (const budget of [1000001, 25000000, Number.MAX_SAFE_INTEGER]) {
    const result = planner.createRecommendation({ ...INPUT, market: 'overseas', budget });
    for (const plan of result.plans) {
      assert.equal(plan.quoteRequired, true);
      assert.equal(plan.withinBudget, null);
      assert.equal(plan.remainingBudget, null);
      assert.ok(plan.pendingItems.length > 0);
      assertSubtotal(plan);
    }
  }
  const input = { ...INPUT, budgetMode: 'discuss', budget: null };
  assert.equal(planner.validateInput(input).budget, null);
  const result = planner.createRecommendation(input);
  for (const plan of result.plans) {
    assert.equal(plan.withinBudget, null);
    assert.equal(plan.remainingBudget, null);
    assertSubtotal(plan);
  }
  for (const fields of [
    { budgetMode: 'amount', budget: null }, { budgetMode: 'discuss', budget: 50000 },
    { budgetMode: 'discuss', budget: 0 }, { budgetMode: 'unknown', budget: 50000 },
    { budgetMode: null, budget: 50000 },
  ]) assert.throws(() => planner.validateInput({ ...INPUT, ...fields }));
});

test('social listening keeps configured scope visible and unpriced rather than treating it as a free inclusion', () => {
  for (const market of ['cn', 'overseas']) {
    const input = { ...INPUT, budget: 100000, market, listening: LISTENING };
    for (const plan of planner.createRecommendation(input).plans) {
      const pending = plan.pendingItems.filter(item => item.id === 'SOCIAL_LISTENING');
      assert.equal(pending.length, 1);
      assert.deepEqual(pending[0].parameters, planner.validateInput(input).listening);
      assert.equal(pending[0].unitPrice, null);
      assert.equal(pending[0].total, null);
      assert.ok(pending[0].details.length > 0);
      assert.equal(plan.quoteRequired, true);
      assert.ok(['partial', 'quote_required'].includes(plan.pricingStatus));
      assert.equal(plan.withinBudget, null);
      assert.equal(plan.remainingBudget, null);
      assertSubtotal(plan);
    }
  }
});

test('social-listening parameters are bounded, deduplicated and reject embedded prices', () => {
  const normalized = planner.validateInput({ ...INPUT, listening: { ...LISTENING, platforms: ['微信', '微信', 'Reddit'] } });
  assert.deepEqual(normalized.listening.platforms, ['微信', 'Reddit']);
  const invalid = [
    { enabled: 'true' }, { platforms: '微信' }, { platforms: [''] },
    { platforms: ['x'.repeat(81)] }, { platforms: ['name\u0000control'] },
    { platforms: Array.from({ length: 21 }, (_, i) => `platform-${i}`) },
    { depth: 'everything' }, { cadence: 'instant' }, { markets: 0 }, { markets: 51 },
    { markets: 1.5 }, { languages: 0 }, { languages: 31 }, { languages: '2' },
    { price: 0 }, { cost: 1 }, { hourlyRate: 1 },
  ];
  for (const fields of invalid) assert.throws(() => planner.validateInput({ ...INPUT, listening: { ...LISTENING, ...fields } }), JSON.stringify(fields));
  for (const depth of ['mentions', 'insights', 'strategy']) for (const cadence of ['monthly', 'weekly', 'daily', 'realtime']) {
    assert.equal(planner.validateInput({ ...INPUT, listening: { ...LISTENING, depth, cadence } }).listening.depth, depth);
  }
  const unspecified = planner.createRecommendation({ ...INPUT, listening: { ...LISTENING, platforms: [] } });
  for (const plan of unspecified.plans) {
    const pending = plan.pendingItems.find(item => item.id === 'SOCIAL_LISTENING');
    assert.ok(pending.details.some(detail => /平台.*待确认/.test(detail)));
    assert.equal(plan.withinBudget, null);
  }
});

test('the worker preserves explicit client module choices even when AI asks for the opposite scope', async t => {
  const analysis = { prioritize: ['W12'], exclude: ['W08'], reuseFacts: false, summary: '根据现有资料先完成重点内容，并由客户确认事实与使用权限后安排发布。' };
  const fetcher = t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }] }));
  const input = { ...INPUT, market: 'overseas', budget: 120000, modules: { W08: 2, W12: 0 } };
  const response = await worker.fetch(request(input), { ...env(), DEEPSEEK_API_KEY: 'test-only-placeholder' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, 'deepseek');
  for (const plan of body.plans) {
    assert.equal(plan.items.find(item => item.id === 'W08').quantity, 2);
    assert.ok(!plan.items.some(item => item.id === 'W12'));
    assertSubtotal(plan);
  }
  assert.equal(fetcher.mock.callCount(), 1);
});

test('AI cannot import service IDs from the other market catalog', async t => {
  for (const [market, foreignId] of [['cn', 'W08'], ['overseas', 'CN_W08']]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ prioritize: [foreignId], exclude: [], reuseFacts: false, summary: '建议先确认产品资料与公开范围，再根据实际需求安排内容工作。' }) } }] }));
    const input = { ...INPUT, market };
    const response = await worker.fetch(request(input), { ...env(), DEEPSEEK_API_KEY: 'test-only-placeholder' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.source, 'rules');
    assert.ok(result.plans.every(plan => ![...plan.items, ...plan.pendingItems].some(item => item.id === foreignId)));
    if (market === 'cn') assert.ok(result.plans.every(plan => plan.items.find(item => item.id === 'CN_QUARTER')?.unitPrice === 50000));
  }
});

test('the Chinese quarterly base is exactly one 50000 unit and never borrows overseas line prices', () => {
  const result = planner.createRecommendation(INPUT);
  for (const plan of result.plans) {
    const core = plan.items.find(item => item.id === 'CN_QUARTER');
    assert.ok(core);
    assert.equal(core.unitPrice, 50000);
    assert.equal(core.quantity, 1);
    assert.equal(core.total, 50000);
    assert.equal(core.required, true);
    assert.equal(plan.total, 50000);
    assert.equal(plan.pricingStatus, 'priced');
    assert.deepEqual(plan.pendingItems, [], 'unselected Chinese extras must not become default paid scope');
    assert.ok(plan.items.every(item => item.id.startsWith('CN_')));
    assertSubtotal(plan);
  }
});

test('Chinese scope growth follows confirmed unit arithmetic rather than duplicating every topic by scene and audience', () => {
  for (const [scope, units] of [
    [{ productLines: 1, scenarios: 3, audiences: 3, intents: 30 }, 1],
    [{ productLines: 2, scenarios: 3, audiences: 3, intents: 30 }, 2],
    [{ productLines: 1, scenarios: 4, audiences: 3, intents: 30 }, 2],
    [{ productLines: 1, scenarios: 3, audiences: 4, intents: 30 }, 2],
    [{ productLines: 2, scenarios: 4, audiences: 4, intents: 30 }, 8],
    [{ productLines: 1, scenarios: 3, audiences: 3, intents: 31 }, 2],
    [{ productLines: 2, scenarios: 3, audiences: 3, intents: 90 }, 3],
  ]) {
    const result = planner.createRecommendation({ ...INPUT, budget: 1000000, scope });
    for (const plan of result.plans) {
      assert.equal(plan.items.find(item => item.id === 'CN_QUARTER').quantity, units);
      assert.equal(plan.total, 50000 * units);
      assert.deepEqual(plan.scope, scope);
      assert.equal(plan.pricingBreakdown.scopeUnits, scope.productLines * Math.ceil(scope.scenarios / 3) * Math.ceil(scope.audiences / 3));
      assert.equal(plan.pricingBreakdown.intentUnits, Math.ceil(scope.intents / 30));
      assert.equal(plan.pricingBreakdown.units, units);
      assert.equal(plan.pricingBreakdown.unitPrice, 50000);
      assertSubtotal(plan);
    }
  }
});

test('intent scope is explicitly deduplicated and is not inflated by alternative wording or nine segment combinations', () => {
  const result = planner.createRecommendation(INPUT);
  for (const plan of result.plans) {
    assert.equal(plan.scope.intents, 30);
    assert.equal(plan.pricingBreakdown.units, 1);
    assert.match(plan.pricingBreakdown.intentDefinition, /去重/);
    assert.match(plan.pricingBreakdown.intentDefinition, /改写|同义|措辞/);
    assert.match(plan.pricingBreakdown.scopeBasis, /产品线|场景|客群/);
  }
});

test('expanded overseas scope stays pending while confirmed Chinese standard units are priced', () => {
  const scope = { ...INPUT.scope, productLines: 2 };
  const overseas = planner.createRecommendation({ ...INPUT, market: 'overseas', budget: 150000, scope });
  for (const plan of overseas.plans) {
    const expansion = plan.pendingItems.find(item => item.id === 'OVERSEAS_SCOPE');
    assert.ok(expansion);
    assert.equal(expansion.required, true);
    assert.equal(plan.quoteRequired, true);
    assert.equal(plan.withinBudget, null);
    assert.equal(plan.remainingBudget, null);
    assertSubtotal(plan);
  }
  const chinese = planner.createRecommendation({ ...INPUT, budget: 150000, scope }).plans[0];
  assert.equal(chinese.total, 100000);
  assert.equal(chinese.pricingStatus, 'priced');
  assert.ok(!chinese.pendingItems.some(item => item.id === 'OVERSEAS_SCOPE'));
});

test('the largest valid Chinese scope keeps its exact core quantity beyond optional-module limits', () => {
  const scope = { productLines: 100, scenarios: 100, audiences: 100, intents: 1000 };
  const quantity = 100 * Math.ceil(100 / 3) ** 2;
  const input = { ...INPUT, scope, budget: Number.MAX_SAFE_INTEGER, modules: { CN_QUARTER: quantity } };
  for (const plan of planner.createRecommendation(input).plans) {
    assert.equal(plan.items.find(item => item.id === 'CN_QUARTER').quantity, quantity);
    assert.equal(plan.total, 50000 * quantity);
    assertSubtotal(plan);
  }
});

test('Chinese extras stay pending instead of inheriting a numeric overseas tariff', () => {
  const options = pricing.getOptionalServices('cn');
  const addon = options.find(item => item.id.startsWith('CN_W'));
  assert.ok(addon, 'Chinese add-ons must have their own identifiers');
  assert.ok(options.filter(item => item.id.startsWith('CN_W')).every(item => item.price === null));
  const input = { ...INPUT, budget: 100000, modules: { [addon.id]: 2 } };
  for (const plan of planner.createRecommendation(input).plans) {
    assert.equal(plan.total, 50000);
    assert.equal(plan.pricingStatus, 'partial');
    assert.equal(plan.quoteRequired, true);
    assert.equal(plan.withinBudget, null, 'unknown add-on prices cannot be declared within budget');
    assert.equal(plan.remainingBudget, null);
    assert.equal(plan.pricedSubtotalWithinBudget, true);
    const pending = plan.pendingItems.find(item => item.id === addon.id);
    assert.ok(pending);
    assert.equal(pending.quantity, 2);
    assert.equal(pending.unitPrice, null);
    assert.equal(pending.total, null);
    assertSubtotal(plan);
  }
});

test('manual optional quantities change only the requested units and preserve trusted arithmetic', () => {
  const input = { ...INPUT, market: 'overseas', budget: 120000 };
  const base = planner.createRecommendation(input).plans[1];
  const original = structuredClone(base);
  const changed = planner.customizePlan(base, input, { W08: 2, W12: 1 });
  assert.deepEqual(base, original, 'customization must not mutate the recommended starting plan');
  assert.equal(changed.items.find(item => item.id === 'W08').quantity, 2);
  assert.equal(changed.items.find(item => item.id === 'W12').quantity, 1);
  const prices = new Map(pricing.catalog.map(item => [item.id, item.price]));
  for (const item of changed.items.filter(item => item.unitPrice !== null)) assert.equal(item.unitPrice, prices.get(item.id));
  assertSubtotal(changed);
  assert.deepEqual(planner.customizePlan(changed, input, { W08: 2, W12: 1 }), changed, 'reapplying an absolute quantity must not add duplicate units');
  const removed = planner.customizePlan(changed, input, { W08: 0, W12: 0 });
  assert.ok(!removed.items.some(item => ['W08', 'W12'].includes(item.id)));
  assertSubtotal(removed);
});

test('an explicitly selected priced quantity is reported over budget rather than silently dropped or repriced', () => {
  const input = { ...INPUT, market: 'overseas', budget: 5000 };
  const base = planner.createRecommendation(input).plans[1];
  const plan = planner.customizePlan(base, input, { W08: 100 });
  assert.equal(plan.items.find(item => item.id === 'W08').quantity, 100);
  assert.equal(plan.items.find(item => item.id === 'W08').unitPrice, 6500);
  assert.ok(plan.total > input.budget);
  assert.equal(plan.pricedSubtotalWithinBudget, false);
  assert.equal(plan.withinBudget, false);
  assertSubtotal(plan);
});

test('required core scope cannot be deleted and nested client prices or invalid quantities are rejected', () => {
  const base = planner.createRecommendation(INPUT).plans[1];
  assert.throws(() => planner.customizePlan(base, INPUT, { CN_QUARTER: 0 }));
  assert.throws(() => planner.customizePlan(base, INPUT, { CN_QUARTER: 2 }));
  for (const selection of [
    { NONEXISTENT: 1 }, { CN_W08: -1 }, { CN_W08: 1.5 }, { CN_W08: '1' },
    { CN_W08: null }, { CN_W08: Infinity }, { CN_W08: Number.MAX_SAFE_INTEGER + 1 },
    { CN_W08: { quantity: 1, price: 1 } }, { CN_W04: 1 }, { price: 1 }, { total: 1 },
  ]) assert.throws(() => planner.customizePlan(base, INPUT, selection), JSON.stringify(selection));
});

test('explicit module choices take precedence over AI exclusions and additions', () => {
  const input = { ...INPUT, market: 'overseas', budget: 120000, modules: { W08: 2, W12: 0 } };
  const preferences = { prioritize: ['W12'], exclude: ['W08'], reuseFacts: false };
  for (const plan of planner.createRecommendation(input, preferences).plans) {
    assert.equal(plan.items.find(item => item.id === 'W08').quantity, 2);
    assert.ok(!plan.items.some(item => item.id === 'W12'));
    assertSubtotal(plan);
  }
});

test('PR customization adds its necessary setup and changing monitor scope never creates duplicate monitors', () => {
  const input = { ...INPUT, market: 'overseas', budget: 200000 };
  const base = planner.createRecommendation(input).plans[1];
  const pitch = planner.customizePlan(base, input, { PITCH: 1 });
  assert.equal(pitch.items.find(item => item.id === 'PITCH').quantity, 1);
  assert.equal(pitch.items.find(item => item.id === 'PITCH_SETUP').quantity, 1);
  assertSubtotal(pitch);
  const noPitch = planner.customizePlan(pitch, input, { PITCH: 0 });
  assert.ok(!noPitch.items.some(item => ['PITCH', 'PITCH_SETUP'].includes(item.id)));
  assertSubtotal(noPitch);
  const monitored = planner.customizePlan(base, input, { MON_90_60: 1 });
  const monitors = monitored.items.filter(item => item.id.startsWith('MON_'));
  assert.equal(monitors.length, 1);
  assert.equal(monitors[0].id, 'MON_90_60');
  const questions = monitored.items.find(item => item.id === 'W04')?.quantity * 30 || 0;
  assert.ok(questions >= 60 || monitored.assumptions.some(value => /客户.*(?:已有|提供).*题库|客户.*已审核.*问题/.test(value)));
  assertSubtotal(monitored);
});

test('market and scope fields reject malformed, excess and nested price override values', () => {
  const invalid = [
    { market: 'any' }, { market: 'CN' }, { market: null }, { scope: [] }, { scope: null },
    ...['productLines', 'scenarios', 'audiences'].flatMap(key => [0, 101, 1.5, '1', null].map(value => ({ scope: { ...INPUT.scope, [key]: value } }))),
    ...[0, 1001, 30.5, '30', null].map(intents => ({ scope: { ...INPUT.scope, intents } })),
    { scope: { ...INPUT.scope, price: 1 } }, { scope: { ...INPUT.scope, units: 0 } },
  ];
  for (const fields of invalid) assert.throws(() => planner.validateInput({ ...INPUT, ...fields }), JSON.stringify(fields));
});

test('new structured fields pass through the worker validator and unknown fields fail before inference', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', async () => { throw new Error('provider must remain offline'); });
  for (const input of [INPUT, { ...INPUT, budget: 25000000 }, { ...INPUT, budgetMode: 'discuss', budget: null }, { ...INPUT, listening: LISTENING }]) {
    const response = await worker.fetch(request(input), env());
    assert.equal(response.status, 200);
    for (const plan of (await response.json()).plans) assertSubtotal(plan);
  }
  for (const fields of [
    { unknown: true }, { scope: { ...INPUT.scope, total: 1 } }, { budget: null, budgetMode: 'amount' }, { market: 'invalid' },
    { market: null }, { budgetMode: null }, { scope: null },
    { listening: { ...LISTENING, price: 1 } }, { modules: { CN_W08: { quantity: 1, unitPrice: 1 } } },
    { modules: { UNKNOWN: 1 } }, { modules: { CN_W08: 101 } },
  ]) {
    const response = await worker.fetch(request({ ...INPUT, ...fields }), env());
    assert.equal(response.status, 400);
  }
  assert.equal(fetcher.mock.callCount(), 0);
});

test('inconsistent module combinations return a controlled 400 before limiting or invoking AI', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must_not_call_provider'); });
  let limited = 0;
  const configured = { DEEPSEEK_API_KEY: 'test-only-placeholder', ADVISOR_RATE_LIMIT: { async limit() { limited++; return { success: true }; } } };
  const input = { ...INPUT, market: 'overseas', budget: 50000, goal: 'visibility', stage: 'starting' };
  for (const modules of [{ W04: 0 }, { W01: 0 }, { MON_BASE_15: 0 }, { MON_BASE_15: 1, MON_BASE_30: 1 }]) {
    assert.doesNotThrow(() => planner.validateInput({ ...input, modules }), 'this case exercises configuration semantics after schema validation');
    const response = await worker.fetch(request({ ...input, modules }), configured);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_configuration' });
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://eco-geo.org');
  }
  assert.equal(limited, 0);
  assert.equal(fetcher.mock.callCount(), 0);
});

test('existing overseas core units allow explicit increases without changing their minimum or trusted price', () => {
  const input = { ...INPUT, market: 'overseas', budget: 50000, goal: 'visibility', stage: 'starting' };
  for (const id of ['W01', 'W04']) {
    const result = planner.createRecommendation({ ...input, modules: { [id]: 2 } });
    for (const plan of result.plans) {
      assert.equal(plan.items.find(item => item.id === id).quantity, 2);
      assertSubtotal(plan);
    }
    const base = planner.createRecommendation(input).plans.find(plan => plan.items.some(item => item.id === id));
    const raised = planner.customizePlan(base, input, { [id]: 2 });
    const restored = planner.customizePlan(raised, input, { [id]: 1 });
    assert.equal(restored.items.find(item => item.id === id).quantity, 1, 'adding one unit must not permanently raise the core minimum');
    assert.throws(() => planner.customizePlan(raised, input, { [id]: 0 }));
    assertSubtotal(restored);
  }
});

test('manually added research and monitoring modules remain reversible when absent from the base scope', () => {
  const input = { ...INPUT, market: 'overseas', budget: 20000, goal: 'content', stage: 'growing' };
  const base = planner.createRecommendation(input).plans[0];
  for (const id of ['W01', 'W04', 'MON_BASE_15']) {
    assert.ok(!base.items.some(item => item.id === id));
    const added = planner.customizePlan(base, input, { [id]: 1 });
    const row = added.items.find(item => item.id === id);
    assert.equal(row.required, false);
    assert.equal(row.optional, true);
    const removed = planner.customizePlan(added, input, { [id]: 0 });
    assert.ok(!removed.items.some(item => item.id === id));
    assert.equal(removed.total, base.total);
    assertSubtotal(removed);
  }
});

test('provider failure reuses the valid customized baseline and preserves explicit added quantities', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', async () => { throw new Error('provider_unavailable'); });
  const input = { ...INPUT, market: 'overseas', budget: 50000, goal: 'visibility', stage: 'starting', modules: { W04: 2, W01: 2 } };
  const expected = planner.createRecommendation(input);
  const response = await worker.fetch(request(input), { ...env(), DEEPSEEK_API_KEY: 'test-only-placeholder' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, 'rules');
  assert.deepEqual(body.plans, expected.plans);
  assert.equal(fetcher.mock.callCount(), 1);
});
