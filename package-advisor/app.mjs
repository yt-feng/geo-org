import { createRecommendation } from './planner.mjs';
import { catalog } from './catalog.mjs';

const API_URL = 'https://recommend.eco-geo.org/api/recommend';
const $ = (id) => document.getElementById(id);
const money = (value) => `¥${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
const goalLabels = { visibility: '提升 AI 可见度', content: '建设可信内容', authority: '建立海外影响力' };
const stageLabels = { starting: '刚开始出海 · 资料需要梳理', growing: '正在增长 · 已有官网与内容', established: '相对成熟 · 需要规模化建设' };
const publicServices = new Map(catalog.map((item) => [item.id, item]));
const coreContentIds = new Set(['W07', 'W08', 'W09', 'W15', 'W16', 'W17']);
const budgetBands = {
  light: { min: 5000, max: 30000, step: 500, initial: 15000, presets: [5000, 10000, 15000, 30000], help: '灵活选择专项，先完成一项明确的重点工作。实施周期、具体前提与交付范围以所选方案为准。' },
  system: { min: 30000, max: 150000, step: 1000, initial: 50000, presets: [30000, 50000, 100000, 150000], help: '围绕首期 90 天选择服务组合，优先完成最需要的诊断、内容与验证工作。' },
  scale: { min: 150000, max: 1000000, step: 5000, initial: 300000, presets: [150000, 300000, 500000, 1000000], help: '多产品、多市场与团队协同，请在备注说明优先范围。先给第一阶段建议，后续投入按范围确认。' },
};
const form = $('advisor-form');
let currentBudget = 50000;
let activeBudgetBand = 'system';
let currentRecommendation;
let selectedPlanId;
let requestController;
let requestSequence = 0;
let toastTimer;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function getInput() {
  return {
    budget: currentBudget,
    goal: form.elements.goal.value,
    stage: $('stage').value,
    notes: $('notes').value.trim(),
  };
}

function setMessage(message = '', isError = false) {
  const target = $('request-message');
  target.textContent = message;
  target.hidden = !message;
  target.classList.toggle('error', isError);
}

function setLoading(loading) {
  $('ai-button').disabled = loading;
  $('ai-button').classList.toggle('is-loading', loading);
  $('ai-button-text').textContent = loading ? '正在理解你的需求…' : '生成 AI 定制建议';
  $('results-panel').setAttribute('aria-busy', String(loading));
}

function updateControls() {
  const { budget } = getInput();
  const band = budgetBands[activeBudgetBand];
  const range = $('budget');
  range.min = String(band.min);
  range.max = String(band.max);
  range.step = String(band.step);
  range.value = String(budget);
  $('budget-value').textContent = money(budget);
  if (document.activeElement !== $('budget-amount')) $('budget-amount').value = String(budget);
  range.style.setProperty('--range-progress', `${((budget - band.min) / (band.max - band.min)) * 100}%`);
  range.setAttribute('aria-valuetext', `${money(budget)}，本次项目预算`);
  $('budget-range-min').textContent = money(band.min);
  $('budget-range-max').textContent = money(band.max);
  $('budget-band-help').textContent = band.help;
  document.querySelectorAll('[data-budget-band]').forEach((button) => {
    const active = button.dataset.budgetBand === activeBudgetBand;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-budget]').forEach((button, index) => {
    button.dataset.budget = String(band.presets[index]);
    button.textContent = `${band.presets[index] / 10000} 万`;
    const active = Number(button.dataset.budget) === budget;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('notes-count').textContent = `${$('notes').value.length} / 1600`;
}

function renderRecommendation(recommendation, mode = 'preview') {
  currentRecommendation = recommendation;
  const plans = distinctPlans(recommendation.plans);
  const previous = plans.find((plan) => plan.id === selectedPlanId);
  selectedPlanId = previous?.id || plans.find((plan) => plan.id === 'recommended')?.id || plans[0].id;
  $('result-summary').textContent = recommendation.summary.replace(/(?:三|3)\s*(?:种|个|档|套)\s*((?:服务)?(?:方案|套餐|组合))/gu, '可选$1');
  const badge = $('source-badge');
  badge.textContent = mode === 'preview' ? '预算预览' : recommendation.source === 'deepseek' ? 'AI 定制建议' : '基础推荐';
  badge.classList.toggle('ai', mode !== 'preview' && recommendation.source === 'deepseek');
  $('plans-grid').dataset.planCount = String(plans.length);
  $('plans-grid').replaceChildren(...plans.map(createPlanCard));
  renderSelectedPlan();
}

function distinctPlans(plans) {
  const byDeliverables = new Map();
  for (const plan of plans) {
    const signature = JSON.stringify(plan.items.map((item) => [item.id, item.quantity, item.total]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || a[1] - b[1] || a[2] - b[2]));
    if (!byDeliverables.has(signature) || plan.id === 'recommended') byDeliverables.set(signature, plan);
  }
  return [...byDeliverables.values()];
}

function createPlanCard(plan) {
  const selected = plan.id === selectedPlanId;
  const needsConfiguration = plan.configurationRequired && !plan.items.length;
  const button = node('button', `plan-card${selected ? ' selected' : ''}`);
  button.type = 'button';
  button.dataset.planId = plan.id;
  button.setAttribute('aria-pressed', String(selected));
  button.setAttribute('aria-label', needsConfiguration ? `${plan.name}，需顾问配置范围` : `${plan.name}，${money(plan.total)}，${plan.withinBudget ? '预算范围内' : '超出当前预算'}，查看交付明细`);
  const price = node('span', 'plan-price', plan.configurationRequired && !plan.items.length ? '按范围配置' : money(plan.total));
  const status = node('span', `plan-status${plan.withinBudget ? '' : ' over'}`);
  status.append(node('span', '', needsConfiguration ? '待确认范围与报价' : plan.withinBudget ? '预算范围内' : '进阶扩展参考'), node('span', 'plan-select-mark', '✓'));
  button.append(node('span', 'plan-label', plan.label || plan.scopeLabel), node('span', 'plan-name', plan.name), price, node('span', 'plan-period', plan.horizon || '本期所选服务 / 人民币'), node('span', 'plan-description', plan.description), status);
  button.addEventListener('click', () => {
    selectedPlanId = plan.id;
    $('plans-grid').querySelectorAll('.plan-card').forEach((card) => {
      const active = card.dataset.planId === selectedPlanId;
      card.classList.toggle('selected', active);
      card.setAttribute('aria-pressed', String(active));
    });
    renderSelectedPlan();
  });
  return button;
}

function renderSelectedPlan() {
  const plan = currentRecommendation.plans.find((item) => item.id === selectedPlanId);
  if (!plan) return;
  $('plan-detail').hidden = false;
  $('detail-title').textContent = `${plan.name} · 交付清单`;
  $('detail-count').textContent = `${plan.items.length} 项服务`;
  $('line-items').replaceChildren(...plan.items.map((item) => {
    const row = node('article', 'line-item');
    const main = node('div', 'item-main');
    main.append(node('h5', 'item-title', item.name));
    const deliverables = node('ul', 'item-deliverables');
    (item.deliverables || []).forEach((text) => deliverables.append(node('li', '', text)));
    main.append(deliverables);
    const price = node('div', 'item-price', money(item.total));
    price.append(node('span', 'item-unit', `${money(item.unitPrice)} × ${item.quantity} ${item.unit || '项'}`));
    row.append(main, price);
    return row;
  }));
  $('detail-total').textContent = plan.configurationRequired && !plan.items.length ? '待范围确认' : money(plan.total);
  $('phases').replaceChildren(...(plan.phases || []).map((phase) => {
    const item = node('li');
    item.append(node('h5', '', phase.title), node('p', '', phase.description));
    return item;
  }));
  $('highlights').replaceChildren(...(plan.highlights || []).map((text) => node('li', '', text)));
  $('assumptions').replaceChildren(...(plan.assumptions || []).map((text) => node('li', '', text)));
  renderDeliveryValue(plan);
}

function renderDeliveryValue(plan) {
  const contentCount = plan.items.filter((item) => coreContentIds.has(item.id)).reduce((sum, item) => sum + item.quantity, 0);
  const channelCount = plan.items.filter((item) => item.id === 'W10').reduce((sum, item) => sum + item.quantity * 3, 0);
  const observations = plan.items.reduce((sum, item) => sum + (publicServices.get(item.id)?.sampling?.plannedAnswers || 0) * item.quantity, 0);
  const coreItems = plan.items.filter((item) => coreContentIds.has(item.id));
  $('value-plan-name').textContent = `${plan.name} · ${plan.scopeLabel || '本期所选服务'}`;
  $('value-plan-total').textContent = plan.configurationRequired && !plan.items.length ? '待范围确认' : money(plan.total);
  $('metric-content').textContent = contentCount ? `${contentCount} 项` : '按需选配';
  $('metric-content-note').textContent = contentCount ? coreItems.map((item) => `${item.name} ${item.quantity} ${item.unit}`).join(' · ') : '本档未选内容制作；可在诊断后确认新增范围。';
  $('metric-channels').textContent = channelCount ? `${channelCount} 条` : '按需选配';
  $('metric-channels-note').textContent = channelCount ? '以 3 条为一包，基于已确认母内容做渠道适配。' : '本档未选渠道适配；已有母内容可后续组合。';
  $('metric-observations-label').textContent = observations ? '计划 AI 回答观察' : '明确交付服务';
  $('metric-observations').textContent = observations ? `${observations.toLocaleString('zh-CN')} 次` : `${plan.items.length} 项`;
  $('metric-observations-note').textContent = observations ? '按所选监测的问题数、平台和观察轮次计算。' : '以本期清单逐项确认交付与验收范围。';
  const sourcePrice = publicServices.get('W08')?.price;
  const adaptationPrice = publicServices.get('W10')?.price;
  if (Number.isFinite(sourcePrice) && Number.isFinite(adaptationPrice)) {
    $('example-source-price').textContent = money(sourcePrice);
    $('example-adapt-price').textContent = money(adaptationPrice);
    $('example-total').textContent = money(sourcePrice + adaptationPrice);
  }
}

function refreshPreview() {
  requestSequence += 1;
  if (requestController) requestController.abort();
  requestController = undefined;
  setLoading(false);
  setMessage();
  updateControls();
  try {
    renderRecommendation(createRecommendation(getInput()), 'preview');
  } catch {
    $('result-summary').textContent = '预算预览暂未就绪。你可以重试，或联系顾问配置方案。';
    $('plans-grid').replaceChildren();
    $('plan-detail').hidden = true;
  }
}

function isValidRecommendation(data) {
  if (!data || !['deepseek', 'rules'].includes(data.source) || typeof data.summary !== 'string' || data.summary.length > 6000 || !Array.isArray(data.plans) || data.plans.length < 1 || data.plans.length > 3) return false;
  return data.plans.every((plan) => {
    if (!plan || typeof plan.id !== 'string' || typeof plan.name !== 'string' || typeof plan.description !== 'string' || !Number.isFinite(plan.total) || plan.total < 0 || !Array.isArray(plan.items) || (!plan.items.length && !plan.configurationRequired) || plan.items.length > 40) return false;
    if (!plan.items.every((item) => item && typeof item.name === 'string' && Number.isFinite(item.quantity) && item.quantity > 0 && Number.isFinite(item.unitPrice) && item.unitPrice >= 0 && Number.isFinite(item.total) && item.total >= 0 && Array.isArray(item.deliverables) && item.deliverables.every((entry) => typeof entry === 'string'))) return false;
    if (!Array.isArray(plan.phases) || !plan.phases.every((phase) => phase && typeof phase.title === 'string' && typeof phase.description === 'string')) return false;
    return ['highlights', 'assumptions'].every((key) => Array.isArray(plan[key]) && plan[key].every((entry) => typeof entry === 'string'));
  });
}

async function requestRecommendation(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const sequence = ++requestSequence;
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  const input = getInput();
  setLoading(true);
  setMessage('正在结合预算、业务目标与补充说明，整理适合你的服务重点。');
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!response.ok) {
      const error = new Error(response.status === 429 ? '请求较多，请稍后再试。当前预算预览仍可使用。' : 'AI 建议暂时未能完成，当前预算预览仍可使用。请稍后重试。');
      throw error;
    }
    const result = await response.json();
    if (sequence !== requestSequence) return;
    if (!isValidRecommendation(result)) throw new Error('建议格式暂未就绪，已保留当前预算预览。请稍后重试。');
    renderRecommendation(result, 'result');
    setMessage(result.source === 'deepseek' ? 'AI 定制建议已更新。你可以比较组合、保存方案，再与顾问确认范围。' : '本次已生成基础推荐；自然语言定制暂未完成。你可以保留方案或稍后重试 AI 建议。', result.source !== 'deepseek');
    if (window.matchMedia('(max-width: 680px)').matches) $('results-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (sequence !== requestSequence) return;
    const message = error.name === 'AbortError' ? '本次分析等待较久，已保留你的输入与预算预览。请点击按钮重试。' : error instanceof TypeError ? '暂时无法连接 AI 顾问，已保留你的输入与预算预览。请稍后重试。' : error.message;
    setMessage(message, true);
    $('ai-button-text').textContent = '重试 AI 定制建议';
  } finally {
    clearTimeout(timeout);
    if (sequence === requestSequence) {
      const failed = $('request-message').classList.contains('error');
      setLoading(false);
      if (failed) $('ai-button-text').textContent = '重试 AI 定制建议';
      requestController = undefined;
    }
  }
}

function safeMarkdown(value) {
  return String(value).replace(/[\\`*_{}[\]<>|]/g, '\\$&').replace(/\r?\n/g, ' ');
}

function exportPlan() {
  const plan = currentRecommendation?.plans.find((entry) => entry.id === selectedPlanId);
  if (!plan) return;
  const input = getInput();
  const lines = [
    '# Eco GEO · 项目服务方案', '',
    `生成日期：${new Date().toLocaleDateString('zh-CN')}`, '',
    `方案类型：${$('source-badge').textContent}`, '',
    `预算参考：${money(input.budget)}`, '',
    `主要目标：${goalLabels[input.goal]}`, '',
    `品牌基础：${stageLabels[input.stage]}`, '',
  ];
  if (input.notes) lines.push(`需求补充：${safeMarkdown(input.notes)}`, '');
  lines.push(`## ${safeMarkdown(plan.name)}`, '', safeMarkdown(currentRecommendation.summary), '', safeMarkdown(plan.description), '', '## 交付清单', '', '| 服务 | 数量 | 单价 | 小计 |', '| --- | --- | --- | --- |');
  plan.items.forEach((item) => lines.push(`| ${safeMarkdown(item.name)} | ${item.quantity} ${safeMarkdown(item.unit || '项')} | ${money(item.unitPrice)} | ${money(item.total)} |`));
  lines.push('', `**本期所选服务费合计：${plan.configurationRequired && !plan.items.length ? '待范围确认' : money(plan.total)}**`, '');
  plan.items.forEach((item) => { lines.push(`### ${safeMarkdown(item.name)}`, ''); item.deliverables.forEach((entry) => lines.push(`- ${safeMarkdown(entry)}`)); lines.push(''); });
  lines.push('## 实施阶段', '');
  plan.phases.forEach((phase) => lines.push(`- **${safeMarkdown(phase.title)}**：${safeMarkdown(phase.description)}`));
  lines.push('', '## 资产复用价值', '');
  plan.highlights.forEach((entry) => lines.push(`- ${safeMarkdown(entry)}`));
  lines.push('', '## 方案前提与范围', '');
  plan.assumptions.forEach((entry) => lines.push(`- ${safeMarkdown(entry)}`));
  lines.push('', '这是按当前需求配置的参考方案。正式报价以确认后的市场、语言、资料基础及工作范围为准，税费以正式报价单为准。第三方媒体及平台采购另行确认。本方案不承诺 AI 引用、排名、销售转化或媒体刊发结果。', '', '联系：info@eco-geo.com', '', '方案配置：https://eco-geo.org/package-advisor/', '');
  const blob = new Blob(['\uFEFF', lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `Eco-GEO-项目服务方案-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('方案已导出，可保存后与顾问确认。');
}

function showToast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

form.addEventListener('submit', requestRecommendation);
function bandForBudget(value) {
  return value < 30000 ? 'light' : value <= 150000 ? 'system' : 'scale';
}

function setBudget(value, bandId = bandForBudget(value)) {
  currentBudget = value;
  activeBudgetBand = bandId;
  $('budget-amount').setCustomValidity('');
  refreshPreview();
}

form.addEventListener('input', (event) => {
  if (event.target.id === 'budget-amount') {
    const value = Number(event.target.value);
    if (event.target.value !== '' && Number.isInteger(value) && value >= 5000 && value <= 1000000) {
      setBudget(value);
    } else {
      requestSequence += 1;
      requestController?.abort();
      setLoading(false);
      event.target.setCustomValidity('请输入 5,000 至 1,000,000 之间的整数预算。');
      $('source-badge').textContent = '等待预算输入';
      $('source-badge').classList.remove('ai');
    }
    return;
  }
  if (event.target.id === 'budget') currentBudget = Number(event.target.value);
  refreshPreview();
});
form.addEventListener('change', (event) => {
  if (event.target.id === 'budget-amount') {
    const entered = Number(event.target.value);
    const value = event.target.value === '' || !Number.isFinite(entered) ? currentBudget : Math.min(1000000, Math.max(5000, Math.round(entered)));
    event.target.value = String(value);
    setBudget(value);
    if (value !== entered) setMessage(`项目预算可填 ¥5,000–¥1,000,000，已调整为 ${money(value)}。`);
  } else if (event.target.id === 'stage') refreshPreview();
});
document.querySelectorAll('[data-budget-band]').forEach((button) => button.addEventListener('click', () => {
  const id = button.dataset.budgetBand;
  setBudget(budgetBands[id].initial, id);
}));
document.querySelectorAll('[data-budget]').forEach((button) => button.addEventListener('click', () => {
  setBudget(Number(button.dataset.budget), activeBudgetBand);
}));
$('export-button').addEventListener('click', exportPlan);
$('print-button').addEventListener('click', () => {
  const details = document.querySelector('.assumptions');
  const wasOpen = details.open;
  details.open = true;
  window.print();
  details.open = wasOpen;
});
refreshPreview();
