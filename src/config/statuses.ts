// The sets of statuses the queries ask about, written once: a visit's (appointments.status) and a payment's
// (payments.status, in Razorpay's words).

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

const listed = (statuses: readonly string[]): string => statuses.map((status) => `'${status}'`).join(", ");

/** `column IN (…)`, for a set above. */
export const statusIn = (column: string, statuses: readonly string[]): string => `${column} IN (${listed(statuses)})`;

/** `column NOT IN (…)`, for a set above. */
export const statusNotIn = (column: string, statuses: readonly string[]): string =>
  `${column} NOT IN (${listed(statuses)})`;
