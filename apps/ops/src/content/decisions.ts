// The decision queues that are not referrals: concerns raised, deletions asked for, and changes of number.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const grievances = {
  title: "Concerns",
  queue: {
    title: "Open concerns",
    /**
     * The days the app promises the client an answer within, which counsel has
     * still to confirm (docs/open-points.md, item 51).
     * test/node/apps/ops/ops-content.test.ts holds this to the app's own words.
     */
    answerDays: 30,
    /** Beneath the name: the number to answer on, and the day it was raised. */
    raised: (mobile: string, date: string) => `${mobile} · raised ${date}`,
    label: "Your answer",
    send: "Record and close",
    sending: "Closing…",
    empty: "No open concerns.",
    /** A row each, as the redesign draws them; the client's name opens the concern in a drawer. */
    columns: ["Client", "Concern", "Raised", "Answer by"] as const,
    /** Beside the page's title. */
    openCount: (count: number) => `${String(count)} open`,
    openLabel: (name: string) => `Open ${name}’s concern`,
    closed: (name: string) => `${name}’s concern closed.`,
    /** Recording an answer sends nothing: the client hears from whoever answers them, and reads it in the app. */
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: changed("Already answered."),
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
} as const;

export const deletions = {
  title: "Deletion requests",
  queue: {
    title: "Waiting for a decision",
    /** The 30 days a request is processed within, which run from the day it was made (ADR 0049). */
    processDays: 30,
    requested: (mobile: string, date: string) => `${mobile} · requested ${date}`,
    /** A visit the client booked after asking: they may want to keep their account. */
    bookedSince: (visit: string) => `Booked a visit for ${visit} since asking. Ask whether they still want this.`,
    delete: "Erase",
    reject: "Keep, with reason",
    /**
     * A queue holds many rows and each button says the same thing, so the
     * destructive one names whose account it is, as the Technicians page's revoke does.
     */
    deleteLabel: (name: string) => `Erase client: ${name}`,
    rejectLabel: (name: string) => `Keep ${name}’s account, with reason`,
    confirmLabel: (name: string) => `Erasing ${name}`,
    warning: "This erases the client now and tells them on WhatsApp. It can’t be undone.",
    /** What the erasure destroys, in the order src/domain/privacy/erasure.ts destroys it. */
    deleted: {
      title: "Erased",
      items: [
        "Every photo: visits and try-ons, files and records",
        "Their referral card. Invites they sent show the Mane Man example card",
        "Saved addresses, and any number change in progress",
        "Name, number, email, and the text of any concern. Open ones close",
        "Their sessions. They’re signed out at once",
      ],
    },
    /** What stays, and why. The 8 years are the app's own words to the client. */
    kept: {
      title: "Kept",
      items: [
        "Visits, payments, refunds and credits, as records",
        "Invoices in Books, for 8 years, by law",
        "CRM and Books records, blanked within the hour",
      ],
    },
    /** The runbook's first step, "Check the request comes from the number's owner". */
    checked: "I’ve confirmed this with the client, on their own number.",
    /** Erasure blanks the number, after which nobody can find the chat on the phone. */
    chatDeleted: "I’ve deleted their chat on the WhatsApp phone.",
    confirm: (name: string) => `Erase ${name}`,
    deleting: "Erasing…",
    reason: {
      label: "Reason",
      // The client is sent this reason on WhatsApp, and their app shows it for thirty days.
      confirm: "Keep account",
    },
    rejecting: "Keeping…",
    /** Above the queue once a decision is made. */
    done: {
      delete: "Client erased. They’re told on WhatsApp.",
      reject: "Kept. The client is told why on WhatsApp.",
    },
    empty: "No deletion requests.",
    /** A row each, as the redesign draws them; the client's name opens the request in a drawer. */
    columns: ["Client", "Asked", "Decide by", "To settle"] as const,
    actions: "Decision",
    /** Beside the page's title. */
    toDecide: (count: number) => `${String(count)} to decide`,
    openLabel: (name: string) => `Open ${name}’s deletion request`,
    /** What the API would refuse an erasure for, in a row: nothing, or what to settle first. */
    settle: {
      none: "Nothing",
      visit_booked: "A visit booked",
      payment_held: "A refund owed",
      payment_owed: "A link unpaid",
    },
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: changed("Already decided."),
      /** The API refuses while something is still owed (docs/decisions/0066-erasure-all-or-nothing.md). */
      visit_booked: "They have a visit booked. Cancel it on their Visits tab, which refunds them, then erase.",
      payment_held: "A refund is still owed. Erase once Payments shows it refunded.",
      payment_owed: "A payment link is still unpaid. Erase once it’s paid.",
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
    /** Beneath a refusal, the client's tab that settles it. */
    settleOn: { visits: "Open Visits", payments: "Open Payments" },
  },
} as const;

export const numberChanges = {
  title: "Number changes",
  queue: {
    title: "Waiting for a decision",
    /** The number they had, and the one they are moving to. */
    move: (from: string, to: string) => `${from} → ${to}`,
    requested: (date: string) => `Requested ${date}`,
    /** The rule the change follows, quoted in migrations/0008_profile.sql. */
    proven: "Both numbers verified by code.",
    /** Another record holding the new number: one that never became a client gives it up; a client's refuses. */
    heldBy: (name: string, client: boolean) => {
      const whose = name === "" ? "another record" : `${name}’s record`;
      return client
        ? `This number is on ${whose}, a client. It can’t be confirmed while they hold it.`
        : `This number is on ${whose}, never a client. Confirming moves it here.`;
    },
    confirm: "Approve",
    reject: "Decline",
    reason: {
      label: "Reason",
      // The client's profile shows this reason for thirty days.
      confirm: "Decline change",
    },
    deciding: "Saving…",
    empty: "No number changes.",
    /** A row each, as the redesign draws them; the client's name opens the change in a drawer. */
    columns: ["Client", "From", "To", "Asked", "Check", "Answer by"] as const,
    actions: "Decision",
    /** Beside the page's title. */
    toDecide: (count: number) => `${String(count)} to decide`,
    openLabel: (name: string) => `Open ${name}’s number change`,
    confirmLabel: (name: string) => `Approve ${name}’s number change`,
    rejectLabel: (name: string) => `Decline ${name}’s number change`,
    /** The row's check: both numbers proven, or the new one on another record. */
    checked: "Both numbers verified",
    heldShort: (name: string) => `On ${name === "" ? "another record" : `${name}’s record`}`,
    confirmed: (name: string) => `${name}’s number changed.`,
    rejected: (name: string) => `${name}’s number change declined.`,
    errors: {
      not_permitted: NOT_PERMITTED,
      number_in_use: "Another client already has that number.",
      not_found: changed("Already decided."),
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
} as const;
