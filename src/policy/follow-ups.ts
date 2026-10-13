// What follows a visit on WhatsApp (src/domain/visits/follow-ups.ts): the check-ins after a fit or a replacement, on
// the days ops set in Settings.

export const CHECK_IN_KEYS = ["first", "second"] as const;
/** How many days after a fit or a replacement the client is asked how it is: first, and second. */
export type CheckInDays = Readonly<Record<(typeof CHECK_IN_KEYS)[number], number>>;

export const CHECK_IN_DAYS: CheckInDays = { first: 2, second: 21 };

/** The first check-in comes before the second. */
export const checkInConflicts = (days: CheckInDays): (readonly [string, string])[] =>
  days.first >= days.second ? [["first", "second"]] : [];

/** How long after a consultation or a fit its follow-up goes, so it reaches the client once they are home. */
export const FOLLOW_UP_AFTER_HOURS = 3;
