"use client";

import { useState } from "react";
import { estimateTextBudget, formatCreditsWithUsd } from "@/lib/credits";
import { selectionPrices, publicService, type SelectionPrice } from "@/lib/model-selection-ui";
import { useSiteLocale } from "./LocaleProvider";

export function CreditBudgetPlanner({ prices }: { prices: SelectionPrice[] }) {
  const { t, isEnglish } = useSiteLocale();
  const locale = isEnglish ? "en" : "zh";
  const [budget, setBudget] = useState("20");
  const [selected, setSelected] = useState("");
  const available = prices.filter(price => price.kind === "chat" && price.billingReady === true);
  const candidates = selectionPrices(available, 2_000);
  const key = (item: typeof candidates[number]) => `${item.service}:${item.modelId}`;
  const chosen = candidates.find(item => key(item) === selected) || candidates.find(item => item.modelId === "gemini-3.8-flash") || candidates[0];
  const budgetMicrousd = /^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(budget) && Number(budget) > 0 ? Math.round(Number(budget) * 1_000_000) : null;
  const estimate = chosen && budgetMicrousd !== null ? estimateTextBudget(budgetMicrousd, 2_000, 1_000, Math.round(chosen.inputUsdPerMillion * 1_000_000), Math.round(chosen.outputUsdPerMillion * 1_000_000)) : null;
  return <section className="credit-budget" aria-labelledby="credit-budget-title">
    <div><span className="landing-eyebrow">TOKVILO / YOUR API BUDGET</span><h2 id="credit-budget-title">{t("先定预算，再选模型。", "Start with your budget.")}</h2><p>{t("固定兑换：$1 = 1,000 积分。积分与美元表示同一份 API 余额，可在已开通的 API 模型间使用。", "Fixed conversion: $1 = 1,000 credits. Credits and USD represent the same API balance, usable across enabled API models.")}</p></div>
    <div className="credit-budget-controls"><label>{t("计划 API 预算（USD）", "Planned API budget (USD)")}<input type="number" min="0.01" max="99999" step="0.01" value={budget} onChange={event => setBudget(event.target.value)} inputMode="decimal" /></label><label>{t("试算模型", "Example model")}<select value={chosen ? key(chosen) : ""} disabled={!candidates.length} onChange={event => setSelected(event.target.value)}>{candidates.length ? candidates.map(item => <option key={key(item)} value={key(item)}>{item.modelId} · {item.service === "studio" ? t("多模态", "Multimodal") : item.service === "selected" ? "Select" : t("模型服务", "Models")}</option>) : <option value="">{t("暂无可试算的模型", "No comparable model available")}</option>}</select></label></div>
    {estimate && chosen && budgetMicrousd !== null ? <div className="credit-budget-result" aria-live="polite"><div><span>{t("你的计划额度", "Your planned allowance")}</span><strong>{formatCreditsWithUsd(budgetMicrousd, locale)}</strong></div><div><span>{t("每个示例任务", "Per example task")}</span><strong>{formatCreditsWithUsd(estimate.exampleMicrousd, locale)}</strong></div><div><span>{t("按当前费率约可完成", "At current rates, approximately")}</span><strong>{estimate.examples.toLocaleString("en-US")} {t("个示例任务", "example tasks")}</strong></div></div> : <p role="status">{budgetMicrousd === null ? t("请输入正数美元预算，最多两位小数。", "Enter a positive USD budget with up to two decimal places.") : t("当前没有条件一致的输入／输出费率可用于试算。", "No matching input/output rates are available for this example.")}</p>}
    <p className="credit-budget-note">{t("每个示例 = 2,000 输入 + 1,000 输出 tokens，按普通文字、无缓存命中费率估算，不含工具等额外项目。实际任务长度和费率变化会改变次数；不是调用次数承诺，也不会设置扣费上限或自动充值。正式请求仍先报价，再按实际用量结算。", "Each example uses 2,000 input + 1,000 output tokens at standard text rates without cache hits, excluding tools and other extras. Task length and rate changes affect the count; this is not a request guarantee, spending limit or automatic top-up. Actual requests receive a quote and settle by usage.")}</p>
    {chosen && available.find(price => price.model === chosen.modelId && publicService(price.provider) === chosen.service)?.billingReady !== true ? <p>{t("服务可用状态需要重新确认。", "Service availability needs to be rechecked.")}</p> : null}
  </section>;
}
