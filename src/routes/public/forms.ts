// A booking or a waitlist place from a public form: the site's own (./consultations.ts) or an invite's landing
// (./referral-landing.ts). Each door says only what it adds (the invite, how the friend hears of the fit, where the
// hair loss is, how the visitor came, a discount code); both book the same way, once for the request's
// Idempotency-Key, and answer alike: 201 with what was made, or why nothing was for a number we know, or the refusal.

import type { Context } from "hono";
import type { AppEnv } from "../../http/context.ts";
import {
  bookConsultation,
  type Booked,
  type ConsultationRequest,
  type NotBooked,
  type StandingCode,
} from "../../domain/booking/public-consultation.ts";
import type { Refusal } from "../../domain/booking/public-booking.ts";
import { joinTheWaitlist, type WaitlistRequest } from "../../domain/booking/public-waitlist.ts";
import { loadSlotSchedule, type SlotSchedule } from "../../domain/booking/slot-times.ts";
import { windowTimesOf, type WindowTimes } from "../../policy/slot-times.ts";
import { answerKeyed, onceForKey } from "../../http/idempotency.ts";
import { formRequest } from "../../http/public-form.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { MINUTE_MS } from "../../lib/durations.ts";

/** The request as its Idempotency-Key is kept: the route it came to, the key, and what was sent. */
interface Keyed {
  readonly route: string;
  readonly key: string | undefined;
  readonly request: object;
}

/** A code as it stands on a site booking: what it takes off comes off the hair system's price when they pay. */
function standingCodeBody(standing: StandingCode | null) {
  if (standing === null) return null;
  const { kind, value, cap } = standing.terms;
  return { code: standing.code, kind, value, cap };
}

/** When the booking is: the window and its hours that day, and its start with the end of the arrival window after it. */
interface BookedTimes {
  readonly hours: WindowTimes;
  readonly arrivalMinutes: number;
}

/** A visit's start and the end of its arrival window after it; both null for a request ops fix the hour of. */
function startAndArrival(startsAt: Date | null, arrivalMinutes: number) {
  if (startsAt === null) return { starts_at: null, arrives_by: null };
  const arrives = new Date(startsAt.getTime() + arrivalMinutes * MINUTE_MS);
  return { starts_at: startsAt.toISOString(), arrives_by: arrives.toISOString() };
}

/** What a booking answers: the day, the window and its hours, the start and the arrival, the area, credits and invite. */
export function bookedBody(booked: Booked, { hours, arrivalMinutes }: BookedTimes) {
  const { state, date, window, area, credits, invite, oneVisit, startsAt } = booked;
  const { starts_at, arrives_by } = startAndArrival(startsAt, arrivalMinutes);
  return { state, date, window, hours, starts_at, arrives_by, area, credits, invite, one_visit: oneVisit };
}

/** What a number we know is answered when nothing is booked: why, with its consultation still to come where it has one. */
function notBookedBody(known: NotBooked, schedule: SlotSchedule, arrivalMinutes: number) {
  const { state, reason, consultation } = known;
  if (consultation === null) return { state, reason, consultation: null };
  const { date, window, startsAt } = consultation;
  const hours = windowTimesOf(schedule.on(date))[window];
  return { state, reason, consultation: { date, window, hours, ...startAndArrival(startsAt, arrivalMinutes) } };
}

/** What a booking on the site's own page answers: the same, with its discount code as it stands. */
export const bookedWithCode = (booked: Booked, times: BookedTimes) => ({
  ...bookedBody(booked, times),
  discount_code: standingCodeBody(booked.discountCode),
});

/** A consultation, or a consultation and fit, booked from a form, and answered as the door answers it. */
export async function bookFromForm<Body>(
  c: Context<AppEnv>,
  keyed: Keyed,
  request: () => Promise<ConsultationRequest>,
  answerOf: (booked: Booked, times: BookedTimes) => Body,
) {
  type Answered = { readonly ok: true; readonly body: Body | ReturnType<typeof notBookedBody> } | Refusal;
  const run = await onceForKey(c, keyed, async (): Promise<Answered> => {
    // The day's times are read beside the booking, so the answer waits on no further trip.
    const [booked, schedule, inputs] = await Promise.all([
      request().then((asked) => bookConsultation(formRequest(c), asked)),
      loadSlotSchedule(c.env.DB),
      opsInputs(c),
    ]);
    if (!booked.ok) return booked;
    if (booked.state === "not_booked") {
      return { ok: true as const, body: notBookedBody(booked, schedule, inputs.bookingRules.arrival) };
    }
    const hours = windowTimesOf(schedule.on(booked.date))[booked.window];
    return { ok: true as const, body: answerOf(booked, { hours, arrivalMinutes: inputs.bookingRules.arrival }) };
  });
  return answerKeyed(c, run);
}

/** A place on the waitlist for a pincode we do not serve yet, from a form. */
export async function joinWaitlistFromForm(c: Context<AppEnv>, keyed: Keyed, request: () => Promise<WaitlistRequest>) {
  const run = await onceForKey(c, keyed, async () => {
    const listed = await joinTheWaitlist(formRequest(c), await request());
    if (!listed.ok) return listed;
    return { ok: true as const, body: { area: listed.area, credits: listed.credits, invite: listed.invite } };
  });
  return answerKeyed(c, run);
}
