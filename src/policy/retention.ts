// How long we keep what serves no purpose any more (DPDP Act 2023, s.8(7)). The owner ruled these on 2 October 2026,
// as recommended, for counsel to confirm (docs/open-points.md, item 149; the 2 Oct audit's decision 10). A client's
// own record is kept until they ask for it to be erased, as the privacy page says; what follows is everyone and
// everything else.

/** A person who never had a visit or a payment, erased once they have done nothing with us for this long. */
export const DORMANT_MONTHS = 12;

/** A waitlist entry, deleted this long after its area launched: by then it has been told, or never will be. */
export const WAITLIST_AFTER_LAUNCH_MONTHS = 12;

/**
 * A check-in's coordinates, blanked this many days after the dispute window of a no-show charge would close. The
 * distance it measured stays: it names no place.
 */
export const CHECKIN_COORDINATES_GRACE_DAYS = 7;

// The audit log is kept two years. Nothing in it is that old yet: its triggers keep every row, and the job that
// deletes the oldest is owed before the first rows reach two years, in September 2028.

/** How many dormant people one run erases at most: each is a batch and a CRM message. */
export const ERASED_PER_RUN = 5;

/** The ISO instant `months` before `now`. */
export const monthsBefore = (now: Date, months: number): string => {
  const then = new Date(now);
  then.setUTCMonth(then.getUTCMonth() - months);
  return then.toISOString();
};
