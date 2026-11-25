// Visits (board C): the list and a visit's page.

export const visits = {
  title: "Visits",
  /** The three views, as a screen reader names their choice, and Issues with how many are open. */
  show: "Show",
  upcoming: "Upcoming",
  past: "Past",
  issues: "Issues",
  none: "Nothing booked yet.",
  noneYet: "No visits yet. After your consultation, every visit shows here with its photos and invoice.",
  /** Visits: a visit paid for ahead, or covered by a credit; a consultation, which costs nothing. */
  paid: "Paid",
  free: "Free",
  /**
   * A visit booked while online payment is off, paid at the visit (ADR 0209), naming no way to pay (ADR 0272): "Pay
   * Rs. 2,200 at the visit".
   */
  payAtVisit: (amount: string) => `Pay ${amount} at the visit`,
  /** A consultation asked for on the site, which ops have yet to confirm. */
  requested: "Requested",
  // A visit that is not this client's, or no longer exists.
  notFound: "We couldn’t find this visit.",
  // Offline, the visits are not kept on the phone.
  offline: "Your visits will load when you’re back online.",
  cancelled: "Cancelled",
  notHome: "Missed visit",
  /** A visit nobody came to, in the history once its day is over, until ops close it. */
  missedByUs: "We couldn’t make it",
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
    gst: "Including GST",
  },
  detail: {
    back: "Back to visits",
    cancelled: "This visit was cancelled.",
    photographs: "Photos from this visit",
    /** Beneath a visit's photos. */
    private: "Only you and your technician see these photos.",
    technician: "Technician",
    duration: "Time taken",
    paid: "Paid",
    receipt: "Receipt",
    /** A fit the client signed off in their app, and when. */
    signedOff: "Signed off",
    signedBy: (when: string) => `By you, ${when}`,
    /** A first fit's guarantee, and the way to claim it while it runs. */
    guarantee: "Fit guarantee",
    guaranteeUntil: (date: string) => `Until ${date}`,
    notRight: "The fit isn’t right",
    /** The client's stars for a visit done, given once (docs/decisions/0260-ratings.md). */
    rating: {
      title: "How was this visit?",
      label: "Rate this visit",
      star: (stars: number) => `${String(stars)} of 5`,
      thanks: "Thanks. We share ratings with the technician.",
      low: "Thanks. Tell us what went wrong and we’ll follow up.",
      report: "Report an issue",
      failed: "That didn’t go through. Try again.",
    },
    done: "What was done",
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
      line: (minutes: number) =>
        `Nobody answered while the technician waited ${String(minutes)} minutes at your door. No work was done.`,
      charge: "Missed-visit charge",
      yourDispute: "Your dispute",
      decision: {
        undecided: "We’re looking at it. Nothing is charged until we have.",
        charged: "Charged",
        waived: "Not charged",
      },
      /** What the charge took, as the booking was sold to cost a no-show. */
      kept: (amount: string) => `We kept ${amount}`,
      creditSpent: "The free service visit it used is spent",
      dispute: "Dispute this charge",
      /** "16 Dec, 12:30 am": the window closes at the charge's own time of day. */
      disputeUntil: (when: string) => `Were you home? You can dispute the charge until ${when}.`,
      /** Where the button stood, once the days to dispute have passed. */
      disputeClosed: (day: string) => `The days to dispute this charge ended on ${day}.`,
      disputed: {
        open: "You disputed this charge. We’re looking at it.",
        refunded: "We looked at your dispute and refunded the charge.",
        upheld: "We looked at your dispute. The charge stands.",
      },
    },
  },
} as const;
