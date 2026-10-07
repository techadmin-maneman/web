// No-shows: the case, the charge, its ruling and a client's dispute.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

/**
 * The design's Payments: the day's money over "No-shows and late
 * cancellations", a disputed charge ruled on with Refund or Uphold, and the
 * no-show cases to rule on.
 */
export const noShows = {
  title: "Payments",
  /**
   * The first card: the day's money, over the charges it was kept on.
   * The card carries no heading on the board and names no day, so both are
   * placeholders. Every figure is read from the payments and the charges
   * themselves (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
   */
  money: {
    /** The card's heading, which names its day: "Today, Wed 22 Sep", or "Mon 20 Sep". */
    title: (day: string, today: boolean) => (today ? `Today, ${day}` : day),
    /** The field that shows another day's money. */
    pick: "Day",
    /** The board's own three, in its order and its words; "today" only on today's card. */
    figures: {
      collected: (today: boolean) => (today ? "Collected today" : "Collected"),
      processing: "Refunds processing",
      charged: "Charges and no-shows",
    },
    /** Under "Refunds processing", which counts what has not gone back yet. */
    refunded: (amount: string, today: boolean) => `${amount} refunded ${today ? "today" : "that day"}`,
    charges: {
      /** The board's own heading over the list. */
      title: "No-shows and late cancellations",
      /** The board's line: the client, then what it was. */
      noShow: (name: string) => `${name} · no-show`,
      cancelled: (name: string) => `${name} · cancelled late`,
      moved: (name: string) => `${name} · moved late`,
      /** The board's evidence beneath a late cancellation: "Cancelled 9:14 am · visit was 10 am". */
      changed: (at: string, was: string) => `Cancelled ${at} · visit was ${was}`,
      /**
       * A charged no-show's evidence. The board writes the three facts here; they
       * stand on the queue beneath, which is where a case is ruled on
       * (docs/fidelity-method.md).
       */
      attended: (technician: string, was: string) => `${technician} attended · visit was ${was}`,
      /** A no-show whose case has lost the technician who attended. */
      unattended: (was: string) => `No one home · visit was ${was}`,
      /** A charge on a visit that carries no start time. */
      undated: "time unknown",
      /** A charge on a visit with no client of ours. */
      unknown: "Client unknown",
      /**
       * Words where the amount stands on a no-show charged before a
       * charge recorded what it kept, so the line cannot be read as a nought
       * (ADR 0036, PR #89).
       */
      noAmount: "Amount not recorded",
      /** The board draws two charges and no empty day. */
      empty: (today: boolean) => (today ? "No charges today." : "No charges that day."),
    },
  },
  queue: {
    /**
     * The board heads the list "No-shows and late cancellations".
     * Nothing lists a late cancellation, and what is here is a queue, as board
     * C1's "Held for review" is.
     */
    title: "No-shows to decide",
    /** The visit the case belongs to: "Visit of Sat 19 Sep". */
    visit: (date: string) => `Visit of ${date}`,
    /** A case whose appointment carries no date. */
    undated: "Visit, date unknown",
    /** The client of an erased record, who has no name left to show. */
    erased: "Client erased",
    attended: (technician: string) => `${technician} attended`,
    /**
     * The board's four rows, in its own words, and two it does not letter: the
     * window the visit was booked for, and when the check-in reached us. A phone's
     * clock is the technician's to set, so ops rule on both clocks
     * (docs/decisions/0065-a-technicians-writes-reach-fsm.md).
     */
    facts: {
      booked: "Booked",
      checkIn: "Check-in",
      // Shown only when the phone gave a time the bounds would not take.
      claimed: "Phone time",
      received: "Reached us",
      distance: "Distance",
      whatsapp: "WhatsApp",
      waited: "Waited",
    },
    /** "Sat 19 Sep, 9 am to 12 pm". */
    booked: (date: string, from: string, to: string) => `${date}, ${from} to ${to}`,
    /** "2:08 pm · 5 h 8 m after the booked start", or before it, or at it. */
    checkIn: (time: string, offset: string) => `${time} · ${offset}`,
    after: (span: string) => `${span} after the booked start`,
    before: (span: string) => `${span} before the booked start`,
    onTime: "at the booked start",
    /** "5 h 8 m", "48 m", "1 h", as the Technicians page writes a length. */
    span: (hours: number, minutes: number) => {
      if (hours === 0) return `${String(minutes)} m`;
      return minutes === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(minutes)} m`;
    },
    /**
     * The board writes "240 m · over 200 m fence", against the radius in force
     * when they checked in; a distance inside it is ours.
     */
    distance: (metres: number, radius: number) =>
      metres > radius
        ? `${String(metres)} m · over ${String(radius)} m fence`
        : `${String(metres)} m · inside ${String(radius)} m fence`,
    /**
     * An address with no coordinates cannot be measured against, so the route
     * carries no distance (ADR 0036). Words rather than a number, because ops
     * charge a client on these facts and nothing was measured here at all.
     */
    unmeasured: "Not measured · address has no location",
    /** Ops let them check in past the fence for this visit, from the dispatch board, with their reason. */
    letIn: (reason: string | null) =>
      reason === null ? "check-in allowed by ops" : `check-in allowed by ops: ${reason}`,
    /**
     * What became of the reminder, dated, since it goes the evening before. A
     * reminder never sent is not one sent and never delivered.
     */
    message: {
      delivered: (when: string) => `Delivered ${when}`,
      // The board's receipt always arrived; the other four are ours.
      sent: "Sent, not delivered",
      no_consent: "Not sent · client hasn't opted in to WhatsApp",
      not_sent: "Not sent",
      none: "No reminder sent",
    },
    /** "Fri 18 Sep, 6:03 pm". */
    dated: (date: string, time: string) => `${date}, ${time}`,
    /**
     * The board's "15 min · closed 11:47", counted from the check-in to the
     * close, not the wait the rules asked for. When the check-in reached us
     * late, how long it had been with us is said as well.
     */
    waited: (minutes: number, closed: string) => `${String(minutes)} min · closed ${closed}`,
    waitedBoth: (minutes: number, withUs: number, closed: string) =>
      `${String(minutes)} min by phone, ${String(withUs)} after it reached us · closed ${closed}`,
    notClosed: "Not closed",
    // The board draws no case closed before the booked start's wait had run.
    closedEarly: "Closed before the wait ended. Waive it, or explain in your note.",
    /**
     * The field beneath the evidence, "Your note · required", which the
     * board draws on the dispute. A ruling needs its reason either way, and the
     * server refuses one without it (src/policy/decision-reasons.ts).
     */
    reason: {
      label: "Your note · required",
      placeholder: "Why you're charging or waiving",
    },
    /**
     * The board's buttons are Refund and Uphold, which rule on a
     * dispute, on its own card above the queue. A case is charged or waived.
     */
    charge: "Charge",
    waive: "Waive",
    /**
     * A charge is asked about once more, with what it keeps of what was paid and what it refunds, since it
     * cannot be taken back here.
     */
    confirm: {
      keepsAll: (paid: string) => `Keep ${paid} of the ${paid} paid?`,
      keepsPart: (kept: string, paid: string, refund: string) =>
        `Keep ${kept} of the ${paid} paid, and refund ${refund}?`,
      keepsNone: (paid: string) => `Keep nothing, and refund the ${paid} paid?`,
      keepsCredit: "Keep the free service visit it was booked with?",
      nothingPaid: "Nothing was paid. Record the charge?",
      creditToo: "The free service visit is kept too.",
      who: (name: string, day: string) => `Charging ${name} for the visit of ${day} can't be undone.`,
      working: "Calculating.",
      failed: "Couldn't calculate the charge. Try again.",
    },
    // A visit that carries no date, as a charge asked about names it.
    noDay: "an unrecorded day",
    confirmCharge: "Confirm charge",
    back: "Back",
    deciding: "Saving",
    /** The board draws no empty queue. */
    empty: "No no-shows to decide.",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Already decided. Reload.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  /** The board draws no list of the day's rulings. Each case ruled on today, the latest first. */
  decided: {
    title: "Decided today",
    charged: (kept: string) => `Charged · kept ${kept}`,
    chargedCredit: "Charged · kept a free service visit",
    chargedNothing: "Charged · kept nothing",
    // A charge ruled before charges recorded what they kept.
    chargedUnrecorded: "Charged",
    waived: "Waived",
    at: (ruling: string, time: string) => `${ruling} · ${time}`,
    empty: "Nothing decided today.",
  },
  /**
   * The second card, a disputed charge, one card a dispute. The design
   * draws its label, its four rows of evidence, its note and its two buttons; the
   * rest is placeholder (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
   */
  dispute: {
    /** The board's own label. */
    label: "Disputed charge",
    /**
     * The board heads the card "Vikram Sethi says he was home", its
     * summary of the client's words. Their words stand beneath, as they wrote them.
     */
    title: "disputes the charge",
    erased: "An erased client disputes the charge",
    /** The client's words, erased with them. */
    wordsErased: "Erased with the client.",
    /** What the charge took, and when the visit was. */
    took: (what: string, day: string) => `Kept ${what} for the visit of ${day}.`,
    credit: "a free service visit",
    /** The board's four rows. */
    facts: { checkIn: "Check-in", distance: "Distance", whatsapp: "WhatsApp", waited: "Waited" },
    /** Beside a check-in time the bounds moved: "10:33 · phone time adjusted (phone said 9:18)". */
    adjusted: (time: string, said: string) => `${time} · phone time adjusted (phone said ${said})`,
    /** The board's note, "Your note · required", and its placeholder. */
    reason: {
      label: "Your note · required",
      placeholder: "Why you're refunding or upholding",
    },
    refund: "Refund",
    uphold: "Uphold",
    ruling: "Ruling",
    /** The board draws one card, with no panel around it. A panel needs a name to be read by. */
    queueTitle: "Disputed charges",
    /** The board always draws one. */
    none: "No disputed charges.",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Already ruled on. Reload.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
} as const;
