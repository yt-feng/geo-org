import { catalog, cnCatalog, getOptionalServices, CN_UNIT_PRICE, INTENT_DEFINITION, LANGUAGE_LABELS, OVERSEAS_LANGUAGES } from './catalog.mjs';

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

function pricedLine(service, quantity, required = false) {
  return { id: service.id, name: service.name, quantity, unitPrice: service.price, total: service.price * quantity, unit: service.unit, deliverables: [...service.deliverables], prerequisites: [...service.prerequisites], required, optional: !required, pricingStatus: 'priced' };
}
function pendingLine(service, quantity, reason, details = []) {
  return { id: service.id, name: service.name, quantity, unit: service.unit, unitPrice: null, total: null, reason, details: [...details], deliverables: [...(service.deliverables || [])], prerequisites: [...(service.prerequisites || [])], required: false, optional: true, pricingStatus: 'quote_required' };
}
function scopeDetails(input) {
  return [`服务语种：${input.languages.map(language => LANGUAGE_LABELS[language]).join('、')}`, `${input.scope.productLines} 条产品线；每产品线 ${input.scope.scenarios} 个场景、${input.scope.audiences} 类客群`, `全项目 ${input.scope.intents} 个去重决策主题；同义问法不重复计数`, INTENT_DEFINITION];
}
function socialLine(input) {
  const service = getOptionalServices(input.market).find(item => item.id === 'SOCIAL_LISTENING');
  const depth = { mentions: '提及与主题识别', insights: '讨论洞察与竞品分析', strategy: '策略研究与行动建议' }[input.listening.depth];
  const cadence = { monthly: '月度', weekly: '每周', daily: '每日', realtime: '实时监测需求（须确认可取得性与响应安排）' }[input.listening.cadence];
  return { ...pendingLine(service, 1, '社交聆听按平台、研究深度、频率及覆盖范围独立报价。', [`平台：${input.listening.platforms.join('、') || '待确认'}`, `研究深度：${depth}；频率：${cadence}`, `覆盖 ${input.listening.markets} 个市场、${input.listening.languages} 种语言`, '历史窗口、数据授权、告警规则、响应方式及外部数据费用另行确认']), parameters: { ...input.listening, enabled: true, platforms: [...input.listening.platforms] } };
}

function systemScopeLine(input, id = 'OVERSEAS_SCOPE') {
  return { id, name: id === 'OVERSEAS_SCOPE' ? '境外范围扩展与实施方案' : '境外企业项目整体范围与报价', quantity: 1, unit: '定制项目', unitPrice: null, total: null, pricingStatus: 'quote_required', required: true, optional: false,
    reason: '境外项目按产品线、场景、客群、去重决策主题与实施条件确认服务范围和报价。',
    details: [...scopeDetails(input), '内容数量、渠道、语种、采样协议和执行排期在项目清单中确认。'],
  };
}


function languageScopeLine(input, quantities, services, legacy = false) {
  const languages = input.languages.filter(language => language !== 'en');
  const modules = [...quantities.entries()].filter(([id]) => id !== 'SOCIAL_LISTENING' && id !== 'W20').map(([id, quantity]) => ({ id, name: services.get(id).name.replace(/^英文/, ''), quantity, unit: services.get(id).unit }));
  return {
    id: legacy ? 'W20' : 'LANGUAGE_SCOPE', name: '新增语种的本地化与审校范围', quantity: legacy ? quantities.get('W20') : 1, unit: legacy ? services.get('W20').unit : '语种增量范围',
    unitPrice: null, total: null, pricingStatus: 'quote_required', pricingBasis: 'language_quote', required: !legacy, optional: legacy,
    reason: '共享研究与品牌事实库优先复用；新增语种按本地表达、专业术语、页面或渠道适配及审校范围独立报价。',
    details: [
      `新增语种：${languages.length ? languages.map(language => LANGUAGE_LABELS[language]).join('、') : '待补充，请在语种选择或备注中说明'}`,
      ...modules.map(item => `待核对数量：${item.name} × ${item.quantity} ${item.unit}；按新增语种确认复用与适配范围`),
      '所列数量用于确认各语种的交付范围；研究资料与品牌事实库优先复用。',
      '结合已有内容资产与审校能力，确认各语种所需的本地化与审校增量。',
    ],
    parameters: { languages: [...languages], modules, reuseBasis: '共享研究和事实库复用，按本地表达、术语、页面渠道和审校的增量核价', legacyW20: legacy },
  };
}

function localizedServiceLine(service, quantity, required, input) {
  const labels = input.languages.map(language => LANGUAGE_LABELS[language]).join('、');
  return {
    ...pendingLine(service, quantity, '该服务按所选语种独立核价，以实际本地化范围、资料复用和审校要求为准。', [
      `所选语种：${labels}`,
      `申请数量：${quantity} ${service.unit}；逐语种确认具体交付、共享资料复用与增量范围`,
      '共享研究和事实库优先复用；本地表达、专业术语、页面渠道适配与审校按实际需要确认。',
    ]),
    name: `${labels} · ${service.name.replace(/^英文/, '')}`,
    deliverables: [`按所选语种确认${service.name.replace(/^英文/, '')}的具体范围`, '所列数量为本次需求，具体文本深度、平台、轮次与审校范围在报价清单中确认'],
    required, optional: !required, pricingBasis: 'language_quote', languages: [...input.languages],
    parameters: { languages: [...input.languages], requestedQuantity: quantity, unit: service.unit },
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
  const localizedOnly = input.market === 'overseas' && !input.languages.includes('en');
  const mixedLanguages = input.market === 'overseas' && input.languages.includes('en') && input.languages.some(language => language !== 'en');
  const quantities = new Map();
  const systemPending = [];
  for (const item of plan.items) {
    const service = services.get(item.id);
    if (!service || (service.price === null && item.id !== 'W20') || !safeInteger(item.quantity, 1, service.maxQuantity)) return fail('invalid_plan');
    quantities.set(item.id, item.quantity);
  }
  for (const item of plan.pendingItems || []) {
    if (item.id === 'LANGUAGE_SCOPE') continue; // Rebuilt from canonical languages and current quantities.
    if (systemPendingIds.has(item.id)) systemPending.push(systemScopeLine(input, item.id));
    else {
      const service = services.get(item.id);
      if (!service || (service.price !== null && item.pricingBasis !== 'language_quote') || !safeInteger(item.quantity, 1, service.maxQuantity)) return fail('invalid_plan');
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
    dependencyNotes.push('行业 PR 编辑沟通配套首次资料整理与沟通准备，按项目计收一次。');
  } else if (quantities.has(setupId)) {
    quantities.delete(setupId);
    dependencyNotes.push('首次资料整理与沟通准备随行业 PR 编辑沟通服务配置。');
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
    else if (id === 'W20') {
      if (localizedOnly) pendingItems.push({ ...localizedServiceLine(service, quantity, false, input), reason: '语言适配纳入所选语种的服务范围，结合资料复用、本地化与审校需求统一确认报价。' });
      else pendingItems.push(languageScopeLine(input, quantities, services, true));
    }
    else if (localizedOnly) pendingItems.push(localizedServiceLine(service, quantity, coreMinimums[id] !== undefined || (id === setupId && quantities.has(pitchId)), input));
    else if (service.price === null) pendingItems.push(pendingLine(service, quantity, id === 'CN_W22' ? '基包包含基础排期、执行统筹和季度复盘；额外多团队协作按实际范围另行报价。' : '中文增项在基包范围之外，按所选数量与实际交付要求独立报价。', ['所选数量与具体交付范围将在正式报价中确认。']));
    else items.push(pricedLine(service, quantity, coreMinimums[id] !== undefined || (id === setupId && quantities.has(pitchId))));
  }
  if (mixedLanguages && !quantities.has('W20') && [...quantities.keys()].some(id => id !== 'SOCIAL_LISTENING')) pendingItems.push(languageScopeLine(input, quantities, services));
  for (const item of items) item.languages = [input.market === 'cn' ? 'zh' : 'en'];
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
    input.market === 'cn' ? '中文服务按季度标准单元计价，可选增项按范围另行报价。' : localizedOnly ? '所选语种的各项服务按本地化范围、资料复用与审校要求确认报价。' : mixedLanguages ? '已列金额为英语部分服务费；其他语种按本地化与审校增量另行报价。' : '英语单价仅适用于英语服务；其他语种按实际范围独立报价。',
    `服务语种：${input.languages.map(language => LANGUAGE_LABELS[language]).join('、')}`,
    '金额为人民币未税服务费。媒体采购、会员、广告、拍摄、差旅、专门数据授权等外部费用按实际项目另列。',
    INTENT_DEFINITION,
    '每行交付范围以一个计价单位为准，实际交付数量按所选服务及数量确认。',
    ...dependencyNotes,
  ];
  if (quoteRequired) assumptions.unshift('显示金额为已定价服务小计，待报价项目尚未计入；完整报价确认后与预算核对。');
  if (input.budgetMode === 'discuss') assumptions.unshift('项目预算与服务范围另行确认。');
  if (input.market === 'cn') assumptions.push(calculateChineseUnits(input.scope).scopeBasis);
  if (!count(prefix + 'W01')) assumptions.push('客户提供可核验事实、获准使用的资料和审校负责人；资料不足时先确认补充范围，不直接制作或发布未经核准的主张。');
  if (count(prefix + 'W15')) assumptions.push('白皮书优先复用已有母文、案例与访谈资料，新增撰写与编辑范围在交付清单中确认。');
  if (sampling) {
    if (count('W04') * 30 < sampling.questions) assumptions.push(`客户须提供至少 ${sampling.questions} 道已审核、已定稿且可直接采样的去重问题；不足部分需补充题库工作后再执行。`);
    assumptions.push(`AI 回答采样：${sampling.questions} 题 × ${sampling.platforms} 个实际平台 × 每题每轮 ${sampling.repeats} 次；${sampling.baselineRounds} 次基线、${sampling.fullFollowupRounds} 次完整复测，共 ${sampling.plannedAnswers} 次计划回答观察。社交聆听按独立服务范围确认。`);
  }
  if (count(prefix + 'W10') && !originals.some(id => count(prefix + id))) assumptions.push('渠道适配须由客户提供已完成、已核准且可公开使用的合格母稿；未计入新母稿制作。');
  if (count(prefix + 'W03')) assumptions.push('精选公开讨论研究为约定范围内的一次性人工研究；持续跨平台社交聆听另行确认范围与报价。');
  for (const item of [...items, ...pendingItems]) for (const prerequisite of services.get(item.id)?.prerequisites || []) if (!assumptions.includes(prerequisite)) assumptions.push(prerequisite);
  if (!configured) assumptions.unshift('当前选择尚未形成服务清单，请选择所需模块后确认范围与报价。');
  const comparable = input.budgetMode === 'amount' && !quoteRequired;
  const quantitySummary = items.map(item => `${item.name} × ${item.quantity}`).join('；');
  const remaining = comparable ? input.budget - total : null;
  const scopeLabel = input.market === 'cn' ? '中文季度标准单元' : quoteRequired ? '范围与报价建议' : input.budget >= 150000 ? '第一阶段建议' : input.budget < 20000 ? '可单独购买的专项' : '首期服务组合';
  const horizon = input.market === 'cn' ? '按季度确认交付' : quoteRequired || input.budgetMode === 'discuss' ? '范围确认后分阶段推进' : sampling?.fullFollowupRounds ? '90 天验证周期' : sampling ? '首月基线与所选专项' : '按所选专项安排交付';
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
    languages: [...input.languages], ...(input.market === 'overseas' ? { pricingLanguageBasis: localizedOnly ? 'localized' : mixedLanguages ? 'multilingual' : 'english' } : {}),
    coreMinimums: { ...coreMinimums }, items, pendingItems, total, totalLabel: localizedOnly ? '所选语种服务待报价' : mixedLanguages ? '英语部分服务费小计' : quoteRequired ? '已定价服务小计（待报价项目未计入）' : '当前方案服务费合计',
    pricingStatus, quoteRequired, withinBudget: comparable ? total <= input.budget : null,
    pricedSubtotalWithinBudget: input.budgetMode === 'amount' ? total <= input.budget : null,
    allocatedBudget: total, remainingBudget: remaining, configurationRequired: !configured,
    description: !configured ? '当前尚未形成报价，请先选择需要的服务以确认交付范围。' : customized ? '以下为您选择的服务与数量，待报价项目将在范围确认后提供报价。' : plan.description,
    highlights: [quantitySummary || '服务范围与报价待确认', ...(pendingItems.length ? [`${pendingItems.length} 项待报价，金额尚未计入`] : !configured ? ['尚未配置服务，需先确定交付范围'] : []), input.budgetMode === 'discuss' ? '预算与服务范围另行确认' : quoteRequired ? `项目预算 ¥${input.budget.toLocaleString('zh-CN')}，完整报价确认后再比较` : `预算余量 ¥${remaining.toLocaleString('zh-CN')}；按需要决定下一步`],
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
    description: `已确认季度标准单元为 ¥50,000，当前范围需 ${units} 个单元；可选增项按实际范围另行报价。`,
    assumptions: ['中文基包覆盖所选标准单元，具体内容、渠道与观察数量以季度交付清单为准。'],
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
    assumptions: ['企业项目按需求确认各阶段服务范围、交付数量与排期，再提供完整报价。'],
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
  return { ...recommendation, market: input.market, languages: [...input.languages], ...(recommended.pricingLanguageBasis ? { pricingLanguageBasis: recommended.pricingLanguageBasis } : {}), budgetMode: input.budgetMode, scope: { ...input.scope }, plans,
    pricingStatus: recommended.pricingStatus, quoteRequired: recommended.quoteRequired, scopeLabel: recommended.scopeLabel, horizon: recommended.horizon,
    allocatedBudget: recommended.allocatedBudget, remainingBudget: recommended.remainingBudget,
    ...(recommended.pricingBreakdown ? { pricingBreakdown: recommended.pricingBreakdown } : {}),
  };
}
