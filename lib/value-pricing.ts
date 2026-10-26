import { compareOfficialRate, type ComparableRetailRate } from "./official-pricing";

/** Public model rates are consistent across customers. This policy changes prices,
 * never usage, model routing, wallet currency or already accepted quote snapshots. */
export const VALUE_PRICING_VERSION = "reference-70-v1-20261026";
export const OFFICIAL_TARGET_PERCENT = 70;
export const REFERENCE_MAX_AGE_DAYS = 14;

/** Input is the existing cost-plus retail floor, not a raw procurement price.
 * Only exact, current, same-condition USD reference rates can lift that floor.
 * Zero rates may represent free or unsupported dimensions and remain unchanged. */
export function valueRetailMicrousd(model: string, rate: ComparableRetailRate, now = new Date()): number {
  const floor = rate.retailMicrousd;
  if (!Number.isSafeInteger(floor) || floor < 0) throw new RangeError("Invalid retail pricing floor");
  if (floor === 0) return 0;
  const comparison = compareOfficialRate(model, rate, { now });
  const asOf = Date.parse(`${comparison.asOf}T00:00:00Z`);
  const age = now.getTime() - asOf;
  if (!Number.isFinite(age) || age < 0 || age > REFERENCE_MAX_AGE_DAYS * 86_400_000 ||
      comparison.status !== "verified" || !comparison.official || comparison.official.currency !== "USD") return floor;
  const officialMicrousd = Math.round(comparison.official.amount * 1_000_000);
  if (!Number.isSafeInteger(officialMicrousd) || officialMicrousd <= 0) return floor;
  const target = Number((BigInt(officialMicrousd) * BigInt(OFFICIAL_TARGET_PERCENT) + BigInt(99)) / BigInt(100));
  return Math.max(floor, target);
}
