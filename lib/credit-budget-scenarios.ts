import { estimateTextBudget } from "./credits";

/** Public planning samples, not measured averages or guaranteed task outcomes. */
export const TEXT_BUDGET_SCENARIOS = [
  {
    id: "daily",
    title: { zh: "日常摘要与写作", en: "Everyday summaries & writing" },
    description: { zh: "短文摘要、邮件与文案初稿", en: "Short summaries, emails and first drafts" },
    inputTokens: 2_000,
    outputTokens: 1_000,
  },
  {
    id: "coding",
    title: { zh: "编程迭代", en: "Coding iterations" },
    description: { zh: "代码解释、局部修改与测试草稿", en: "Code explanations, focused changes and test drafts" },
    inputTokens: 8_000,
    outputTokens: 2_000,
  },
  {
    id: "analysis",
    title: { zh: "长文分析", en: "Long-document analysis" },
    description: { zh: "长材料梳理与要点提炼", en: "Organizing long documents and extracting key points" },
    inputTokens: 32_000,
    outputTokens: 2_000,
  },
] as const;

export function getBudgetScenario(id: string) {
  return TEXT_BUDGET_SCENARIOS.find(scenario => scenario.id === id) || TEXT_BUDGET_SCENARIOS[0];
}

export function estimateScenarioBudget(budgetMicrousd: number, scenario: { inputTokens: number; outputTokens: number }, inputRateMicrousd: number, outputRateMicrousd: number) {
  const estimate = estimateTextBudget(budgetMicrousd, scenario.inputTokens, scenario.outputTokens, inputRateMicrousd, outputRateMicrousd);
  if (!estimate) return null;
  // Each example is an independent request, rounded once to the ledger unit.
  const hundredExamplesMicrousd = estimate.exampleMicrousd * 100;
  if (!Number.isSafeInteger(hundredExamplesMicrousd)) return null;
  return { ...estimate, hundredExamplesMicrousd };
}
