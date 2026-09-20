import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContactSummary, prepareContactHandoff, consumeContactHandoff, HANDOFF_KEY, HANDOFF_TTL } from '../package-advisor/handoff.mjs';

const input = { market: 'cn', budget: null, budgetMode: 'discuss', scope: { productLines: 2, scenarios: 3, audiences: 3, intents: 60 }, notes: '已有材料，请优先复用。', modules: { CN_W10: 0 }, listening: { enabled: true, platforms: ['weibo', 'xiaohongshu'], depth: 'insights', cadence: 'weekly', markets: 1, languages: 1 } };
const plan = { name: '中文季度服务', total: 280000, pricingStatus: 'estimate', estimated: true, quoteRequired: false, items: [{ id: 'CN_QUARTER', name: '中文季度标准单元', quantity: 2, unit: '单元', unitPrice: 50000, total: 100000 }, { id: 'SOCIAL_LISTENING', name: 'Social listening', quantity: 1, unit: '季度', unitPrice: 180000, total: 180000 }], pendingItems: [] };
function storage() {
  const values = new Map();
  return { values, setItem: (key, value) => values.set(key, value), getItem: key => values.get(key), removeItem: key => values.delete(key) };
}

test('consultation summary retains scope, preliminary totals and notes without private fields', () => {
  const summary = buildContactSummary(input, { ...plan, margin: 0.9, internalCost: 1 });
  for (const text of ['另行讨论', '2 条产品线', '60 个去重意图主题', '¥280,000', '¥100,000', '¥180,000', '初步服务费合计', '实际以正式报价单为准', 'Social listening', '本次明确不选：中文 · 渠道适配与上稿', input.notes]) assert.ok(summary.includes(text), text);
  assert.doesNotMatch(summary, /margin|internalCost|毛利|¥0/);
});

test('explicit handoff is one-time, tab-scoped and expires without a network request', () => {
  const store = storage();
  assert.equal(prepareContactHandoff(input, plan, {}, store, 1000), true);
  assert.ok(consumeContactHandoff(store, 1001).includes('中文季度服务'));
  assert.equal(consumeContactHandoff(store, 1001), null);
  prepareContactHandoff(input, plan, {}, store, 1000);
  assert.equal(consumeContactHandoff(store, 1000 + HANDOFF_TTL + 1), null);
  assert.equal(store.values.size, 0);
});

test('unavailable storage and malformed or future-dated drafts fail safely', () => {
  const blocked = { setItem() { throw Error('blocked'); }, getItem() { throw Error('blocked'); } };
  assert.equal(prepareContactHandoff(input, plan, {}, blocked), false);
  assert.equal(consumeContactHandoff(blocked), null);
  for (const value of ['{', JSON.stringify({ version: 1, createdAt: 999999, summary: 'x'.repeat(20) }), JSON.stringify({ version: 1, createdAt: 1, summary: 'x'.repeat(4000) })]) {
    const store = storage(); store.setItem(HANDOFF_KEY, value);
    assert.equal(consumeContactHandoff(store, 1000), null);
    assert.equal(store.values.size, 0);
  }
});

test('large Unicode summaries stay within the contact form byte budget and disclose shortening', () => {
  const summary = buildContactSummary({ ...input, notes: '详细需求😀'.repeat(1600) }, plan);
  assert.ok(summary.length <= 3500);
  assert.ok(new TextEncoder().encode(summary).byteLength <= 8000);
  assert.ok(summary.endsWith('完整配置请以下载方案为准。）'));
  assert.doesNotMatch(summary, /\ufffd/);
});
