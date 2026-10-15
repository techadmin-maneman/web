// How long we keep what serves no purpose any more (DPDP Act 2023, s.8(7)), for counsel to confirm (open point 149).
// A client's
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

/** The audit log, kept two years; its trigger refuses to let a younger row go (migration 0172). */
export const AUDIT_LOG_MONTHS = 24;

/** A resolved alert, and Razorpay's ID of an event applied, long past any repeat of it. */
export const RESOLVED_ALERT_MONTHS = 12;
export const RAZORPAY_EVENT_MONTHS = 12;

/** The closed chat of a number we never knew, nor any technician's. */
export const STRANGER_CHAT_MONTHS = 12;

/** A message we sent, unless a no-show or a move holds it as its evidence. */
export const SENT_MESSAGE_MONTHS = 24;

/**
 * A client's Care thread, closed and quiet this long, has its messages moved out of D1 into the backups bucket
 * (docs/decisions/0207-closed-chats-archived.md). They are kept there as long as the client is, as the rows were.
 */
export const CHAT_ARCHIVE_MONTHS = 12;

/** How many threads one run archives at most: each is a read of its messages, a file written and one batch. */
export const ARCHIVED_THREADS_PER_RUN = 20;

/** How many rows of each one run deletes at most. */
export const PURGED_PER_RUN = 500;

/** How many dormant people one run erases at most: each is a batch and a CRM message. */
export const ERASED_PER_RUN = 5;

/** The ISO instant `months` before `now`. */
export const monthsBefore = (now: Date, months: number): string => {
  const then = new Date(now);
  then.setUTCMonth(then.getUTCMonth() - months);
  return then.toISOString();
};
