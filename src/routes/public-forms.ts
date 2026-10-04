// A booking or a waitlist place from a public form: the site's own (./consultations.ts) or an invite's landing
// (./referral-landing.ts). Each door says only what it adds (the invite, how the friend hears of the fit, where the
// hair loss is, how the visitor came, a discount code); both book the same way, once for the request's
// Idempotency-Key, and answer alike: 201 with what was made, or the refusal.

import type { Context } from "hono";
import type { AppEnv } from "../http/context.ts";
import {
  bookConsultation,
  joinTheWaitlist,
  type Booked,
  type ConsultationRequest,
  type Refusal,
  type StandingCode,
  type WaitlistRequest,
} from "../domain/public-booking.ts";
import { errorBody } from "../http/errors.ts";
import { onceForKey, type KeyedRun } from "../http/idempotency.ts";
import { formRequest } from "../http/public-form.ts";

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

/** What a booking answers: the day, the window and the area, the credits and the invite. */
export function bookedBody(booked: Booked) {
  const { state, date, window, area, credits, invite, oneVisit } = booked;
  return { state, date, window, area, credits, invite, one_visit: oneVisit };
}

/** What a booking on the site's own page answers: the same, with its discount code as it stands. */
export const bookedWithCode = (booked: Booked) => ({
  ...bookedBody(booked),
  discount_code: standingCodeBody(booked.discountCode),
});

/** A keyed run answered: its first success again, the key's conflict, its success now, or its refusal. */
function answered<Body>(c: Context<AppEnv>, run: KeyedRun<{ readonly ok: true; readonly body: Body } | Refusal>) {
  const { requestId } = c.var;
  if (run.kind === "replay") return c.json(run.body, 201);
  if (run.kind === "in_progress") return c.json(errorBody("idempotency_in_progress", requestId), 409);
  if (run.kind === "key_reused") return c.json(errorBody("idempotency_key_reused", requestId), 422);
  const { outcome } = run;
  if (outcome.ok) return c.json(outcome.body, 201);
  return c.json(errorBody(outcome.code, requestId, outcome.fields), outcome.status);
}

/** A consultation, or a consultation and fit, booked from a form, and answered as the door answers it. */
export async function bookFromForm<Body>(
  c: Context<AppEnv>,
  keyed: Keyed,
  request: () => Promise<ConsultationRequest>,
  answerOf: (booked: Booked) => Body,
) {
  const run = await onceForKey(c, keyed, async () => {
    const booked = await bookConsultation(formRequest(c), await request());
    return booked.ok ? { ok: true as const, body: answerOf(booked) } : booked;
  });
  return answered(c, run);
}

/** A place on the waitlist for a pincode we do not serve yet, from a form. */
export async function joinWaitlistFromForm(c: Context<AppEnv>, keyed: Keyed, request: () => Promise<WaitlistRequest>) {
  const run = await onceForKey(c, keyed, async () => {
    const listed = await joinTheWaitlist(formRequest(c), await request());
    if (!listed.ok) return listed;
    return { ok: true as const, body: { area: listed.area, credits: listed.credits, invite: listed.invite } };
  });
  return answered(c, run);
}
