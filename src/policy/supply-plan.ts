// The supply plan's rules (docs/decisions/0180-supply-plan.md): what a city needs over a supplier's lead time and a
// planning period, the safety stock the forecast's spread asks for, what it is short of or can spare, how a short city
// borrows from one with spare before anything is bought, and how an order rounds to the supplier's packs.

/** One period of a city's forecast of a stock code, as the plan reads it. */
export interface PeriodForecast {
  readonly period: number;
  readonly expected: number;
  readonly high: number;
}

/** How many periods the plan must see across: the supplier's lead time, then one period more. */
export function periodsCovering(leadDays: number, periodDays: number): number {
  return Math.ceil((leadDays + periodDays) / periodDays);
}

/**
 * What a city needs of a stock code over its first periods, and the safety stock above it: each period's spread from
 * its expected to its high case, added as spreads add, the square root of their squares.
 */
export function needOver(
  forecast: readonly PeriodForecast[],
  periods: number,
): { readonly need: number; readonly safety: number } {
  const covered = forecast.filter((line) => line.period < periods);
  const need = covered.reduce((sum, line) => sum + line.expected, 0);
  const safety = Math.sqrt(covered.reduce((sum, line) => sum + (line.high - line.expected) ** 2, 0));
  return { need: Math.round(need * 10) / 10, safety: Math.round(safety * 10) / 10 };
}

/** Whole pieces a city is short of: what it needs and its safety stock, less what it can use. */
export const shortOf = (usable: number, need: number, safety: number): number =>
  Math.max(0, Math.ceil(need + safety - usable));

/** Whole pieces a city can spare beyond its need and its safety stock. */
export const spareOf = (usable: number, need: number, safety: number): number =>
  Math.max(0, Math.floor(usable - need - safety));

/** An order's quantity: at least the shortfall and the supplier's minimum, in whole packs. */
export function orderQuantity(short: number, packSize: number, minimum: number): number {
  const wanted = Math.max(short, minimum, 1);
  return Math.ceil(wanted / packSize) * packSize;
}

export interface Loan {
  readonly from: string;
  readonly to: string;
  readonly quantity: number;
}

/**
 * Each short city borrows from those with spare, the city furthest short first, from the city with the most to spare
 * first, before anything is bought. What lending leaves short is the answer's `short`.
 */
export function lend(
  shorts: readonly { readonly city: string; readonly short: number }[],
  spares: readonly { readonly city: string; readonly spare: number }[],
): { readonly loans: Loan[]; readonly short: Map<string, number> } {
  const left = new Map(spares.map((each) => [each.city, each.spare]));
  const short = new Map<string, number>();
  const loans: Loan[] = [];
  for (const { city, short: wanted } of [...shorts].sort((a, b) => b.short - a.short)) {
    let still = wanted;
    const lenders = [...left].filter(([lender, spare]) => lender !== city && spare > 0).sort((a, b) => b[1] - a[1]);
    for (const [lender, spare] of lenders) {
      if (still === 0) break;
      const quantity = Math.min(spare, still);
      loans.push({ from: lender, to: city, quantity });
      left.set(lender, spare - quantity);
      still -= quantity;
    }
    if (still > 0) short.set(city, still);
  }
  return { loans, short };
}

/**
 * How many days `usable` lasts against the forecast, period by period from today, the forecast's periods added across
 * its cities; Infinity where it outlasts the horizon.
 */
export function coverDays(forecast: readonly PeriodForecast[], usable: number, periodDays: number): number {
  const byPeriod = new Map<number, number>();
  for (const line of forecast) byPeriod.set(line.period, (byPeriod.get(line.period) ?? 0) + line.expected);
  let left = usable;
  for (const [period, expected] of [...byPeriod].sort((a, b) => a[0] - b[0])) {
    if (left < expected) return period * periodDays + Math.floor((periodDays * left) / expected);
    left -= expected;
  }
  return Number.POSITIVE_INFINITY;
}

interface Terms {
  readonly unit_price: number;
  readonly lead_time_days: number;
}

/**
 * Whom an order goes to: the supplier who sells it cheapest, unless what the plan can count on runs out before that
 * supplier could deliver; then the one who delivers soonest, the cheaper of any who tie.
 */
export function supplierFor<T extends Terms>(terms: readonly T[], coversDays: number): T | undefined {
  const cheapest = [...terms].sort((a, b) => a.unit_price - b.unit_price)[0];
  if (cheapest === undefined || cheapest.lead_time_days <= coversDays) return cheapest;
  return [...terms].sort((a, b) => a.lead_time_days - b.lead_time_days || a.unit_price - b.unit_price)[0];
}
