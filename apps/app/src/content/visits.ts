// Visits (board C): the list and a visit's page.

export const visits = {
  title: "Visits",
  upcoming: "Upcoming",
  // Done, missed and cancelled visits alike, so a cancelled one still to come does not read as past.
  past: "History",
  none: "Nothing booked yet.",
  /** Visits: a visit paid for ahead, or covered by a credit. */
  prepaid: "Prepaid",
  /** A consultation asked for on the site, which ops have yet to confirm. */
  requested: "Requested",
  // A visit that is not this client's, or no longer exists.
  notFound: "We couldn’t find this visit.",
  // Offline, the visits are not kept on the phone.
  offline: "Your visits will load when you are back online.",
  cancelled: "Cancelled",
  notHome: "Missed visit",
  partial: "Partly done",
  /*
   * The client's own record, derived from their visits and
   * payments (src/domain/visits/client-history.ts). Home writes
   * one sentence about a replacement, "Your replacement is due in
   * March.", and that sentence is kept word for word.
   *
   * A month and never a day (ADR 0059). Nothing here is shown at all until there is
   * something true to say.
   */
  record: {
    label: "Your record",
    due: (month: string) => `Your replacement is due in ${month}.`,
    /** Past its month, the same fact in the tense it is now true in. */
    overdue: (month: string) => `Your replacement was due in ${month}.`,
    rows: { firstFit: "First fit", services: "Service visits", replacements: "Replacements", spend: "Total paid" },
    /** A client fitted before their visits were recorded has no first fit to name, which is not the same as none. */
    noFirstFit: "Not yet",
    /** Beside the total, so a figure that includes tax is not read as one that does not. */
    gst: "GST included",
  },
  detail: {
    back: "Back to visits",
    cancelled: "This visit was cancelled.",
    photographs: "Photos from this visit",
    technician: "Technician",
    duration: "Duration",
    type: "Type",
    done: "What was done",
    /** The checklist the technician ticked, as one sentence: "Hair system removed, scalp cleaned, cut and styled." */
    doneLine: (items: readonly string[]) =>
      `${items.map((item, index) => (index === 0 ? item : item.charAt(0).toLowerCase() + item.slice(1))).join(", ")}.`,
    /** The things a finished visit can say about its invoice (ADR 0056). */
    invoice: {
      open: "Tax invoice",
      newTab: "PDF, opens in a new tab",
      generating: "Your invoice will be ready within the hour.",
      // Past the hour, with a way to ask for it; a day after the visit, late.
      delayed: "Your invoice is on its way. Message us if you need it today.",
      late: "Your invoice is taking longer than it should. Message us and we’ll send it.",
      message: "Message us",
      // A free visit says "No charge", and never promises a document.
      free: "No charge for this visit, so there is no invoice.",
      // An invoice held back on purpose: a credit visit's, and a draft whose total is not what the visit
      // was sold for, which is checked before it is sent.
      credit: "Covered by a free service visit.",
      checking: "We’re checking this invoice before sending it. Message us if you need it sooner.",
    },
    // A visit the client missed, and the dispute of its charge (ADR 0096). The reason ops gave stays with them.
    noShow: {
      label: "Missed visit",
      line: (minutes: number) => `We came and waited ${String(minutes)} minutes, but no one was home.`,
      decision: {
        undecided: "We are looking at it. Nothing is charged until we have.",
        charged: "Charged.",
        waived: "Not charged.",
      },
      /** What the charge took, as the booking was sold to cost a no-show. */
      kept: (amount: string) => `Charged: we kept ${amount} of what you paid.`,
      creditSpent: "Charged: the free service visit it used is spent.",
      dispute: "Dispute this charge",
      /** Where the button stood, once the days to dispute have passed. */
      disputeClosed: (day: string) => `The days to dispute this charge ended on ${day}.`,
      disputed: {
        open: "You disputed this charge. We are looking at it.",
        refunded: "We looked at your dispute and refunded the charge.",
        upheld: "We looked at your dispute. The charge stands.",
      },
    },
  },
} as const;
