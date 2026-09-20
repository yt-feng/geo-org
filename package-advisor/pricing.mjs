import { catalog, cnCatalog, getOptionalServices, CN_UNIT_PRICE, INTENT_DEFINITION } from './catalog.mjs';

const INPUT_KEYS = new Set(['budget', 'budgetMode', 'market', 'scope', 'goal', 'stage', 'notes', 'modules', 'listening']);
const SCOPE_KEYS = new Set(['productLines', 'scenarios', 'audiences', 'intents']);
const LISTENING_KEYS = new Set(['enabled', 'platforms', 'depth', 'cadence', 'markets', 'languages']);
const DEFAULT_SCOPE = { productLines: 1, scenarios: 3, audiences: 3, intents: 30 };
const DEFAULT_LISTENING = { enabled: false, platforms: [], depth: 'insights', cadence: 'monthly', markets: 1, languages: 1 };
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const originals = ['W07', 'W08', 'W09', 'W15', 'W16', 'W17'];
const systemPendingIds = new Set(['OVERSEAS_SCOPE', 'OVERSEAS_PROGRAM_DISCOVERY', 'OVERSEAS_PROGRAM_CONTENT', 'OVERSEAS_PROGRAM_GOVERNANCE']);
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const safeInteger = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const fail = code => { throw new Error(code); };

export function calculateChineseUnits(scope) {
  const scopeUnits = scope.productLines * Math.ceil(scope.scenarios / 3) * Math.ceil(scope.audiences / 3);
  const intentUnits = Math.ceil(scope.intents / 30);
  return {
    scopeUnits, intentUnits, units: Math.max(scopeUnits, intentUnits), unitPrice: CN_UNIT_PRICE,
    formula: '单元数 = max(产品线数 × 向上取整(每产品线场景数 ÷ 3) × 向上取整(每产品线客群数 ÷ 3), 向上取整(全项目去重意图数 ÷ 30))；季度价 = 单元数 × ¥50,000',
    scopeBasis: '场景数和客群数按每条产品线统一规划；产品线间的差异写入备注后确认。范围单元不是文章、发布或回答数量，意图费用不重复叠加。',
    intentDefinition: INTENT_DEFINITION,
  };
}

function normalizeSelections(value, input) {
  if (value === undefined) return {};
  if (!object(value)) return fail('invalid_modules');
  const services = new Map(getOptionalServices(input.market).map(item => [item.id, item]));
  const normalized = {};
  for (const [id, quantity] of Object.entries(value)) {
    const service = services.get(id);
    if (!service || !safeInteger(quantity, 0, service.maxQuantity)) return fail('invalid_modules');
    if (id === 'CN_QUARTER' && quantity !== calculateChineseUnits(input.scope).units) return fail('core_service_locked');
    normalized[id] = quantity;
  }
  return normalized;
}

export function normalizeAdvisorInput(value) {
  if (!object(value) || Object.keys(value).some(key => !INPUT_KEYS.has(key))) return fail('invalid_input');
  const market = value.market === undefined ? 'overseas' : value.market;
  const budgetMode = value.budgetMode === undefined ? 'amount' : value.budgetMode;
  if (!['cn', 'overseas'].includes(market) || !['amount', 'discuss'].includes(budgetMode)) return fail('invalid_input');
  if (budgetMode === 'discuss' ? value.budget !== null : !safeInteger(value.budget, 5000, Number.MAX_SAFE_INTEGER)) return fail('invalid_input');
  if (!['visibility', 'content', 'authority'].includes(value.goal) || !['starting', 'growing', 'established'].includes(value.stage)) return fail('invalid_input');
  if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 1600 || CONTROLS.test(value.notes))) return fail('invalid_input');
  if (value.scope !== undefined && (!object(value.scope) || Object.keys(value.scope).some(key => !SCOPE_KEYS.has(key)))) return fail('invalid_scope');
  const scope = { ...DEFAULT_SCOPE, ...value.scope };
  for (const [key, count] of Object.entries(scope)) if (!safeInteger(count, 1, key === 'intents' ? 1000 : 100)) return fail('invalid_scope');
  if (value.listening !== undefined && (!object(value.listening) || Object.keys(value.listening).some(key => !LISTENING_KEYS.has(key)))) return fail('invalid_listening');
  const listening = { ...DEFAULT_LISTENING, ...value.listening };
  if (typeof listening.enabled !== 'boolean' || !['mentions', 'insights', 'strategy'].includes(listening.depth) || !['monthly', 'weekly', 'daily', 'realtime'].includes(listening.cadence) || !safeInteger(listening.markets, 1, 50) || !safeInteger(listening.languages, 1, 30)) return fail('invalid_listening');
  if (!Array.isArray(listening.platforms) || listening.platforms.length > 20 || listening.platforms.some(platform => typeof platform !== 'string' || platform.trim().length < 1 || platform.length > 80 || CONTROLS.test(platform))) return fail('invalid_listening');
  listening.platforms = [...new Set(listening.platforms.map(platform => platform.trim()))];
  const input = { budget: value.budget, budgetMode, market, scope, goal: value.goal, stage: value.stage, notes: value.notes?.trim() || '', listening };
  input.modules = normalizeSelections(value.modules, input);
  return input;
}

function pricedLine(service, quantity, required = false) {
  return { id: service.id, name: service.name, quantity, unitPrice: service.price, total: service.price * quantity, unit: service.unit, deliverables: [...service.deliverables], prerequisites: [...service.prerequisites], required, optional: !required, pricingStatus: 'priced' };
}
function pendingLine(service, quantity, reason, details = []) {
  return { id: service.id, name: service.name, quantity, unit: service.unit, unitPrice: null, total: null, reason, details: [...details], deliverables: [...(service.deliverables || [])], prerequisites: [...(service.prerequisites || [])], required: false, optional: true, pricingStatus: 'quote_required' };
}
function scopeDetails(input) {
  return [`${input.scope.productLines} 条产品线；每产品线 ${input.scope.scenarios} 个场景、${input.scope.audiences} 类客群`, `全项目 ${input.scope.intents} 个去重决策主题；同义问法不重复计数`, INTENT_DEFINITION];
}
function socialLine(input) {
  const service = getOptionalServices(input.market).find(item => item.id === 'SOCIAL_LISTENING');
  const depth = { mentions: '提及与主题识别', insights: '讨论洞察与竞品分析', strategy: '策略研究与行动建议' }[input.listening.depth];
  const cadence = { monthly: '月度', weekly: '每周', daily: '每日', realtime: '实时监测需求（须确认可取得性与响应安排）' }[input.listening.cadence];
  return { ...pendingLine(service, 1, '定制社交聆听独立核价；不与 AI 回答采样、精选讨论研究混算。', [`平台：${input.listening.platforms.join('、') || '待确认'}`, `研究深度：${depth}；频率：${cadence}`, `覆盖 ${input.listening.markets} 个市场、${input.listening.languages} 种语言`, '历史窗口、数据授权、告警规则、响应方式及外部数据费用另行确认']), parameters: { ...input.listening, enabled: true, platforms: [...input.listening.platforms] } };
}

function systemScopeLine(input, id = 'OVERSEAS_SCOPE') {
  return { id, name: id === 'OVERSEAS_SCOPE' ? '境外范围扩展与实施方案' : '境外企业项目整体范围与报价', quantity: 1, unit: '定制项目', unitPrice: null, total: null, pricingStatus: 'quote_required', required: true, optional: false,
    reason: '境外项目按实际产品线、场景、客群、去重意图与实施条件核价；不直接套用中文标准单元或把预算截断为套餐总价。',
    details: [...scopeDetails(input), '内容、渠道、语言、采样协议和执行排期分别确认；矩阵大小不等于文章或发布数量。'],
  };
}

function originalCoreMinimums(plan, input, services) {
  if (input.market === 'cn') return { CN_QUARTER: calculateChineseUnits(input.scope).units };
  if (plan.coreMinimums !== undefined) {
    if (!object(plan.coreMinimums)) return fail('invalid_plan');
    const minimums = {};
    for (const [id, minimum] of Object.entries(plan.coreMinimums)) {
      const service = services.get(id);
      if (!service || !(id === 'W01' || id === 'W04' || service.sampling) || !safeInteger(minimum, 1, service.maxQuantity)) return fail('invalid_plan');
      minimums[id] = minimum;
    }
    return minimums;
  }
  // Only the original template establishes mandatory quantities. The stable map
  // survives customization so manually added services never become locked later.
  return Object.fromEntries(plan.items.filter(item => item.id === 'W01' || item.id === 'W04' || services.get(item.id)?.sampling).map(item => [item.id, item.quantity]));
}

export function customizePricedPlan(plan, rawInput, selections = {}) {
  const input = normalizeAdvisorInput(rawInput);
  if (!object(plan) || !Array.isArray(plan.items)) return fail('invalid_plan');
  const selected = normalizeSelections(selections, input);
  const services = new Map(getOptionalServices(input.market).map(item => [item.id, item]));
  const coreMinimums = originalCoreMinimums(plan, input, services);
  const quantities = new Map();
  const systemPending = [];
  for (const item of plan.items) {
    const service = services.get(item.id);
    if (!service || service.price === null || !safeInteger(item.quantity, 1, service.maxQuantity)) return fail('invalid_plan');
    quantities.set(item.id, item.quantity);
  }
  for (const item of plan.pendingItems || []) {
    if (systemPendingIds.has(item.id)) systemPending.push(systemScopeLine(input, item.id));
    else {
      const service = services.get(item.id);
      if (!service || service.price !== null || !safeInteger(item.quantity, 1, service.maxQuantity)) return fail('invalid_plan');
      quantities.set(item.id, item.quantity);
    }
  }
  for (const [id, quantity] of Object.entries(selected)) {
    const minimum = coreMinimums[id];
    if (minimum !== undefined && quantity < minimum) return fail('core_service_locked');
    if (quantity === 0) quantities.delete(id);
    else quantities.set(id, quantity);
  }
  if (input.market === 'cn') quantities.set('CN_QUARTER', calculateChineseUnits(input.scope).units);
  if (selected.SOCIAL_LISTENING === undefined && input.listening.enabled) quantities.set('SOCIAL_LISTENING', 1);

  const prefix = input.market === 'cn' ? 'CN_' : '';
  const pitchId = prefix + 'PITCH', setupId = prefix + 'PITCH_SETUP';
  const dependencyNotes = [];
  if (quantities.has(pitchId)) {
    quantities.set(setupId, 1);
    dependencyNotes.push('行业 PR 编辑沟通自动配套一次首次资料与方法设置；同一项目不重复收取设置费用。');
  } else if (quantities.has(setupId)) {
    quantities.delete(setupId);
    dependencyNotes.push('未选择 PR 编辑沟通，首次设置未单独计入。');
  }
  const monitorIds = [...quantities.keys()].filter(id => input.market === 'overseas' && services.get(id)?.sampling);
  if (monitorIds.length > 1) {
    const chosen = Object.keys(selected).filter(id => selected[id] > 0 && services.get(id)?.sampling);
    if (chosen.length !== 1) return fail('duplicate_monitoring');
    // Explicitly selecting a different monitoring scope replaces the old one;
    // the old monitor cannot be billed alongside the replacement.
    for (const id of monitorIds) if (id !== chosen[0]) {
      quantities.delete(id);
      if (coreMinimums[id] !== undefined) {
        coreMinimums[chosen[0]] = coreMinimums[id];
        delete coreMinimums[id];
      }
    }
  }
  const items = [], pendingItems = [...systemPending];
  for (const [id, quantity] of quantities) {
    const service = services.get(id);
    if (id === 'SOCIAL_LISTENING') pendingItems.push(socialLine(input));
    else if (service.price === null) pendingItems.push(pendingLine(service, quantity, id === 'CN_W22' ? '仅核价超出基包的额外多团队协作；基础排期、执行统筹和季度复盘已在基包内，不重复收费。' : '中文增项按所选数量和实际范围单独报价，先扣除基包已包含的工作，不使用境外价格。', ['数量表示申请配置的增量计价单位，具体交付与价格在正式报价中确认。']));
    else items.push(pricedLine(service, quantity, coreMinimums[id] !== undefined || (id === setupId && quantities.has(pitchId))));
  }
  const expandedOverseas = input.market === 'overseas' && (input.scope.productLines > 1 || input.scope.scenarios > 3 || input.scope.audiences > 3 || input.scope.intents > 30);
  if (expandedOverseas && !pendingItems.some(item => systemPendingIds.has(item.id))) pendingItems.unshift(systemScopeLine(input));
  const total = items.reduce((n, item) => n + item.total, 0);
  if (!Number.isSafeInteger(total)) return fail('invalid_total');
  const configured = items.length > 0 || pendingItems.length > 0;
  const quoteRequired = pendingItems.length > 0 || !configured;
  const pricingStatus = quoteRequired ? (items.length ? 'partial' : 'quote_required') : 'priced';
  const count = id => quantities.get(id) || 0;
  const sampling = input.market === 'overseas' ? items.map(item => services.get(item.id).sampling).find(Boolean) : undefined;
  const assumptions = [
    input.market === 'cn' ? '中文季度标准单元与境外服务独立定价；本方案只使用中文标准价和中文增项待报价。' : '境外服务按各行注明的计价单位列示；超出已定价单位的整体范围另行核价。',
    '金额为人民币未税服务费。媒体采购、会员、广告、拍摄、差旅、专门数据授权等外部费用按实际项目另列。',
    INTENT_DEFINITION,
    '每行范围描述以一个计价单位为准。矩阵、去重主题、文章、适配发布、AI回答观察和社交讨论样本分别计量，不互相充当数量。',
    ...dependencyNotes,
  ];
  if (quoteRequired) assumptions.unshift('显示金额仅为已定价服务小计；待报价项目尚未计入，不能据此判断整体价格或是否在预算内。');
  if (input.budgetMode === 'discuss') assumptions.unshift('预算选择另行讨论；本页不作预算内承诺，也不将开放预算视为零元。');
  if (input.market === 'cn') assumptions.push(calculateChineseUnits(input.scope).scopeBasis);
  if (!count(prefix + 'W01')) assumptions.push('客户提供可核验事实、获准使用的资料和审校负责人；资料不足时先确认补充范围，不直接制作或发布未经核准的主张。');
  if (count(prefix + 'W15')) assumptions.push('白皮书复用已付费的母文、案例或访谈时，正式范围核销重复制作，不将复用内容计为额外原创。');
  if (sampling) {
    if (count('W04') * 30 < sampling.questions) assumptions.push(`客户须提供至少 ${sampling.questions} 道已审核、已定稿且可直接采样的去重问题；不足部分需补充题库工作后再执行。`);
    assumptions.push(`AI 回答采样：${sampling.questions} 题 × ${sampling.platforms} 个实际平台 × 每题每轮 ${sampling.repeats} 次；${sampling.baselineRounds} 次基线、${sampling.fullFollowupRounds} 次完整复测，共 ${sampling.plannedAnswers} 次计划回答观察。此项不是社交聆听。`);
  }
  if (count(prefix + 'W10') && !originals.some(id => count(prefix + id))) assumptions.push('渠道适配须由客户提供已完成、已核准且可公开使用的合格母稿；未计入新母稿制作。');
  if (count(prefix + 'W03')) assumptions.push('精选公开讨论研究是有界的一次性人工研究，不等于持续跨平台 Social Listening；定制社交聆听独立核价。');
  for (const item of [...items, ...pendingItems]) for (const prerequisite of services.get(item.id)?.prerequisites || []) if (!assumptions.includes(prerequisite)) assumptions.push(prerequisite);
  if (!configured) assumptions.unshift('当前选择尚未形成服务清单；零小计不代表免费服务，请选择合适模块或按需求配置。');
  const comparable = input.budgetMode === 'amount' && !quoteRequired;
  const quantitySummary = items.map(item => `${item.name} × ${item.quantity}`).join('；');
  const remaining = comparable ? input.budget - total : null;
  const scopeLabel = input.market === 'cn' ? '中文季度标准单元' : quoteRequired ? '范围与报价建议' : plan.scopeLabel || '服务组合';
  const horizon = input.market === 'cn' ? '按季度确认交付' : quoteRequired || input.budgetMode === 'discuss' ? '范围确认后分阶段推进' : plan.horizon || '按所选专项安排交付';
  const customized = Object.keys(selected).length > 0;
  const phases = input.market === 'cn' ? [
    { title: '01 · 确认中文范围单元', description: '核对产品线、每产品线的场景与客群、全项目去重意图；固定标准单元和可选增项分别列示。' },
    { title: '02 · 锁定季度交付清单', description: '确认去重问题清单、事实与证据缺口、内容行动及执行记录；具体内容数量、平台与轮次在启动清单确定。' },
    { title: '03 · 季度执行与复盘', description: '按清单交付可复用资料、执行记录和下一季度优先级；未定价增项经报价确认后执行。' },
  ] : sampling ? [
    { title: '01 · 核验题库与事实', description: `确认 ${sampling.questions} 道去重题目、${sampling.platforms} 个实际平台和采样口径。` },
    { title: '02 · 执行所选模块', description: '按当前清单完成资料、内容或渠道工作，整理原回答、引用和缺失记录。' },
    { title: sampling.fullFollowupRounds ? '03 · 复测与交接' : '03 · 基线交付与下一步', description: sampling.fullFollowupRounds ? `按约定周期完成 ${sampling.fullFollowupRounds} 次完整复测，交接比较记录与后续建议。` : '本项只含单次基线，后续复测另行确认；按实际清单交接。' },
  ] : [
    { title: '01 · 确认范围与资料', description: '核对所选范围、客户素材、数据条件与权限，列清已定价和待报价模块。' },
    { title: '02 · 执行确认的服务', description: '按实际选择的模块和数量执行，未定价项目先确认报价与清单。' },
    { title: '03 · 交付与阶段选择', description: '交接约定成果和记录，再决定下一阶段；当前未包含固定 AI 回答采样。' },
  ];
  const result = {
    ...plan, ...(customized ? { name: `${input.market === 'cn' ? '中文季度' : '境外'} · 自选服务组合` } : {}), customized, phases, market: input.market, budgetMode: input.budgetMode, scope: { ...input.scope }, scopeLabel, horizon,
    coreMinimums: { ...coreMinimums }, items, pendingItems, total, totalLabel: quoteRequired ? '已定价服务小计（待报价项目未计入）' : '已定价服务小计',
    pricingStatus, quoteRequired, withinBudget: comparable ? total <= input.budget : null,
    pricedSubtotalWithinBudget: input.budgetMode === 'amount' ? total <= input.budget : null,
    allocatedBudget: total, remainingBudget: remaining, configurationRequired: !configured,
    description: !configured ? '当前尚未配置可执行服务；此处不是免费服务报价。请保留需求或调整可选模块。' : customized ? '已按您的模块选择重新计算。已定价服务与待报价项目分别列明，数量按实际清单核对。' : plan.description,
    highlights: [quantitySummary || '整体范围待核价，尚未产生可下单的已定价服务清单', ...(pendingItems.length ? [`${pendingItems.length} 项待报价，金额尚未计入`] : !configured ? ['尚未配置服务，需先确定交付范围'] : []), input.budgetMode === 'discuss' ? '预算另行讨论；不作预算内承诺' : quoteRequired ? `项目预算 ¥${input.budget.toLocaleString('zh-CN')}，完整报价确认后再比较` : `预算余量 ¥${remaining.toLocaleString('zh-CN')}；按需要决定下一步`],
    assumptions: [...new Set(assumptions)],
  };
  if (sampling) result.sampling = { ...sampling };
  else delete result.sampling;
  if (input.market === 'cn') result.pricingBreakdown = calculateChineseUnits(input.scope);
  return result;
}

export function createChinesePlans(input, preferences = {}) {
  const service = cnCatalog.find(item => item.id === 'CN_QUARTER');
  const units = calculateChineseUnits(input.scope).units;
  const allowed = new Map(getOptionalServices('cn').map(item => [item.id, item]));
  const mapId = id => id === 'SOCIAL_LISTENING' || id.startsWith('CN_') ? id : `CN_${id}`;
  const priorities = (preferences.prioritize || []).map(mapId).filter(id => allowed.has(id) && id !== 'CN_QUARTER');
  const excluded = new Set((preferences.exclude || []).map(mapId));
  // The confirmed Chinese base is complete at its quoted unit price.
  // Add-ons are introduced only by explicit user selections or AI suggestions,
  // never automatically because of the selected goal.
  const optional = [...new Set(priorities)].filter(id => !excluded.has(id));
  return [0, 1, 2].map(index => ({
    id: ['essential', 'recommended', 'extended'][index], label: ['季度基础', '优先建议', '增项候选'][index], name: optional.length ? ['中文季度标准单元', '中文基础与优先增项', '中文基础与扩展候选'][index] : '中文季度标准单元',
    items: [pricedLine(service, units, true)],
    pendingItems: optional.slice(0, index).map(id => id === 'SOCIAL_LISTENING' ? socialLine(input) : pendingLine(allowed.get(id), 1, '此为可删减的中文增项候选，需单独确认范围与价格。')),
    description: `已确认季度标准单元为 ¥50,000，当前范围需 ${units} 个单元；可选增项独立列示，不默认为包含在基包内。`,
    assumptions: ['中文基包覆盖所选标准单元范围；不直接复制境外套餐的内容篇数、采样量、媒体数量或效果承诺。'],
    phases: [
      { title: '01 · 确认范围单元', description: '核对产品线、各产品线场景与客群，以及全项目去重决策主题。' },
      { title: '02 · 锁定季度清单', description: '按标准单元与确认的增项，明确研究、内容、渠道和观测的实际交付清单。' },
      { title: '03 · 按清单执行与复盘', description: '按确认排期和证据记录验收；下一季度或新增范围另行选择。' },
    ],
  }));
}

export function createEnterprisePlans(input) {
  return [0, 1, 2].map(index => ({
    id: ['essential', 'recommended', 'extended'][index], label: '企业定制方案', name: '境外企业定制方案', items: [], pendingItems: [systemScopeLine(input, 'OVERSEAS_PROGRAM_DISCOVERY')],
    description: `围绕 ${input.scope.productLines} 条产品线及所选场景、客群和去重意图配置境外服务。先确认各阶段清单与报价，已选标准模块可单独列价。`,
    assumptions: ['当前是企业需求与报价范围建议，尚未形成全项目总价；没有将大预算截断成固定套餐，也没有自动虚构国家、周期或内容数量。'],
    phases: [
      { title: '01 · 核对业务范围', description: '按产品线梳理场景、客群、独立决策主题、现有资料和渠道条件。' },
      { title: '02 · 配置首阶段', description: '选择明确的研究、内容、观测或渠道模块，逐项确认数量与报价。' },
      { title: '03 · 分阶段实施', description: '按确认的成果和证据验收，再配置下一阶段服务。' },
    ],
  }));
}

export function finalizeRecommendation(recommendation, rawInput, preferences = {}) {
  const input = normalizeAdvisorInput(rawInput);
  const plans = recommendation.plans.map(plan => {
    const requested = { ...input.modules };
    if ((preferences.prioritize || []).includes('SOCIAL_LISTENING') && requested.SOCIAL_LISTENING === undefined) requested.SOCIAL_LISTENING = 1;
    if ((preferences.exclude || []).includes('SOCIAL_LISTENING') && requested.SOCIAL_LISTENING === undefined && !input.listening.enabled) requested.SOCIAL_LISTENING = 0;
    return customizePricedPlan(plan, input, requested);
  });
  const recommended = plans.find(plan => plan.id === 'recommended') || plans[0];
  return { ...recommendation, market: input.market, budgetMode: input.budgetMode, scope: { ...input.scope }, plans,
    pricingStatus: recommended.pricingStatus, quoteRequired: recommended.quoteRequired, scopeLabel: recommended.scopeLabel, horizon: recommended.horizon,
    allocatedBudget: recommended.allocatedBudget, remainingBudget: recommended.remainingBudget,
    ...(recommended.pricingBreakdown ? { pricingBreakdown: recommended.pricingBreakdown } : {}),
  };
}
