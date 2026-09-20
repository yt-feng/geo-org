import { catalog, cnCatalog, getOptionalServices, CN_UNIT_PRICE, INTENT_DEFINITION, LANGUAGE_LABELS, OVERSEAS_LANGUAGES, LANGUAGE_PRICE_FACTORS, SHARED_SERVICE_IDS, EXTRA_LANGUAGE_SHARE, SOCIAL_QUARTER_PRICES, SOCIAL_CADENCE_FACTORS, ESTIMATE_NOTICE, PLATFORM_LABELS } from './catalog.mjs';

const INPUT_KEYS = new Set(['budget', 'budgetMode', 'market', 'scope', 'goal', 'stage', 'notes', 'modules', 'listening', 'languages']);
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
    scopeBasis: '场景数和客群数按每条产品线统一规划；产品线间的差异可在备注中说明。实际文章、发布与观察数量以季度交付清单为准。',
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
  const languageInput = value.languages === undefined ? [market === 'cn' ? 'zh' : 'en'] : value.languages;
  if (!Array.isArray(languageInput) || languageInput.length < 1 || languageInput.length > 10 || languageInput.some(language => typeof language !== 'string' || !(market === 'cn' ? ['zh'] : OVERSEAS_LANGUAGES).includes(language))) return fail('invalid_languages');
  const languages = [...new Set(languageInput)];
  if (market === 'cn' && (languages.length !== 1 || languages[0] !== 'zh')) return fail('invalid_languages');
  const scope = { ...DEFAULT_SCOPE, ...value.scope };
  for (const [key, count] of Object.entries(scope)) if (!safeInteger(count, 1, key === 'intents' ? 1000 : 100)) return fail('invalid_scope');
  if (value.listening !== undefined && (!object(value.listening) || Object.keys(value.listening).some(key => !LISTENING_KEYS.has(key)))) return fail('invalid_listening');
  const listening = { ...DEFAULT_LISTENING, ...value.listening };
  if (typeof listening.enabled !== 'boolean' || !['mentions', 'insights', 'strategy'].includes(listening.depth) || !['monthly', 'weekly', 'daily', 'realtime'].includes(listening.cadence) || !safeInteger(listening.markets, 1, 50) || !safeInteger(listening.languages, 1, 30)) return fail('invalid_listening');
  if (!Array.isArray(listening.platforms) || listening.platforms.length > 20 || listening.platforms.some(platform => typeof platform !== 'string' || platform.trim().length < 1 || platform.length > 80 || CONTROLS.test(platform))) return fail('invalid_listening');
  listening.platforms = [...new Set(listening.platforms.map(platform => platform.trim()))];
  const input = { budget: value.budget, budgetMode, market, languages, scope, goal: value.goal, stage: value.stage, notes: value.notes?.trim() || '', listening };
  input.modules = normalizeSelections(value.modules, input);
  return input;
}

const sharedIds = new Set(SHARED_SERVICE_IDS);
const languageAliases = new Set(['W20', 'CN_W20']);
const money = amount => `¥${amount.toLocaleString('zh-CN')}`;
const serviceMap = market => new Map(getOptionalServices(market).map(item => [item.id, item]));
const orderedLanguages = input => OVERSEAS_LANGUAGES.filter(language => input.languages.includes(language));
const detail = (language, label, unitPrice, quantity) => ({ language, label, unitPrice, quantity, amount: unitPrice * quantity });

function calculateServicePricing(service, input, quantity) {
  if (languageAliases.has(service.id)) return { unitPrice: 0, pricingDetails: [] };
  let pricingDetails;
  if (service.id === 'SOCIAL_LISTENING') {
    const { platforms, depth, cadence, markets, languages } = input.listening;
    const coverage = 100 + 35 * (markets - 1) + 20 * (languages - 1);
    const unitPrice = Math.ceil(Math.max(1, platforms.length) * SOCIAL_QUARTER_PRICES[depth] * SOCIAL_CADENCE_FACTORS[cadence] * coverage / 10000) * 100;
    pricingDetails = [detail('shared', '季度社交聆听服务', unitPrice, quantity)];
  } else if (input.market === 'cn' || sharedIds.has(service.id)) {
    pricingDetails = [detail(input.market === 'cn' ? 'zh' : 'shared', input.market === 'cn' ? '中文服务' : '共享研究与实施', service.price, quantity)];
  } else {
    const languages = orderedLanguages(input);
    pricingDetails = languages.map((language, index) => {
      const isAdditional = index > 0 && !service.sampling && service.id !== 'W10';
      const unitPrice = Math.round(service.price * LANGUAGE_PRICE_FACTORS[language] * (isAdditional ? EXTRA_LANGUAGE_SHARE : 1));
      return detail(language, `${LANGUAGE_LABELS[language]}${service.sampling ? ' · 完整采样' : isAdditional ? ' · 本地化与审校' : ' · 内容与执行'}`, unitPrice, quantity);
    });
  }
  const unitPrice = pricingDetails.reduce((sum, item) => sum + item.unitPrice, 0);
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || !Number.isSafeInteger(unitPrice * quantity)) return fail('invalid_total');
  return { unitPrice, pricingDetails };
}

export function estimateServicePricing(id, rawInput, quantity = 1) {
  const input = normalizeAdvisorInput(rawInput);
  const service = serviceMap(input.market).get(id);
  if (!service || !safeInteger(quantity, 1, service.maxQuantity)) return fail('unknown_service');
  return calculateServicePricing(service, input, quantity);
}

export function estimateServiceUnitPrice(id, rawInput) {
  return estimateServicePricing(id, rawInput).unitPrice;
}

function estimatedLine(service, quantity, input, required = false) {
  const pricing = calculateServicePricing(service, input, quantity);
  const shared = input.market === 'overseas' && sharedIds.has(service.id);
  const localizing = input.market === 'overseas' && (input.languages.length !== 1 || input.languages[0] !== 'en');
  let deliverables = service.deliverables.map(value => !localizing ? value : value
    .replace('500–1000英文词或同等中文信息量', '所选语种的完整页面内容，按对应语种信息量确认篇幅')
    .replace('1篇800–1400英文词或同等中文深度的研究型文章', '每种所选语种各1篇完整研究型文章，按对应语种信息量确认篇幅')
    .replace('1篇英文渠道适配稿', '每种所选语种各1篇渠道适配稿')
    .replaceAll('英文', '所选语种'));
  if (service.sampling) {
    const sample = service.sampling;
    deliverables = [
      `每种所选语种分别执行 ${sample.questions} 道固定问题 × ${sample.platforms} 个实际平台 × 每题每轮 ${sample.repeats} 次；${sample.baselineRounds} 次基线、${sample.fullFollowupRounds} 次完整复测`,
      `每种所选语种 ${sample.plannedAnswers} 次计划回答观察，${input.languages.length} 种语种合计 ${sample.plannedAnswers * input.languages.length} 次`,
      '交付原回答证据、引用清单、缺失状态、分平台分析与下一步建议',
    ];
  }
  return {
    id: service.id, name: input.market === 'overseas' && (input.languages.length !== 1 || input.languages[0] !== 'en') ? service.name.replace(/^英文/, '') : service.name,
    quantity, unitPrice: pricing.unitPrice, total: pricing.unitPrice * quantity, unit: service.unit,
    deliverables, prerequisites: [...service.prerequisites], required, optional: !required,
    pricingStatus: 'estimate', estimated: true, pricingDetails: pricing.pricingDetails,
    languages: [...input.languages], ...(shared ? { shared: true } : {}),
  };
}

function scopeDetails(input) {
  return [`服务语种：${input.languages.map(language => LANGUAGE_LABELS[language]).join('、')}`, `${input.scope.productLines} 条产品线；每产品线 ${input.scope.scenarios} 个场景、${input.scope.audiences} 类客群`, `全项目 ${input.scope.intents} 个去重决策主题；同义问法不重复计数`, INTENT_DEFINITION];
}

function socialLine(input, services) {
  const depth = { mentions: '提及与主题识别', insights: '讨论洞察与竞品分析', strategy: '策略研究与行动建议' }[input.listening.depth];
  const cadence = { monthly: '月度', weekly: '每周', daily: '每日', realtime: '实时监测与告警需求' }[input.listening.cadence];
  return {
    ...estimatedLine(services.get('SOCIAL_LISTENING'), 1, input),
    details: [`平台：${input.listening.platforms.map(platform => PLATFORM_LABELS[platform] || platform).join('、') || '暂按 1 个平台估算，平台在服务清单确认'}`, `研究深度：${depth}；频率：${cadence}`, `覆盖 ${input.listening.markets} 个市场、${input.listening.languages} 种语言`, '历史窗口、数据授权、告警规则和响应方式在正式服务清单确认；外部数据采购费用单列'],
    parameters: { ...input.listening, enabled: true, platforms: [...input.listening.platforms] },
  };
}

function scopeLine(input, quantities, selections, services) {
  const { units } = calculateChineseUnits(input.scope);
  const targets = { W04: units, W05: units, W22: units * 3 };
  const components = Object.entries(targets).flatMap(([id, target]) => {
    if (selections[id] === 0) return [];
    const quantity = Math.max(0, target - (quantities.get(id) || 0));
    const service = services.get(id);
    return quantity ? [{ id, name: service.name, unit: service.unit, ...detail('shared', `${service.name} × ${quantity} ${service.unit}`, service.price, quantity) }] : [];
  });
  if (!components.length) return null;
  const total = components.reduce((sum, item) => sum + item.amount, 0);
  return {
    id: 'OVERSEAS_SCOPE', name: '季度增量范围服务', quantity: 1, unit: '季度范围服务', unitPrice: total, total,
    required: true, optional: false, pricingStatus: 'estimate', estimated: true, shared: true, languages: [...input.languages],
    pricingDetails: components.map(({ language, label, unitPrice, quantity, amount }) => ({ language, label, unitPrice, quantity, amount })),
    scopeComponents: components.map(({ id, quantity, unitPrice, amount }) => ({ id, quantity, unitPrice, amount })),
    scopeUnits: units,
    deliverables: components.map(item => `${item.name} ${item.quantity} ${item.unit}，交付该服务对应成果与记录`),
    prerequisites: ['客户确认范围、资料与审校负责人；内容制作和渠道执行以各自所选数量为准'],
    details: [...scopeDetails(input), `按 ${units} 个季度范围单元安排本行所列服务，当前清单已有工作已计入覆盖。`, '每单元覆盖 1 条产品线、最多 3 个场景、3 类客群，按 30 个去重决策主题规划；内容制作、发布与观测按所选服务列明。'],
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
  return Object.fromEntries(plan.items.filter(item => item.id === 'W01' || item.id === 'W04' || services.get(item.id)?.sampling).map(item => [item.id, item.quantity]));
}

export function customizePricedPlan(plan, rawInput, selections = {}) {
  const input = normalizeAdvisorInput(rawInput);
  if (!object(plan) || !Array.isArray(plan.items)) return fail('invalid_plan');
  const selected = normalizeSelections(selections, input);
  const services = serviceMap(input.market);
  const coreMinimums = originalCoreMinimums(plan, input, services);
  const quantities = new Map();
  let hasSystemScope = Boolean(plan.enterprise);
  for (const item of [...plan.items, ...(plan.pendingItems || [])]) {
    if (item.id === 'LANGUAGE_SCOPE') continue;
    if (systemPendingIds.has(item.id)) { if (item.id !== 'OVERSEAS_SCOPE') hasSystemScope = true; continue; }
    const service = services.get(item.id);
    if (!service || !safeInteger(item.quantity, 1, service.maxQuantity)) return fail('invalid_plan');
    quantities.set(item.id, item.quantity);
  }
  for (const [id, quantity] of Object.entries(selected)) {
    if (coreMinimums[id] !== undefined && quantity < coreMinimums[id]) return fail('core_service_locked');
    if (quantity === 0) quantities.delete(id);
    else quantities.set(id, quantity);
  }
  if (input.market === 'cn') quantities.set('CN_QUARTER', calculateChineseUnits(input.scope).units);
  if (selected.SOCIAL_LISTENING === undefined && input.listening.enabled) quantities.set('SOCIAL_LISTENING', 1);
  // Historic language selections are aliases of the canonical language controls.
  for (const id of languageAliases) quantities.delete(id);

  const prefix = input.market === 'cn' ? 'CN_' : '';
  const pitchId = prefix + 'PITCH', setupId = prefix + 'PITCH_SETUP';
  if (quantities.has(pitchId)) quantities.set(setupId, 1);
  else quantities.delete(setupId);
  const monitorIds = [...quantities.keys()].filter(id => input.market === 'overseas' && services.get(id)?.sampling);
  if (monitorIds.length > 1) {
    const chosen = Object.keys(selected).filter(id => selected[id] > 0 && services.get(id)?.sampling);
    if (chosen.length !== 1) return fail('duplicate_monitoring');
    for (const id of monitorIds) if (id !== chosen[0]) {
      quantities.delete(id);
      if (coreMinimums[id] !== undefined) { coreMinimums[chosen[0]] = coreMinimums[id]; delete coreMinimums[id]; }
    }
  }
  const scopeExclusions = new Set(plan.scopeExclusions || []);
  if ([...scopeExclusions].some(id => !['W04', 'W05', 'W22'].includes(id))) return fail('invalid_plan');
  for (const id of ['W04', 'W05', 'W22']) {
    if (selected[id] === 0) scopeExclusions.add(id);
    else if (selected[id] > 0) scopeExclusions.delete(id);
  }
  const scopeSelections = { ...Object.fromEntries([...scopeExclusions].map(id => [id, 0])), ...selected };
  const items = [...quantities].map(([id, quantity]) => id === 'SOCIAL_LISTENING' ? socialLine(input, services) : estimatedLine(services.get(id), quantity, input, coreMinimums[id] !== undefined || (id === setupId && quantities.has(pitchId))));
  const expanded = input.market === 'overseas' && (input.scope.productLines > 1 || input.scope.scenarios > 3 || input.scope.audiences > 3 || input.scope.intents > 30);
  if (input.market === 'overseas' && (hasSystemScope || expanded)) {
    const scope = scopeLine(input, quantities, scopeSelections, services);
    if (scope) items.push(scope);
  }
  const total = items.reduce((sum, item) => sum + item.total, 0);
  if (!Number.isSafeInteger(total)) return fail('invalid_total');
  const configured = items.length > 0;
  const count = id => quantities.get(id) || 0;
  const samplingService = input.market === 'overseas' ? [...quantities.keys()].map(id => services.get(id)).find(service => service.sampling) : undefined;
  const sampling = samplingService ? { ...samplingService.sampling, languages: [...input.languages], languageCount: input.languages.length, plannedAnswersPerLanguage: samplingService.sampling.plannedAnswers, plannedAnswers: samplingService.sampling.plannedAnswers * input.languages.length, plannedAnswersTotal: samplingService.sampling.plannedAnswers * input.languages.length } : undefined;
  const assumptions = [
    ESTIMATE_NOTICE,
    `服务语种：${input.languages.map(language => LANGUAGE_LABELS[language]).join('、')}`,
    '金额为人民币未税服务费。媒体采购、会员、广告、拍摄、差旅、专门数据授权等外部费用按实际项目单列。',
    INTENT_DEFINITION,
    '每行交付范围以一个计价单位为准，实际交付数量按所选服务及数量确认。',
    input.market === 'cn' ? '中文季度基包与增项采用各自参考服务价；增项用于基包之外的新增交付。' : '共享研究与事实资料优先复用；内容和渠道按所选语种完成本地表达、术语核对及审校，各语种版本对应同一份内容资产。',
  ];
  if (input.budgetMode === 'discuss') assumptions.push('项目预算与服务范围另行确认。');
  if (input.market === 'cn') assumptions.push(calculateChineseUnits(input.scope).scopeBasis);
  if (!count(prefix + 'W01')) assumptions.push('客户提供可核验事实、获准使用的资料和审校负责人；资料不足时先确认补充范围。');
  if (count(pitchId)) assumptions.push('行业 PR 编辑沟通配套首次资料整理与沟通准备，按项目计收一次；媒体采购与刊登费用另列。');
  if (count(prefix + 'W15')) assumptions.push('白皮书优先复用已有母文、案例与访谈资料，新增撰写与编辑范围在交付清单中确认。');
  if (sampling) {
    const includedScopeQuestions = (items.find(item => item.id === 'OVERSEAS_SCOPE')?.scopeComponents.find(item => item.id === 'W04')?.quantity || 0) * 30;
    if (count('W04') * 30 + includedScopeQuestions < sampling.questions) assumptions.push(`客户须提供至少 ${sampling.questions} 道已审核、已定稿且可直接采样的去重问题；不足部分需补充题库工作后再执行。`);
    assumptions.push(`AI 回答采样按每种所选语种分别执行：每语种 ${sampling.questions} 题 × ${sampling.platforms} 个实际平台 × 每题每轮 ${sampling.repeats} 次；${sampling.baselineRounds} 次基线、${sampling.fullFollowupRounds} 次完整复测，每语种 ${sampling.plannedAnswersPerLanguage} 次、合计 ${sampling.plannedAnswers} 次计划回答观察。社交聆听按独立服务范围确认。`);
  }
  if (input.market === 'overseas' && !sampling) assumptions.push('本方案未包含 AI 回答采样或复测，按所选资产与执行记录验收。');
  if (count(prefix + 'W10') && !originals.some(id => count(prefix + id))) assumptions.push('渠道适配须由客户提供已完成、已核准且可公开使用的合格母稿；未计入新母稿制作。');
  if (count(prefix + 'W03')) assumptions.push('精选公开讨论研究为约定范围内的一次性人工研究；持续跨平台社交聆听按季度服务另行选择。');
  for (const item of items) for (const prerequisite of item.prerequisites || []) if (!assumptions.includes(prerequisite)) assumptions.push(prerequisite);
  if (!configured) assumptions.unshift('当前选择尚未形成服务清单，请选择所需模块后确认范围与报价。');
  const comparable = configured && input.budgetMode === 'amount';
  const remaining = comparable ? input.budget - total : null;
  const customized = Object.keys(selected).length > 0 || plan.customized === true;
  const mixed = input.market === 'overseas' && input.languages.length > 1;
  const scopeLabel = input.market === 'cn' ? '中文季度服务' : hasSystemScope || expanded ? '季度范围与服务组合' : input.budget >= 150000 ? '第一阶段服务组合' : input.budget < 20000 ? '可单独购买的专项' : '首期服务组合';
  const horizon = input.market === 'cn' || hasSystemScope || expanded ? '按季度安排交付' : sampling?.fullFollowupRounds ? '90 天验证周期' : sampling ? '首月基线与所选专项' : '按所选专项安排交付';
  const result = {
    ...plan, ...(customized ? { name: `${input.market === 'cn' ? '中文季度' : '境外'} · 自选服务组合` } : {}), customized, market: input.market, budgetMode: input.budgetMode, scope: { ...input.scope }, scopeLabel, horizon,
    languages: [...input.languages], ...(input.market === 'overseas' ? { pricingLanguageBasis: mixed ? 'multilingual' : input.languages[0] === 'en' ? 'english' : 'localized' } : {}),
    coreMinimums: { ...coreMinimums }, scopeExclusions: [...scopeExclusions].sort(), items, pendingItems: [], total, totalLabel: '初步服务费合计',
    pricingStatus: configured ? 'estimate' : 'quote_required', estimated: configured, estimateNotice: ESTIMATE_NOTICE, quoteRequired: !configured,
    withinBudget: comparable ? total <= input.budget : null, pricedSubtotalWithinBudget: comparable ? total <= input.budget : null,
    allocatedBudget: total, remainingBudget: remaining, configurationRequired: !configured,
    description: !configured ? '当前尚未形成报价，请先选择需要的服务以确认交付范围。' : customized ? '以下为您选择的服务与数量，实际交付范围与排期以正式服务清单为准。' : plan.description,
    highlights: [items.map(item => `${item.name} × ${item.quantity}`).join('；') || '服务范围与报价待确认', ESTIMATE_NOTICE, input.budgetMode === 'discuss' ? '预算与服务范围另行确认' : !configured ? '请选择所需服务' : remaining >= 0 ? `预算余量 ${money(remaining)}` : `超出当前预算 ${money(-remaining)}，可调整所选服务与数量`],
    assumptions: [...new Set(assumptions)],
    phases: [
      { title: '01 · 确认服务清单', description: '核对所选服务、语种、数量、已有素材与执行条件，确认正式报价和排期。' },
      { title: '02 · 执行与审校', description: '按约定清单开展研究、制作、适配或观察，由客户核对事实与公开口径。' },
      { title: '03 · 交付与复盘', description: '交接成果、来源和执行记录；复测及持续服务按所选范围安排。' },
    ],
  };
  if (sampling) result.sampling = sampling;
  else delete result.sampling;
  if (input.market === 'cn') result.pricingBreakdown = calculateChineseUnits(input.scope);
  return result;
}

export function createChinesePlans(input, preferences = {}) {
  const services = serviceMap('cn');
  const units = calculateChineseUnits(input.scope).units;
  const mapId = id => id === 'SOCIAL_LISTENING' || id.startsWith('CN_') ? id : `CN_${id}`;
  const excluded = new Set((preferences.exclude || []).map(mapId));
  const optional = [...new Set((preferences.prioritize || []).map(mapId))].filter(id => services.has(id) && id !== 'CN_QUARTER' && !excluded.has(id) && !languageAliases.has(id));
  return [0, 1, 2].map(index => ({
    id: ['essential', 'recommended', 'extended'][index], label: ['季度基础', '优先建议', '增项候选'][index], name: optional.length ? ['中文季度标准单元', '中文基础与优先增项', '中文基础与扩展候选'][index] : '中文季度标准单元',
    items: [estimatedLine(services.get('CN_QUARTER'), units, input, true), ...optional.slice(0, index).map(id => id === 'SOCIAL_LISTENING' ? socialLine(input, services) : estimatedLine(services.get(id), 1, input))],
    description: `中文季度标准单元为 ¥50,000，当前范围需 ${units} 个单元；可选增项按实际范围与数量列价。`,
  }));
}

export function createEnterprisePlans(input, preferences = {}) {
  const services = serviceMap('overseas');
  const excluded = new Set(preferences.exclude || []);
  const quantities = new Map([['W04', 1], ['W05', 1], ['W22', 3]]);
  if (!preferences.reuseFacts) quantities.set('W01', 1);
  const goalServices = input.goal === 'authority' ? [['W09', 1], ['W08', 1], ['W10', 3]] : input.goal === 'content' ? [['W07', 1], ['W08', 2], ['W10', 6]] : [['MON_90_30', 1], ['W08', 2], ['W10', 6]];
  for (const [id, quantity] of goalServices) if (!excluded.has(id)) quantities.set(id, quantity);
  for (const id of preferences.prioritize || []) if (services.has(id) && !excluded.has(id) && !languageAliases.has(id)) quantities.set(id, quantities.get(id) || 1);
  for (const id of excluded) if (id !== 'W04' && id !== 'W01') quantities.delete(id);
  return [0, 1, 2].map(index => ({
    id: ['essential', 'recommended', 'extended'][index], label: '企业季度方案', name: '境外企业季度方案', enterprise: true,
    items: [...quantities].map(([id, quantity]) => id === 'SOCIAL_LISTENING' ? socialLine(input, services) : estimatedLine(services.get(id), quantity, input, id === 'W01' || id === 'W04' || Boolean(services.get(id).sampling))),
    description: `围绕 ${input.scope.productLines} 条产品线及所选场景、客群和去重意图安排季度研究与统筹，内容和渠道按清单数量执行。`,
  }));
}

export function finalizeRecommendation(recommendation, rawInput, preferences = {}) {
  const input = normalizeAdvisorInput(rawInput);
  const plans = recommendation.plans.map(plan => {
    const requested = { ...input.modules };
    for (const id of ['W04', 'W05', 'W22']) if ((preferences.exclude || []).includes(id) && requested[id] === undefined && !plan.items.some(item => item.id === id)) requested[id] = 0;
    if ((preferences.prioritize || []).includes('SOCIAL_LISTENING') && requested.SOCIAL_LISTENING === undefined) requested.SOCIAL_LISTENING = 1;
    if ((preferences.exclude || []).includes('SOCIAL_LISTENING') && requested.SOCIAL_LISTENING === undefined && !input.listening.enabled) requested.SOCIAL_LISTENING = 0;
    return customizePricedPlan(plan, input, requested);
  });
  const recommended = plans.find(plan => plan.id === 'recommended') || plans[0];
  return { ...recommendation, market: input.market, languages: [...input.languages], ...(recommended.pricingLanguageBasis ? { pricingLanguageBasis: recommended.pricingLanguageBasis } : {}), budgetMode: input.budgetMode, scope: { ...input.scope }, plans,
    pricingStatus: recommended.pricingStatus, estimated: recommended.estimated, estimateNotice: ESTIMATE_NOTICE, quoteRequired: recommended.quoteRequired, scopeLabel: recommended.scopeLabel, horizon: recommended.horizon,
    allocatedBudget: recommended.allocatedBudget, remainingBudget: recommended.remainingBudget,
    ...(recommended.pricingBreakdown ? { pricingBreakdown: recommended.pricingBreakdown } : {}),
  };
}
