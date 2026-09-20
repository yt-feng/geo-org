import { getOptionalServices } from './catalog.mjs';

export const HANDOFF_KEY = 'eco-geo-advisor-contact-v1';
export const HANDOFF_TTL = 30 * 60 * 1000;

const money = (value) => `¥${Number(value).toLocaleString('zh-CN')}`;
const text = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim();

export function buildContactSummary(input, plan, recommendation = {}) {
  const scope = input.scope || { productLines: 1, scenarios: 3, audiences: 3, intents: 30 };
  const lines = [
    'Eco GEO · 待确认的服务方案',
    `市场：${input.market === 'cn' ? '中文 GEO / 按季度' : '境外 GEO / 按项目范围'}`,
    `预算参考：${input.budgetMode === 'discuss' || input.budget === null ? '另行讨论' : money(input.budget)}`,
    `范围：${scope.productLines} 条产品线；每条 ${scope.scenarios} 个场景、${scope.audiences} 类客群；全项目 ${scope.intents} 个去重意图主题`,
    `选择：${text(plan.name)}`,
    `来源：${recommendation.source === 'deepseek' ? 'AI 建议及当前手动配置' : '当前配置预览'}`,
    plan.items?.length ? `已定价部分：${money(plan.total)}${input.market === 'cn' ? ' / 季度基础包及已定价项' : ''}` : '已定价部分：尚未形成报价',
    plan.quoteRequired ? '另有待报价范围；以上小计不是完整报价。' : '金额为参考服务费，按确认范围与排期签约。',
    '', '已选交付：',
  ];
  for (const item of plan.items || []) lines.push(`- ${text(item.name)} × ${item.quantity} ${text(item.unit)}：${money(item.total)}`);
  const names = new Map(getOptionalServices(input.market || 'overseas').map(item => [item.id, item.name]));
  const removed = Object.entries(input.modules || {}).filter(([id, quantity]) => quantity === 0 && names.has(id)).map(([id]) => names.get(id));
  if (removed.length) lines.push('', `本次明确不选：${removed.join('、')}`);
  if (plan.pendingItems?.length) {
    lines.push('', '待报价范围：');
    for (const item of plan.pendingItems) lines.push(`- ${text(item.name)} × ${item.quantity || 1}：${text(item.reason)}；${(item.details || []).map(text).join('；')}`);
  }
  if (input.listening?.enabled) {
    const listening = input.listening;
    const depth = { mentions: '提及与趋势', insights: '分析与洞察', strategy: '战略与专项研究' };
    const cadence = { monthly: '月度', weekly: '每周', daily: '每日', realtime: '实时告警' };
    lines.push('', `Social listening：${(listening.platforms || []).map(text).join('、')}；${depth[listening.depth] || ''}；${cadence[listening.cadence] || ''}；${listening.markets} 个市场 / ${listening.languages} 种语言；历史数据及响应安排待确认。`);
  }
  lines.push('', '希望确认：最终服务范围、待报价项目、资料前提、排期与验收方式。');
  if (input.notes) lines.push('', `我的补充：${text(input.notes)}`);
  let summary = lines.join('\n');
  const encoder = new TextEncoder();
  if (summary.length > 3500 || encoder.encode(summary).byteLength > 8000) {
    const suffix = '\n（此处为咨询摘要，完整配置请以下载方案为准。）';
    const chars = Array.from(summary);
    while (chars.length && (chars.join('').length + suffix.length > 3500 || encoder.encode(chars.join('') + suffix).byteLength > 8000)) chars.pop();
    summary = chars.join('') + suffix;
  }
  return summary;
}

// Only called after the visitor chooses to take the current plan to consultation.
// The draft stays in this tab's same-origin session and never triggers a request.
export function prepareContactHandoff(input, plan, recommendation, storage, now = Date.now()) {
  try {
    storage ||= globalThis.sessionStorage;
    storage.setItem(HANDOFF_KEY, JSON.stringify({ version: 1, createdAt: now, summary: buildContactSummary(input, plan, recommendation) }));
    return true;
  } catch { return false; }
}

export function consumeContactHandoff(storage, now = Date.now()) {
  try {
    storage ||= globalThis.sessionStorage;
    const raw = storage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    storage.removeItem(HANDOFF_KEY);
    if (raw.length > 12000) return null;
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Number.isSafeInteger(value.createdAt) || value.createdAt > now || now - value.createdAt > HANDOFF_TTL || typeof value.summary !== 'string' || value.summary.length < 10 || value.summary.length > 3500 || new TextEncoder().encode(value.summary).byteLength > 8000) return null;
    return value.summary;
  } catch { return null; }
}
