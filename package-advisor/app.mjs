import { createRecommendation, customizePlan } from './planner.mjs';
import { catalog, cnCatalog, getOptionalServices } from './catalog.mjs';
import { budgetToPosition, positionToBudget, SCALE_DISCUSS_POSITION, MAX_SAFE_BUDGET } from './budget-ui.mjs';
import { prepareContactHandoff } from './handoff.mjs';

const API_URL = 'https://recommend.eco-geo.org/api/recommend';
const $ = (id) => document.getElementById(id);
const money = (value) => Number.isFinite(value) ? `¥${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : '待报价';
const goalLabels = { visibility: '提升 AI 可见度', content: '建设可信内容', authority: '建立海外影响力' };
const stageLabels = { starting: '起步 · 资料需要梳理', growing: '增长 · 已有官网与内容', established: '成熟 · 规模化建设' };
const publicServices = new Map([...catalog, ...cnCatalog].map((item) => [item.id, item]));
const coreContentIds = new Set(['W07', 'W08', 'W09', 'W15', 'W16', 'W17']);
const budgetBands = {
  light: { min: 5000, max: 30000, step: 500, initial: 15000, presets: [5000, 10000, 15000, 30000], help: '灵活选择专项，先完成一项重点工作。周期、前提与交付范围以所选方案为准。' },
  system: { min: 30000, max: 150000, step: 1000, initial: 50000, presets: [30000, 50000, 100000, 150000], help: '按需组合诊断、内容与复测。预算是规划参考，不代表必须一次用满。' },
  scale: { min: 150000, max: 10000000, step: 1000, initial: 300000, presets: [150000, 500000, 1000000, 3000000], help: '高档滑条采用对数刻度。可手填超过参考刻度的金额，或选择“另行讨论”。先确认优先范围，再安排阶段投入。' },
};
const form = $('advisor-form');
const moduleSelections = { overseas: {}, cn: {} };
const listeningSelections = { overseas: null, cn: null };
const quantityDrafts = new Map();
let activeMarket = 'overseas';
let currentBudget = 50000;
let currentBudgetMode = 'amount';
let activeBudgetBand = 'system';
let currentRecommendation;
let displayedPlans = [];
let selectedPlanId;
let resultMode = 'preview';
let manualAdjusted = false;
let configurationValid = false;
let requestController;
let requestSequence = 0;
let toastTimer;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}
function currentMarket() { return form.elements.market.value; }
function readListeningFields() {
  return { enabled: $('social-enabled').checked, platforms: [...form.querySelectorAll('[name="social-platform"]:checked')].map((input) => input.value), depth: $('social-depth').value, cadence: $('social-frequency').value, markets: Number($('social-markets').value), languages: Number($('social-languages').value) };
}
function restoreListeningFields(value) {
  const settings = value || { enabled: false, platforms: [], depth: 'insights', cadence: 'monthly', markets: 1, languages: 1 };
  $('social-enabled').checked = settings.enabled;
  form.querySelectorAll('[name="social-platform"]').forEach((input) => { input.checked = settings.platforms.includes(input.value); });
  $('social-depth').value = settings.depth;
  $('social-frequency').value = settings.cadence;
  $('social-markets').value = String(settings.markets);
  $('social-languages').value = String(settings.languages);
}
function getInput() {
  const listening = readListeningFields();
  if (!listening.enabled) {
    listening.markets = Number.isInteger(listening.markets) && listening.markets >= 1 && listening.markets <= 50 ? listening.markets : 1;
    listening.languages = Number.isInteger(listening.languages) && listening.languages >= 1 && listening.languages <= 30 ? listening.languages : 1;
  }
  return {
    budget: currentBudgetMode === 'discuss' ? null : currentBudget,
    budgetMode: currentBudgetMode,
    market: currentMarket(),
    scope: { productLines: Number($('scope-product-lines').value), scenarios: Number($('scope-scenarios').value), audiences: Number($('scope-audiences').value), intents: Number($('scope-intents').value) },
    goal: form.elements.goal.value,
    stage: $('stage').value,
    notes: $('notes').value.trim(),
    modules: { ...moduleSelections[currentMarket()] },
    listening,
  };
}
function setMessage(message = '', isError = false) {
  $('request-message').textContent = message;
  $('request-message').hidden = !message;
  $('request-message').classList.toggle('error', isError);
}
function setLoading(loading) {
  $('ai-button').disabled = loading;
  $('ai-button').classList.toggle('is-loading', loading);
  $('ai-button-text').textContent = loading ? '正在理解你的需求…' : '生成 AI 定制建议';
  $('results-panel').setAttribute('aria-busy', String(loading));
}
function cancelPending() {
  requestSequence += 1;
  requestController?.abort();
  requestController = undefined;
  setLoading(false);
}
function updateControls() {
  const input = getInput();
  const band = budgetBands[activeBudgetBand];
  const range = $('budget');
  const discuss = currentBudgetMode === 'discuss';
  const scale = activeBudgetBand === 'scale';
  const chinese = input.market === 'cn';
  $('budget-label').textContent = chinese ? '本季度预算' : '本期项目预算';
  range.min = scale ? '0' : String(band.min);
  range.max = scale ? String(SCALE_DISCUSS_POSITION) : String(band.max);
  range.step = scale ? '1' : String(band.step);
  range.value = scale ? String(budgetToPosition(discuss ? null : currentBudget)) : String(currentBudget);
  const progress = scale ? budgetToPosition(discuss ? null : currentBudget) / SCALE_DISCUSS_POSITION : (currentBudget - band.min) / (band.max - band.min);
  range.style.setProperty('--range-progress', `${Math.max(0, Math.min(1, progress)) * 100}%`);
  range.setAttribute('aria-valuetext', discuss ? '预算另行讨论，先确认服务范围' : `${money(currentBudget)}，${chinese ? '本季度预算' : '本期项目预算'}`);
  $('budget-value').textContent = discuss ? '另行讨论' : money(currentBudget);
  $('budget-display').hidden = discuss;
  $('discuss-budget').hidden = !discuss;
  $('budget-amount').disabled = discuss;
  if (!discuss && document.activeElement !== $('budget-amount')) $('budget-amount').value = String(currentBudget);
  $('budget-range-min').textContent = money(band.min);
  $('budget-range-max').textContent = scale ? '另行讨论 →' : money(band.max);
  $('budget-band-help').textContent = (chinese ? '中文标准单元为 ¥50,000 / 季度。所填金额是本季度预算，不是全年预算。低于基础价时，需调整预算或与顾问讨论专项范围，不代表另有低价标准包。' : band.help) + (!discuss && currentBudget > 10000000 ? ' 当前手填金额已超过参考刻度，金额原样保留。' : '');
  $('budget-log-ticks').hidden = !scale;
  if (scale && !$('budget-log-ticks').children.length) [150000, 500000, 1000000, 3000000, 10000000].forEach((value) => {
    const button = node('button', '', `${value / 10000}万`);
    button.type = 'button'; button.style.left = `${budgetToPosition(value) / SCALE_DISCUSS_POSITION * 100}%`;
    button.addEventListener('click', () => setBudget(value, 'scale'));
    $('budget-log-ticks').append(button);
  });
  document.querySelectorAll('[data-budget-band]').forEach((button) => {
    const active = button.dataset.budgetBand === activeBudgetBand;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    const names = chinese ? { light: '较低预算', system: '季度规划', scale: '扩展覆盖' } : { light: '轻量起步', system: '系统建设', scale: '规模拓展' };
    const descriptions = chinese ? { light: '预算参考 · 标准单元仍为 5 万 / 季度', system: '按季度 · 范围与意图单元取较大值', scale: '多单元范围 · 增项单独报价' } : { light: '灵活专项 · 先完成一项重点工作', system: '首期建设 · 按需组合诊断、内容与复测', scale: '分阶段推进 · 多产品、多市场与团队协同' };
    button.querySelector('.band-title').textContent = names[button.dataset.budgetBand];
    button.querySelector('small').textContent = descriptions[button.dataset.budgetBand];
  });
  document.querySelectorAll('[data-budget]').forEach((button, index) => {
    button.dataset.budget = String(band.presets[index]); button.textContent = `${band.presets[index] / 10000} 万`;
    const active = !discuss && Number(button.dataset.budget) === currentBudget;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('notes-count').textContent = `${$('notes').value.length} / 1600`;
  $('chinese-base').hidden = input.market !== 'cn';
  $('overseas-reuse-example').hidden = input.market === 'cn';
  $('market-help').textContent = input.market === 'cn' ? '中文方案以季度标准单元计价；境外方案按项目模块计价，两种服务口径分别展示。' : '境外项目按市场、语言与交付模块配置。项目范围和周期见明细，第三方采购另行确认。';
  $('social-fields').hidden = !input.listening.enabled;
  $('social-fields').querySelectorAll('input,select').forEach((field) => { field.disabled = !input.listening.enabled; });
  const scope = input.scope;
  $('scope-status').textContent = `${scope.productLines || '—'} 条产品线，每产品线规划 ${scope.scenarios || '—'} 个场景、${scope.audiences || '—'} 类客群；全项目 ${scope.intents || '—'} 个去重意图主题。`;
}
function isPending(plan) { return plan.quoteRequired || ['partial', 'quote_required'].includes(plan.pricingStatus) || Boolean(plan.pendingItems?.length) || (plan.configurationRequired && !plan.items.length); }
function priceText(plan) {
  if (isPending(plan)) return plan.total > 0 ? `${money(plan.total)} + 待报价` : '按范围报价';
  return money(plan.total);
}
function distinctPlans(plans) {
  const map = new Map();
  for (const plan of plans) {
    const signature = JSON.stringify({ items: plan.items.map((item) => [item.id, item.quantity, item.total]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), pending: (plan.pendingItems || []).map((item) => [item.id, item.quantity]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) });
    if (!map.has(signature) || plan.id === 'recommended') map.set(signature, plan);
  }
  return [...map.values()];
}
function renderRecommendation(recommendation, mode = 'preview') {
  currentRecommendation = recommendation;
  resultMode = mode;
  const input = getInput();
  displayedPlans = distinctPlans(recommendation.plans.map((plan) => customizePlan(plan, input, input.modules)));
  configurationValid = true;
  $('export-button').disabled = false;
  $('print-button').disabled = false;
  $('consult-button').removeAttribute('aria-disabled');
  $('consult-button').removeAttribute('tabindex');
  selectedPlanId = displayedPlans.find((plan) => plan.id === selectedPlanId)?.id || displayedPlans.find((plan) => plan.id === 'recommended')?.id || displayedPlans[0]?.id;
  $('result-summary').textContent = recommendation.summary.replace(/(?:三|3)\s*(?:种|个|档|套)\s*((?:服务)?(?:方案|套餐|组合))/gu, '可选$1');
  const baseLabel = mode === 'preview' ? '预算预览' : recommendation.source === 'deepseek' ? 'AI 定制建议' : '基础推荐';
  $('source-badge').textContent = manualAdjusted ? `手动调整 · ${baseLabel}` : baseLabel;
  $('source-badge').classList.toggle('ai', !manualAdjusted && mode !== 'preview' && recommendation.source === 'deepseek');
  $('plans-grid').dataset.planCount = String(displayedPlans.length);
  $('plans-grid').replaceChildren(...displayedPlans.map(createPlanCard));
  renderSelectedPlan();
}
function createPlanCard(plan) {
  const button = node('button', `plan-card${plan.id === selectedPlanId ? ' selected' : ''}`);
  button.type = 'button'; button.dataset.planId = plan.id; button.setAttribute('aria-pressed', String(plan.id === selectedPlanId));
  button.setAttribute('aria-label', `${plan.name}，${priceText(plan)}，查看交付明细`);
  const statusText = isPending(plan) ? '含待报价范围 · 非完整报价' : currentBudgetMode === 'discuss' ? '预算与范围另行讨论' : plan.withinBudget ? '当前参考预算内' : '需调整预算或范围';
  const status = node('span', 'plan-status'); status.append(node('span', '', statusText), node('span', 'plan-select-mark', '✓'));
  button.append(node('span', 'plan-label', plan.label || plan.scopeLabel), node('span', 'plan-name', plan.name), node('span', `plan-price${isPending(plan) ? ' has-pending' : ''}`, priceText(plan)), node('span', 'plan-period', plan.horizon || '本期所选服务 / 人民币'), node('span', 'plan-description', plan.description), status);
  button.addEventListener('click', () => {
    selectedPlanId = plan.id;
    $('plans-grid').querySelectorAll('.plan-card').forEach((card) => { const active = card.dataset.planId === selectedPlanId; card.classList.toggle('selected', active); card.setAttribute('aria-pressed', String(active)); });
    renderSelectedPlan();
  });
  return button;
}
function getDisplayedPlan() { return displayedPlans.find((plan) => plan.id === selectedPlanId); }
function changeModule(id, quantity, restoreFocus = false) {
  if (!configurationValid) return false;
  cancelPending();
  const hadPrevious = Object.hasOwn(moduleSelections[currentMarket()], id);
  const previous = moduleSelections[currentMarket()][id];
  const previousSocialEnabled = $('social-enabled').checked;
  const previousManualAdjusted = manualAdjusted;
  if (id === 'SOCIAL_LISTENING' && quantity === 0) $('social-enabled').checked = false;
  moduleSelections[currentMarket()][id] = quantity;
  quantityDrafts.delete(id);
  manualAdjusted = true;
  updateControls();
  try {
    renderRecommendation(currentRecommendation, resultMode);
    if (restoreFocus) [...$('plan-detail').querySelectorAll('[data-module-id]')].find((input) => input.dataset.moduleId === id)?.focus({ preventScroll: true });
    return true;
  }
  catch {
    if (hadPrevious) moduleSelections[currentMarket()][id] = previous;
    else delete moduleSelections[currentMarket()][id];
    $('social-enabled').checked = previousSocialEnabled;
    manualAdjusted = previousManualAdjusted;
    updateControls();
    renderRecommendation(currentRecommendation, resultMode);
    setMessage('这项调整需先确认基础范围，已保留调整前的有效配置。', true);
    return false;
  }
}
function moduleControls(item) {
  const controls = node('div', 'item-controls');
  if (item.required || item.optional === false) {
    controls.append(node('span', 'required-label', '基础必需 · 已锁定'));
    const info = node('small', '', '构成本方案的基础范围。如已有成果可复用，请在备注说明，由顾问核验。'); controls.append(info); return controls;
  }
  const metadata = getOptionalServices(currentMarket()).find((entry) => entry.id === item.id);
  if (item.id === 'SOCIAL_LISTENING') {
    const remove = node('button', 'remove-module', '移除独立聆听'); remove.type = 'button';
    remove.addEventListener('click', () => changeModule(item.id, 0));
    controls.append(node('small', '', '平台、深度与频率可在左侧独立聆听配置中调整。'), remove);
    return controls;
  }
  const label = node('label', '', '数量');
  const quantity = node('input'); quantity.type = 'number'; quantity.min = '1'; quantity.max = String(metadata?.maxQuantity || 100); quantity.step = '1'; quantity.dataset.moduleId = item.id; quantity.value = quantityDrafts.get(item.id) ?? String(item.quantity); quantity.setAttribute('aria-label', `${item.name}数量`);
  quantity.addEventListener('input', () => {
    quantityDrafts.set(item.id, quantity.value);
    const value = Number(quantity.value);
    if (quantity.value !== '' && Number.isInteger(value) && value >= 1 && value <= Number(quantity.max)) changeModule(item.id, value, document.activeElement === quantity);
  });
  quantity.addEventListener('change', () => {
    if (quantity.value === '' || !quantity.checkValidity()) return;
    changeModule(item.id, Number(quantity.value), document.activeElement === quantity);
  });
  label.append(quantity);
  const remove = node('button', 'remove-module', '移除'); remove.type = 'button'; remove.setAttribute('aria-label', `移除${item.name}`);
  remove.addEventListener('click', () => { changeModule(item.id, 0); showToast(`已移除${item.name}，对应交付也已移除。可按需重新加入。`); });
  controls.append(label, remove); return controls;
}
function syncModuleQuantities() {
  if (!configurationValid) return false;
  const fields = [...$('plan-detail').querySelectorAll('[data-module-id]')];
  for (const field of fields) {
    const value = Number(field.value);
    if (field.value === '' || !Number.isInteger(value) || value < 1 || value > Number(field.max)) {
      showToast('请完成可选模块数量，随后会按当前配置继续。');
      field.focus();
      field.reportValidity();
      return false;
    }
  }
  for (const field of fields) {
    const item = [...(getDisplayedPlan()?.items || []), ...(getDisplayedPlan()?.pendingItems || [])].find((entry) => entry.id === field.dataset.moduleId);
    if (item && item.quantity !== Number(field.value) && !changeModule(item.id, Number(field.value))) return false;
  }
  return configurationValid;
}
function renderSelectedPlan() {
  const plan = getDisplayedPlan();
  $('plan-detail').hidden = !plan;
  if (!plan) return;
  $('detail-title').textContent = `${plan.name} · 交付清单`;
  $('detail-count').textContent = `${plan.items.length + (plan.pendingItems?.length || 0)} 项服务`;
  $('line-items').replaceChildren(...plan.items.map((item) => {
    const row = node('article', 'line-item'); const main = node('div', 'item-main'); main.append(node('h5', 'item-title', item.name));
    const list = node('ul', 'item-deliverables'); (item.deliverables || []).forEach((text) => list.append(node('li', '', text))); main.append(list, moduleControls(item));
    const price = node('div', 'item-price', money(item.total)); price.append(node('span', 'item-unit', `${money(item.unitPrice)} × ${item.quantity} ${item.unit || '项'}`)); row.append(main, price); return row;
  }));
  const pending = plan.pendingItems || [];
  $('pending-quote').hidden = !pending.length && !isPending(plan);
  $('pending-quote').replaceChildren();
  if (isPending(plan)) {
    $('pending-quote').append(node('h4', '', '待确认报价的范围'));
    if (!pending.length) $('pending-quote').append(node('p', '', '先确认市场、交付和阶段范围，再给出完整报价。此处未填写的费用不代表免费。'));
    pending.forEach((item) => {
      const article = node('article', 'pending-item'); article.append(node('h5', '', item.name), node('p', '', item.reason || '按确认的工作范围另行报价'));
      (item.details || []).forEach((text) => article.append(node('p', '', text)));
      article.append(moduleControls(item)); $('pending-quote').append(article);
    });
  }
  $('detail-total-label').textContent = isPending(plan) ? '已定价部分小计' : plan.totalLabel || '本期所选服务费合计';
  $('detail-total').textContent = isPending(plan) && plan.total === 0 ? '待报价' : money(plan.total);
  renderPricingBreakdown(plan);
  const selected = new Set([...plan.items, ...pending].map((item) => item.id));
  const options = getOptionalServices(currentMarket()).filter((item) => item.optional !== false && !item.required && !selected.has(item.id) && item.id !== 'SOCIAL_LISTENING');
  const optionNodes = [new Option(options.length ? '选择一个可选模块…' : '当前可选模块均已加入', '')];
  options.forEach((item) => optionNodes.push(new Option(`${item.name} · ${item.price === null ? '按范围报价' : money(item.price) + '/' + item.unit}`, item.id)));
  $('module-select').replaceChildren(...optionNodes); $('add-module').disabled = !options.length;
  $('module-picker-note').textContent = currentMarket() === 'cn' ? '中文可选模块按范围报价，不套用境外单价。移除可选项目时，相应交付一并移除。' : '可选项目可调整数量或移除。基础必需项目用于保证方案成立，已有成果可由顾问核验复用。';
  $('phases').replaceChildren(...(plan.phases || []).map((phase) => { const item = node('li'); item.append(node('h5', '', phase.title), node('p', '', phase.description)); return item; }));
  $('highlights').replaceChildren(...(plan.highlights || []).map((text) => node('li', '', text)));
  $('assumptions').replaceChildren(...(plan.assumptions || []).map((text) => node('li', '', text)));
  renderDeliveryValue(plan);
}
function renderPricingBreakdown(plan) {
  const breakdown = plan.pricingBreakdown;
  $('pricing-breakdown').hidden = !breakdown;
  $('pricing-breakdown').replaceChildren();
  if (!breakdown) return;
  $('pricing-breakdown').append(node('h4', '', '中文季度基础包如何计算'), node('p', '', `业务范围需要 ${breakdown.scopeUnits} 个单元；意图主题需要 ${breakdown.intentUnits} 个单元。取较大值 ${breakdown.units}，不重复叠加。`), node('strong', '', `${money(breakdown.unitPrice)} × ${breakdown.units} = ${money(breakdown.unitPrice * breakdown.units)} / 季度`), node('p', '', '范围单元 = 产品线数 × ⌈每条产品线场景数 ÷ 3⌉ × ⌈每条产品线客群数 ÷ 3⌉；意图单元 = ⌈全项目去重主题数 ÷ 30⌉。⌈ ⌉ 表示向上取整。单元描述服务覆盖范围；原创内容、采样次数和发布数量按交付清单确认，不把同义问法或复用内容重复计数。'));
}
function renderDeliveryValue(plan) {
  const count = plan.items.filter((item) => coreContentIds.has(item.id)).reduce((sum, item) => sum + item.quantity, 0);
  const channels = plan.items.filter((item) => item.id === 'W10').reduce((sum, item) => sum + item.quantity * 3, 0);
  const observations = plan.items.reduce((sum, item) => sum + (publicServices.get(item.id)?.sampling?.plannedAnswers || 0) * item.quantity, 0);
  $('value-plan-name').textContent = `${plan.name} · ${plan.scopeLabel || '本期所选服务'}`; $('value-plan-total').textContent = priceText(plan);
  $('metric-content-label').textContent = currentMarket() === 'cn' ? '季度服务覆盖' : '核心内容资产';
  $('metric-content').textContent = count ? `${count} 项` : currentMarket() === 'cn' ? `${plan.pricingBreakdown?.units || 1} 标准单元` : '按需选配';
  $('metric-content-note').textContent = count ? '按清单已选页面、母文、案例等数量合计。' : currentMarket() === 'cn' ? '中文季度基础包按确认的业务范围与意图主题配置，具体内容产出见交付约定。' : '本档未选内容制作；可在诊断后确认新增范围。';
  $('metric-channels').textContent = channels ? `${channels} 条` : '按需选配'; $('metric-channels-note').textContent = channels ? '以 3 条为一包，基于已确认母内容适配。' : '以清单中明确列出的适配范围为准。';
  $('metric-observations-label').textContent = observations ? '计划 AI 回答观察' : '已列明服务'; $('metric-observations').textContent = observations ? `${observations.toLocaleString('zh-CN')} 次` : `${plan.items.length + (plan.pendingItems?.length || 0)} 项`;
  $('metric-observations-note').textContent = observations ? '按所选问题数、平台与观察轮次计算。独立社交聆听不计入此处。' : '包括已定价与待报价范围，两者在上方分别列明。';
}
function refreshPreview() {
  cancelPending(); setMessage(); manualAdjusted = Object.keys(moduleSelections[currentMarket()]).length > 0; updateControls();
  if (!form.checkValidity()) { markInputInvalid('请完成有效的预算与服务范围输入，随后会重新计算当前方案。'); return; }
  if (getInput().listening.enabled && !getInput().listening.platforms.length) { markInputInvalid('请选择至少一个社交监控平台，或取消独立 Social Listening。'); return; }
  try { renderRecommendation(createRecommendation(getInput()), 'preview'); }
  catch { markInputInvalid('请完善服务范围。当前输入会保留，也可与顾问确认配置。'); }
}
function markInputInvalid(message) {
  configurationValid = false;
  displayedPlans = [];
  $('source-badge').textContent = '等待有效输入';
  $('source-badge').classList.remove('ai');
  $('result-summary').textContent = message;
  $('plans-grid').replaceChildren();
  $('plan-detail').hidden = true;
  $('export-button').disabled = true;
  $('print-button').disabled = true;
  $('consult-button').setAttribute('aria-disabled', 'true');
  $('consult-button').setAttribute('tabindex', '-1');
  $('value-plan-name').textContent = '完善输入后显示当前服务组合';
  $('value-plan-total').textContent = '待配置';
  ['metric-content', 'metric-channels', 'metric-observations'].forEach((id) => { $(id).textContent = '—'; });
}
function isValidRecommendation(data) {
  if (!data || !['deepseek', 'rules'].includes(data.source) || typeof data.summary !== 'string' || !Array.isArray(data.plans) || !data.plans.length || data.plans.length > 3) return false;
  return data.plans.every((plan) => plan && typeof plan.id === 'string' && typeof plan.name === 'string' && typeof plan.description === 'string' && Number.isFinite(plan.total) && plan.total >= 0 && Array.isArray(plan.items) && plan.items.length <= 100 && plan.items.every((item) => typeof item.id === 'string' && typeof item.name === 'string' && Number.isFinite(item.quantity) && item.quantity > 0 && Number.isFinite(item.unitPrice) && Number.isFinite(item.total) && Array.isArray(item.deliverables)) && (plan.pendingItems === undefined || Array.isArray(plan.pendingItems)) && Array.isArray(plan.phases) && Array.isArray(plan.highlights) && Array.isArray(plan.assumptions));
}
async function requestRecommendation(event) {
  event.preventDefault(); if (!form.reportValidity() || !configurationValid || !syncModuleQuantities()) { setMessage('请先完善市场、预算、服务范围与模块数量。', true); return; }
  cancelPending(); const sequence = requestSequence; const controller = new AbortController(); requestController = controller;
  setLoading(true); setMessage('正在结合市场、范围与选配项目整理建议；你已移除的可选项会保留。');
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getInput()), signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error(response.status === 429 ? '请求较多，请稍后重试。当前配置仍可使用。' : 'AI 建议暂未完成，已保留你的配置。请稍后重试。');
    const result = await response.json(); if (sequence !== requestSequence) return;
    if (!isValidRecommendation(result)) throw new Error('建议格式暂未就绪，已保留当前配置。请稍后重试。');
    renderRecommendation(result, 'result');
    setMessage(result.source === 'deepseek' ? 'AI 建议已更新，你的可选项目增删与数量已保留。可继续调整后联系顾问确认。' : '本次为基础推荐，AI 定制暂未完成；当前配置可继续调整。', result.source !== 'deepseek');
    if (window.matchMedia('(max-width: 680px)').matches) $('results-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (sequence !== requestSequence) return;
    setMessage(error.name === 'AbortError' ? '分析等待较久，输入与选配均已保留。请重试。' : error instanceof TypeError ? '暂时无法连接 AI 顾问，当前配置已保留。请重试。' : error.message, true);
  } finally { clearTimeout(timeout); if (sequence === requestSequence) { const failed = $('request-message').classList.contains('error'); setLoading(false); if (failed) $('ai-button-text').textContent = '重试 AI 定制建议'; requestController = undefined; } }
}
function safeMarkdown(value) { return String(value).replace(/[\\`*_{}[\]<>|]/g, '\\$&').replace(/\r?\n/g, ' '); }
function exportPlan() {
  if (!syncModuleQuantities()) return;
  const plan = getDisplayedPlan(); if (!plan || !configurationValid) return; const input = getInput();
  const lines = ['# Eco GEO · 项目服务方案', '', `日期：${new Date().toLocaleDateString('zh-CN')}`, '', `方案来源：${$('source-badge').textContent}`, '', `服务市场：${input.market === 'cn' ? '中文 GEO' : '境外 GEO'}`, '', `${input.market === 'cn' ? '本季度预算' : '境外本期项目预算'}：${input.budgetMode === 'discuss' ? '另行讨论，先确认范围' : money(input.budget)}`, '', `范围：${input.scope.productLines} 条产品线，每产品线 ${input.scope.scenarios} 个场景、${input.scope.audiences} 类客群；全项目 ${input.scope.intents} 个去重意图主题。`, '', `主要目标：${goalLabels[input.goal]}`, '', `品牌基础：${stageLabels[input.stage]}`, ''];
  if (input.notes) lines.push(`备注：${safeMarkdown(input.notes)}`, '');
  lines.push(`## ${safeMarkdown(plan.name)}`, '', safeMarkdown(plan.description), '', '## 已定价交付', '', '| 服务 | 数量 | 单价 | 小计 |', '| --- | --- | --- | --- |');
  plan.items.forEach((item) => lines.push(`| ${safeMarkdown(item.name)}${item.required ? '（基础必需）' : ''} | ${item.quantity} ${safeMarkdown(item.unit || '项')} | ${money(item.unitPrice)} | ${money(item.total)} |`));
  lines.push('', `**${isPending(plan) ? '已定价部分小计' : plan.totalLabel || '服务费合计'}：${isPending(plan) && !plan.total ? '待报价' : money(plan.total)}**`, '');
  if (plan.pendingItems?.length) { lines.push('## 待报价范围', ''); plan.pendingItems.forEach((item) => { lines.push(`- ${safeMarkdown(item.name)} × ${item.quantity}：${safeMarkdown(item.reason || '按范围报价')}`); (item.details || []).forEach((text) => lines.push(`  - ${safeMarkdown(text)}`)); }); lines.push('', '以上待报价范围未计入已定价小计，当前不是完整报价。', ''); }
  if (plan.pricingBreakdown) { const p = plan.pricingBreakdown; lines.push('## 中文季度标准单元', '', `业务范围单元 ${p.scopeUnits}；意图单元 ${p.intentUnits}；取较大值 ${p.units} × ${money(p.unitPrice)} = ${money(p.unitPrice * p.units)} / 季度。`, ''); }
  if (input.listening.enabled) lines.push('## 独立 Social Listening', '', `平台：${input.listening.platforms.join('、') || '待确认'}；深度：${$('social-depth').selectedOptions[0].textContent}；频率：${$('social-frequency').selectedOptions[0].textContent}；${input.listening.markets} 个市场、${input.listening.languages} 种语言。按范围另行报价，区别于 AI 回答采样。`, '');
  if (Object.keys(input.modules).length) { lines.push('## 用户手动选配', ''); Object.entries(input.modules).forEach(([id, quantity]) => { const item = [...getOptionalServices(input.market), ...plan.items].find((entry) => entry.id === id); lines.push(`- ${safeMarkdown(item?.name || id)}：${quantity === 0 ? '已移除，AI 不得自动加回' : `数量 ${quantity}`}`); }); lines.push(''); }
  plan.items.forEach((item) => { lines.push(`### ${safeMarkdown(item.name)}`, ''); item.deliverables.forEach((text) => lines.push(`- ${safeMarkdown(text)}`)); lines.push(''); });
  lines.push('## 实施阶段', ''); plan.phases.forEach((phase) => lines.push(`- ${safeMarkdown(phase.title)}：${safeMarkdown(phase.description)}`));
  lines.push('', '## 范围前提', ''); plan.assumptions.forEach((text) => lines.push(`- ${safeMarkdown(text)}`));
  lines.push('', '下一步：顾问确认范围、报价与排期。参考配置不自动提交，也不构成付款要求。第三方采购与税费以正式报价单为准。', '', '联系：info@eco-geo.com', '', 'https://eco-geo.org/package-advisor/', '');
  const url = URL.createObjectURL(new Blob(['\uFEFF', lines.join('\n')], { type: 'text/markdown;charset=utf-8' })); const anchor = node('a'); anchor.href = url; anchor.download = `Eco-GEO-项目服务方案-${new Date().toISOString().slice(0, 10)}.md`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); showToast('已导出当前市场、预算、范围与完整选配。');
}
function showToast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function bandForBudget(value) { return value < 30000 ? 'light' : value <= 150000 ? 'system' : 'scale'; }
function setBudget(value, bandId = value === null ? 'scale' : bandForBudget(value)) {
  currentBudgetMode = value === null ? 'discuss' : 'amount'; if (value !== null) currentBudget = value; activeBudgetBand = bandId; $('budget-amount').setCustomValidity(''); refreshPreview();
}
form.addEventListener('submit', requestRecommendation);
form.addEventListener('input', (event) => {
  if (event.target.name === 'market' && currentMarket() !== activeMarket) {
    listeningSelections[activeMarket] = readListeningFields();
    activeMarket = currentMarket();
    restoreListeningFields(listeningSelections[activeMarket]);
    if (moduleSelections[activeMarket].SOCIAL_LISTENING === 0) $('social-enabled').checked = false;
  }
  if (event.target.id === 'budget-amount') {
    const value = Number(event.target.value);
    if (event.target.value !== '' && Number.isSafeInteger(value) && value >= 5000) setBudget(value);
    else { cancelPending(); event.target.setCustomValidity('请输入不少于 ¥5,000 的整数金额，或选择另行讨论。'); markInputInvalid('请完成预算输入，或选择“预算另行讨论”。'); }
    return;
  }
  if (event.target.id === 'budget') {
    const value = activeBudgetBand === 'scale' ? positionToBudget(Number(event.target.value)) : Number(event.target.value);
    currentBudgetMode = value === null ? 'discuss' : 'amount'; if (value !== null) currentBudget = value;
  }
  if (event.target.id === 'social-enabled') {
    if (event.target.checked) delete moduleSelections[currentMarket()].SOCIAL_LISTENING;
    else moduleSelections[currentMarket()].SOCIAL_LISTENING = 0;
  }
  refreshPreview();
});
form.addEventListener('change', (event) => {
  if (event.target.id === 'budget-amount') {
    const entered = Number(event.target.value); const value = event.target.value === '' || !Number.isFinite(entered) ? currentBudget : Math.min(MAX_SAFE_BUDGET, Math.max(5000, Math.round(entered)));
    event.target.value = String(value); setBudget(value); if (value !== entered) setMessage(`已调整为 ${money(value)}。也可选择预算另行讨论。`);
  }
});
document.querySelectorAll('[data-budget-band]').forEach((button) => button.addEventListener('click', () => setBudget(budgetBands[button.dataset.budgetBand].initial, button.dataset.budgetBand)));
document.querySelectorAll('[data-budget]').forEach((button) => button.addEventListener('click', () => setBudget(Number(button.dataset.budget), activeBudgetBand)));
$('discuss-button').addEventListener('click', () => setBudget(null));
$('resume-budget').addEventListener('click', () => setBudget(currentBudget));
$('add-module').addEventListener('click', () => { const id = $('module-select').value; if (id) changeModule(id, 1); });
$('export-button').addEventListener('click', exportPlan);
$('print-button').addEventListener('click', () => { if (!syncModuleQuantities()) return; const details = document.querySelector('.assumptions'); const open = details.open; details.open = true; window.print(); details.open = open; });
$('consult-button').addEventListener('click', (event) => {
  if (!syncModuleQuantities()) { event.preventDefault(); return; }
  if (!configurationValid || !getDisplayedPlan() || !prepareContactHandoff(getInput(), getDisplayedPlan(), currentRecommendation)) {
    event.preventDefault();
    showToast('浏览器未能携带方案，请先下载方案，再联系顾问。');
  }
});
refreshPreview();
