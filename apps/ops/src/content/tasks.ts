// Tasks: every queue ops work through, a payment link's state, and the alerts that need a hand.

import type { components } from "../api-schema.ts";
import type { LinkState } from "../tasks/payment-link.ts";
import { FAILED, NOT_PERMITTED } from "./common.ts";
import { DEPARTMENT_NAMES } from "./shell.ts";

/** A task group as the API names it, from the generated schema, which the Worker-typed tests can read too. */
type Group = components["schemas"]["Tasks"]["groups"][number]["group"];

/** Where a payment link still owed stands, as the Tasks board says it. */
const PAYMENT_LINK_STATES: Readonly<Record<LinkState, string>> = {
  sent: "link sent",
  unsent: "link not sent",
  refused: "link refused by Razorpay",
  closed: "link closed unpaid",
};

/**
 * The section each task is decided in, and a way to its row
 * there. The board draws no way of acting on a task; the section itself
 * decides nothing.
 */
const DECIDE: Readonly<Partial<Record<Group, string>>> = {
  untold_move: "Open in Dispatch",
  leave_conflict: "Move in Dispatch",
  referral_review: "Decide in Referrals",
  no_show_decision: "Decide in Payments",
  no_show_dispute: "Decide in Payments",
  number_change: "Decide in Number changes",
  erasure_request: "Decide in Deletion requests",
  grievance: "Answer in Concerns",
};

/**
 * The Tasks queue. A task is not a record: it is a row in a queue the database
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
    partial_visit: "Partly done visit",
    referral_review: "Referral review",
    no_show_decision: "No-show decision",
    // A group the Tasks design does not draw; the Payments design letters the card "Disputed charge".
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
  } satisfies Readonly<Record<Group, string>>,
  /** The first line of a no-show whose client has since been erased: the visit, which is all that is left. */
  visit: (date: string) => `Visit of ${date}`,
  /** A disputed charge whose client has since been erased. */
  disputeErased: "Erased client",
  /** A queue whose row has lost the client it was about. */
  unknown: "Client unknown",
  /** The client's page, which the board draws no way to. */
  open: (name: string) => `Open ${name}`,
  decide: DECIDE,
  /** A group longer than the board lists: its count is all of them. */
  shown: (shown: number, count: number) => `Longest ${String(shown)} of ${String(count)}.`,
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
    failed: FAILED,
  },
  /** More were waiting than one look reads. */
  truncated: "Counts may be incomplete.",
  /** The second line, one per group: the one fact the group turns on. */
  subs: {
    /**
     * "Moved to Wed 23 Sep, 9 am; has not agreed to WhatsApp": ops call, then say so on the row. A
     * reason the API does not name says only that the client was not told.
     */
    untold_move: {
      no_consent: (when: string) => `Moved to ${when} · not opted in to WhatsApp`,
      not_sent: (when: string) => `Moved to ${when} · WhatsApp failed`,
      unknown: (when: string) => `Moved to ${when} · not told`,
    },
    /** "Wed 23 Sep, 10:30 am, and Sameer is away": move it on the dispatch board, or take the leave back. */
    leave_conflict: (when: string, technician: string) => `${when} · ${technician} is away`,
    /**
     * "Visit Tue 22 Sep, 10 am; no address yet". The client saves one in the app, whose Home asks for it,
     * or gives it to ops on the phone, who record it on their page; the task goes when either does (ADR 0092).
     */
    address_to_confirm: (when: string) => `Visit ${when} · no address`,
    /** "Asked for 23 Sep 2026, morning": the day nobody could book for them, self-serve booking being off. */
    consultation_request: (day: string, when: string) => `Asked for ${day}, ${when}`,
    /**
     * "+ consultation and fit in one visit", after the day and window asked for: book it from the row,
     * paid for once the client is fitted (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
     */
    withOneVisit: "+ consultation and fit together",
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
     * "9 weeks since the last visit · due Sat 19 Sep", as the Tasks design writes "9 weeks since service": the day the next
     * service fell due, from the cadence ops set. The task goes when the client books.
     */
    at_risk_client: (weeks: number, due: string) =>
      `${String(weeks)} ${weeks === 1 ? "week" : "weeks"} since last visit · due ${due}`,
    /**
     * "MM-ESS-4417-C · order by 1 Feb 2028, replace by 1 Mar 2028": the task falls due, and counts overdue, from the
     * day the order must go in, the supplier's lead time before the piece is due.
     */
    replacement_order: (piece: string, orderBy: string, due: string) =>
      `${piece} · order by ${orderBy}, replace by ${due}`,
    /**
     * "The piece was not ready · 20 Sep": book the visit that finishes it. The reason is in the
     * words the job sheet gives it, which ops set in Settings (docs/decisions/0087-consumables-and-stock.md).
     */
    partial_visit: (reason: string, date: string) => `${reason} · ${date}`,
    /** A visit closed partial with no reason from the technician. */
    noReason: "No reason given",
    no_show_decision: (technician: string) => `${technician} attended`,
    /** "Disputes the charge that kept Rs. 2,000", or the free service visit it spent. */
    no_show_dispute: (took: string) => `Disputes a charge: ${took}`,
    disputedCredit: "a free service visit",
    number_change: "Both numbers verified",
    erasure_request: "Requested in the app",
    // A concern about their data, which the app promises an answer to within 30 days.
    grievance: "Raised in the app",
    // The client cannot open the invoice until somebody sends it in Books.
    draft_invoice: (visit: string) => `Visit of ${visit} · draft in Books`,
    /**
     * "Mane Man Natural, Rs. 45,000; link sent": a one visit's client was fitted and has not paid. A
     * link not sent yet is asked of Razorpay again by the cron; one Razorpay refused, or closed unpaid, is sent again
     * from the row or from Razorpay's dashboard (ADR 0105).
     */
    payment_owed: (product: string, amount: string, link: LinkState) =>
      `${product}, ${amount} · ${PAYMENT_LINK_STATES[link]}`,
    /** "Rs. 2,000 owed back on pay_Q1x; Razorpay refused the refund": refunded from Razorpay's dashboard. */
    payment_to_refund: (amount: string, payment: string, why: string) =>
      `${amount} to refund on ${payment} · ${why === "refund_failed" ? "refund failed" : "refund refused"}`,
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
    nobody: "unassigned",
    take: "Take",
    handBack: "Hand back",
    give: "Assign…",
    giveTo: "Assign to",
    /** The choice in the list that hands someone else's task back. */
    giveNobody: "No one",
    you: (email: string) => `${email} (you)`,
    save: "Assign",
    saving: "Saving…",
    cancel: "Cancel",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Already handled. Reload.",
      invalid_request: "That person hasn't used the console recently.",
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  /**
   * A visit left partly done closed without a follow-up, with why
   * (docs/decisions/0092-task-owners.md).
   */
  close: {
    open: "Close without follow-up",
    label: "Why no follow-up is needed",
    confirm: "Close task",
    closing: "Closing…",
    cancel: "Cancel",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Already booked or closed. Reload.",
      invalid_request: "Give a reason.",
      unknown: FAILED,
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
      resent: "Sent again.",
      sent: "Link created and sent.",
      not_texted: "Not sent: this is a test number.",
      paid: "Already paid.",
      refused: "Razorpay refused this link. Send one from the Razorpay dashboard.",
    } as Readonly<Record<string, string>>,
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "That link no longer exists. Reload.",
      unavailable: "Razorpay isn't responding. Try again in a minute.",
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  /** The board draws twelve tasks and no empty list. */
  empty: "All clear.",
} as const;

/**
 * No board draws it. Tasks' "Needs a hand": the alerts ops were told of in the alert space, each until
 * somebody puts right what it was about. A few words name each kind; its message says what happened and what to do.
 */
export const needsAHand = {
  title: "Needs a hand",
  kinds: {
    message_failed: "WhatsApp message failed",
    messages_unsent: "WhatsApp messages stuck for a day",
    crm_lead: "Lead didn't reach the CRM",
    crm_erasure: "CRM erasure incomplete",
    crm_contact_update: "CRM lead not updated",
    contact_sync: "Contact change failed",
    deletion_waiting: "Deletion request nearly due",
    books_erasure: "Books erasure incomplete",
    crm_contact_erasure: "CRM contact erasure incomplete",
    cancel_refund_failed: "Refund failed",
    no_show_refund_failed: "Refund failed",
    no_show_credit_not_back: "Visit credit not returned",
    payment_link: "Payment link refused",
    payment_link_failed: "Payment link failed",
    invoice_draft: "Invoice still a draft",
    invoice_unpriced: "Visit has no price to invoice",
    invoice_refused: "Books refused an invoice",
    invoice_failed: "Invoice didn't reach Books",
    books_unapplied: "Payment has nothing to apply to",
    razorpay_refund_unheard: "Refund arrived before its payment",
    low_stock: "Stock low",
    technician_code_refused: "Technician login code refused",
    whatsapp_bridge: "WhatsApp disconnected",
    login_codes_failing: "Login codes failing",
    cron_job: "Scheduled job failing",
  } as Readonly<Record<string, string>>,
  /** Books refusing or failing on a customer, a payment, its application or a refund. */
  books: "Books needs attention",
  /** Any other kind. */
  other: "Needs attention",
  /** "3 times since 21 Sep", or "Since 21 Sep" for one. */
  seen: (times: number, since: string) => (times === 1 ? `Since ${since}` : `${String(times)} times since ${since}`),
  open: "Open",
  sendAgain: "Send again",
  sending: "Sending…",
  done: "Mark done",
  closing: "Closing…",
  shown: (shown: number, count: number) => `Oldest ${String(shown)} of ${String(count)}.`,
  errors: {
    not_permitted: NOT_PERMITTED,
    not_found: "Already closed. Reload.",
    unknown: FAILED,
  } as Readonly<Record<string, string>>,
} as const;
