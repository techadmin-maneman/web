// The sets of statuses the queries ask about, written once: a visit's (appointments.status), a payment's
// (payments.status, in Razorpay's words) and a refund's. No query spells a list of them again
// (test/node/architecture/status-lists.test.ts).

/** A visit still to happen. */
export const VISIT_LIVE = ["scheduled", "dispatched", "in_progress"] as const;
/** A visit its technician has not begun. */
export const VISIT_NOT_BEGUN = ["scheduled", "dispatched"] as const;
/** A visit called off: cancelled, or ended before it was done. */
export const VISIT_CALLED_OFF = ["cancelled", "terminated"] as const;

/** A payment whose money we still hold, all of it or part. */
export const PAYMENT_HELD = ["captured", "partially_refunded"] as const;
/** A payment taken, whether or not it has been given back since. */
export const PAYMENT_TAKEN = ["captured", "partially_refunded", "refunded"] as const;
/** A payment given back, all of it or part. */
export const PAYMENT_REFUNDED = ["partially_refunded", "refunded"] as const;

/** A visit that happened: done, or ended before it was. */
export const VISIT_ENDED = ["completed", "terminated"] as const;
/**
 * What a day on the dispatch board holds: its live jobs, and those done or ended before they were, so a past day reads
 * as it was worked and a no-show stays where it happened.
 */
export const VISIT_ON_THE_BOARD = [...VISIT_LIVE, ...VISIT_ENDED] as const;

/** A refund asked of Razorpay that has not failed: waiting, or made (refunds.status). */
export const REFUND_NOT_FAILED = ["created", "processed"] as const;

const listed = (statuses: readonly string[]): string => statuses.map((status) => `'${status}'`).join(", ");

/** `column IN (…)`, for a set above. */
export const statusIn = (column: string, statuses: readonly string[]): string => `${column} IN (${listed(statuses)})`;

/** `column NOT IN (…)`, for a set above. */
export const statusNotIn = (column: string, statuses: readonly string[]): string =>
  `${column} NOT IN (${listed(statuses)})`;

/** A visit `alias` booked ahead: not begun, not deleted, and starting from `?1` and before `?2`. */
export const bookedAhead = (alias: string): string =>
  `${alias}.window_start >= ?1 AND ${alias}.window_start < ?2 AND ${statusIn(`${alias}.status`, VISIT_NOT_BEGUN)}
    AND ${alias}.deleted_at IS NULL`;
