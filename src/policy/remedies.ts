// Remedies Customer Care give a client (docs/decisions/0143-remedies.md): free service visits, with why. Care give up
// to the limit ops set without asking; anything above it waits for a Customer Care manager. Refunds stay with Finance.

export const REMEDY_REASONS = ["fit_problem", "technician_late", "visit_missed", "product_fault", "other"] as const;
export type RemedyReason = (typeof REMEDY_REASONS)[number];

export const REMEDY_LIMIT_KEYS = ["visits", "days"] as const;
/** How many free visits Care give a client without approval, counted over how many days. */
export type RemedyLimit = Readonly<Record<(typeof REMEDY_LIMIT_KEYS)[number], number>>;

/** One free visit for a client in 90 days, unless a manager approves more. */
export const REMEDY_LIMIT: RemedyLimit = { visits: 1, days: 90 };

/** The most free visits one remedy gives. */
export const MOST_REMEDY_VISITS = 6;

/** Whether a remedy of `visits` goes at once: what the client was given in the limit's days, with it, within the limit. */
export const withinLimit = (visits: number, givenLately: number, limit: RemedyLimit = REMEDY_LIMIT): boolean =>
  visits + givenLately <= limit.visits;
