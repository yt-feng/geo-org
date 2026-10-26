"use client";

import { compareOfficialRate, matchOfficialModel } from "@/lib/official-pricing";
import { dollarRate, type SelectionPrice } from "@/lib/model-selection-ui";
import { formatCreditsWithUsd } from "@/lib/credits";
import { useSiteLocale } from "./LocaleProvider";
import { englishPriceText } from "@/lib/price-copy";

export function OfficialPriceComparison({ price, compact = false }: { price: SelectionPrice; compact?: boolean }) {
  const { t, isEnglish } = useSiteLocale();
  const locale = isEnglish ? "en" : "zh";
  const match = matchOfficialModel(price.model);
  const rates = price.rates.filter(rate => rate.unit === "1M_tokens" && /^(?:(?:[^:]+:)?(?:input|output)|(?:input|output):[^:]+)$/.test(rate.dimension));
  const label = (dimension: string) => dimension.split(":").includes("input") ? t("输入", "Input") : t("输出", "Output");
  const rows = rates.map(rate => ({ rate, comparison: compareOfficialRate(price.model, rate) }));
  const comparable = rows.filter(({ comparison }) => comparison.status === "verified");
  const source = rows.find(({ comparison }) => comparison.sourceUrl)?.comparison;
  const completePairs = rates.length > 0 && rates.every(rate => rates.some(other =>
    other.dimension === rate.dimension.split(":").map(part => part === "input" ? "output" : part === "output" ? "input" : part).join(":") &&
    (other.condition?.trim() || "") === (rate.condition?.trim() || "") &&
    other.tierMinInputTokens === rate.tierMinInputTokens && other.tierMaxInputTokens === rate.tierMaxInputTokens));
  // Each declared tier needs both input and output; partial or mixed evidence cannot describe the whole model.
  const saving = price.billingReady === true && completePairs && rows.every(({ comparison: c }) => c.status === "verified" && c.pricePosition === "lower" && c.savingsPercent !== null)
    ? Math.min(...rows.map(({ comparison }) => comparison.savingsPercent!)) : null;
  return <section className={`official-price${compact ? " official-price-compact" : ""}`} aria-label={t("价格对比与计费说明", "Price comparison & billing details")}>
    {compact && rates.length ? <div className="official-retail-summary"><strong>{t("tokvilo 实际售价", "tokvilo rates")}</strong><span>{t("$1 = 1,000 积分 · 每百万 tokens", "$1 = 1,000 credits · Per 1M tokens")}</span>{rates.map(rate => <div key={rate.dimension}><span>{label(rate.dimension)}{rate.condition ? <small>{isEnglish ? englishPriceText(rate.condition) : rate.condition}</small> : null}</span><strong>{formatCreditsWithUsd(rate.retailMicrousd, locale)}</strong></div>)}</div> : null}
    {saving !== null ? <p className="official-savings-summary">{t(`已核实的输入／输出费率均比官方低至少 ${(Math.floor(saving * 10) / 10).toFixed(1)}%`, `All verified input/output rates are at least ${(Math.floor(saving * 10) / 10).toFixed(1)}% below official rates`)}</p> : null}
    {price.billingReady === false ? <p>{t("此服务尚未开通；列示报价不代表当前可购买或调用。", "This service is not yet enabled; listed rates do not imply current purchasing or execution availability.")}</p> : null}
    <details className="official-price-details">
      <summary>{t("价格对比与计费说明", "Price comparison & billing details")}</summary>
      <p>{t("积分是同一 API 服务余额的显示单位，$1 = 1,000 积分。按真实用量和确认费率结算；积分换算本身不构成折扣。", "Credits display the same API service balance: $1 = 1,000 credits. Settlement uses actual usage and confirmed rates; the conversion itself is not a discount.")}</p>
      {!match || !rates.length ? <p className="official-price-unverified">{t("官方同型号价格待核实，暂不计算优惠。", "Official pricing for this exact model is not yet verified; no savings claim is shown.")}</p> : <>
        <div className="official-price-heading"><strong>{t("tokvilo 与官方价格", "tokvilo vs official")}</strong><span>{t("标准按量 / 百万 tokens · 按标示币种", "Standard usage / 1M tokens · Currencies as shown")}</span></div>
        <div className="official-price-scroll"><table><thead><tr><th>{t("计费项", "Rate")}</th><th>{t("官方", "Official")}</th><th>tokvilo USD</th><th>{t("对比", "Difference")}</th></tr></thead><tbody>{rows.map(({ rate, comparison: c }) => <tr key={rate.dimension}><th>{label(rate.dimension)}{rate.condition ? <small>{isEnglish ? englishPriceText(rate.condition) : rate.condition}</small> : null}</th><td>{c.official ? `${c.official.currency === "CNY" ? "¥" : "$"}${c.official.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })}` : "—"}</td><td>{dollarRate(rate.retailMicrousd)}</td><td>{c.status === "verified" && c.savingsPercent !== null ? <span className={c.pricePosition === "lower" ? "price-saving" : ""}>{c.pricePosition === "lower" ? t(`省 ${c.savingsPercent.toFixed(1)}%`, `Save ${c.savingsPercent.toFixed(1)}%`) : c.pricePosition === "equal" ? t("价格相同", "Same price") : t(`高 ${Math.abs(c.savingsPercent).toFixed(1)}%`, `${Math.abs(c.savingsPercent).toFixed(1)}% higher`)}{c.pricePosition === "lower" && c.multiple !== null && c.multiple >= 2 ? <small>{t(`官方为 tokvilo 的 ${c.multiple.toFixed(1)} 倍`, `Official is ${c.multiple.toFixed(1)}× tokvilo`)}</small> : null}</span> : t("暂不可比", "Not comparable")}</td></tr>)}</tbody></table></div>
        {rows.some(({ comparison }) => comparison.status !== "verified") ? <p>{t("币种、上下文档位或计费条件未对齐的项目，不计算差价。", "No savings are calculated where currencies, context tiers or billing conditions do not match.")}</p> : null}
        {source?.sourceUrl ? <p><a href={source.sourceUrl} target="_blank" rel="noreferrer">{t("厂商官方价格依据 ↗", "Official pricing source ↗")}</a> · {t("核实于", "Checked")} {source.asOf}{comparable.length ? t("。不含批量优惠、免费额度及税费。", ". Excludes batch discounts, free allowances and taxes.") : ""}</p> : null}
        <h4>{t("比较口径", "Comparison conditions")}</h4>{rows.map(({ rate, comparison: c }) => <p key={rate.dimension}>{rate.dimension}: {c.official?.condition || t("未取得同条件官方费率", "No matching official rate verified")}{rate.condition ? ` · tokvilo: ${isEnglish ? englishPriceText(rate.condition) : rate.condition}` : ""}</p>)}
      </>}
    </details>
  </section>;
}
