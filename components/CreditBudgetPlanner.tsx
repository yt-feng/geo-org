"use client";

import { useState } from "react";
import { CREDIT_EXCHANGE_LABEL, formatCreditsWithUsd } from "@/lib/credits";
import { TEXT_BUDGET_SCENARIOS, getBudgetScenario, estimateScenarioBudget } from "@/lib/credit-budget-scenarios";
import { selectionPrices, publicService, type SelectionPrice } from "@/lib/model-selection-ui";
import { useSiteLocale } from "./LocaleProvider";

export function CreditBudgetPlanner({ prices }: { prices: SelectionPrice[] }) {
  const { t, isEnglish } = useSiteLocale();
  const locale = isEnglish ? "en" : "zh";
  const [budget, setBudget] = useState("20");
  const [selected, setSelected] = useState("");
  const [scenarioId, setScenarioId] = useState("daily");
  const scenario = getBudgetScenario(scenarioId);
  const available = prices.filter(price => price.kind === "chat" && price.billingReady === true);
  const candidates = selectionPrices(available, scenario.inputTokens);
  const key = (item: { service: string; modelId: string }) => `${item.service}:${item.modelId}`;
  // Keep a chosen model across scenarios, even when a required price tier is missing.
  const choices = available.filter(price => TEXT_BUDGET_SCENARIOS.some(sample => selectionPrices([price], sample.inputTokens).length))
    .map(price => ({ modelId: price.model, service: publicService(price.provider) }));
  const defaultCandidates = selectionPrices(available, TEXT_BUDGET_SCENARIOS[0].inputTokens);
  const defaultModel = defaultCandidates.find(item => item.modelId === "gemini-3.8-flash") || defaultCandidates[0] || choices[0];
  const selectedKey = selected || (defaultModel ? key(defaultModel) : "");
  const chosen = candidates.find(item => key(item) === selectedKey);
  const budgetMicrousd = /^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(budget) && Number(budget) > 0 ? Math.round(Number(budget) * 1_000_000) : null;
  const estimate = chosen && budgetMicrousd !== null ? estimateScenarioBudget(budgetMicrousd, scenario, Math.round(chosen.inputUsdPerMillion * 1_000_000), Math.round(chosen.outputUsdPerMillion * 1_000_000)) : null;
  const inputTokens = scenario.inputTokens.toLocaleString("en-US"), outputTokens = scenario.outputTokens.toLocaleString("en-US");

  return <section className="credit-budget" aria-labelledby="credit-budget-title">
    <div><span className="landing-eyebrow">TOKVILO / YOUR API BUDGET</span><h2 id="credit-budget-title">{t("先定预算，再选模型。", "Start with your budget.")}</h2><p>{t(`固定兑换：${CREDIT_EXCHANGE_LABEL.zh}。积分与美元表示同一份 API 余额，可在已开通的 API 模型间使用。`, `Fixed conversion: ${CREDIT_EXCHANGE_LABEL.en}. Credits and USD represent the same API balance, usable across enabled API models.`)}</p></div>
    <fieldset className="credit-budget-scenarios"><legend>{t("选择使用场景", "Choose a usage scenario")}</legend><div>{TEXT_BUDGET_SCENARIOS.map(sample => <label key={sample.id} className={scenario.id === sample.id ? "is-selected" : ""}><input type="radio" name="credit-budget-scenario" value={sample.id} checked={scenario.id === sample.id} onChange={() => setScenarioId(sample.id)} /><span><strong>{sample.title[locale]}</strong><span>{sample.description[locale]}</span></span></label>)}</div></fieldset>
    <p className="credit-budget-assumptions">{t(`每个示例 = ${inputTokens} 输入 + ${outputTokens} 输出 tokens。场景只改变试算用量，同一模型仍按相同费率和适用档位计算。`, `Each example uses ${inputTokens} input + ${outputTokens} output tokens. Scenarios change the sample usage only; the same model uses the same rates and applicable tier.`)}</p>
    <div className="credit-budget-controls"><label htmlFor="credit-budget-amount">{t("计划 API 预算（USD）", "Planned API budget (USD)")}<input id="credit-budget-amount" type="number" min="0.01" max="99999" step="0.01" value={budget} onChange={event => setBudget(event.target.value)} inputMode="decimal" /></label><label htmlFor="credit-budget-model">{t("试算模型", "Example model")}<select id="credit-budget-model" value={selectedKey} disabled={!choices.length} onChange={event => setSelected(event.target.value)}>{choices.length ? choices.map(item => <option key={key(item)} value={key(item)}>{item.modelId} · {item.service === "studio" ? t("多模态", "Multimodal") : item.service === "selected" ? "Select" : t("模型服务", "Models")}{candidates.some(candidate => key(candidate) === key(item)) ? "" : t("（此场景暂无报价）", " (No quote for this scenario)")}</option>) : <option value="">{t("暂无可试算的模型", "No comparable model available")}</option>}</select></label></div>
    {estimate && chosen && budgetMicrousd !== null ? <div className="credit-budget-result credit-budget-scenario-result" aria-live="polite"><div><span>{t("你的计划额度", "Your planned allowance")}</span><strong>{formatCreditsWithUsd(budgetMicrousd, locale)}</strong></div><div><span>{t("每个示例任务", "Per example task")}</span><strong>{formatCreditsWithUsd(estimate.exampleMicrousd, locale)}</strong></div><div><span>{t("100 次相同样本的总费用", "Total for 100 identical examples")}</span><strong>{formatCreditsWithUsd(estimate.hundredExamplesMicrousd, locale)}</strong></div><div><span>{t("按当前费率约可完成", "At current rates, approximately")}</span><strong>{estimate.examples.toLocaleString("en-US")} {t("个示例任务", "example tasks")}</strong></div></div> : <p role="status">{budgetMicrousd === null ? t("请输入正数美元预算，最多两位小数。", "Enter a positive USD budget with up to two decimal places.") : t("所选模型在此场景暂无条件一致的输入／输出费率，请换一个模型或场景试算。", "The selected model has no matching input/output rates for this scenario. Try another model or scenario.")}</p>}
    <p className="credit-budget-note">{t("按普通文字、无缓存命中费率估算，不含工具等额外项目。100 次表示 100 个独立示例，不是批量折扣。实际任务长度和费率变化会改变费用与次数；不保证任务成功率；不是调用次数承诺，也不会设置扣费上限或自动充值。正式请求仍先报价，再按实际用量结算。", "Estimates use standard text rates without cache hits and exclude tools and other extras. The 100-example total covers 100 separate requests, without a batch discount. Task length and rate changes affect costs and counts; task success is not guaranteed. This is not a request guarantee, spending limit or automatic top-up. Actual requests receive a quote and settle by usage.")}</p>
  </section>;
}
