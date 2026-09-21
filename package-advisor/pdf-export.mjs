import { PDFDocument, rgb, StandardFonts } from './vendor/pdf-lib-1.17.1.mjs';
import fontkit from './vendor/fontkit-1.1.1.mjs';
import pako from './vendor/pako-1.0.11.mjs';
import { getOptionalServices, LANGUAGE_LABELS, PLATFORM_LABELS } from './catalog.mjs';

const PAGE = [595.28, 841.89];
const MARGIN = 44;
const WIDTH = PAGE[0] - MARGIN * 2;
const BOTTOM = 58;
const COLOR = {
  ink: rgb(0.075, 0.19, 0.15), muted: rgb(0.32, 0.40, 0.36),
  pale: rgb(0.93, 0.965, 0.93), line: rgb(0.79, 0.85, 0.80),
  white: rgb(1, 1, 1), soft: rgb(0.975, 0.98, 0.965),
};
let fontAssetPromise;

async function loadFont() {
  if (!fontAssetPromise) {
    fontAssetPromise = (async () => {
      const url = new URL('./vendor/EcoGEONotoSC-Regular.ttf.gz', import.meta.url);
      const decode = bytes => bytes[0] === 0x1f && bytes[1] === 0x8b ? pako.ungzip(bytes) : bytes;
      if (url.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
        const { readFile } = await import('node:fs/promises');
        return decode(new Uint8Array(await readFile(url)));
      }
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('PDF 字体未能加载，请稍后重试。');
      return decode(new Uint8Array(await response.arrayBuffer()));
    })().catch(error => { fontAssetPromise = undefined; throw error; });
  }
  return fontAssetPromise;
}

const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').replace(/[\u2010-\u2015\u2212]/gu, '-').replace(/\t/gu, '  ').replace(/\r\n?/gu, '\n');
const money = value => `¥${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
const list = value => Array.isArray(value) ? value : [];
const languageNames = values => list(values).map(value => LANGUAGE_LABELS[value] || clean(value)).join('、');

/** Generate a searchable proposal entirely in the caller's browser.
 * Prices are copied from the selected, already-priced snapshot. This module
 * neither calls the recommendation API nor computes new service prices.
 */
export async function createProposalPdf({ input, plan, source = '当前配置预览', summary = '', date = new Date() } = {}) {
  if (!input || !plan || !Array.isArray(plan.items) || !plan.items.length || !Number.isFinite(plan.total) || plan.total <= 0) {
    throw new Error('请先完成服务配置，再下载方案。');
  }
  if (plan.items.some(item => !item || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0 || !Number.isFinite(item.total) || item.total < 0)) {
    throw new Error('当前费用明细尚未完整，请更新方案后重试。');
  }
  const timestamp = new Date(date);
  if (Number.isNaN(timestamp.getTime())) throw new Error('方案日期无效，请重试。');
  const dateLabel = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(await loadFont(), { subset: true });
  const brandFont = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(`Eco GEO · ${clean(plan.name || '服务方案')} · 初步报价`);
  document.setAuthor('Eco GEO');
  document.setSubject('当前服务配置与初步报价，实际以正式报价单为准');
  document.setCreator('Eco GEO 本地方案导出');
  document.setProducer('Eco GEO');
  document.setCreationDate(timestamp);
  document.setModificationDate(timestamp);

  const supported = new Set(font.getCharacterSet());
  const unavailable = new Set();
  const printable = value => Array.from(clean(value), character => {
    if (character === '\n' || supported.has(character.codePointAt(0))) return character;
    const escaped = `[U+${character.codePointAt(0).toString(16).toUpperCase()}]`;
    unavailable.add(escaped);
    return escaped;
  }).join('');
  const textWidth = (value, size) => font.widthOfTextAtSize(value, size);
  // Split every paragraph on measured glyph boundaries, including long URLs.
  // Full text is retained; no CSS clipping, canvas rasterization or truncation.
  function wrap(value, maxWidth, size = 11) {
    const lines = [];
    for (const paragraph of printable(value).split('\n')) {
      let line = '';
      for (const character of Array.from(paragraph)) {
        if (line && textWidth(line + character, size) > maxWidth) {
          lines.push(line.trimEnd());
          line = character.trimStart();
        } else line += character;
      }
      lines.push(line.trimEnd());
    }
    return lines.length ? lines : [''];
  }
  let page;
  let y;
  const pages = [];
  function draw(value, x, baseline, size = 11, color = COLOR.ink, selectedPage = page) {
    selectedPage.drawText(printable(value), { x, y: baseline, size, font, color });
  }
  function rule(baseline, selectedPage = page) {
    selectedPage.drawLine({ start: { x: MARGIN, y: baseline }, end: { x: PAGE[0] - MARGIN, y: baseline }, thickness: 0.6, color: COLOR.line });
  }
  function newPage() {
    page = document.addPage(PAGE);
    pages.push(page);
    page.drawText('ECO GEO', { x: MARGIN, y: PAGE[1] - 34, size: 11, font: brandFont, color: COLOR.ink });
    draw('客户服务方案 · 初步报价', PAGE[0] - MARGIN - 141, PAGE[1] - 33, 9, COLOR.muted);
    rule(PAGE[1] - 45);
    y = PAGE[1] - 67;
  }
  function ensure(height) {
    if (y - height < BOTTOM) newPage();
  }
  function paragraph(value, { size = 11, leading = 17, color = COLOR.ink, indent = 0, gap = 8 } = {}) {
    const lines = wrap(value, WIDTH - indent, size);
    for (const line of lines) {
      ensure(leading);
      draw(line, MARGIN + indent, y - size, size, color);
      y -= leading;
    }
    y -= gap;
  }
  function section(title) {
    ensure(58);
    y -= 10;
    page.drawRectangle({ x: MARGIN, y: y - 16, width: 3, height: 17, color: COLOR.ink });
    draw(title, MARGIN + 12, y - 13, 14);
    y -= 32;
  }
  function bullet(value) { paragraph(`• ${clean(value)}`, { indent: 8, leading: 16.5, gap: 5 }); }
  function infoGrid(entries) {
    for (let offset = 0; offset < entries.length; offset += 2) {
      const row = entries.slice(offset, offset + 2);
      const cellWidth = (WIDTH - 12) / 2;
      const wrapped = row.map(entry => wrap(entry.value, cellWidth - 24, 10.5));
      const height = Math.max(...wrapped.map(lines => lines.length)) * 16 + 34;
      ensure(height + 10);
      row.forEach((entry, index) => {
        const x = MARGIN + index * (cellWidth + 12);
        page.drawRectangle({ x, y: y - height, width: cellWidth, height, color: COLOR.soft });
        draw(entry.label, x + 12, y - 16, 9, COLOR.muted);
        wrapped[index].forEach((line, lineIndex) => draw(line, x + 12, y - 34 - lineIndex * 16, 10.5));
      });
      y -= height + 10;
    }
  }
  function totalBox() {
    const caption = plan.quoteRequired || list(plan.pendingItems).length ? '已定价部分初步小计' : '本方案服务费 · 初步总价';
    const label = money(plan.total);
    const totalSize = textWidth(label, 27) > WIDTH - 36 ? 21 : 27;
    ensure(100);
    page.drawRectangle({ x: MARGIN, y: y - 93, width: WIDTH, height: 93, color: COLOR.ink });
    draw(caption, MARGIN + 18, y - 21, 10, COLOR.white);
    draw(label, MARGIN + 18, y - 55, totalSize, COLOR.white);
    draw('人民币服务费 · 初步报价，实际以正式报价单为准', MARGIN + 18, y - 77, 9.5, COLOR.white);
    y -= 105;
  }
  const tableWidths = [235, 74, 95, WIDTH - 404];
  const tableX = tableWidths.reduce((positions, width) => [...positions, positions.at(-1) + width], [MARGIN]);
  function tableHeader() {
    ensure(35);
    page.drawRectangle({ x: MARGIN, y: y - 28, width: WIDTH, height: 28, color: COLOR.pale });
    ['服务 / 语种费用拆分', '数量 / 单位', '初步单价', '初步金额'].forEach((label, index) => draw(label, tableX[index] + 8, y - 18, 9.5));
    y -= 28;
  }
  function tableRow(cells, { detail = false, total = false } = {}) {
    const size = detail ? 9.5 : 10.5;
    const leading = detail ? 14 : 15.5;
    const lines = cells.map((cell, index) => wrap(cell, tableWidths[index] - 16, size));
    const height = Math.max(...lines.map(value => value.length)) * leading + (detail ? 14 : 20);
    // Real catalogue rows are short; exceptionally long labels are retained as
    // paragraph continuations instead of overflowing a single page-height row.
    if (height > PAGE[1] - 170) {
      tableRow(['项目名称见下方完整说明', ...cells.slice(1)], { detail, total });
      paragraph(cells[0], { size, leading, indent: 8 });
      return;
    }
    if (y - height < BOTTOM) { newPage(); tableHeader(); }
    if (detail || total) page.drawRectangle({ x: MARGIN, y: y - height, width: WIDTH, height, color: detail ? COLOR.soft : COLOR.pale });
    lines.forEach((content, index) => content.forEach((line, lineIndex) => draw(line, tableX[index] + 8, y - 11 - size - lineIndex * leading, size, detail ? COLOR.muted : COLOR.ink)));
    y -= height;
    rule(y);
  }

  newPage();
  paragraph('把预算，变成看得见的交付。', { size: 23, leading: 31, gap: 8 });
  paragraph(plan.name || '当前服务方案', { size: 15, leading: 21, gap: 5 });
  paragraph(`生成日期：${dateLabel}  /  ${source === 'deepseek' ? 'AI 定制建议' : source === 'rules' ? '基础推荐' : source}`, { size: 9.5, leading: 15, color: COLOR.muted, gap: 12 });
  totalBox();
  if (summary) paragraph(summary, { size: 11, leading: 18, gap: 10 });
  if (plan.description && plan.description !== summary) paragraph(plan.description, { size: 10.5, leading: 17, color: COLOR.muted, gap: 12 });

  const scope = input.scope || { productLines: 1, scenarios: 3, audiences: 3, intents: 30 };
  const isChinese = input.market === 'cn';
  const budget = input.budgetMode === 'discuss' || input.budget === null ? '另行讨论 · 先确认服务范围' : money(input.budget);
  section('01  本次需求与服务范围');
  infoGrid([
    { label: '市场与计价周期', value: isChinese ? '中文 GEO / 季度服务' : `境外 GEO / ${plan.horizon || '按本期项目范围'}` },
    { label: isChinese ? '本季度预算参考' : '本期项目预算参考', value: budget },
    { label: '服务语种', value: languageNames(input.languages || plan.languages || [isChinese ? 'zh' : 'en']) },
    { label: '本次重点', value: ({ visibility: '提升 AI 可见度', content: '建设采购决策内容', authority: '建设可信来源' })[input.goal] || '按已选服务范围' },
  ]);
  paragraph(`产品线 ${scope.productLines} 条；每条产品线规划 ${scope.scenarios} 个场景、${scope.audiences} 类客群；全项目 ${scope.intents} 个去重决策问题主题。`, { gap: 5 });
  paragraph('这些数值描述服务覆盖范围。同义问法不重复计数；原创内容、采样次数和发布数量按下面的交付清单确认。', { size: 10, leading: 16, color: COLOR.muted });
  if (plan.pricingBreakdown) {
    const basis = plan.pricingBreakdown;
    paragraph(`中文季度标准单元：范围单元 ${basis.scopeUnits}；意图单元 ${basis.intentUnits}；取较大值 ${basis.units} 个单元。每单元 ${money(basis.unitPrice)} / 季度，已纳入明细。`, { size: 10, leading: 16 });
  }
  if (input.budgetMode !== 'discuss' && Number.isFinite(input.budget)) {
    paragraph(plan.total > input.budget ? '当前初步总价高于预算参考，可调整可选交付后再与顾问确认。' : '预算是本次规划的边界，不要求全部花完；费用以当前已选交付为基础。', { size: 10, leading: 16, color: COLOR.muted });
  }

  section('02  当前费用明细');
  paragraph('以下为当前所选服务的初步报价。语种拆分说明本项费用构成；共享研究与事实库只计一次。', { size: 10, leading: 16, color: COLOR.muted });
  tableHeader();
  for (const item of plan.items) {
    const detailCount = list(item.pricingDetails).length;
    const groupHeight = Math.max(2, wrap(`${item.name}${item.required ? ' · 基础必需' : ''}`, tableWidths[0] - 16, 10.5).length) * 15.5 + 20 + detailCount * 42;
    if (groupHeight < PAGE[1] - 180 && y - groupHeight < BOTTOM) { newPage(); tableHeader(); }
    const standalone = Number.isFinite(item.listPrice) && item.listPrice > item.total ? ` · 单独参考 ${money(item.listPrice)}` : '';
    tableRow([`${item.name}${item.required ? ' · 基础必需' : ''}${standalone}`, `${item.quantity} ${item.unit || ''}`, money(item.unitPrice), money(item.total)]);
    const details = list(item.pricingDetails).filter(detail => Number.isFinite(detail.unitPrice) && Number.isFinite(detail.quantity) && Number.isFinite(detail.amount));
    for (const detail of details) {
      const detailStandalone = Number.isFinite(detail.listPrice) && detail.listPrice > detail.amount ? `（单独参考 ${money(detail.listPrice)}）` : '';
      tableRow([`  ${detail.label || LANGUAGE_LABELS[detail.language] || detail.language || '费用构成'}${detailStandalone}`, `${detail.quantity}`, money(detail.unitPrice), money(detail.amount)], { detail: true });
    }
    if (details.length && Math.abs(details.reduce((amount, detail) => amount + detail.amount, 0) - item.total) > 0.01) {
      tableRow(['  拆分说明待顾问核对，本项以服务行金额为准。', '', '', ''], { detail: true });
    }
  }
  tableRow(['初步服务费合计', '', '', money(plan.total)], { total: true });
  y -= 10;
  paragraph('初步报价，实际以正式报价单为准。执行周期、资料前提、外部费用及最终范围将在正式报价中确认。', { size: 10, leading: 16, color: COLOR.muted });

  if (list(plan.pendingItems).length) {
    section('待确认的补充范围');
    paragraph('以下项目未计入上面的已定价部分，不代表免费；确认范围后补充正式报价。');
    for (const item of plan.pendingItems) { bullet(item.name); paragraph(item.reason || '', { indent: 8 }); list(item.details).forEach(bullet); }
  }

  section('03  交付清单');
  for (const item of plan.items) {
    ensure(65);
    paragraph(`${item.name} · ${item.quantity} ${item.unit || ''}`, { size: 12, leading: 19, gap: 5 });
    const deliverables = list(item.deliverables);
    if (deliverables.length) deliverables.forEach(bullet);
    else paragraph('具体成果与验收清单在正式报价中确认。', { size: 10.5, indent: 8, color: COLOR.muted });
    list(item.details).forEach(detail => paragraph(detail, { size: 10, leading: 16, color: COLOR.muted, indent: 8 }));
    if (list(item.prerequisites).length) paragraph(`本项前提：${item.prerequisites.join('；')}`, { size: 10, leading: 16, color: COLOR.muted, indent: 8 });
    y -= 5;
  }

  if (input.listening?.enabled && plan.items.some(item => item.id === 'SOCIAL_LISTENING')) {
    section('Social listening 配置');
    const listening = input.listening;
    const depth = { mentions: '提及与趋势', insights: '分析与洞察', strategy: '战略与专项研究' };
    const cadence = { monthly: '月度', weekly: '每周', daily: '每日', realtime: '实时告警' };
    paragraph(`平台：${list(listening.platforms).map(platform => PLATFORM_LABELS[platform] || clean(platform)).join('、') || '待确认'}。研究深度：${depth[listening.depth] || listening.depth}；更新频率：${cadence[listening.cadence] || listening.cadence}；覆盖 ${listening.markets} 个市场、${listening.languages} 种语言。`);
    paragraph('覆盖可合法获取的公开数据。数据可用性、历史窗口、告警及人工响应安排在正式报价中确认；本项与 AI 回答采样分别交付。', { size: 10, leading: 16, color: COLOR.muted });
  }

  if (list(plan.phases).length || list(plan.assumptions).length) {
    section('04  实施安排与资料前提');
    for (const phase of list(plan.phases)) {
      ensure(54);
      paragraph(phase.title || '执行阶段', { size: 12, leading: 19, gap: 4 });
      paragraph(phase.description || '', { size: 10.5, leading: 17 });
    }
    list(plan.assumptions).forEach(bullet);
  }
  if (list(plan.highlights).length) {
    section('方案中的复用与协同');
    list(plan.highlights).forEach(bullet);
  }

  const selections = Object.entries(input.modules || {});
  if (selections.length) {
    section('05  你的手动选配');
    const names = new Map([...getOptionalServices(input.market || 'overseas'), ...plan.items].map(item => [item.id, item.name]));
    for (const [id, quantity] of selections) bullet(`${names.get(id) || id}：${quantity === 0 ? '本次明确不选（已移除）' : `已设置数量 ${quantity}`}`);
    paragraph('以上记录保留本次增删选择；已移除项目的对应交付不包含在本方案中。', { size: 10, leading: 16, color: COLOR.muted });
  }
  section('下一步');
  paragraph('顾问将与你核对当前方案、资料前提、正式报价与排期。下载方案不会自动提交需求；无需先付款。', { size: 11, leading: 18 });
  paragraph('eco-geo.org/contact/', { size: 10.5, leading: 17, color: COLOR.muted });
  if (input.notes) {
    const hasUnmappedNotes = Array.from(clean(input.notes)).some(character => character !== '\n' && !supported.has(character.codePointAt(0)));
    section(hasUnmappedNotes ? '你的补充说明 · 个别缺字以 [U+编码] 保留' : '你的补充说明');
    paragraph(input.notes, { size: 10.5, leading: 17 });
  }
  pages.forEach((selectedPage, index) => {
    rule(43, selectedPage);
    draw('Eco GEO · 初步报价，实际以正式报价单为准', MARGIN, 28, 8, COLOR.muted, selectedPage);
    const label = `${index + 1} / ${pages.length}`;
    draw(label, PAGE[0] - MARGIN - textWidth(label, 8), 28, 8, COLOR.muted, selectedPage);
  });
  return document.save({ useObjectStreams: true });
}
