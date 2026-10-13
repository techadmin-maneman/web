// The settings of payment links, a visit's messages and moves, free visits, referrals and the try-on, in the Rules
// table of ./ops-settings.ts.

import { ARRIVAL_NOTICE_MIN } from "./check-in.ts";
import { CREDIT_REMINDER_DAYS, CREDIT_REMINDER_KEYS, creditReminderConflicts } from "./credit-reminders.ts";
import { CHECK_IN_DAYS, CHECK_IN_KEYS, checkInConflicts } from "./follow-ups.ts";
import { MOVE_PROPOSAL_HOURS } from "./dispatch.ts";
import { REFERRAL_MONTHLY_CAP } from "./fraud-holds.ts";
import type { OpsSetting } from "./ops-settings.ts";
import { PAYMENT_LINK_KEYS, PAYMENT_LINKS } from "./pay-by-link.ts";
import { LOOK_PER_NUMBER_DAYS } from "./tryon-delivery.ts";

export const CLIENT_SETTINGS = [
  {
    // A paid visit booked from the console, and a one visit's link once the client is fitted (ADR 0105).
    name: "payment_links",
    title: "Payment links",
    note: "How long a console booking's link holds its slot, how close to the visit it closes, and how long a one visit's link takes payment.",
    unit: "hours",
    min: 0,
    max: 72,
    keys: PAYMENT_LINK_KEYS,
    bounds: {
      holds_hours: { min: 1, max: 72 },
      closes_before_hours: { min: 0, max: 24 },
      pay_within_days: { min: 1, max: 30, unit: "days" },
    },
    fallback: PAYMENT_LINKS,
  },
  {
    name: "arrival_notice_min",
    title: "Arrival message",
    note: "How long after a technician arrives the client can still be told on WhatsApp. A check-in that reaches us later sends nothing.",
    unit: "minutes",
    min: 1,
    max: 60,
    keys: null,
    fallback: ARRIVAL_NOTICE_MIN,
  },
  {
    // docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md.
    name: "move_proposal_hours",
    title: "Move proposals",
    note: "How long a move to another day waits for the client to confirm, or until the visit if that is sooner.",
    unit: "hours",
    min: 1,
    max: 168,
    keys: null,
    fallback: MOVE_PROPOSAL_HOURS,
  },
  {
    name: "credit_reminder_days",
    title: "Free visit reminders",
    note: "Days before free service visits run out that the client is reminded, first and last.",
    unit: "days",
    min: 1,
    max: 90,
    keys: CREDIT_REMINDER_KEYS,
    bounds: {
      first: { min: 2, max: 90 },
      last: { min: 1, max: 60 },
    },
    fallback: CREDIT_REMINDER_DAYS,
    conflicts: (value) => creditReminderConflicts(value),
  },
  {
    // What follows a fit or a replacement on WhatsApp (src/domain/visits/follow-ups.ts).
    name: "check_in_days",
    title: "Check-ins after a fit",
    note: "Days after a fit or a replacement that the client is asked how it is, first and second.",
    unit: "days",
    min: 1,
    max: 90,
    keys: CHECK_IN_KEYS,
    bounds: {
      first: { min: 1, max: 14 },
      second: { min: 2, max: 90 },
    },
    fallback: CHECK_IN_DAYS,
    conflicts: (value) => checkInConflicts(value),
  },
  {
    name: "referral_monthly_cap",
    title: "Referral review above",
    note: "Fits a referrer may have rewarded in a month before the next is held for your review.",
    unit: "fits a month",
    min: 1,
    max: 100,
    keys: null,
    fallback: REFERRAL_MONTHLY_CAP,
  },
  {
    // docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md.
    name: "tryon_look_days",
    title: "Try-on looks",
    note: "Days before the same WhatsApp number can have another try-on look.",
    unit: "days",
    min: 1,
    max: 365,
    keys: null,
    fallback: LOOK_PER_NUMBER_DAYS,
  },
] as const satisfies readonly OpsSetting[];
