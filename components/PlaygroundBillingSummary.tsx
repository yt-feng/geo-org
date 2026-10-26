import { formatCreditsWithUsd } from "@/lib/credits";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Display the server receipt and its actual token counts without deriving or modifying a charge. */
export function PlaygroundBillingSummary({ response, locale }: { response: unknown; locale: "zh" | "en" }) {
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const root = record(response), billing = record(root.tokvilo_billing);
  const usage = record(root.usage ?? record(root.data).usage);
  const input = usage.prompt_tokens ?? usage.input_tokens;
  const output = usage.completion_tokens ?? usage.output_tokens;
  const total = usage.total_tokens;
  const counts = [
    { label: t("输入 tokens", "Input tokens"), value: input },
    { label: t("输出 tokens", "Output tokens"), value: output },
    { label: t("总 tokens", "Total tokens"), value: total },
  ].filter((count): count is { label: string; value: number } => nonnegativeInteger(count.value));
  const hasBilling = Object.keys(billing).length > 0;
  if (!hasBilling && !counts.length) return null;
  const reserved = billing.currency === "USD" && nonnegativeInteger(billing.reservedMicrousd) ? billing.reservedMicrousd : null;
  const finalized = billing.status === "settled" || billing.status === "refunded" && billing.chargedMicrousd === 0;
  const charged = finalized && billing.currency === "USD" && nonnegativeInteger(billing.chargedMicrousd) ? billing.chargedMicrousd : null;
  return <section className="playground-quote-summary" aria-label={t("本次费用与实际用量", "Request cost and actual usage")}>
    <div className="playground-request-summary">
      {reserved !== null ? <div><span>{t("预留金额", "Reservation")}</span><strong>{formatCreditsWithUsd(reserved, locale)}</strong></div> : null}
      {hasBilling ? <div><span>{t("实际费用", "Actual charge")}</span><strong>{charged !== null ? formatCreditsWithUsd(charged, locale) : t("待结算确认", "Awaiting settlement")}</strong></div> : null}
      {counts.map(count => <div key={count.label}><span>{count.label}</span><strong>{count.value.toLocaleString("en-US")}</strong></div>)}
    </div>
    {hasBilling ? <p>{charged !== null
      ? billing.status === "refunded" ? t("本次未扣费，预留已释放。", "No charge was made; the reservation has been released.") : t("以上为服务端确认的实际费用；预留金额不是最终费用。", "The actual charge above is confirmed by the server; the reservation is not the final charge.")
      : t("预留金额不是最终费用；请查询原请求，等待结算确认。", "The reservation is not the final charge. Check the original request for confirmed settlement.")}</p> : null}
    {counts.length ? <p>{t("tokens 为模型返回的实际用量，与积分计价单位不同。", "Tokens are the actual usage reported by the model, separate from the credits used for pricing.")}</p> : null}
  </section>;
}
