"use client";

import { compareOfficialRate, matchOfficialModel } from "@/lib/official-pricing";
import { dollarRate, type SelectionPrice } from "@/lib/model-selection-ui";
import { useSiteLocale } from "./LocaleProvider";
import { englishPriceText } from "@/lib/price-copy";

export function OfficialPriceComparison({ price, compact = false }: { price: SelectionPrice; compact?: boolean }) {
  const { t, isEnglish } = useSiteLocale();
  const match = matchOfficialModel(price.model);
  const rates = price.rates.filter(rate => rate.unit === "1M_tokens" && /^(?:(?:[^:]+:)?(?:input|output)|(?:input|output):[^:]+)$/.test(rate.dimension));
  if (!match || !rates.length) return <p className="official-price-unverified">{t("官方同型号价格待核实，暂不计算优惠。", "Official pricing for this exact model is not yet verified; no savings claim is shown.")}</p>;
  const rows = rates.map(rate => ({ rate, comparison: compareOfficialRate(price.model, rate) }));
  const comparable = rows.filter(({ comparison }) => comparison.status === "verified");
  const source = rows.find(({ comparison }) => comparison.sourceUrl)?.comparison;
  return <section className={`official-price${compact ? " official-price-compact" : ""}`} aria-label={t("与厂商官方价格比较", "Compare with official pricing")}>
    <div className="official-price-heading"><strong>{t("tokvilo 与官方价格", "tokvilo vs official")}</strong><span>{t("标准按量 / 百万 tokens · 按标示币种", "Standard usage / 1M tokens · Currencies as shown")}</span></div>
    <div className="official-price-scroll"><table><thead><tr><th>{t("计费项", "Rate")}</th><th>{t("官方", "Official")}</th><th>tokvilo</th><th>{t("对比", "Difference")}</th></tr></thead><tbody>{rows.map(({ rate, comparison: c }) => <tr key={rate.dimension}><th>{({ input: t("输入", "Input"), output: t("输出", "Output"), cacheRead: t("缓存读取", "Cache read"), cached_input: t("缓存输入", "Cached input"), cacheWrite: t("缓存写入", "Cache write") })[rate.dimension.split(":").find(part => part === "input" || part === "output")!] || rate.dimension}{rate.condition ? <small>{isEnglish ? englishPriceText(rate.condition) : rate.condition}</small> : null}</th><td>{c.official ? `${c.official.currency === "CNY" ? "¥" : "$"}${c.official.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })}` : "—"}</td><td>{dollarRate(rate.retailMicrousd)}</td><td>{c.status === "verified" && c.savingsPercent !== null ? <span className={c.pricePosition === "lower" ? "price-saving" : ""}>{c.pricePosition === "lower" ? t(`省 ${c.savingsPercent.toFixed(1)}%`, `Save ${c.savingsPercent.toFixed(1)}%`) : c.pricePosition === "equal" ? t("价格相同", "Same price") : t(`高 ${Math.abs(c.savingsPercent).toFixed(1)}%`, `${Math.abs(c.savingsPercent).toFixed(1)}% higher`)}{c.pricePosition === "lower" && c.multiple !== null && c.multiple >= 2 ? <small>{t(`官方为 tokvilo 的 ${c.multiple.toFixed(1)} 倍`, `Official is ${c.multiple.toFixed(1)}× tokvilo`)}</small> : null}</span> : t("暂不可比", "Not comparable")}</td></tr>)}</tbody></table></div>
    {rows.some(({ comparison }) => comparison.status !== "verified") ? <p>{t("币种、上下文档位或计费条件未对齐的项目，不计算差价。", "No savings are calculated where currencies, context tiers or billing conditions do not match.")}</p> : null}
    {price.billingReady === false ? <p>{t("此服务尚未开通；以下报价不代表当前可购买或调用。", "This service is not yet enabled; listed rates do not imply current purchasing or execution availability.")}</p> : null}
    {source?.sourceUrl ? <p><a href={source.sourceUrl} target="_blank" rel="noreferrer">{t("厂商官方价格依据 ↗", "Official pricing source ↗")}</a> · {t("核实于", "Checked")} {source.asOf}{comparable.length ? t("。不含批量优惠、免费额度及税费。", ". Excludes batch discounts, free allowances and taxes.") : ""}</p> : null}
    <details><summary>{t("查看比较口径", "Comparison conditions")}</summary>{rows.map(({ rate, comparison: c }) => <p key={rate.dimension}>{rate.dimension}: {c.official?.condition || t("未取得同条件官方费率", "No matching official rate verified")}{rate.condition ? ` · tokvilo: ${isEnglish ? englishPriceText(rate.condition) : rate.condition}` : ""}</p>)}</details>
  </section>;
}
