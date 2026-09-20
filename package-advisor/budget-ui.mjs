// Scale budgets use a logarithmic reference range; the final segment is open discussion.
export const SCALE_MIN = 150000;
export const SCALE_REFERENCE_MAX = 10000000;
export const SCALE_FINITE_POSITION = 1000;
export const SCALE_DISCUSS_POSITION = 1100;
export const MAX_SAFE_BUDGET = Number.MAX_SAFE_INTEGER;

export function budgetToPosition(value) {
  if (value === null) return SCALE_DISCUSS_POSITION;
  return Math.max(0, Math.min(SCALE_FINITE_POSITION, Math.log(value / SCALE_MIN) / Math.log(SCALE_REFERENCE_MAX / SCALE_MIN) * SCALE_FINITE_POSITION));
}

export function positionToBudget(position) {
  if (Number(position) > SCALE_FINITE_POSITION) return null;
  return Math.round((SCALE_MIN * (SCALE_REFERENCE_MAX / SCALE_MIN) ** (Math.max(0, Number(position)) / SCALE_FINITE_POSITION)) / 1000) * 1000;
}
