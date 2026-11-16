// The alerts under the bell (design/client-redesign, the notifications screen; docs/decisions/0255-client-alerts-and-
// push.md): one beside each message we send the client, and each time a technician asks for their sign-off. An alert
// carries its kind, its visit and a technician's minutes, so each kind has its own words. It opens Home for the visit
// under way, else its visit where it has one, else the page its kind belongs to.

import { REFUND_TAKES } from "./payments.ts";

/** An alert as GET /api/me/alerts answers it (the ClientAlert schema; a test holds the kinds to it). */
export interface ClientAlert {
  readonly id: string;
  readonly kind: string;
  readonly visit_id: string | null;
  readonly update: {
    readonly kind: "on_the_way" | "running_late" | "at_the_gate";
    readonly minutes: number | null;
  } | null;
  readonly at: string;
  readonly read: boolean;
}
type Alert = ClientAlert;

interface AlertWords {
  readonly title: string;
  readonly line: string;
  /** Where it opens when it is about no visit. */
  readonly page: string;
}

const PAYMENTS = "/profile/payments";

export const ALERTS: Readonly<Record<string, AlertWords | undefined>> = {
  tryon_result: { title: "Your try-on is ready", line: "See the look on your own photo.", page: "/photos" },
  consultation_confirmation: {
    title: "Consultation booked",
    line: "We confirm the exact hour on WhatsApp the day before.",
    page: "/visits",
  },
  visit_reminder: { title: "Your visit is tomorrow", line: "See when your technician arrives.", page: "/visits" },
  payment_receipt: { title: "Payment received", line: "Your receipt is in Payments.", page: PAYMENTS },
  nothing_to_pay: { title: "Nothing to pay", line: "Your visit is covered.", page: "/visits" },
  link_paid: { title: "Payment received", line: "Thank you. Your receipt is in Payments.", page: PAYMENTS },
  upi_received: { title: "UPI payment received", line: "Your receipt is in Payments.", page: PAYMENTS },
  reschedule_confirmation: { title: "Your visit has moved", line: "The new time is on the visit.", page: "/visits" },
  cancel_confirmation: { title: "Visit cancelled", line: "Any refund shows in Payments.", page: "/visits" },
  visit_cancelled: {
    title: "We had to cancel your visit",
    line: "We’ll message you to book another time.",
    page: "/visits",
  },
  visit_moved: { title: "We moved your visit", line: "The new time is on the visit.", page: "/visits" },
  move_proposed: { title: "Can we move your visit?", line: "Accept the new time, or pick another.", page: "/visits" },
  arrival_notice: { title: "Your technician is at your door", line: "They’ll wait a few minutes.", page: "/visits" },
  no_show_decided: { title: "About the visit we missed", line: "See what happens next.", page: "/visits" },
  no_show_dispute_ruled: { title: "Your dispute has an answer", line: "See it on the visit.", page: "/visits" },
  booking_refunded: { title: "Refund started", line: `Banks take ${REFUND_TAKES}.`, page: PAYMENTS },
  next_service_reminder: { title: "Your next service is due", line: "Book it when it suits you.", page: "/" },
  friend_fitted: {
    title: "Your friend was fitted",
    line: "Your free service visits are on their way.",
    page: "/rewards",
  },
  friend_credited: { title: "Free service visits added", line: "They’re applied when you book.", page: "/rewards" },
  referral_rejected: { title: "About your invite", line: "See Rewards for why.", page: "/rewards" },
  credits_expiring: { title: "Free visits ending soon", line: "Use them before they end.", page: "/rewards" },
  launch_alert: { title: "We’re in your city", line: "Book a free consultation.", page: "/" },
  deletion_rejected: { title: "About your deletion request", line: "See Account for why.", page: "/profile/account" },
  concern_received: {
    title: "We have your concern",
    line: "We’ll reply here and on WhatsApp.",
    page: "/visits/issues",
  },
  concern_answered: { title: "Your concern has an answer", line: "See it in your issues.", page: "/visits/issues" },
  recall_notice: {
    title: "We’re replacing your hair system",
    line: "At no cost. We’ll call you to set a day.",
    page: "/",
  },
  consultation_follow_up: {
    title: "After your consultation",
    line: "Book your first fit when you’re ready.",
    page: "/",
  },
  fit_aftercare: { title: "Caring for your hair system", line: "What to do in the first days.", page: "/" },
  first_check_in: {
    title: "How is your hair system?",
    line: "Tell us if anything is off.",
    page: "/visits/issues/new",
  },
  second_check_in: {
    title: "How is your hair system?",
    line: "Tell us if anything is off.",
    page: "/visits/issues/new",
  },
  sign_off_asked: {
    title: "Your technician asks you to sign off the fit",
    line: "Look at the hairline and the photos, then sign off in the app.",
    page: "/",
  },
};

/** A technician's word, with the minutes they gave where they gave some. */
const UPDATES = {
  on_the_way: {
    title: "Your technician is on the way",
    line: (minutes: number | null) =>
      minutes === null ? "On the way to you." : `Arriving in about ${String(minutes)} minutes.`,
  },
  running_late: {
    title: "Your technician is running late",
    line: (minutes: number | null) =>
      minutes === null ? "Sorry for the wait." : `About ${String(minutes)} minutes late. Sorry for the wait.`,
  },
  at_the_gate: { title: "Your technician is at the gate", line: () => "At your door in a minute or two." },
} as const;

/** About the visit under way: Home's card follows it and holds the sign-off, so these open Home, never its page. */
const ON_HOME: ReadonlySet<string> = new Set(["technician_update", "sign_off_asked"]);

/** An alert's title and line, and the page it opens. */
export function alertWords(alert: Alert): { title: string; line: string; to: string } {
  const visit = alert.visit_id === null || ON_HOME.has(alert.kind) ? null : `/visits/${alert.visit_id}`;
  if (alert.kind === "technician_update") {
    const update = UPDATES[alert.update?.kind ?? "on_the_way"];
    return { title: update.title, line: update.line(alert.update?.minutes ?? null), to: "/" };
  }
  // A kind newer than this build reads as the push does, and opens the inbox.
  const words = ALERTS[alert.kind] ?? { title: alerts.pushed.title, line: alerts.pushed.line, page: "/alerts" };
  return { title: words.title, line: words.line, to: visit ?? words.page };
}

export const alerts = {
  today: "Today",
  earlier: "Earlier",
  none: ["Nothing yet", "Visit updates, issue replies and payments show here."] as const,
  /** Beneath the list, where the same updates' WhatsApp messages are chosen. */
  whatsapp: "The same updates reach you on WhatsApp. Choose which ones in",
  privacy: "Privacy and messages",
  unread: "New",
  /** A push whose alert could not be read, or was shown already. */
  pushed: { title: "Mane Man", line: "You have a new update." },
  /** This phone's notifications, on the inbox's head. */
  phone: {
    title: "Alerts on this phone",
    on: "On",
    off: "Get them as they happen, as well as on WhatsApp",
    blocked: "Turned off in this browser’s settings",
    failed: "That didn’t turn on. Try again.",
    turnOn: "Turn on",
  },
} as const;
