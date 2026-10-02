// A working day, as booking and dispatch count it (docs/decisions/0035-window-slot-map.md).
// The client books one of three windows; the dispatch board has four slots a
// day. Slots are counted in halves, so a replacement's slot and a half is a
// whole number. The times here are the defaults: ops set others in the console,
// each from a day nothing is booked or bookable on (src/policy/slot-times.ts;
// docs/decisions/0102-window-times.md). Which half-slots each window has stays here.

import type { VisitType } from "./visit-types.ts";

export const SLOTS_PER_DAY = 4;
/** Half-slots in a day. */
export const UNITS_PER_DAY = SLOTS_PER_DAY * 2;

/** When each half-slot starts, in India's time, until ops set other times. */
export const UNIT_STARTS = ["09:00", "10:30", "12:00", "13:00", "14:00", "15:00", "16:00", "18:00"] as const;
/** When the day ends, and the evening with it, until ops set another time. */
export const DAY_END = "20:00";

export const BOOKING_WINDOWS = ["morning", "afternoon", "evening"] as const;
export type BookingWindow = (typeof BOOKING_WINDOWS)[number];

/**
 * Each window's span under the default times, which the site prints until it reads the day's hours from the API.
 * mm-api reads a day's windows from the times in force on it (windowTimesOf, src/policy/slot-times.ts).
 */
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

/**
 * How many days the date strip offers at once (board C2), from its first day, and so how far ahead the site's
 * consultation form reaches from tomorrow. How far ahead a visit may be booked in the app is ops' to set, 45 days
 * to begin with (`horizon`, src/policy/next-visit.ts).
 */
export const BOOKING_DAYS = 14;

/** The windows a visit of this many half-slots can start in: those with a half-slot it fits after, inside the day. */
export const windowsFitting = (units: number): BookingWindow[] =>
  BOOKING_WINDOWS.filter((window) => WINDOW_SLOT_MAP[window].some((start) => start + units <= UNITS_PER_DAY));

/**
 * The windows a visit of this type can start in. A first fit's two slots and a replacement's slot and a half do not
 * fit in the evening.
 */
export const windowsFor = (type: VisitType): BookingWindow[] => windowsFitting(VISIT_BLOCKS[type].units);

/** The windows a first fit can start in (windowsFor), which a request for one may name. */
export const FIRST_FIT_WINDOWS = ["morning", "afternoon"] as const;
export type FirstFitWindow = (typeof FIRST_FIT_WINDOWS)[number];

/** How long a held slot waits for payment (board C4's countdown from 10:00). */
export const HOLD_SECONDS = 600;

/**
 * How long after the countdown a payment still counts as made in time, by
 * Razorpay's own clock for it, and how long an unpaid hold with an order keeps
 * its time before anyone else may take it (docs/decisions/0068-a-paid-hold-is-kept.md).
 * A hold keeps the grace it was made with (slot_holds.grace_seconds); this is a
 * hold's that was made before holds kept one.
 */
export const PAYMENT_GRACE_SECONDS = 120;

export const PAYMENT_HOLD_KEYS = ["countdown", "grace"] as const;
/** The countdown and the grace, in minutes, as ops set them in the console (docs/decisions/0088-every-policy-in-the-console.md). */
export type PaymentHold = Readonly<Record<(typeof PAYMENT_HOLD_KEYS)[number], number>>;

export const PAYMENT_HOLD: PaymentHold = { countdown: HOLD_SECONDS / 60, grace: PAYMENT_GRACE_SECONDS / 60 };

/**
 * How long a move on the dispatch board holds the time it is moving a job to
 * while FSM is written. A move still open after this never finished, and the
 * next move or the sweeper lets its time go
 * (docs/decisions/0069-dispatch-under-concurrency.md).
 */
export const MOVE_CLAIM_SECONDS = 300;
