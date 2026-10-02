// When the client is not home (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them, and as the owner ruled on the charge and
// its dispute; the wait they turn on, the three facts ops rule on, and what a
// charge costs. Nothing here charges anybody: the server opens the case and a
// person decides it.

import type { VisitType } from "../config/visit-types.ts";
import {
  cancelRefund,
  creditOnChange,
  LATE_CHANGE_CHARGES,
  type CancelRefund,
  type Charge,
  type Charges,
  type CreditOnChange,
} from "./moving-a-visit.ts";
import { MINUTE_MS } from "../lib/durations.ts";

export const RULES = [
  "The wait timer starts at check-in and runs config NO_SHOW_WAIT_MIN (15) minutes.",
  "Close as no-show is disabled until the timer ends.",
  "Ops then receive three facts: check-in time, distance, and the delivery receipt of the day-before or arrival WhatsApp to the client (from the BSP's delivery webhook).",
  "A no-show is charged under the 24-hour policy. The charge is applied by ops from the evidence, never automatically.",
  "Whether the wait differs for a first fit is open, so make it config per visit type.",
  // The owner, 27 September 2026 (docs/owner-answers-2026-09-27.md, item 60).
  "a charged no-show costs, to begin with, what a late cancellation of the same visit costs",
  "the client disputes a charge in the app, and ops rule Refund or Uphold in the console with a reason, and the client is told.",
] as const;

/**
 * How long the technician waits before he may close a job as a no-show. The
 * prompt gives 15 minutes and leaves a first fit open; the owner ruled on
 * 24 September 2026 that every type waits the same 15 minutes
 * (docs/open-points.md, "The no-show wait"). It stays one number per type so a
 * type can be given its own later without touching anything that reads it.
 */
export type Waits = Readonly<Record<VisitType, number>>;

export const NO_SHOW_WAIT_MIN: Waits = {
  consultation: 15,
  service: 15,
  replacement: 15,
  first_fit: 15,
};

/**
 * Ours, not the prompt's (docs/decisions/0065-a-technicians-writes-reach-fsm.md):
 * a check-in's time is the phone's, and the phone's clock is the technician's
 * to set, so a back-dated check-in once closed a no-show a fifth of a second
 * after it arrived.
 */
export const SERVER_CLOCK_RULE =
  "The wait runs on the server's clock as well as the phone's: a check-in the server has held for less than the wait cannot be closed, whatever time the phone gave it.";

/**
 * When the wait that started at check-in ends. The waits ops have set, or the
 * ones above: they are ops-editable inputs (docs/decisions/0061-ops-editable-inputs.md),
 * so every caller passes what is in force and the rule still stands on its own.
 */
export const waitEndsAt = (checkedInAt: Date, type: VisitType, wait: Waits = NO_SHOW_WAIT_MIN): Date =>
  new Date(checkedInAt.getTime() + wait[type] * MINUTE_MS);

/** A check-in's two times: the phone's, held within bounds (src/policy/phone-clock.ts), and the server's. */
export interface CheckInTimes {
  readonly at: Date;
  readonly receivedAt: Date;
}

/** When the wait ends: on the phone's time and on the server's, whichever is later. */
export function noShowWaitEnds(checkIn: CheckInTimes, type: VisitType, wait: Waits = NO_SHOW_WAIT_MIN): Date {
  const byPhone = waitEndsAt(checkIn.at, type, wait);
  const byServer = waitEndsAt(checkIn.receivedAt, type, wait);
  return byServer.getTime() > byPhone.getTime() ? byServer : byPhone;
}

/** Whether the technician may close the job as a no-show yet. */
export const canCloseAsNoShow = (
  checkIn: CheckInTimes,
  type: VisitType,
  now: Date,
  wait: Waits = NO_SHOW_WAIT_MIN,
): boolean => now.getTime() >= noShowWaitEnds(checkIn, type, wait).getTime();

/** The three facts ops rule on, and nothing else. */
export interface Evidence {
  readonly checkedInAt: string;
  /** Null when the address had no coordinates, so nothing was measured (ADR 0036). */
  readonly distanceM: number | null;
  /** When the BSP reported the day-before or arrival WhatsApp delivered; null if it never was. */
  readonly messageDeliveredAt: string | null;
}

/** Ops' ruling on a case, which the server never makes for them. */
export const NO_SHOW_DECISIONS = ["undecided", "charged", "waived"] as const;
export type NoShowDecision = (typeof NO_SHOW_DECISIONS)[number];

/**
 * What a charged no-show costs, by kind of visit: to begin with what a late cancellation of the same visit costs, as
 * the owner ruled on 27 September 2026 (docs/open-points.md, item 60), and set in the console apart from it so either
 * can change alone (docs/decisions/0088-every-policy-in-the-console.md). A booking keeps the charge it was made under.
 */
export const NO_SHOW_CHARGES: Charges = { ...LATE_CHANGE_CHARGES };

/**
 * What a charged no-show gives back of the visit's payment, by the charge its booking was sold under: what a cancel
 * inside the notice would (RULES[5]). A first fit or a replacement keeps its late fee and refunds the rest, a paid
 * service visit is kept, and a charge of nothing refunds it all.
 */
export const chargedRefund = (type: VisitType, charge: Charge): CancelRefund => cancelRefund(type, "late", charge);

/** What becomes of the credit a charged no-show was paid with: lost, as a late cancel's is, unless the charge is nothing. */
export const chargedCredit = (charge: Charge): CreditOnChange => creditOnChange("late", charge);

/**
 * Ops' ruling on a disputed charge (RULES[6]): refunded gives back what the charge took, the money it kept and the
 * credit it spent; upheld keeps them.
 */
export const DISPUTE_RULINGS = ["refunded", "upheld"] as const;
export type DisputeRuling = (typeof DISPUTE_RULINGS)[number];

/** Where a dispute stands: open while ops look, then as they ruled. */
export type DisputeState = "open" | DisputeRuling;

/** The longest reason a client gives for a dispute: a sentence or two. */
export const DISPUTE_REASON_MAX_CHARS = 300;

/** What a charge took from the client, as recorded on the ruling. */
export interface ChargeTaken {
  /** In paise, kept of the visit's payment. */
  readonly kept: number;
  readonly creditSpent: boolean;
}

/** Whether a charge can be disputed: one that took something, money or a credit. One a charge, at most. */
export const isDisputable = (taken: ChargeTaken): boolean => taken.kept > 0 || taken.creditSpent;

/** The owner's ruling of 30 September 2026 (docs/open-points.md, item 60; ADR 0025, item 85). */
export const DISPUTE_WINDOW_RULE =
  "A client may dispute a no-show's charge for 30 days after it; ops may change the days in the console." as const;

/** Days a client may dispute a charge after it, until ops set another figure (Settings · Rules). */
export const DISPUTE_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The moment a charge made at `chargedAt` can no longer be disputed. Each charge keeps the one it was given. */
export const disputeUntil = (chargedAt: Date, days: number = DISPUTE_WINDOW_DAYS): Date =>
  new Date(chargedAt.getTime() + days * DAY_MS);

/** Whether a charge's window is still open. A charge made before windows were kept has none, and stays open. */
export const withinDisputeWindow = (until: string | null, now: Date): boolean =>
  until === null || now.getTime() < new Date(until).getTime();

/**
 * What waiving a no-show gives the client back of what the visit took: its
 * payment refunded, its credit returned. The prompt's rule (RULES[3]) says a
 * charge keeps it, as a cancel inside 24 hours does; it says nothing of a
 * waiver, which the owner ruled on 27 September 2026: a waiver refunds the
 * payment and returns the credit (docs/owner-answers-2026-09-27.md). A waiver
 * means we accept the fault, so keeping the money would contradict it. Ops set
 * it in the console with every other policy; each ruling keeps what it gave back.
 */
export type Waiver = Readonly<{ payment: "refunded" | "kept"; credit: "returned" | "spent" }>;

export const WAIVER_KEYS = ["payment", "credit"] as const;

export const WAIVER_GIVES_BACK: Waiver = { payment: "refunded", credit: "returned" };
