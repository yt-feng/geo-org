import { catalog } from './catalog.mjs';

const byId = new Map(catalog.map(item => [item.id, item]));
export const GOALS = ['visibility', 'content', 'authority'];
export const STAGES = ['starting', 'growing', 'established'];
const LABELS = { visibility: 'AI 可见度', content: '采购决策内容', authority: '可信来源' };
const ALLOWED = new Set(['budget', 'goal', 'stage', 'notes']);
export const PREFERENCE_SERVICES = ['W03', 'W05', 'W07', 'W08', 'W09', 'W10', 'W11', 'W12', 'W15', 'W16', 'W17', 'W18', 'W19', 'W21', 'W25', 'W26', 'W28', 'W29', 'W30', 'PITCH'];
const preferenceIds = new Set(PREFERENCE_SERVICES);
const ORIGINALS = ['W07', 'W08', 'W09', 'W15', 'W16', 'W17'];

export function validateInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !ALLOWED.has(key))) throw new Error('invalid_input');
  if (!Number.isInteger(value.budget) || value.budget < 20000 || value.budget > 500000 || !GOALS.includes(value.goal) || !STAGES.includes(value.stage)) throw new Error('invalid_input');
  if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 1600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.notes))) throw new Error('invalid_input');
  return { budget: value.budget, goal: value.goal, stage: value.stage, notes: value.notes?.trim() || '' };
}

function line(id, quantity = 1) {
  const item = byId.get(id);
  if (!item || !Number.isInteger(quantity) || quantity < 1) throw new Error('unknown_service');
  return { id, name: item.name, quantity, unitPrice: item.price, total: item.price * quantity, unit: item.unit, deliverables: [...item.deliverables] };
}

const commonAssumptions = [
  '参考范围：1 个品牌、1 个主要市场、英语；金额为人民币未税服务费，按确认的交付清单签约。',
  '媒体发布费、会员费、广告、拍摄、差旅、新增语种与新建网站另行确认；本方案未含这些外部费用。',
  'AI 提及、引用、收录与有效询盘分别观察；以所选清单的材料、记录和证据验收，不承诺第三方效果。',
  '每条服务的范围描述以 1 个计价单位为准，交付数量按所列数量计算；渠道适配不作为新增原创文章计数。',
];

function normalizePreferences(value) {
  const preferences = value && typeof value === 'object' ? value : {};
  const clean = list => Array.isArray(list) ? [...new Set(list.filter(id => preferenceIds.has(id)))] : [];
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
    if (!byId.has(id) || exclusions.has(id)) return false;
    if (id === 'W10' && !hasOriginal()) return false;
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
    append('W10');
    append('W07');
  } else if (input.goal === 'content') {
    append('W08');
    append('W10');
    append('W07');
    if (!hasOriginal()) append('W09');
  } else {
    append('W09');
    append('W18');
    if (!hasOriginal()) append('W08');
    append('W10');
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
    ? { W07: [1, 2, 3, 4, 5][depth], W08: [2, 3, 4, 6, 8][depth], W09: [0, 1, 1, 2, 3][depth], W10: [1, 2, 4, 6, 8][depth] }
    : input.goal === 'authority'
      ? { W07: [0, 1, 1, 2, 3][depth], W08: [1, 2, 3, 4, 5][depth], W09: [1, 2, 2, 3, 4][depth], W10: [1, 2, 3, 4, 5][depth] }
      : { W07: [1, 2, 3, 4, 5][depth], W08: [1, 2, 3, 5, 7][depth], W09: [0, 1, 1, 2, 3][depth], W10: [1, 2, 3, 5, 7][depth] };
  const expansionOrder = input.goal === 'authority' ? ['W09', 'W08', 'W07', 'W10'] : ['W08', 'W07', 'W10', 'W09'];
  // Rotate between asset types rather than consuming the remainder with one type.
  for (let quantity = 1; quantity <= Math.max(...Object.values(desired)); quantity++) {
    for (const id of expansionOrder) if (quantity <= desired[id]) append(id, quantity);
  }

  if (index === 2 && target >= 40500 && target < 75000 && input.goal === 'visibility') {
    const extraAsset = append('W08', count('W08') + 1) || append('W07', count('W07') + 1);
    if (extraAsset) append('W10', count('W10') + 1);
    else if (monitor()) setMonitoring(30, true);
  }

  if (index === 2 && target < 75000 && input.goal !== 'visibility') {
    append('W08', count('W08') + 1);
    if (input.goal === 'content') append('W10', Math.min(2, count('W10') + 1));
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
  const adaptations = count('W10') * 3;
  const assumptions = [...commonAssumptions];
  if (!count('W01')) assumptions.push('本组合以客户提供已核准的品牌事实、产品资料和公开权限为前提；若资料不足，先补充事实盘点并重新确认范围，暂不直接制作或发布。');
  else assumptions.push('已包含品牌事实盘点；客户指定业务与技术审校负责人，确认事实、证据及公开范围。');
  if (sampling) assumptions.push(hasFollowup
    ? `首期按 90 天安排；监测为 ${sampling.questions} 道固定题、3 个平台、1 次基线与 1 次完整复测，不代表每月或每日全量监测。`
    : `当前只含 ${sampling.questions} 道固定题的首月单次基线，不含后续复测；其他所选内容可在首期 90 天内按约定排期交付。`);
  else assumptions.push('本档为内容或可信资产建设专项，首期按最多 90 天安排；未包含 AI 回答采样或复测，验收以所选资产与提交记录为准。');
  if (count('W09') || count('W17')) assumptions.push('案例须有真实可核验材料；不同案例按独立资产确认，伙伴合作与发布权限须具备后才执行。');
  if (count('W15')) assumptions.push('白皮书基于已核准证据单独确认范围；复用本项目的文章、案例或访谈时，正式报价核销重复制作，不将复用内容计为额外原创。');
  if (count('W16')) assumptions.push('原创数据解读须由客户提供获准使用的有效数据；未含实验、调研采集或数据采购。');
  if (count('W26')) assumptions.push('Webinar 须有客户确认的讲者、素材和平台；平台及获客费用另列。');
  if (count('PITCH')) assumptions.push('PR 包含首次设置与一个 12 目标传播项目；刊登由编辑决定，付费发布不包含在本项服务内。');
  for (const item of items) for (const prerequisite of byId.get(item.id).prerequisites || []) {
    if (!assumptions.includes(prerequisite)) assumptions.push(prerequisite);
  }
  const omitted = preferences.prioritize.filter(id => !count(id) && !exclusions.has(id));
  if (omitted.length) assumptions.push(`备注中优先关注的${omitted.map(id => byId.get(id).name).join('、')}尚未进入本档预算，可与已有服务替换后另行确认。`);

  const highlights = [
    originals ? `${originals} 项核心内容或研究资产${adaptations ? `，另含 ${adaptations} 条渠道适配` : ''}${count('W18') ? `、${count('W18') * 3} 项行业资料提交` : ''}` : '先建立问题与证据清单，明确下一步投入方向',
    sampling ? `${sampling.questions} 道固定问题 · ${sampling.plannedAnswers} 份计划回答观察 · ${hasFollowup ? '含一次复测' : '单次基线'}` : '按真实材料制作，完成审校后用于官网、销售或行业沟通',
    `预算余量 ¥${(input.budget - total).toLocaleString('zh-CN')}，可保留到下一阶段`,
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
    description: `围绕${LABELS[input.goal]}，${hasFollowup ? '以明确资产与一次基线、一次复测验证本期投入。' : sampling ? '先看清当前回答表现，并完成清单列明的优先交付。' : '把预算优先用于可复用的内容与可信资产。'}`,
    items, highlights, assumptions, phases, ...(sampling ? { sampling: { ...sampling } } : {}),
  };
}

export function createRecommendation(raw, rawPreferences = {}) {
  const input = validateInput(raw);
  const preferences = normalizePreferences(rawPreferences);
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
  return { source: 'rules', summary: `围绕${LABELS[input.goal]}优先安排可验收的交付。三档逐步增加资产或观测范围，预算是上限；已有合格材料在正式确认时复用核销。`, plans, recommendationId: `preview-${input.budget}-${input.goal}-${input.stage}` };
}
