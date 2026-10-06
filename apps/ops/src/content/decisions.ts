// The decision queues that are not referrals: concerns raised, deletions asked for, and changes of number.

import { NOT_PERMITTED } from "./common.ts";

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
    hint: "The client sees this in their app. The audit log records that you answered it.",
    send: "Record the answer and close it",
    sending: "Closing",
    empty: "No concern is open.",
    /** Recording an answer sends nothing: the client hears from whoever answers them, and reads it in the app. */
    note: (days: number) =>
      `The client is told in the app that we answer within ${String(days)} days. ` +
      "Nothing here messages them: answer on WhatsApp, then record the answer here. Their app shows it.",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Someone has answered this one already. Reload to see the queue as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Please try again.",
    } as Readonly<Record<string, string>>,
  },
} as const;

export const deletions = {
  title: "Deletion requests",
  queue: {
    title: "Waiting for a decision",
    /** The 30 days a request is processed within, which run from the day it was made (ADR 0049). */
    processDays: 30,
    requested: (mobile: string, date: string) => `${mobile} · requested ${date}`,
    delete: "Delete the account",
    reject: "Reject the request",
    /**
     * A queue holds many rows and each button says the same thing, so the
     * destructive one names whose account it is, as the Technicians page's revoke does.
     */
    deleteLabel: (name: string) => `Delete the account of ${name}`,
    rejectLabel: (name: string) => `Reject the request of ${name}`,
    confirmLabel: (name: string) => `Deleting the account of ${name}`,
    warning:
      "This erases the client now, and tells them on WhatsApp. It cannot be undone, and there is no copy to put back.",
    /** What the erasure destroys, in the order src/domain/erasure.ts destroys it. */
    deleted: {
      title: "Deleted",
      items: [
        "Every photograph of them, their visits' and their try-ons', the files as well as the records",
        "Their referral card, so an invite they sent shows the house card from now on",
        "Their saved addresses, and any number change under way",
        "Their name, number and e-mail on the record, and the words of any grievance; one still open is closed",
        "Their sessions, so their phone is signed out at once",
      ],
    },
    /** What stays, and why. The eight years are the app's own words to the client. */
    kept: {
      title: "Kept",
      items: [
        "Their visits, payments, refunds and credits, as records",
        "Their invoices in Books, eight years, by law",
        "Their records in the CRM and Books, blanked within the hour",
      ],
    },
    /** The runbook's first step, "Check the request comes from the number's owner". */
    checked: "I have confirmed this request with the client, on their own number.",
    confirm: "Delete this account",
    cancel: "Keep the account",
    deleting: "Deleting",
    reason: {
      label: "Why you are rejecting it",
      // The client is sent this reason on WhatsApp, and their app shows it for thirty days.
      hint: "Kept with the decision, under your name. The client reads it on WhatsApp and in the app.",
      confirm: "Reject this request",
      cancel: "Leave it waiting",
    },
    rejecting: "Rejecting",
    /** Above the queue once a decision is made. */
    done: {
      delete: "Account deleted. The client is told on WhatsApp, and the CRM and Books are blanked within the hour.",
      reject: "Request rejected. The client is told why on WhatsApp.",
    },
    empty: "No deletion request is waiting.",
    note: (days: number) =>
      `Each request is processed within ${String(days)} days of being made. ` +
      "Ops are alerted once when five are left.",
    errors: {
      not_permitted: NOT_PERMITTED,
      not_found: "Someone has decided this one already. Reload to see the queue as it stands.",
      /** The API refuses while something is still owed (docs/decisions/0066-erasure-all-or-nothing.md). */
      visit_booked:
        "They still have a visit booked, so nothing was erased. Cancel it on their Visits tab, which refunds what they " +
        "paid, then delete.",
      payment_held:
        "We still owe them money back, so nothing was erased. Delete once their Payments tab shows it refunded.",
      payment_owed: "A payment link of theirs is still unpaid, so nothing was erased. Delete once it is paid.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. The client has not been erased.",
    } as Readonly<Record<string, string>>,
    /** Beneath a refusal, the client's tab that settles it. */
    settleOn: { visits: "Open their visits", payments: "Open their payments" },
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
    proven: "A code went to both numbers, and both were entered.",
    /** Another record holding the new number: one that never became a client gives it up; a client's refuses. */
    heldBy: (name: string, client: boolean) => {
      const whose = name === "" ? "another record" : `${name}'s record`;
      return client
        ? `This number is on ${whose}, a client's. Confirming is refused while they hold it.`
        : `This number is on ${whose}, which never became a client. Confirming takes the number from it.`;
    },
    effect: "Confirming moves the client to the new number. They sign in with it from then on.",
    confirm: "Confirm the change",
    reject: "Reject",
    reason: {
      label: "Why you are rejecting it",
      // The client's profile shows this reason for thirty days.
      hint: "Kept with the decision, under your name. The client reads it in the app.",
      confirm: "Reject the change",
      cancel: "Leave it waiting",
    },
    deciding: "Deciding",
    empty: "No number change is waiting.",
    errors: {
      not_permitted: NOT_PERMITTED,
      number_in_use: "Another client holds that number already. Nothing was changed.",
      not_found: "Someone has decided this one already. Reload to see the queue as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
} as const;
