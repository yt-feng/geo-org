import { createRecommendation } from './planner.mjs';

const API_URL = 'https://recommend.eco-geo.org/api/recommend';
const $ = (id) => document.getElementById(id);
const money = (value) => `¥${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
const goalLabels = { visibility: '提升 AI 可见度', content: '建设可信内容', authority: '建立海外影响力' };
const stageLabels = { starting: '刚开始出海 · 资料需要梳理', growing: '正在增长 · 已有官网与内容', established: '相对成熟 · 需要规模化建设' };
const form = $('advisor-form');
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
    budget: Number($('budget').value),
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
  $('budget-value').textContent = money(budget);
  $('budget').style.setProperty('--range-progress', `${((budget - 20000) / 480000) * 100}%`);
  $('budget').setAttribute('aria-valuetext', `${money(budget)}，首期 90 天预算`);
  document.querySelectorAll('[data-budget]').forEach((button) => {
    const active = Number(button.dataset.budget) === budget;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('notes-count').textContent = `${$('notes').value.length} / 1600`;
}

function renderRecommendation(recommendation, mode = 'preview') {
  currentRecommendation = recommendation;
  const plans = recommendation.plans;
  const previous = plans.find((plan) => plan.id === selectedPlanId);
  selectedPlanId = previous?.id || plans[1]?.id || plans[0].id;
  $('result-summary').textContent = recommendation.summary;
  const badge = $('source-badge');
  badge.textContent = mode === 'preview' ? '预算预览' : recommendation.source === 'deepseek' ? 'AI 定制建议' : '基础推荐';
  badge.classList.toggle('ai', mode !== 'preview' && recommendation.source === 'deepseek');
  $('plans-grid').replaceChildren(...plans.map(createPlanCard));
  renderSelectedPlan();
}

function createPlanCard(plan) {
  const selected = plan.id === selectedPlanId;
  const button = node('button', `plan-card${selected ? ' selected' : ''}`);
  button.type = 'button';
  button.dataset.planId = plan.id;
  button.setAttribute('aria-pressed', String(selected));
  button.setAttribute('aria-label', `${plan.name}，${money(plan.total)}，${plan.withinBudget ? '预算范围内' : '超出当前预算'}，查看交付明细`);
  const price = node('span', 'plan-price', money(plan.total));
  const status = node('span', `plan-status${plan.withinBudget ? '' : ' over'}`);
  status.append(node('span', '', plan.withinBudget ? '预算范围内' : '进阶扩展参考'), node('span', 'plan-select-mark', '✓'));
  button.append(node('span', 'plan-label', plan.label), node('span', 'plan-name', plan.name), price, node('span', 'plan-period', '本期所选服务 / 人民币'), node('span', 'plan-description', plan.description), status);
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
  $('detail-total').textContent = money(plan.total);
  $('phases').replaceChildren(...(plan.phases || []).map((phase) => {
    const item = node('li');
    item.append(node('h5', '', phase.title), node('p', '', phase.description));
    return item;
  }));
  $('highlights').replaceChildren(...(plan.highlights || []).map((text) => node('li', '', text)));
  $('assumptions').replaceChildren(...(plan.assumptions || []).map((text) => node('li', '', text)));
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
    if (!plan || typeof plan.id !== 'string' || typeof plan.name !== 'string' || typeof plan.description !== 'string' || !Number.isFinite(plan.total) || plan.total < 0 || !Array.isArray(plan.items) || !plan.items.length || plan.items.length > 40) return false;
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
    '# Eco GEO · 首期 90 天服务方案', '',
    `生成日期：${new Date().toLocaleDateString('zh-CN')}`, '',
    `方案类型：${$('source-badge').textContent}`, '',
    `预算参考：${money(input.budget)}`, '',
    `主要目标：${goalLabels[input.goal]}`, '',
    `品牌基础：${stageLabels[input.stage]}`, '',
  ];
  if (input.notes) lines.push(`需求补充：${safeMarkdown(input.notes)}`, '');
  lines.push(`## ${safeMarkdown(plan.name)}`, '', safeMarkdown(currentRecommendation.summary), '', safeMarkdown(plan.description), '', '## 交付清单', '', '| 服务 | 数量 | 单价 | 小计 |', '| --- | --- | --- | --- |');
  plan.items.forEach((item) => lines.push(`| ${safeMarkdown(item.name)} | ${item.quantity} ${safeMarkdown(item.unit || '项')} | ${money(item.unitPrice)} | ${money(item.total)} |`));
  lines.push('', `**本期所选服务费合计：${money(plan.total)}**`, '');
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
  anchor.download = `Eco-GEO-90天服务方案-${new Date().toISOString().slice(0, 10)}.md`;
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
form.addEventListener('input', refreshPreview);
form.addEventListener('change', (event) => { if (event.target.id === 'stage') refreshPreview(); });
document.querySelectorAll('[data-budget]').forEach((button) => button.addEventListener('click', () => {
  $('budget').value = button.dataset.budget;
  refreshPreview();
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
