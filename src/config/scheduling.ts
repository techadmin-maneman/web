// A working day, as booking and dispatch count it (docs/decisions/0035-window-slot-map.md).
// The client books one of three windows; the dispatch board has four slots a
// day. Slots are counted in halves, so a replacement's slot and a half is a
// whole number. The times are placeholders until the owner rules
// (docs/open-points.md, item 53).

import type { VisitType } from "./visit-types.ts";

export const SLOTS_PER_DAY = 4;
/** Half-slots in a day. */
export const UNITS_PER_DAY = SLOTS_PER_DAY * 2;

/** When each half-slot starts, in India's time. */
export const UNIT_STARTS = ["09:00", "10:30", "12:00", "13:00", "14:00", "15:00", "16:00", "18:00"] as const;

export const BOOKING_WINDOWS = ["morning", "afternoon", "evening"] as const;
export type BookingWindow = (typeof BOOKING_WINDOWS)[number];

/** Each window's span, in India's time. */
export const WINDOW_TIMES: Readonly<Record<BookingWindow, { start: string; end: string }>> = {
  morning: { start: "09:00", end: "12:00" },
  afternoon: { start: "12:00", end: "16:00" },
  evening: { start: "16:00", end: "20:00" },
};

/** WINDOW_SLOT_MAP: the half-slots a visit booked in each window may start in. */
export const WINDOW_SLOT_MAP: Readonly<Record<BookingWindow, readonly number[]>> = {
  morning: [0, 1],
  afternoon: [2, 3, 4, 5],
  evening: [6, 7],
};

/**
 * Each visit type's block, in half-slots (consultation and service one slot,
 * replacement one and a half, first fit two), and how long FSM books it for.
 * The owner kept the design's four lengths on 24 September 2026, the service's
 * 90 minutes among them (docs/open-points.md, "Visit lengths").
 */
export const VISIT_BLOCKS: Readonly<Record<VisitType, { readonly units: number; readonly minutes: number }>> = {
  consultation: { units: 2, minutes: 60 },
  service: { units: 2, minutes: 90 },
  replacement: { units: 3, minutes: 135 },
  first_fit: { units: 4, minutes: 180 },
};

/** How far ahead the date strip reaches (board C2), from tomorrow. */
export const BOOKING_DAYS = 14;

/** How long a held slot waits for payment (board C4's countdown from 10:00). */
export const HOLD_SECONDS = 600;

/**
 * How long after the countdown a payment still counts as made in time, by
 * Razorpay's own clock for it, and how long an unpaid hold with an order keeps
 * its time before anyone else may take it (docs/decisions/0068-a-paid-hold-is-kept.md).
 */
export const PAYMENT_GRACE_SECONDS = 120;

/**
 * How long a move on the dispatch board holds the time it is moving a job to
 * while FSM is written. A move still open after this never finished, and the
 * next move or the sweeper lets its time go
 * (docs/decisions/0069-dispatch-under-concurrency.md).
 */
export const MOVE_CLAIM_SECONDS = 300;
