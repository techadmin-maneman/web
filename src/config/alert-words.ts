// The words each alert tells ops (docs/decisions/0067-alerts-and-silent-failures.md), one template for each kind, kept
// together so they are read and changed as the console's own words are. Each says what to do first, then why, and
// last the IDs and days to act on: never a client's name, number or address, since the chat that hears them is
// outside the console. The kinds are src/policy/alerts.ts's.

import { rupees } from "@maneman/web-kit/money";

/** A refund Razorpay would not make, or would not say it made, for ops to settle by hand. */
interface RefundLeft {
  readonly outcome: "refused" | "unanswered";
  /** The amount and what it was for, as "Rs. 500 for visit …". */
  readonly what: string;
  readonly payment: string;
  readonly amount: number;
}

/** Why a visit's invoice is held as a draft in Books. */
export type DraftHeld = "price_differs" | "price_unknown" | "paid_with_credit" | "credit_missing";

export const ALERT_WORDS = {
  // Bookings and visits.
  booked_unassigned: (a: { readonly day: string; readonly visit: string }) =>
    `Give the visit on ${a.day} a technician on the board: its own was switched off. Visit ${a.visit}.`,
  unassigned_visit: (a: { readonly visit: string }) =>
    `Send a technician to visit ${a.visit} from the Dispatch board: it is today, and has none.`,
  credit_visit_without_credit: (a: { readonly booking: string }) =>
    `Decide whether to charge for booking ${a.booking}: it was booked on a visit credit the client no longer had.`,
  replaced_after_begun: (a: { readonly visit: string; readonly booking: string }) =>
    `Ask the client which visit to keep: they moved visit ${a.visit} to booking ${a.booking} after its technician ` +
    "began it, so both stand.",
  unbooked_hold: (a: { readonly booking: string; readonly reason: string }) =>
    `Book or refund booking ${a.booking}: it was paid for, or booked free, and is neither half an hour on ` +
    `(${a.reason}).`,
  hair_profile_from_older: (a: { readonly client: string; readonly version: string }) =>
    `Check client ${a.client}'s hair profile against the version before it: a technician based version ` +
    `${a.version} on an older one.`,

  // Refunds and payments.
  refund_left: (a: RefundLeft) =>
    a.outcome === "refused"
      ? `Refund payment ${a.payment} by hand in Razorpay, once: Razorpay refused the refund of ${a.what}.`
      : `Look at payment ${a.payment} in Razorpay first: Razorpay did not say whether it made the refund of ` +
        `${a.what}. Refund it by hand only if no refund of ${rupees(a.amount)} is there.`,
  hold_refund_failed: (a: {
    readonly outcome: "refused" | "unanswered";
    readonly booking: string;
    readonly payment: string;
    readonly amount: number;
  }) =>
    a.outcome === "refused"
      ? `Refund payment ${a.payment} of ${rupees(a.amount)} from Razorpay's dashboard: Razorpay refused it. ` +
        `Booking ${a.booking}.`
      : `Look at payment ${a.payment} in Razorpay's dashboard first: Razorpay did not say whether it refunded its ` +
        `${rupees(a.amount)}. Refund it there only if no refund of it shows. Booking ${a.booking}.`,
  refund_failed: (a: { readonly refund: string; readonly payment: string; readonly amount: number }) =>
    `Refund payment ${a.payment} again from Razorpay's dashboard: Razorpay failed refund ${a.refund} of ` +
    `${rupees(a.amount)}. The client's app says it is being redone.`,
  second_capture: (a: {
    readonly order: string;
    readonly payment: string;
    readonly amount: number;
    readonly other: string;
  }) =>
    `Refund payment ${a.payment} of ${rupees(a.amount)} from Razorpay's dashboard: order ${a.order} was paid twice, ` +
    `after ${a.other}.`,
  paid_off_its_order: (a: {
    readonly payment: string;
    readonly amount: number;
    readonly order: string;
    readonly booking: string;
  }) =>
    `Refund payment ${a.payment} of ${rupees(a.amount)} from Razorpay's dashboard, or book the visit for the client: ` +
    `it was made on order ${a.order}, which booking ${a.booking} left when a discount code changed its price.`,
  hold_link_without_order: (a: { readonly booking: string; readonly payment: string }) =>
    `Book the visit for the client, or refund payment ${a.payment} in Razorpay's dashboard: they paid booking ` +
    `${a.booking}'s link, but Razorpay named no order for it, so nothing was booked.`,
  razorpay_catch_up_not_booked: (a: { readonly booking: string; readonly reason: string }) =>
    `Book the visit for the client, or refund the payment in Razorpay's dashboard: booking ${a.booking} is paid ` +
    `for, and could be neither booked nor refunded (${a.reason}).`,
  razorpay_payment_unheard: (a: {
    readonly next: string;
    readonly payment: string;
    readonly amount: number;
    readonly paidFor: string;
  }) =>
    `Check Razorpay's webhook (runbook, "Razorpay's webhook is not arriving"): payment ${a.payment} of ` +
    `${rupees(a.amount)} for ${a.paidFor} reached us only when we asked Razorpay. ${a.next}`,
  razorpay_refund_unheard: (a: { readonly payment: string; readonly refund: string }) =>
    `Check who refunded payment ${a.payment}: Razorpay refunded it (refund ${a.refund}) before we heard it was paid, ` +
    `so no visit was booked. If nobody here did, see the runbook, "Razorpay's webhook is not arriving".`,
  no_show_credit_not_back: (a: { readonly visit: string; readonly why: string }) =>
    `Settle visit ${a.visit}'s credit with the client by hand if they are owed one: its grant expired or was ` +
    `withdrawn, so it could not come back after the no-show ${a.why}. The client is told so.`,
  /** `what` is the payment, or what is left of it: "payment …", "Rs. 500 of payment …". */
  books_unapplied: (a: { readonly what: string; readonly books: string; readonly why: string }) =>
    `Refund ${a.what}, or keep it in Books as the client's credit: it has nothing to be set against (${a.why}). ` +
    `Books payment ${a.books}.`,

  // Payment links.
  payment_link_not_made: (a: {
    readonly visit: string;
    readonly product: string;
    readonly why: "unpriced" | "code_changing";
  }) =>
    a.why === "unpriced"
      ? `Price ${a.product} in the price book, then send visit ${a.visit}'s payment link from Razorpay's dashboard ` +
        `with reference ${a.visit}: the fit has no price for its day.`
      : `Send visit ${a.visit}'s payment link from Razorpay's dashboard with reference ${a.visit}: a discount code ` +
        `went on or came off it each time its link was written, for the fit with ${a.product}.`,
  payment_link_refused: (a: { readonly visit: string; readonly amount: number; readonly reason: string }) =>
    `Send the client a payment link of ${rupees(a.amount)} from Razorpay's dashboard, with reference ${a.visit}: ` +
    `Razorpay would not make visit ${a.visit}'s (${a.reason}).`,
  payment_link_failed: (a: { readonly visit: string; readonly times: number; readonly reason: string }) =>
    `Send visit ${a.visit}'s payment link from Razorpay's dashboard, with reference ${a.visit}, if the client is ` +
    `waiting: Razorpay could not be asked for it ${String(a.times)} times (${a.reason}).`,
  paid_elsewhere_link: (a: { readonly visit: string; readonly link: string; readonly reason: string }) =>
    `Cancel payment link ${a.link} in Razorpay's dashboard, and refund one payment if the client paid both: visit ` +
    `${a.visit} was paid by another link, and this one would not cancel (${a.reason}).`,
  erased_link: (a: { readonly link: string; readonly reason: string }) =>
    `Cancel payment link ${a.link} in Razorpay's dashboard: its client was erased, and it would not cancel ` +
    `(${a.reason}).`,
  custom_order_link: (a: { readonly order: string; readonly reason: string }) =>
    `Send custom order ${a.order}'s payment link again from the client's page: it could not be made (${a.reason}).`,
  custom_order_payment_stranded: (a: { readonly payment: string; readonly amount: number; readonly order: string }) =>
    `Refund payment ${a.payment} of ${rupees(a.amount)} from the client's Payments: it came in for custom order ` +
    `${a.order}, which was cancelled or already paid.`,
  custom_order_link_not_cancelled: (a: { readonly order: string; readonly link: string }) =>
    `Cancel payment link ${a.link} in Razorpay's dashboard: custom order ${a.order} is cancelled. If the client ` +
    "pays it first, refund them from their Payments.",

  // Invoices.
  invoice_draft: (a: {
    readonly invoice: string;
    readonly visit: string;
    readonly held: DraftHeld;
    readonly total: number;
    readonly soldFor: number;
  }) =>
    ({
      price_differs: `Correct invoice ${a.invoice} in Books to ${rupees(a.soldFor)}, what the visit was sold for: it totals ${rupees(a.total)}, so it is held as a draft until it matches.`,
      price_unknown: `Check invoice ${a.invoice}'s ${rupees(a.total)} in Books and send it there: nothing here says what the visit was sold for.`,
      paid_with_credit: `Leave invoice ${a.invoice} as a draft in Books: the visit was paid with a referral credit, and how that is invoiced waits for the accountant.`,
      credit_missing: `Charge, send or delete draft invoice ${a.invoice} in Books: the visit was booked on a referral credit the client no longer had, so nothing paid for it.`,
    })[a.held] + ` Visit ${a.visit}.`,
  invoice_not_sent: (a: { readonly invoice: string; readonly visit: string }) =>
    `Send invoice ${a.invoice} in Books: Books would not mark it sent, so the client cannot open it. Visit ${a.visit}.`,
  invoice_hand_made: (a: { readonly invoice: string; readonly visit: string }) =>
    `Send invoice ${a.invoice} in Books: it was made there by hand, and is still a draft an hour after the visit. ` +
    `Visit ${a.visit}.`,
  invoice_void: (a: { readonly invoice: string; readonly visit: string }) =>
    `Raise a new invoice in Books if visit ${a.visit} still owes one: invoice ${a.invoice} is void.`,
  invoice_unpriced: (a: { readonly visit: string }) =>
    `Raise visit ${a.visit}'s invoice in Books by hand: the price book has no price for its day.`,
  invoice_refused: (a: { readonly visit: string; readonly said: string }) =>
    `Raise visit ${a.visit}'s invoice in Books by hand, or correct what Books refused: "${a.said}".`,
  invoice_failed: (a: { readonly visit: string; readonly times: number; readonly reason: string }) =>
    `Raise visit ${a.visit}'s invoice in Books by hand if it is wanted now: it failed ${String(a.times)} times ` +
    `(${a.reason}).`,
  books_customer_erasure: (a: { readonly customer: string; readonly client: string; readonly tries: string }) =>
    `In Books, delete customer ${a.customer}, or, where an invoice names it, rename it "Erased client", clear its ` +
    `contact persons, numbers, e-mail and addresses, and mark it inactive: Books would not erase it after ` +
    `${a.tries}. Erased client ${a.client}.`,
  crm_contact_erasure: (a: { readonly contact: string; readonly client: string; readonly tries: string }) =>
    `In the CRM, clear Contact ${a.contact}'s name, numbers, e-mail and addresses, delete it and empty it from the ` +
    `recycle bin: the CRM would not erase it after ${a.tries}. Erased client ${a.client}.`,

  // Stock.
  low_stock: (a: {
    readonly item: string;
    readonly at: string;
    readonly held: number;
    readonly unit: string;
    readonly level: number;
  }) =>
    `Record a transfer or a delivery of ${a.item} for ${a.at} on the Stock page: ${String(a.held)} ${a.unit} left, ` +
    `at or below its level of ${String(a.level)}.`,
  kit_short: (a: {
    readonly kit: string;
    readonly span: "tomorrow" | "the week";
    readonly lacks: string;
    readonly source: string | null;
    readonly nowhere: readonly string[];
  }) =>
    `Send the top-up waiting on the Supply plan: technician ${a.kit}'s kit is short for ${a.span} of ${a.lacks}.` +
    (a.nowhere.length === 0
      ? ""
      : ` ${a.source ?? "Its stockroom"} can't cover ${a.nowhere.join(", ")}: order or move one.`),
  fit_without_piece: (a: {
    readonly day: string;
    readonly item: string;
    readonly city: string;
    readonly quickest: string;
  }) => `Move or order ${a.item} for the fit on ${a.day}: none is in ${a.city} or on its way; ${a.quickest}.`,
  stock_expiring: (a: { readonly place: string; readonly days: number; readonly lots: string }) =>
    `Use first, move or write off on the Stock page what expires in ${a.place} within ${String(a.days)} days: ` +
    `${a.lots}.`,
  transfer_overdue: (a: {
    readonly quantity: number;
    readonly unit: string;
    readonly item: string;
    readonly from: string;
    readonly to: string;
    readonly day: string;
  }) =>
    `Receive or send back on the Stock page the ${String(a.quantity)} ${a.unit} of ${a.item} sent from ${a.from} ` +
    `to ${a.to} on ${a.day}: it has not arrived.`,
  count_differs: (a: { readonly place: string; readonly lines: number }) =>
    `Sign off ${a.place}'s count on Counts: it still differs on ${String(a.lines)} after a recount.`,

  // Clients' records elsewhere.
  crm_contact_update: (a: { readonly client: string; readonly attempts: number; readonly reason: string }) =>
    `Update client ${a.client}'s CRM lead by hand: their new number, city or invite did not reach it after ` +
    `${String(a.attempts)} attempts (${a.reason}).`,
  crm_lead: (a: { readonly lead: string; readonly attempts: number; readonly reason: string }) =>
    `Send lead ${a.lead} again from Tasks once Zoho is back: it did not reach the CRM after ` +
    `${String(a.attempts)} attempts (${a.reason}).`,
  crm_erasure: (a: { readonly person: string; readonly attempts: number; readonly reason: string }) =>
    `Send person ${a.person}'s erasure again from Tasks, or blank their CRM record by hand and mark it done there: ` +
    `it failed ${String(a.attempts)} times (${a.reason}).`,
  message_failed: (a: {
    readonly message: string;
    readonly kind: string;
    readonly attempts: number;
    readonly detail: string;
  }) =>
    `Send message ${a.message} (${a.kind}) again from Tasks, or reach the client another way: it failed after ` +
    `${String(a.attempts)} attempts (${a.detail}).`,
  deletion_waiting: (a: {
    readonly request: string;
    readonly by: string;
    readonly waited: number;
    readonly within: number;
  }) =>
    `Decide deletion request ${a.request} by ${a.by}: it has waited ${String(a.waited)} of its ` +
    `${String(a.within)} days.`,
  technician_code_refused: (a: { readonly technician: string; readonly reason: string }) =>
    `Technician ${a.technician} was refused a login code: ${a.reason}`,

  // The system.
  vendor_down: (a: { readonly vendor: string; readonly since: string; readonly failures: number }) =>
    `Check ${a.vendor}'s status: it has failed ${String(a.failures)} times in a row since ${a.since}. Its work waits, ` +
    "and goes on by itself once it answers.",
  dead_letter: (a: { readonly what: string; readonly todo: string }) =>
    `${a.todo} (runbook, "A queue gave up"): ${a.what} was given up on after every try.`,
  login_codes_failing: (a: { readonly failed: number; readonly detail: string }) =>
    `Check the WhatsApp bridge now (runbook, "WhatsApp (Evolution) is down"): ${String(a.failed)} login codes ` +
    `failed to send in the last hour (the latest: ${a.detail}), so nobody can sign in.`,
  whatsapp_bridge: (a: { readonly fix: string; readonly detail: string }) =>
    `${a.fix} (runbook, "WhatsApp (Evolution) is down"): the WhatsApp bridge is not connected (${a.detail}), so no ` +
    "login code or message can be sent.",
  messages_unsent: (a: { readonly count: number }) =>
    `Replay the messages still worth sending once WhatsApp is back (runbook, "Replaying a failed message"): ` +
    `${String(a.count)} ${a.count === 1 ? "message" : "messages"} queued over a day ago never sent.`,
  turnstile_unavailable: (a: { readonly failed: number; readonly detail: string }) =>
    `Check Cloudflare's status and the API's Turnstile secret: Turnstile could not check ${String(a.failed)} ` +
    `visitors in the last hour (${a.detail}), so their bookings, try-ons and app logins were turned away.`,
  google_refused: (a: { readonly detail: string }) =>
    `Check the Google key, its APIs and its quotas (provisioning, step 13): Google refused the address search ` +
    `(${a.detail}), so clients' addresses get no pin.`,
  youcam_units_low: (a: { readonly units: number; readonly floor: number }) =>
    `Buy YouCam units before try-ons stop: ${String(a.units)} left, below the floor of ${String(a.floor)}.`,
  cron_job: (a: { readonly job: string; readonly runs: number; readonly reason: string }) =>
    `Look into the cron's ${a.job} job: it failed ${String(a.runs)} runs in a row (${a.reason}).`,
  cron_job_missed: (a: { readonly job: string; readonly since: string }) =>
    `Look into the cron's ${a.job} job (runbook, "Alerts and the cron"): it has not run well since ${a.since}.`,
  cron_run_cut_short: (a: { readonly started: string }) =>
    `Look into the cron (runbook, "A cron run cut short"): the run started at ${a.started} never finished, so the ` +
    "jobs after where it stopped did not run.",
  maintenance: (a: { readonly since: string; readonly reason: string }) =>
    `Switch maintenance off once the restore is done (runbook, "Restoring D1"): the cron and the queues have stood ` +
    `still since ${a.since} (${a.reason}).`,
  backup_not_configured: () => `Set a backup key (runbook, "Restoring D1"): no weekly backup is written without one.`,
  backup_failed: (a: { readonly reason: string }) =>
    `Look into the weekly backup if it fails again within the hour (runbook, "From a weekly backup"): it failed ` +
    `(${a.reason}).`,
  analytics_copy_failed: (a: { readonly reason: string }) =>
    `Look into the reporting copy if it fails again within the hour: last night's failed (${a.reason}).`,
  analytics_totals: () =>
    "Check the reports before relying on them: last night's reporting copy does not match the bookings and payments " +
    "it was sent.",
  analytics_size: () =>
    "Trim the reporting copy's oldest rows, or move up a Supabase plan: it is near its 500 MB limit.",
  d1_size: (a: { readonly gigabytes: string; readonly percent: number; readonly limit: number }) =>
    `Trim the database (runbook, "D1 growing"): it holds ${a.gigabytes} GB, ${String(a.percent)}% of the ` +
    `${String(a.limit)} GB Cloudflare allows, and past that every write fails.`,
  r2_share: (a: { readonly gigabytes: string; readonly share: string; readonly free: number }) =>
    `Photos and referral cards use ${a.gigabytes} GB, ${a.share} their ${String(a.free)} GB of free storage; past ` +
    "it, uploads go on, on paid storage.",
  r2_growth: (a: { readonly gigabytes: string; readonly since: string }) =>
    `Find what is writing photos and referral cards (runbook, "R2 storage growing"): they grew by ${a.gigabytes} GB ` +
    `since ${a.since}, more than a day's work makes.`,
  photo_uploads: (a: { readonly who: string; readonly key: string }) =>
    `Find what is sending photographs (runbook, "R2 storage growing"): ${a.who} reached the day's limit of uploads, ` +
    `so further ones wait. ${a.key}.`,
} as const;
