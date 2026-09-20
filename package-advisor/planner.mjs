import { catalog, cnCatalog, getOptionalServices } from './catalog.mjs';
import { normalizeAdvisorInput, customizePricedPlan, createChinesePlans, createEnterprisePlans, finalizeRecommendation } from './pricing.mjs';

const byId = new Map(catalog.map(item => [item.id, item]));
export const GOALS = ['visibility', 'content', 'authority'];
export const STAGES = ['starting', 'growing', 'established'];
const LABELS = { visibility: 'AI 可见度', content: '采购决策内容', authority: '可信来源' };
export const PREFERENCE_SERVICES = ['W02', 'W03', 'W05', 'W07', 'W08', 'W09', 'W10', 'W11', 'W12', 'W15', 'W16', 'W17', 'W18', 'W19', 'W21', 'W25', 'W26', 'W28', 'W29', 'W30', 'PITCH', ...cnCatalog.filter(item => item.optional).map(item => item.id), 'SOCIAL_LISTENING'];
const preferenceIds = new Set(PREFERENCE_SERVICES);
const ORIGINALS = ['W07', 'W08', 'W09', 'W15', 'W16', 'W17'];

export function validateInput(value) { return normalizeAdvisorInput(value); }

function line(id, quantity = 1) {
  const item = byId.get(id);
  if (!item || !Number.isFinite(item.price) || !Number.isInteger(quantity) || quantity < 1) throw new Error('unknown_service');
  return { id, name: item.name, quantity, unitPrice: item.price, total: item.price * quantity, unit: item.unit, deliverables: [...item.deliverables] };
}

const commonAssumptions = [
  '参考范围：1 个品牌、1 个主要市场、英语；金额为人民币未税服务费，按确认的交付清单签约。',
  '媒体发布费、会员费、广告、拍摄、差旅、新增语种与新建网站另行确认；本方案未含这些外部费用。',
  'AI 提及、引用、收录与有效询盘分别观察；以所选清单的材料、记录和证据验收，不承诺第三方效果。',
  '每条服务的范围描述以 1 个计价单位为准，交付数量按所列数量计算；渠道适配不作为新增原创文章计数。',
];

function normalizePreferences(value, market = 'overseas') {
  const preferences = value && typeof value === 'object' ? value : {};
  const marketIds = new Set(getOptionalServices(market).map(item => item.id));
  const clean = list => Array.isArray(list) ? [...new Set(list.filter(id => typeof id === 'string').map(id => market === 'cn' && !id.startsWith('CN_') && id !== 'SOCIAL_LISTENING' ? `CN_${id}` : id).filter(id => preferenceIds.has(id) && marketIds.has(id)))] : [];
  return { prioritize: clean(preferences.prioritize), exclude: clean(preferences.exclude), reuseFacts: preferences.reuseFacts === true };
}

function buildPlan(input, target, index, preferences, previous) {
  // Each tier retains the earlier deliverables. Measurement upgrades replace only
  // the same underlying measurement service, never the content already offered.
  const items = previous ? previous.items.map(item => line(item.id, item.quantity)) : [];
  const exclusions = new Set(preferences.exclude);
  const sum = () => items.reduce((total, item) => total + item.total, 0);
  const count = id => items.find(item => item.id === id)?.quantity || 0;
  const hasOriginal = () => ORIGINALS.some(id => count(id));
  const append = (id, quantity = 1) => {
    if (!byId.has(id) || !Number.isFinite(byId.get(id).price) || exclusions.has(id)) return false;
    const current = count(id);
    if (current >= quantity) return true;
    const increment = byId.get(id).price * (quantity - current);
    if (sum() + increment > target) return false;
    const old = items.findIndex(item => item.id === id);
    if (old >= 0) items[old] = line(id, quantity);
    else items.push(line(id, quantity));
    return true;
  };
  const monitor = () => items.find(item => byId.get(item.id).sampling);
  const setMonitoring = (questions, followup) => {
    const current = monitor();
    const sampling = current && byId.get(current.id).sampling;
    const desiredQuestions = Math.max(questions, sampling?.questions || 0);
    const withFollowup = followup || Boolean(sampling?.fullFollowupRounds);
    const id = `MON_${withFollowup ? '90' : 'BASE'}_${desiredQuestions}`;
    const questionUnits = Math.ceil(desiredQuestions / 30);
    const addition = byId.get(id).price - (current?.total || 0) + Math.max(0, questionUnits - count('W04')) * byId.get('W04').price;
    if (sum() + addition > target) return false;
    append('W04', questionUnits);
    if (current) items[items.findIndex(item => item.id === current.id)] = line(id);
    else items.push(line(id));
    return true;
  };
  const addPitch = () => {
    if (exclusions.has('PITCH')) return false;
    const needed = (count('PITCH_SETUP') ? 0 : byId.get('PITCH_SETUP').price) + (count('PITCH') ? 0 : byId.get('PITCH').price);
    if (sum() + needed > target) return false;
    append('PITCH_SETUP');
    return append('PITCH');
  };

  // Low-budget scopes differ by business objective. Fact research is included
  // when affordable; otherwise approved customer material is an explicit gate.
  if (target >= 40500 && input.stage === 'starting' && !preferences.reuseFacts) append('W01');
  if (input.goal === 'visibility') {
    setMonitoring(15, target >= 40500);
    append('W08');
    if (!hasOriginal()) append('W07');
    append('W10', 3);
    append('W07');
  } else if (input.goal === 'content') {
    append('W08');
    append('W10', 3);
    append('W07');
    if (!hasOriginal()) append('W09');
  } else {
    append('W09');
    append('W18');
    if (!hasOriginal()) append('W08');
    append('W10', 3);
  }

  if (input.goal !== 'visibility' && target >= 65000) setMonitoring(15, target >= 80000);
  if (target >= 80000) append('W22', 3);

  // Optional preferences move relevant deliverables ahead of generic expansion;
  // every amount remains a trusted catalogue price and prerequisites still apply.
  for (const id of preferences.prioritize) {
    if (id === 'PITCH') addPitch();
    else append(id);
  }

  // Establish differentiated authority assets before adding many more articles.
  if (input.goal === 'authority' && target >= 130000) append('W15');
  if (input.goal === 'authority' && target >= 190000) append('W16');

  const depth = target >= 250000 ? 4 : target >= 175000 ? 3 : target >= 115000 ? 2 : target >= 75000 ? 1 : 0;
  const desired = input.goal === 'content'
    ? { W07: [1, 2, 3, 4, 5][depth], W08: [2, 3, 4, 6, 8][depth], W09: [0, 1, 1, 2, 3][depth], W10: [3, 6, 12, 18, 24][depth] }
    : input.goal === 'authority'
      ? { W07: [0, 1, 1, 2, 3][depth], W08: [1, 2, 3, 4, 5][depth], W09: [1, 2, 2, 3, 4][depth], W10: [3, 6, 9, 12, 15][depth] }
      : { W07: [1, 2, 3, 4, 5][depth], W08: [1, 2, 3, 5, 7][depth], W09: [0, 1, 1, 2, 3][depth], W10: [3, 6, 9, 15, 21][depth] };
  const expansionOrder = input.goal === 'authority' ? ['W09', 'W08', 'W07', 'W10'] : ['W08', 'W07', 'W10', 'W09'];
  // Rotate between asset types rather than consuming the remainder with one type.
  for (let quantity = 1; quantity <= Math.max(...Object.values(desired)); quantity++) {
    for (const id of expansionOrder) if (quantity <= desired[id]) append(id, quantity);
  }

  if (index === 2 && target >= 40500 && target < 75000 && input.goal === 'visibility') {
    const extraAsset = append('W08', count('W08') + 1) || append('W07', count('W07') + 1);
    if (extraAsset) append('W10', count('W10') + 3);
    else if (monitor()) setMonitoring(30, true);
  }

  if (index === 2 && target < 75000 && input.goal !== 'visibility') {
    append('W08', count('W08') + 1);
    if (input.goal === 'content') append('W10', Math.min(6, count('W10') + 3));
  }

  if (target >= 60000) append('W05');
  if (target >= 100000) {
    append('W28');
    setMonitoring(30, true);
  }
  if (target >= 145000) append('W03');
  if (target >= 175000) setMonitoring(60, true);
  if (target >= 250000) setMonitoring(90, true);
  if (input.goal === 'content' && target >= 130000) append('W19');
  if (input.goal === 'authority' && target >= 250000) append('W26');
  if (target >= 150000) append('W21');
  // A small final increase can broaden the single baseline without implying a retest.
  if (input.goal === 'visibility' && index === 2 && target < 40500) setMonitoring(30, false);

  // If every execution option was excluded, retain a useful scoped diagnostic
  // rather than returning an empty quote or adding an excluded service.
  if (!items.length) setMonitoring(15, false);

  const total = sum();
  const samplingItem = monitor();
  const sampling = samplingItem && byId.get(samplingItem.id).sampling;
  const hasFollowup = Boolean(sampling?.fullFollowupRounds);
  const originals = items.filter(item => ORIGINALS.includes(item.id)).reduce((n, item) => n + item.quantity, 0);
  const adaptations = count('W10');
  const assumptions = [...commonAssumptions];
  if (!count('W01')) assumptions.push('本组合以客户提供已核准的品牌事实、产品资料和公开权限为前提；若资料不足，先补充事实盘点并重新确认范围，暂不直接制作或发布。');
  else assumptions.push('已包含品牌事实盘点；客户指定业务与技术审校负责人，确认事实、证据及公开范围。');
  if (sampling) assumptions.push(hasFollowup
    ? `首期按 90 天安排；监测为 ${sampling.questions} 道固定题、3 个平台、1 次基线与 1 次完整复测，不代表每月或每日全量监测。`
    : `当前只含 ${sampling.questions} 道固定题的首月单次基线，不含后续复测；其他所选内容可在首期 90 天内按约定排期交付。`);
  else assumptions.push('本档为内容或可信资产建设专项，首期按最多 90 天安排；未包含 AI 回答采样或复测，验收以所选资产与提交记录为准。');
  if (count('W10') && !hasOriginal()) assumptions.push('渠道适配以客户提供已完成、已核准且可公开使用的合格母稿为前提；本档不含新母稿制作，素材不满足时先确认补充范围。');
  if (count('W09') || count('W17')) assumptions.push('案例须有真实可核验材料；不同案例按独立资产确认，伙伴合作与发布权限须具备后才执行。');
  if (count('W15')) assumptions.push('白皮书基于已核准证据单独确认范围；复用本项目的文章、案例或访谈时，正式报价核销重复制作，不将复用内容计为额外原创。');
  if (count('W16')) assumptions.push('原创数据解读须由客户提供获准使用的有效数据；未含实验、调研采集或数据采购。');
  if (count('W26')) assumptions.push('Webinar 须有客户确认的讲者、素材和平台；平台及获客费用另列。');
  if (count('PITCH')) assumptions.push('PR 包含首次设置与一个 12 目标传播项目；刊登由编辑决定，付费发布不包含在本项服务内。');
  for (const item of items) for (const prerequisite of byId.get(item.id).prerequisites || []) {
    if (!assumptions.includes(prerequisite)) assumptions.push(prerequisite);
  }
  const omitted = preferences.prioritize.filter(id => !count(id) && !exclusions.has(id));
  if (omitted.length) assumptions.push(`备注中优先关注的${omitted.map(id => byId.get(id)?.name || '定制社交聆听').join('、')}尚未进入本档预算，可与已有服务替换后另行确认。`);

  const highlights = [
    originals ? `${originals} 项核心内容或研究资产${adaptations ? `，另含 ${adaptations} 条渠道适配` : ''}${count('W18') ? `、${count('W18') * 3} 项行业资料提交` : ''}` : '先建立问题与证据清单，明确下一步投入方向',
    sampling ? `${sampling.questions} 道固定问题 · ${sampling.plannedAnswers} 份计划回答观察 · ${hasFollowup ? '含一次复测' : '单次基线'}` : '按真实材料制作，完成审校后用于官网、销售或行业沟通',
    `${input.budget >= 150000 ? '下一阶段待配置预算' : '预算余量'} ¥${(input.budget - total).toLocaleString('zh-CN')}，按阶段确认后使用`,
    '已有合格素材先复用；同一母稿不重复收取原创费用',
  ];
  const kind = hasFollowup ? '验证' : sampling ? (originals ? '诊断与内容' : '诊断') : input.goal === 'authority' ? '可信资产' : '内容建设';
  const names = [`聚焦${kind}`, `${LABELS[input.goal]} · 推荐组合`, `${kind}进阶组合`];
  const phases = sampling ? [
    { title: '01 · 锁定问题与起点', description: `核验资料，确认 ${sampling.questions} 道固定问题的口径，完成约定平台的单次基线与证据台账。` },
    { title: '02 · 完成所选交付', description: originals ? '按服务清单完成研究、内容与渠道适配，客户审校后发布或提交。' : '整理回答、引用来源与缺失记录，形成诊断解读和下一步优先级。' },
    hasFollowup
      ? { title: '03 · 同题复测与交接', description: '90 天内按确认排期完成一次同题复测，比较观察结果，交接材料与下一阶段建议。' }
      : { title: '03 · 验收与下阶段选择', description: '核对本档清单与证据，后续制作、复测或扩量在确认范围后另行选择。' },
  ] : [
    { title: '01 · 核验素材与范围', description: '确认真实事实、可用资料、公开权限和本期资产清单。' },
    { title: '02 · 制作与审校', description: '按所选数量完成内容、研究或行业资料，由客户核对事实与公开口径。' },
    { title: '03 · 发布或提交与交接', description: '在约定渠道发布或提交，核对实际状态并交接资料；本档不包含 AI 复测。' },
  ];
  return {
    id: ['essential', 'recommended', 'extended'][index], name: names[index], label: ['精简起步', '推荐组合', '进阶方案'][index],
    total, withinBudget: total <= input.budget,
    scopeLabel: input.budget >= 150000 ? '第一阶段建议' : '首期服务组合',
    horizon: input.budget >= 150000 ? '范围确认后分阶段推进' : hasFollowup ? '90 天验证周期' : sampling ? '首月基线与所选专项' : '按所选专项安排交付',
    allocatedBudget: total, remainingBudget: input.budget - total,
    description: `围绕${LABELS[input.goal]}，${hasFollowup ? '以明确资产与一次基线、一次复测验证本期投入。' : sampling ? '先看清当前回答表现，并完成清单列明的优先交付。' : '把预算优先用于可复用的内容与可信资产。'}`,
    items, highlights, assumptions, phases, ...(sampling ? { sampling: { ...sampling } } : {}),
  };
}


function buildSmallPlans(input, preferences) {
  const excluded = new Set(preferences.exclude);
  const recipes = {
    visibility: [
      ['题库与基线专项', [['W04', 1], ['MON_BASE_15', 1]]],
      ['基线与内容专项', [['MON_BASE_15', 1], ['W08', 1]]],
      ['基线与渠道适配', [['MON_BASE_15', 1], ['W10', 3]]],
      ['AI 回答基线专项', [['MON_BASE_15', 1]]],
      ['购买问题设计专项', [['W04', 1]]],
      ['业务访谈专项', [['W02', 1]]],
      ['核心页面专项', [['W07', 1]]],
      ['行业资料专项', [['W18', 1]]],
      ['已有内容适配专项', [['W10', 3]]],
    ],
    content: [
      ['官网内容起步', [['W07', 1], ['W08', 1], ['W10', 3]]],
      ['研究文章与渠道适配', [['W08', 1], ['W10', 3]]],
      ['核心页面与渠道适配', [['W07', 1], ['W10', 3]]],
      ['研究文章专项', [['W08', 1]]],
      ['核心页面专项', [['W07', 1]]],
      ['已有内容适配专项', [['W10', 3]]],
      ['业务访谈专项', [['W02', 1]]],
      ['行业资料专项', [['W18', 1]]],
    ],
    authority: [
      ['真实案例与行业资料', [['W09', 1], ['W18', 1]]],
      ['真实案例与渠道适配', [['W09', 1], ['W10', 3]]],
      ['真实案例专项', [['W09', 1]]],
      ['访谈与行业资料', [['W02', 1], ['W18', 1]]],
      ['行业资料与内容适配', [['W18', 1], ['W10', 3]]],
      ['行业资料专项', [['W18', 1]]],
      ['业务访谈专项', [['W02', 1]]],
      ['已有内容适配专项', [['W10', 3]]],
    ],
  };
  const preferred = preferences.prioritize.filter(id => byId.has(id) && Number.isFinite(byId.get(id).price) && id !== 'PITCH').map(id => [byId.get(id).name + '专项', [[id, 1]]]);
  const seen = new Set();
  const candidates = [...preferred, ...recipes[input.goal]].flatMap(([name, quantities]) => {
    if (quantities.some(([id]) => excluded.has(id))) return [];
    const items = quantities.map(([id, quantity]) => line(id, quantity));
    const total = items.reduce((n, item) => n + item.total, 0);
    const signature = items.map(item => item.id + ':' + item.quantity).sort().join('|');
    if (total > input.budget || seen.has(signature)) return [];
    seen.add(signature);
    return [{ name, items, total }];
  });
  // Small budgets compare executable alternatives, not three fees to add together.
  // A different route can cost less: service scope and prerequisites are explicit.
  const recommended = candidates[0];
  const other = candidates.slice(1);
  const essential = other.find(option => option.total <= input.budget * 0.65) || other[0] || recommended;
  const extended = other.find(option => option !== essential) || recommended;
  return [essential, recommended, extended].map((choice, index) => {
    const base = { id: ['essential', 'recommended', 'extended'][index], label: ['轻量专项', '优先建议', '另一种路径'][index], scopeLabel: '可单独购买的专项', horizon: '按专项范围安排交付' };
    if (!choice) return {
      ...base, name: '按需求配置专项', total: 0, withinBudget: true, allocatedBudget: 0, remainingBudget: input.budget,
      configurationRequired: true, items: [],
      description: '当前预算与排除项下，没有适合自动组合的现有价目。请保留需求，按实际交付范围配置服务；此处不是免费服务报价。',
      highlights: ['预算完整保留，待确定合适的交付模块', '可调整排除项，或补充已有资料与希望完成的具体任务'],
      assumptions: [...commonAssumptions, '尚未配置服务，没有形成可下单的交付清单。'],
      phases: [{ title: '确认一个具体任务', description: '先确定需要交付的成果及已有素材，再核对可用模块与预算。' }],
    };
    const { items, total, name } = choice;
    const count = id => items.find(item => item.id === id)?.quantity || 0;
    const sampling = items.map(item => byId.get(item.id).sampling).find(Boolean);
    const hasOriginal = ORIGINALS.some(id => count(id));
    const assumptions = [...commonAssumptions, '专项可按当前需要单独选择，不需要全部购买，也不代表年度套餐。'];
    if (count('W02')) assumptions.push('访谈由客户安排受访者，服务包含访谈、转录整理与主题编码；不等同于完整品牌事实盘点。');
    if (count('W10') && !hasOriginal) assumptions.push('客户须提供已完成、已核准且可公开使用的合格母稿；本项仅做渠道适配，不含新母稿制作。资料不满足时先确认补充范围。');
    if (sampling && !count('W04')) assumptions.push(`客户须提供至少 ${sampling.questions} 道已审核、已定稿且可直接采样的问题，以及准确品牌事实；本项不包含题库新建。资料不足时先完成题库确认。`);
    if (sampling) assumptions.push(`本专项仅含首月单次基线：${sampling.questions} 道问题、3 个平台、${sampling.plannedAnswers} 份计划回答；没有后续复测或持续监测。`);
    else assumptions.push('本专项不含 AI 回答采样、效果监测或后续复测；按表内交付内容与记录验收。');
    if (hasOriginal || count('W18')) assumptions.push('客户提供可核验的事实资料、使用权限和审校负责人；案例与行业资料必须真实，第三方审核状态单独记录。');
    for (const item of items) for (const prerequisite of byId.get(item.id).prerequisites || []) if (!assumptions.includes(prerequisite)) assumptions.push(prerequisite);
    const quantityDescription = items.map(item => `${item.name} ${item.quantity} ${item.unit}`).join('；');
    return {
      ...base, name, total, withinBudget: total <= input.budget, allocatedBudget: total, remainingBudget: input.budget - total,
      horizon: sampling ? '首月单次基线' : '按专项范围安排交付',
      description: `先完成一个明确任务：${name}。以已有素材和约定成果为基础，可独立验收后再决定下一步。`,
      items, highlights: [quantityDescription, `专项服务费 ¥${total.toLocaleString('zh-CN')}，预算余量 ¥${(input.budget - total).toLocaleString('zh-CN')}`, sampling ? '交付原回答、引用与缺失记录，明确当前起点' : '交付范围和前置素材写清楚，完成一项再扩展'], assumptions,
      phases: [
        { title: '01 · 确认前置资料', description: '核对该专项要求的事实、素材、问题清单或受访安排，确认本次边界。' },
        { title: '02 · 执行所选服务', description: '只按这张卡所列的服务、数量与单位范围执行，并完成客户审校或资料核对。' },
        { title: '03 · 交付与下一步', description: '交接约定材料和实际完成记录；扩量、制作或复测在下一步确认范围后选择。' },
      ], ...(sampling ? { sampling: { ...sampling } } : {}),
    };
  });
}

function createLegacyRecommendation(raw, rawPreferences = {}) {
  const input = validateInput(raw);
  const preferences = normalizePreferences(rawPreferences);
  if (input.budget < 20000) {
    const plans = buildSmallPlans(input, preferences);
    return { source: 'rules', summary: '按当前预算推荐可独立交付的专项。选择最符合当前任务的专项即可；已有素材与题库条件逐项列明。', scopeLabel: '可单独购买的专项', horizon: '按专项范围安排交付', allocatedBudget: plans[1].total, remainingBudget: input.budget - plans[1].total, plans, recommendationId: `preview-${input.budget}-${input.goal}-${input.stage}` };
  }
  // Scope is bounded to a single initial phase; a larger ceiling is not a reason
  // to invent additional countries, channels, media fees or annual commitments.
  const ceiling = Math.min(input.budget, 320000);
  const targets = [Math.max(17000, Math.floor(ceiling * 0.60)), Math.max(17000, Math.floor(ceiling * 0.85)), ceiling];
  const plans = [];
  for (let index = 0; index < targets.length; index++) plans.push(buildPlan(input, targets[index], index, preferences, plans[index - 1]));
  const repeated = new Set();
  for (const plan of plans) {
    const signature = plan.items.map(item => `${item.id}:${item.quantity}`).join('|');
    if (repeated.has(signature)) plan.description += ' 当前预算下与前一档交付相同，无需为升级标签额外付费。';
    repeated.add(signature);
  }
  return { source: 'rules', summary: input.budget >= 150000 ? `围绕${LABELS[input.goal]}先明确第一阶段的可执行范围。后续预算按阶段、素材和实际交付需要继续配置。` : `围绕${LABELS[input.goal]}优先安排可验收的交付。可按需要增加资产或观测范围，预算是上限；已有合格材料在正式确认时复用核销。`, scopeLabel: input.budget >= 150000 ? '第一阶段建议' : '首期服务组合', horizon: input.budget >= 150000 ? '范围确认后分阶段推进' : '按所选专项安排交付', allocatedBudget: plans[1].total, remainingBudget: input.budget - plans[1].total, plans, recommendationId: `preview-${input.budget}-${input.goal}-${input.stage}` };
}


export function customizePlan(plan, rawInput, selections = {}) {
  const input = validateInput(rawInput);
  return customizePricedPlan(plan, input, { ...input.modules, ...selections });
}

export function createRecommendation(raw, rawPreferences = {}) {
  const input = validateInput(raw);
  const preferences = normalizePreferences(rawPreferences, input.market);
  let recommendation;
  if (input.market === 'cn') {
    recommendation = { source: 'rules', summary: '中文季度标准单元独立定价：按产品线、每产品线场景及客群、全项目去重意图计算所需单元；可选增项单独报价。', plans: createChinesePlans(input, preferences) };
  } else if (input.budgetMode === 'discuss' || input.budget > 320000) {
    recommendation = { source: 'rules', summary: '境外企业项目先按实际范围配置阶段与服务，完整报价另行确认；预算不作为自动生产内容数量或固定总价。', plans: createEnterprisePlans(input) };
  } else {
    recommendation = createLegacyRecommendation(input, preferences);
  }
  recommendation.recommendationId = `preview-${input.market}-${input.budgetMode}-${input.budget ?? 'discuss'}-${input.goal}-${input.stage}`;
  return finalizeRecommendation(recommendation, input, preferences);
}
