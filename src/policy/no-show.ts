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
 * prompt gives 15 minutes and leaves a first fit open, so every type waits the
 * same until the owner rules (docs/open-points.md, item 45).
 */
export const NO_SHOW_WAIT_MIN: Readonly<Record<VisitType, number>> = {
  consultation: 15,
  service: 15,
  replacement: 15,
  first_fit: 15,
};

/** When the wait that started at check-in ends. */
export const waitEndsAt = (checkedInAt: Date, type: VisitType): Date =>
  new Date(checkedInAt.getTime() + NO_SHOW_WAIT_MIN[type] * 60_000);

/** Whether the technician may close the job as a no-show yet. */
export const canCloseAsNoShow = (checkedInAt: Date, type: VisitType, now: Date): boolean =>
  now.getTime() >= waitEndsAt(checkedInAt, type).getTime();

/** The three facts ops rule on, and nothing else. */
export interface Evidence {
  readonly checkedInAt: string;
  readonly distanceM: number;
  /** When the BSP reported the day-before or arrival WhatsApp delivered; null if it never was. */
  readonly messageDeliveredAt: string | null;
}

/** Ops' ruling on a case, which the server never makes for them. */
export const NO_SHOW_DECISIONS = ["undecided", "charged", "waived"] as const;
export type NoShowDecision = (typeof NO_SHOW_DECISIONS)[number];
