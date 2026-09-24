// When the client is not home (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them, the wait they turn on, and the three
// facts ops rule on. Nothing here charges anybody: the server opens the case
// and a person decides it.

import type { VisitType } from "../config/visit-types.ts";

export const RULES = [
  "The wait timer starts at check-in and runs config NO_SHOW_WAIT_MIN (15) minutes.",
  "Close as no-show is disabled until the timer ends.",
  "Ops then receive three facts: check-in time, distance, and the delivery receipt of the day-before or arrival WhatsApp to the client (from the BSP's delivery webhook).",
  "A no-show is charged under the 24-hour policy. The charge is applied by ops from the evidence, never automatically.",
  "Whether the wait differs for a first fit is open, so make it config per visit type.",
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
 * When the wait that started at check-in ends. The waits ops have set, or the
 * ones above: they are ops-editable inputs (docs/decisions/0060-ops-editable-inputs.md),
 * so every caller passes what is in force and the rule still stands on its own.
 */
export const waitEndsAt = (checkedInAt: Date, type: VisitType, wait: Waits = NO_SHOW_WAIT_MIN): Date =>
  new Date(checkedInAt.getTime() + wait[type] * 60_000);

/** Whether the technician may close the job as a no-show yet. */
export const canCloseAsNoShow = (
  checkedInAt: Date,
  type: VisitType,
  now: Date,
  wait: Waits = NO_SHOW_WAIT_MIN,
): boolean => now.getTime() >= waitEndsAt(checkedInAt, type, wait).getTime();

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
