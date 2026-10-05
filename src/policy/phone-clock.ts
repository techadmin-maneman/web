// How far a technician's phone is trusted about time
// (docs/decisions/0065-a-technicians-writes-reach-fsm.md).
//
// A phone in a basement records the work as it happens and sends it when it
// finds signal, so when the work happened is the phone's to say: a check-in
// carries its own time, and every write's X-Client-Event-Id is a UUIDv7, which
// begins with the millisecond the phone queued it. But the phone's clock is the
// technician's to set, and a check-in's time is the evidence a no-show is
// charged on, so the server keeps the phone's time only within these bounds,
// and keeps its own beside it.

import { indiaDate } from "../lib/india-time.ts";
import { HOUR_MS, MINUTE_MS } from "../lib/durations.ts";

/**
 * How long before the booked start a technician may check in. Early
 * enough for one who beats the traffic, too early to back-date a morning's
 * check-in into the night before.
 */
export const EARLIEST_BEFORE_START_MIN = 60;

/**
 * How long a phone may hold a write and still have its time believed. The app
 * keeps today's and tomorrow's jobs, so a day covers any genuine replay.
 */
export const MAX_OFFLINE_HOURS = 24;

/**
 * The two bounds, as ops set them in the console (docs/decisions/0088-every-policy-in-the-console.md): minutes
 * before the booked start, and hours a write may be held. The committed figures above until they do.
 */
export const PHONE_CLOCK_KEYS = ["before_start", "held_offline"] as const;
export type PhoneClock = Readonly<Record<(typeof PHONE_CLOCK_KEYS)[number], number>>;

export const PHONE_CLOCK: PhoneClock = { before_start: EARLIEST_BEFORE_START_MIN, held_offline: MAX_OFFLINE_HOURS };

/** The earliest moment a technician may check in or start: the booked start less the minutes ops allow. */
export const earliestCheckIn = (visitStart: Date, clock: PhoneClock = PHONE_CLOCK): Date =>
  new Date(visitStart.getTime() - clock.before_start * MINUTE_MS);

/** Whether a check-in or a start reached the server before the earliest check-in. */
export const tooEarlyToArrive = (receivedAt: Date, visitStart: Date, clock: PhoneClock = PHONE_CLOCK): boolean =>
  receivedAt.getTime() < earliestCheckIn(visitStart, clock).getTime();

/** The phone's time for something it did, held within the bounds above; the server's own when it gave none. */
export function boundedPhoneTime(
  claimed: Date | null,
  bounds: { visitStart: Date; receivedAt: Date },
  clock: PhoneClock = PHONE_CLOCK,
): Date {
  if (claimed === null || Number.isNaN(claimed.getTime())) return bounds.receivedAt;
  const received = bounds.receivedAt.getTime();
  const earliest = Math.max(
    earliestCheckIn(bounds.visitStart, clock).getTime(),
    received - clock.held_offline * HOUR_MS,
  );
  return new Date(Math.min(received, Math.max(earliest, claimed.getTime())));
}

/** Whether a check-in or a start falls on the visit's own date, in India. */
export const onTheVisitsDay = (at: Date, visitStart: Date): boolean => indiaDate(at) === indiaDate(visitStart);
