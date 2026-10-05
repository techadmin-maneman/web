// Tasks (board D2): every queue ops work through, a payment link's state, and the alerts that need a hand.

import type { LinkState } from "../tasks/payment-link.ts";
import { NOT_PERMITTED } from "./common.ts";
import { DEPARTMENT_NAMES } from "./shell.ts";

/** Where a payment link still owed stands, as the Tasks board says it. */
const PAYMENT_LINK_STATES: Readonly<Record<LinkState, string>> = {
  sent: "link sent",
  unsent: "link not sent yet",
  refused: "Razorpay refused the link: send one from its dashboard",
  closed: "link closed unpaid",
};

/**
 * Board D2's queue. A task is not a record: it is a row in a queue the database
 * already keeps, read when ops look (src/policy/tasks.ts). The board draws four
 * groups, of which two have something behind them; the others here are queues
 * it does not draw (docs/open-points.md, item 61).
 */
export const tasks = {
  title: "Tasks",
  /** The head's count, in oxblood, as the board writes "4 overdue". */
  overdue: (count: number) => `${String(count)} overdue`,
  /** The head's count as a screen reader names it, with what it does. */
  overdueJump: (count: number) => `${String(count)} overdue, go to the first`,
  /** Each department's section, named as the navigation names it. */
  departments: DEPARTMENT_NAMES,
  /** Each group, lettered in small caps as the board letters its own two. */
  groups: {
    // A group the board does not draw (docs/decisions/0069-dispatch-under-concurrency.md).
    untold_move: "Call about a move",
    // Two groups the board does not draw (docs/decisions/0074-hand-offs-and-messages.md).
    leave_conflict: "Job on a day off",
    address_to_confirm: "Address to confirm",
    consultation_request: "Consultation request",
    // A group the board does not draw (docs/decisions/0086-the-next-visit-is-offered.md).
    first_fit_to_book: "First fit to book",
    replacement_order: "Replacement order",
    at_risk_client: "At-risk client",
    // A group the board does not draw (docs/decisions/0074-hand-offs-and-messages.md).
    partial_visit: "Visit left partly done",
    referral_review: "Referral review",
    no_show_decision: "No-show decision",
    // A group the board does not draw; board D1 letters the card "Disputed charge".
    no_show_dispute: "Disputed charge",
    number_change: "Number change",
    erasure_request: "Deletion request",
    // A group the board does not draw (docs/decisions/0072-ops-clients-and-queues.md).
    grievance: "Concern",
    // Two groups the board does not draw (docs/decisions/0067-alerts-and-silent-failures.md).
    draft_invoice: "Draft invoice",
    // A group the board does not draw (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
    payment_owed: "Payment owed",
    // A group the board does not draw: money owed back that no refund has reached.
    payment_to_refund: "Payment to refund",
  } as Readonly<Record<string, string>>,
  /** The first line of a no-show whose client has since been erased: the visit, which is all that is left. */
  visit: (date: string) => `Visit of ${date}`,
  /** A disputed charge whose client has since been erased. */
  disputeErased: "A client since erased",
  /** A queue whose row has lost the client it was about. */
  unknown: "Client unknown",
  /** The client's page, which the board draws no way to. */
  open: (name: string) => `Open ${name}`,
  /**
   * The section each task is decided in, and a way to its row
   * there. The board draws no way of acting on a task; the section itself
   * decides nothing.
   */
  decide: {
    untold_move: "Open it in Dispatch",
    leave_conflict: "Move it in Dispatch",
    referral_review: "Decide it in Referrals",
    no_show_decision: "Rule on it in Payments",
    no_show_dispute: "Rule on it in Payments",
    number_change: "Decide it in Number changes",
    erasure_request: "Decide it in Deletion requests",
    grievance: "Answer it in Concerns",
  } as Readonly<Record<string, string>>,
  /** A group longer than the board lists: its count is all of them. */
  shown: (shown: number, count: number) => `The ${String(shown)} longest waits of ${String(count)}.`,
  /** A group shows its five longest waits until ops ask for the rest. */
  more: (count: number) => `Show ${String(count)} more`,
  fewer: "Show fewer",
  /** What a consultation asked for, a first fit to book and a replacement due are done with. */
  book: "Book a visit",
  /** A move the client has not heard of, settled from its row. */
  call: {
    call: (mobile: string) => `Call ${mobile}`,
    told: "Told by phone",
    recording: "Recording…",
    failed: "That was not recorded. Try again.",
  },
  /** More were waiting than one look reads. */
  truncated: "More are waiting than this page shows, so its counts may be low.",
  /** The second line, one per group: the one fact the group turns on. */
  subs: {
    /**
     * "Moved to Wed 23 Sep, 9 am; has not agreed to WhatsApp": ops call, then say so on the row. A
     * reason the API does not name says only that the client was not told.
     */
    untold_move: {
      no_consent: (when: string) => `Moved to ${when}; has not agreed to WhatsApp`,
      not_sent: (when: string) => `Moved to ${when}; the WhatsApp did not go`,
      unknown: (when: string) => `Moved to ${when}; not told yet`,
    },
    /** "Wed 23 Sep, 10:30 am, and Sameer is away": move it on the dispatch board, or take the leave back. */
    leave_conflict: (when: string, technician: string) => `${when}, and ${technician} is away`,
    /**
     * "Visit Tue 22 Sep, 10 am; no address yet". The client saves one in the app, whose Home asks for it,
     * or gives it to ops on the phone, who record it on their page; the task goes when either does (ADR 0092).
     */
    address_to_confirm: (when: string) => `Visit ${when}; no address yet`,
    /** "Asked for 23 Sep 2026, morning": the day nobody could book for them, self-serve booking being off. */
    consultation_request: (day: string, when: string) => `Asked for ${day}, ${when}`,
    /**
     * "+ consultation and fit in one visit", after the day and window asked for: book it from the row,
     * paid for once the client is fitted (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
     */
    withOneVisit: "+ consultation and fit in one visit",
    /**
     * ", code WEDDNG25", after the one visit: the discount code the client gave on the form, which the
     * booking from the row starts with (docs/decisions/0108-discount-codes.md).
     */
    withCode: (code: string) => `, code ${code}`,
    /**
     * "+ first fit, afternoon", after the consultation asked for: the site's form asked for the fit
     * too, which the client books and pays for in the app once the consultation is done (ADR 0086).
     */
    withFirstFit: (when: string | null) => (when === null ? "+ first fit" : `+ first fit, ${when.toLowerCase()}`),
    /**
     * "Consultation Thu 10 Sep, morning · not fitted". The window is the consultation's, which the fit
     * is booked in from the row; none where a fit cannot start in it. The task goes when the client books.
     */
    first_fit_to_book: (consulted: string, when: string | null) =>
      when === null
        ? `Consultation ${consulted} · not fitted`
        : `Consultation ${consulted}, ${when.toLowerCase()} · not fitted`,
    /**
     * "9 weeks since the last visit · due Sat 19 Sep", as board D2 writes "9 weeks since service": the day the next
     * service fell due, from the cadence ops set. The task goes when the client books.
     */
    at_risk_client: (weeks: number, due: string) =>
      `${String(weeks)} ${weeks === 1 ? "week" : "weeks"} since the last visit · due ${due}`,
    /** "MM-STD-4417-C · due 1 Mar 2028". The board writes the supplier's lead time too; nothing records one. */
    replacement_order: (piece: string, due: string) => `${piece} · due ${due}`,
    /**
     * "The piece was not ready · 20 Sep": book the visit that finishes it. The reason is in the
     * words the job sheet gives it, which ops set in Settings (docs/decisions/0087-consumables-and-stock.md).
     */
    partial_visit: (reason: string, date: string) => `${reason} · ${date}`,
    /** A visit closed partial with no reason from the technician. */
    noReason: "No reason recorded",
    no_show_decision: (technician: string) => `${technician} attended`,
    /** "Disputes the charge that kept Rs. 2,000", or the free service visit it spent. */
    no_show_dispute: (took: string) => `Disputes the charge that kept ${took}`,
    disputedCredit: "a free service visit",
    number_change: "Both numbers proven by code",
    erasure_request: "Asked for in the client's own app",
    // A concern about their data, which the app promises an answer to within 30 days.
    grievance: "Raised in the client's own app",
    // The client cannot open the invoice until somebody sends it in Books.
    draft_invoice: (visit: string) => `Visit of ${visit}, still a draft in Books`,
    /**
     * "Mane Man Natural, Rs. 45,000; link sent": a one visit's client was fitted and has not paid. A
     * link not sent yet is asked of Razorpay again by the cron; one Razorpay refused, or closed unpaid, is sent again
     * from the row or from Razorpay's dashboard (ADR 0105).
     */
    payment_owed: (product: string, amount: string, link: LinkState) =>
      `${product}, ${amount}; ${PAYMENT_LINK_STATES[link]}`,
    /** "Rs. 2,000 owed back on pay_Q1x; Razorpay refused the refund": refunded from Razorpay's dashboard. */
    payment_to_refund: (amount: string, payment: string, why: string) =>
      `${amount} owed back on ${payment}; ${why === "refund_failed" ? "Razorpay failed the refund" : "Razorpay would not refund it"}`,
    // A held grant whose fraud signals were not recorded.
    unknown: "Held for review",
  },
  /**
   * Whose each task is (docs/decisions/0092-task-owners.md). The board writes each owner in ops by their first name,
   * "Priya", in its own column; our words: it draws no way to take a task, give it to someone or hand it back.
   */
  owner: {
    /** For a screen reader, before the column's name: "Owner: Priya". */
    label: "Owner: ",
    nobody: "nobody yet",
    take: "Take it",
    handBack: "Hand it back",
    give: "Assign…",
    giveTo: "Assign to",
    /** The choice in the list that hands someone else's task back. */
    giveNobody: "Nobody",
    you: (email: string) => `${email} (you)`,
    save: "Assign",
    saving: "Saving…",
    cancel: "Cancel",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Someone has dealt with this task already. Reload to see the list as it stands.",
      invalid_request: "Nobody has used the console lately with that e-mail, so the task cannot be theirs.",
      unknown: "That did not save. Try again.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * A visit left partly done closed without a follow-up, with why, as the owner ruled
   * (docs/decisions/0092-task-owners.md). No board draws it.
   */
  close: {
    open: "Close without a follow-up",
    label: "Why no visit is booked to finish it",
    hint: "Required. Kept with the visit, under your name, and shown on the client's page.",
    confirm: "Close it",
    closing: "Closing…",
    cancel: "Cancel",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "This task has left the list meanwhile: a visit was booked, or it was closed. Reload the page.",
      invalid_request: "Say why no visit is booked, in a sentence or two.",
      unknown: "That did not close. Try again.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * A one visit's payment link, copied to send by hand, or texted to the client again by Razorpay. No
   * board draws it.
   */
  link: {
    copy: "Copy link",
    copied: "Link copied",
    resend: "Send again",
    sending: "Sending…",
    outcomes: {
      resent: "Texted to them again.",
      sent: "Razorpay made the link and texted it to them.",
      not_texted: "Not texted: this number is a test record that messages never reach.",
      paid: "Already paid. The task leaves when the list is read again.",
      refused: "Razorpay refused this link. Send one from Razorpay's dashboard.",
    } as Readonly<Record<string, string>>,
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "This link has gone meanwhile. Reload the page to see the list now.",
      unavailable: "Razorpay did not answer. Try again in a minute.",
      unknown: "That did not send. Try again.",
    } as Readonly<Record<string, string>>,
  },
  /** The board draws no note, and the list has to say where the work is done. */
  note:
    "A task leaves this list when the thing itself is decided, where it is decided. A visit left partly done may " +
    "also be closed here, with why.",
  /** The board draws twelve tasks and no empty list. */
  empty: "Nothing is waiting.",
} as const;

/**
 * No board draws it. Tasks' "Needs a hand": the alerts ops were told of in the alert space, each until
 * somebody puts right what it was about. A few words name each kind; its message says what happened and what to do.
 */
export const needsAHand = {
  title: "Needs a hand",
  kinds: {
    message_failed: "A WhatsApp message did not go",
    messages_unsent: "WhatsApp messages not sent within a day",
    crm_lead: "A lead did not reach the CRM",
    crm_erasure: "An erasure did not finish in the CRM",
    crm_contact_update: "A CRM lead was not updated",
    contact_sync: "A contact change did not go through",
    deletion_waiting: "A deletion request is nearly due",
    books_erasure: "An erasure did not finish in Books",
    cancel_refund_failed: "A refund failed",
    no_show_refund_failed: "A refund failed",
    no_show_credit_not_back: "A visit credit did not come back",
    payment_link: "A payment link was refused",
    payment_link_failed: "A payment link did not go",
    invoice_draft: "An invoice is still a draft",
    invoice_unpriced: "A visit has no price to invoice",
    invoice_refused: "Books refused an invoice",
    invoice_failed: "An invoice did not reach Books",
    books_unapplied: "A payment has nothing to set against",
    razorpay_refund_unheard: "A refund came before its payment",
    low_stock: "Stock is low",
    technician_code_refused: "A technician was refused a login code",
    whatsapp_bridge: "WhatsApp is disconnected",
    login_codes_failing: "Login codes are failing",
    cron_job: "A scheduled job keeps failing",
  } as Readonly<Record<string, string>>,
  /** Books refusing or failing on a customer, a payment, its application or a refund. */
  books: "Books needs a look",
  /** Any other kind. */
  other: "Something needs a look",
  /** "3 times since 21 Sep", or "Since 21 Sep" for one. */
  seen: (times: number, since: string) => (times === 1 ? `Since ${since}` : `${String(times)} times since ${since}`),
  open: "Open",
  sendAgain: "Send again",
  sending: "Sending…",
  done: "Mark done",
  closing: "Closing…",
  /** Under a failed message: the bridge may not have answered in time, and the client may have it already. */
  messageHint: "If it says delivery unconfirmed, check with the client first: it may have arrived.",
  shown: (shown: number, count: number) => `The ${String(shown)} longest open of ${String(count)}.`,
  errors: {
    not_permitted: NOT_PERMITTED,
    not_found: "This was closed meanwhile. Reload the page to see the list now.",
    unknown: "That did not go through. Try again.",
  } as Readonly<Record<string, string>>,
} as const;
