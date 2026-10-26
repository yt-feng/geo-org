/** Display unit only. The USD ledger and actual token usage remain authoritative. */
export const CREDITS_PER_USD = 1_000;
export const MICROS_PER_CREDIT = 1_000;
type Locale = "zh" | "en";

function scaledAmount(microusd: number, digits: number): string | null {
  if (!Number.isSafeInteger(microusd)) return null;
  const amount = BigInt(microusd), absolute = amount < BigInt(0) ? -amount : amount;
  const divisor = BigInt(10) ** BigInt(digits);
  const fraction = (absolute % divisor).toString().padStart(digits, "0").replace(/0+$/, "");
  return `${amount < BigInt(0) ? "-" : ""}${(absolute / divisor).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

export function formatCreditUsd(microusd: number): string {
  const amount = scaledAmount(microusd, 6);
  return amount === null ? "—" : amount.startsWith("-") ? `-$${amount.slice(1)}` : `$${amount}`;
}

export function formatCreditAmount(microusd: number, locale: Locale): string {
  const amount = scaledAmount(microusd, 3);
  return amount === null ? "—" : `${amount} ${locale === "zh" ? "积分" : "credits"}`;
}

export function formatCreditsWithUsd(microusd: number, locale: Locale): string {
  return Number.isSafeInteger(microusd) ? `${formatCreditAmount(microusd, locale)} (${formatCreditUsd(microusd)})` : "—";
}

/** A planning example, not a quote: sum standard uncached text rates, then round once. */
export function estimateTextBudget(budgetMicrousd: number, inputTokens: number, outputTokens: number, inputRateMicrousd: number, outputRateMicrousd: number) {
  if (![budgetMicrousd, inputTokens, outputTokens, inputRateMicrousd, outputRateMicrousd].every(value => Number.isSafeInteger(value) && value >= 0) || inputTokens < 1 || outputTokens < 1) return null;
  const numerator = BigInt(inputTokens) * BigInt(inputRateMicrousd) + BigInt(outputTokens) * BigInt(outputRateMicrousd);
  const cost = (numerator + BigInt(999_999)) / BigInt(1_000_000);
  if (cost < BigInt(1) || cost > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { exampleMicrousd: Number(cost), examples: Number(BigInt(budgetMicrousd) / cost) };
}
