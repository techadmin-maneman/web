// The supplier scorecard's figures (docs/decisions/0172-supplier-scorecard.md), worked out from a year of a
// supplier's orders, receipts and claims: how often an order came on time and in full, how long orders took against
// what was promised, how much arrived damaged or failed its check, and how claims went.

/** How far back the scorecard reads. */
export const SCORECARD_DAYS = 365;

/** One order sent to the supplier, as the scorecard reads it; every day is India's. */
export interface ScoredOrder {
  readonly state: string;
  readonly sentOn: string;
  /** The day it was expected, else the day its longest promised lead time ends; null where neither is known. */
  readonly dueOn: string | null;
  readonly firstReceivedOn: string | null;
  readonly lastReceivedOn: string | null;
  /** Its longest line's promised lead time, in days; null where the supplier no longer lists its items. */
  readonly promisedDays: number | null;
}

export interface ArrivedUnits {
  readonly received: number;
  readonly damaged: number;
  readonly failed: number;
}

export interface ClaimCounts {
  readonly settled: number;
  readonly accepted: number;
  /** What was credited, in the supplier's currency's smallest unit. */
  readonly credited: number;
}

export interface Scorecard {
  readonly orders: number;
  /** Of the orders settled with a known due day, the percent received in full by it; null with none. */
  readonly onTimeInFull: number | null;
  /** The average days from sending an order to its first receipt, and what was promised; null with none. */
  readonly leadDays: number | null;
  readonly promisedDays: number | null;
  /** Of every unit that arrived, the percent that failed its check, and that was damaged; null with none. */
  readonly failedPercent: number | null;
  readonly damagedPercent: number | null;
  readonly claims: ClaimCounts;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from one India date to a later one. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

const average = (values: readonly number[]) =>
  values.length === 0 ? null : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;

const percent = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 100));

export function scorecardOf(orders: readonly ScoredOrder[], arrived: ArrivedUnits, claims: ClaimCounts): Scorecard {
  const settled = orders.filter(
    (order) => (order.state === "received" || order.state === "closed") && order.dueOn !== null,
  );
  const kept = settled.filter(
    (order) =>
      order.state === "received" && order.lastReceivedOn !== null && order.lastReceivedOn <= (order.dueOn ?? ""),
  );
  const waited = orders.flatMap((order) =>
    order.firstReceivedOn === null ? [] : [daysBetween(order.sentOn, order.firstReceivedOn)],
  );
  const promised = orders.flatMap((order) => (order.promisedDays === null ? [] : [order.promisedDays]));
  const units = arrived.received + arrived.damaged + arrived.failed;
  return {
    orders: orders.length,
    onTimeInFull: percent(kept.length, settled.length),
    leadDays: average(waited),
    promisedDays: average(promised),
    failedPercent: percent(arrived.failed, units),
    damagedPercent: percent(arrived.damaged, units),
    claims,
  };
}
