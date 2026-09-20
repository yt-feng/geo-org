import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createProposalPdf } from '../package-advisor/pdf-export.mjs';
import { createRecommendation } from '../package-advisor/planner.mjs';
import { PDFDocument, PDFName } from '../package-advisor/vendor/pdf-lib-1.17.1.mjs';

const base = {
  budget: 300000, budgetMode: 'amount', market: 'overseas', languages: ['en', 'ar'],
  scope: { productLines: 2, scenarios: 4, audiences: 3, intents: 60 },
  goal: 'content', stage: 'growing', modules: { W02: 2, W10: 0, SOCIAL_LISTENING: 1 },
  listening: { enabled: true, platforms: ['LinkedIn', 'YouTube', 'TikTok'], depth: 'insights', cadence: 'weekly', markets: 2, languages: 2 },
  notes: ('请围绕工业设备采购、售后服务和渠道招商，保留英语与阿拉伯语服务；不要重复购买已经拥有的事实材料。价格写明¥、数量写明×，内容应适合客户直接保存。中文标点：，。；【】。🙂 العربية\n').repeat(16).slice(0, 1600),
};
function snapshot(input = base) {
  const recommendation = createRecommendation(input);
  return { input, plan: recommendation.plans.find(plan => plan.id === 'recommended') || recommendation.plans[0], source: 'AI 定制建议 · 已手动调整', summary: recommendation.summary, date: '2026-09-20T10:00:00.000Z' };
}

test('long multilingual proposal generates a searchable-font PDF without mutating the selected snapshot', async () => {
  const value = snapshot();
  const before = structuredClone(value);
  const bytes = await createProposalPdf(value);
  assert.deepEqual(value, before);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  assert.ok(bytes.length < 700000, 'font must be subset into the document');
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 3);
  assert.ok(pdf.getPageCount() < 15, 'long note pagination remains bounded');
  assert.match(pdf.getTitle(), /初步报价/u);
  const fonts = pdf.getPage(0).node.Resources().lookup(PDFName.of('Font'));
  const hasTrueType = fonts.entries().some(([, reference]) => {
    const definition = pdf.context.lookup(reference);
    const descendantReference = definition.get(PDFName.of('DescendantFonts'));
    const descendants = descendantReference ? pdf.context.lookup(descendantReference) : undefined;
    if (!descendants) return false;
    const child = descendants.lookup(0);
    const descriptor = child.lookup(PDFName.of('FontDescriptor'));
    return descriptor.has(PDFName.of('FontFile2'));
  });
  assert.ok(hasTrueType, 'Chinese glyphs must use the validated embedded TrueType path');
});

test('Chinese quarterly and open-budget snapshots generate their numeric preliminary quotes', async () => {
  for (const input of [
    { ...base, market: 'cn', languages: ['zh'], budget: 50000, modules: {}, listening: { enabled: false }, notes: '', scope: { productLines: 1, scenarios: 3, audiences: 3, intents: 30 } },
    { ...base, budgetMode: 'discuss', budget: null, languages: ['ar'], notes: '开放预算，先确认第一阶段范围。' },
  ]) {
    const value = snapshot(input);
    assert.ok(value.plan.total > 0);
    const pdf = await PDFDocument.load(await createProposalPdf(value));
    assert.ok(pdf.getPageCount() > 0);
  }
});

test('empty, nonnumeric, and invalid-date snapshots are rejected instead of exporting stale/free prices', async () => {
  await assert.rejects(createProposalPdf({ input: base, plan: { items: [], total: 0 } }), /完成服务配置/u);
  const value = snapshot();
  const invalid = structuredClone(value);
  invalid.plan.items[0].total = null;
  await assert.rejects(createProposalPdf(invalid), /费用明细/u);
  await assert.rejects(createProposalPdf({ ...value, date: 'invalid' }), /日期/u);
});

test('exporter runs under a CSP-safe local asset design', async () => {
  const sources = await Promise.all(['pdf-export.mjs', 'vendor/pdf-lib-1.17.1.mjs', 'vendor/fontkit-1.1.1.mjs', 'vendor/pako-1.0.11.mjs'].map(path => readFile(new URL(`../package-advisor/${path}`, import.meta.url), 'utf8')));
  for (const code of sources) {
    assert.doesNotMatch(code, /\beval\s*\(|\bnew\s+Function\s*\(/u);
    assert.doesNotMatch(code, /window\.print\s*\(/u);
  }
  assert.doesNotMatch(sources[0], /fetch\(\s*['"]https?:/u);
});

if (process.argv.includes('--write-qa')) {
  await mkdir('tmp/pdfs', { recursive: true });
  const value = snapshot();
  const bytes = await createProposalPdf(value);
  await writeFile('tmp/pdfs/advisor-proposal-qa.pdf', bytes);
  await writeFile('tmp/pdfs/advisor-proposal-qa.json', JSON.stringify(value, null, 2));
  console.log(`QA PDF: ${bytes.length} bytes; selected total ${value.plan.total}; ${value.plan.items.length} services.`);
}
