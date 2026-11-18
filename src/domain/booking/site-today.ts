// A booking from the site for today (docs/decisions/0086-the-next-visit-is-offered.md): held to what the form offers
// today, from the lead time on, whoever's the number. Used by ./public-consultation.ts.

import type { BookingWindow } from "../../config/scheduling.ts";
import { indiaTime } from "../../lib/india-time.ts";
import type { WindowTimes } from "../../policy/slot-times.ts";
import type { OpsInputs } from "../platform/ops-settings.ts";
import { requestStartsToday } from "./open-windows.ts";
import type { Plan } from "../../policy/one-visit.ts";
import { siteVisit } from "./site-visit.ts";

/** What of a booking from the form today's checks read. */
interface AskedToday {
  readonly plan: Plan;
  readonly date: string;
  readonly pincode: string;
  readonly window: BookingWindow;
  readonly startsAt: Date | null;
}

/**
 * A booking for today the form would not offer. One ops are only asked for (`byRequest`) is held to the form's request
 * grid in its window from the lead time on (requestStartsToday): a start off it, or no start chosen in a window with
 * none left. A slot is held to the lead time here, a window that ends by then refused, and to its own starts by the
 * hold.
 */
export function tooSoon(today: {
  readonly request: AskedToday;
  readonly hours: Readonly<Record<BookingWindow, WindowTimes>>;
  readonly inputs: OpsInputs;
  readonly earliest: string | null;
  readonly byRequest: boolean;
}): boolean {
  const { request, earliest } = today;
  if (earliest === null) return false;
  if (!today.byRequest) {
    return request.startsAt === null
      ? today.hours[request.window].end <= earliest
      : indiaTime(request.startsAt) < earliest;
  }
  const starts = requestStartsToday(request.window, today.hours, today.inputs, earliest);
  return request.startsAt === null ? starts.length === 0 : !starts.includes(indiaTime(request.startsAt));
}

/** Whether a booking on the day is only a request ops fix the hour of: self-serve booking off, or no visit offered. */
export async function bookedByRequest(db: D1Database, request: AskedToday, selfServeBooking: boolean) {
  return !selfServeBooking || (await siteVisit(db, request.plan, request.date, request.pincode)) === null;
}
