// Tasks: every queue ops work through, a payment link's state, and the alerts that need a hand.

import type { components } from "../api-schema.ts";
import type { LinkState } from "../tasks/payment-link.ts";
import { changed, FAILED, NOT_PERMITTED, OFFLINE, RAZORPAY_DOWN } from "./common.ts";
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
  move_unanswered: "Open in Dispatch",
  unanswered_chat: "Answer in Messages",
  remedy_approval: "Decide in Messages",
  leave_conflict: "Move in Dispatch",
  referral_review: "Decide in Referrals",
  no_show_decision: "Decide in Charges",
  no_show_dispute: "Decide in Charges",
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
  // Not drawn: the list's heading, the tasks open, as the page's bar already says "Tasks".
  /** The head's count, in oxblood, as the board writes "4 overdue". */
  openCount: (count: number) => `${String(count)} open`,
  overdue: (count: number) => `${String(count)} overdue`,
  /** The head's count as a screen reader names it, with what it does. */
  overdueJump: (count: number) => `${String(count)} overdue, go to the first`,
  /** Each department's section, named as the navigation names it. */
  departments: DEPARTMENT_NAMES,
  /** Each group, lettered in small caps as the board letters its own two. */
  groups: {
    // A group the board does not draw (docs/decisions/0069-dispatch-under-concurrency.md).
    untold_move: "Call about a move",
    // Not drawn: a move to another day the client has not answered (docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md).
    move_unanswered: "Move not answered",
    visit_left_open: "Visit left open",
    unassigned_visit: "No technician",
    // Not drawn: a client wearing a recalled piece (docs/decisions/0187-recalls.md).
    recall_call: "Recall call",
    // Not drawn: a chat past its reply-by time (docs/decisions/0132-the-reply-clock.md).
    unanswered_chat: "Unanswered chat",
    // Not drawn: a matter Care sent to the city (docs/decisions/0135-city-matters.md).
    city_matter: "City matter",
    // Not drawn: a remedy above the limit, for a manager (docs/decisions/0143-remedies.md).
    remedy_approval: "Remedy to approve",
    // Two groups the board does not draw (docs/decisions/0074-hand-offs-and-messages.md).
    leave_conflict: "Visit on a day off",
    address_to_confirm: "Address to confirm",
    consultation_request: "Consultation request",
    // A group the board does not draw (docs/decisions/0086-the-next-visit-is-offered.md).
    first_fit_to_book: "First fit to book",
    replacement_order: "Replacement order",
    stock_at_risk: "Stock at risk",
    at_risk_client: "At-risk client",
    // A group the board does not draw.
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
    // A visit paid by UPI at the visit, to record once the money is in the account (ADR 0209).
    upi_due: "UPI to record",
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
  /** A first fit or replacement left partly done, booked again at no charge. */
  bookFree: "Book again, free",
  /** A move the client has not heard of, settled from its row. */
  call: {
    call: (mobile: string) => `Call ${mobile}`,
    told: "Told by phone",
    recording: "Recording…",
    failed: FAILED,
  },
  /** More were waiting than one look reads. */
  truncated: "Counts may be incomplete.",
  /** Tasks past the lapse days set in Settings, left off the board until asked for. */
  lapsed: (count: number) => `${String(count)} lapsed ${count === 1 ? "task is" : "tasks are"} left out.`,
  showLapsed: "Show them",
  hideLapsed: "Leave them out",
  /** The second line, one per group: the one fact the group turns on. */
  subs: {
    /**
     * "Moved to Wed 23 Sep, 9 am; has not agreed to WhatsApp": ops call, then say so on the row. A
     * reason the API does not name says only that the client was not told.
     */
    untold_move: {
      no_consent: (when: string) => `Moved to ${when} · not opted in to WhatsApp`,
      not_sent: (when: string) => `Moved to ${when} · WhatsApp failed`,
    },
    /**
     * "Asked to move to Wed 23 Sep, morning": call the client. One that ran out says so; withdraw it on the board, or
     * move the visit there with the client's word.
     */
    move_unanswered: {
      open: (when: string) => `Asked to move to ${when}`,
      ranOut: (when: string) => `Asked to move to ${when} · expired`,
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
     * paid for once the client is fitted.
     */
    withOneVisit: "+ consultation and fit together",
    /**
     * ", code WEDDNG25", after the one visit: the discount code the client gave on the form, which the
     * booking from the row starts with (docs/decisions/0108-discount-codes.md).
     */
    withCode: (code: string) => `, code ${code}`,
    /**
     * "+ first fit, afternoon", after the consultation asked for: the site's form asked for the fit
     * too, which the client books and pays for in the app once the consultation is done.
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
    /** "Service visit · Tue 22 Sep, 9:00 am · no technician": send someone from the board. */
    unassigned_visit: (visit: string, when: string) => `${visit} · ${when} · no technician`,
    /** "MM-ESS-0000041-R · recalled, replacement free": call them to book it. */
    recall_call: (pieces: string) => `${pieces} · recalled, replacement free`,
    /** "Tue 22 Sep · nobody came", or "· not closed" for one begun: give the client a new time, or close it. */
    visit_left_open: (when: string, begun: boolean) => `${when} · ${begun ? "not closed" : "nobody came"}`,
    /** "Mane Man Essential · 8 × 10 in · #1B · 20% grey · 100% density · none in their city", or the profile that matches none yet. */
    stock_at_risk: (hairSystem: string) =>
      hairSystem === "" ? "No hair system matched to their profile" : `${hairSystem} · none in their city`,
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
    // "Can't fit today" in the technician app: no piece of the client's spec to fit.
    noPiece: "No piece to fit",
    no_show_decision: (technician: string) => `${technician} came by`,
    /** "Disputes the charge that kept Rs. 1,234", or the free service visit it spent. */
    no_show_dispute: (took: string) => `Disputes a charge: ${took}`,
    disputedCredit: "a free service visit",
    /** "Waiting since 21 Sep, 9:12 pm": the client's last message, unanswered past its reply-by time. */
    unanswered_chat: (since: string) => `Waiting since ${since}`,
    /** Care's note to the city team, as they wrote it. */
    city_matter: (note: string) => note,
    /** "2 free service visits"; why is in the Remedies panel on Messages. */
    remedy_approval: (visits: number) => `${String(visits)} free service ${visits === 1 ? "visit" : "visits"}`,
    number_change: "Both numbers verified",
    erasure_request: "Requested in the app",
    // A concern about their data, which the app promises an answer to within 30 days.
    grievance: "Raised in the app",
    // The client cannot open the invoice until somebody sends it in Books.
    draft_invoice: (visit: string) => `Visit of ${visit} · draft in Books`,
    /**
     * "Mane Man Natural, Rs. 12,345; link sent": a one visit's client was fitted and has not paid. A
     * link not sent yet is asked of Razorpay again by the cron; one Razorpay refused, or closed unpaid, is sent again
     * from the row or from Razorpay's dashboard.
     */
    payment_owed: (product: string, amount: string, link: LinkState) =>
      `${product}, ${amount} · ${PAYMENT_LINK_STATES[link]}`,
    /** "Service visit, Wed 23 Sep · Rs. 2,200 by UPI": record it once it is in the account. */
    upi_due: (visit: string, when: string, amount: string) => `${visit}, ${when} · ${amount} by UPI`,
    /** "Rs. 1,234 owed back on pay_Q1x; Razorpay refused the refund": refunded from Razorpay's dashboard. */
    payment_to_refund: (amount: string, payment: string, why: string) =>
      `${amount} to refund on ${payment} · ${why === "refund_failed" ? "refund failed" : "refund refused"}`,
    // A held grant whose fraud signals were not recorded.
    unknown: "Held for review",
  },
  /**
   * Whose each task is. The board writes each owner in ops by their first name,
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
      not_found: changed("Already handled."),
      invalid_request: "That person hasn’t used the console recently.",
      offline: OFFLINE,
      unknown: FAILED,
    },
  },
  /**
   * A visit left partly done closed without a follow-up, with why
   *.
   */
  close: {
    open: "Close without follow-up",
    label: "Why no follow-up is needed",
    /** A City matter closes once the city has dealt with it. */
    cityMatter: { open: "Mark done", label: "What was done" },
    /** An at-risk client closes with what came of the call. */
    atRisk: { open: "Close", label: "What came of the call" },
    confirm: "Close task",
    closing: "Closing…",
    cancel: "Cancel",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: changed("Already booked or closed."),
      invalid_request: "Give a reason.",
      offline: OFFLINE,
      unknown: FAILED,
    },
  },
  /** A visit paid by UPI at the visit, recorded from its row. */
  upi: {
    open: "Record UPI",
    title: "Record UPI payment",
    sub: (visit: string, amount: string) => `${visit} · ${amount}`,
    utr: "UPI reference (UTR)",
    record: "Record",
    recording: "Recording…",
    cancel: "Cancel",
    errors: {
      invalid_request: "Enter the UTR as the bank shows it: letters and digits.",
      not_due: "This visit isn’t paid at the visit.",
      already_paid: "This visit’s payment is already recorded.",
      reference_used: "That UTR is already recorded against another payment.",
      not_permitted: NOT_PERMITTED,
      offline: OFFLINE,
      unknown: FAILED,
    },
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
    },
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: changed("That link no longer exists."),
      unavailable: RAZORPAY_DOWN,
      offline: OFFLINE,
      unknown: FAILED,
    },
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
    crm_lead: "Lead didn’t reach the CRM",
    crm_erasure: "CRM erasure incomplete",
    crm_contact_update: "CRM lead not updated",
    contact_sync: "Contact change failed",
    deletion_waiting: "Deletion request nearly due",
    books_erasure: "Books erasure incomplete",
    crm_contact_erasure: "CRM contact erasure incomplete",
    cancel_refund_failed: "Refund failed",
    no_show_refund_failed: "Refund failed",
    no_show_credit_not_back: "Free service visit not returned",
    payment_link: "Payment link refused",
    payment_link_failed: "Payment link failed",
    invoice_draft: "Invoice still a draft",
    invoice_unpriced: "Visit has no price to invoice",
    invoice_refused: "Books refused an invoice",
    invoice_failed: "Invoice didn’t reach Books",
    books_unapplied: "Payment not matched to an invoice",
    razorpay_refund_unheard: "Refund seen before its payment",
    low_stock: "Stock low",
    technician_code_refused: "Technician login code refused",
    whatsapp_bridge: "WhatsApp disconnected",
    login_codes_failing: "Login codes failing",
    cron_job: "Scheduled job failing",
  } as Readonly<Record<string, string | undefined>>,
  /** Books refusing or failing on a customer, a payment, its application or a refund. */
  books: "Books needs attention",
  /** Any other kind. */
  other: "Needs attention",
  /** "3 times since 21 Sep", or "Since 21 Sep" for one. */
  seen: (times: number, since: string) => (times === 1 ? `Since ${since}` : `${String(times)} times since ${since}`),
  open: "Open",
  sendAgain: "Send again",
  /** An alert's whole words, its IDs and vendor's answer among them, beneath the first sentence. */
  details: "Details",
  sending: "Sending…",
  done: "Mark done",
  closing: "Closing…",
  shown: (shown: number, count: number) => `Oldest ${String(shown)} of ${String(count)}.`,
  errors: {
    not_permitted: NOT_PERMITTED,
    not_found: changed("Already closed."),
    offline: OFFLINE,
    unknown: FAILED,
  },
} as const;
