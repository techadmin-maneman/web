// What the visit change tests share (visit-changes*.test.ts): a client's booked visit, the client app, and the visit
// and its changes as the database holds them.

import { env } from "cloudflare:workers";
import { appFor, fakeDependencies, NOW } from "../helpers.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";

export const VISIT = "22222222-2222-4222-8222-222222222222";

export const PAYMENT = "33333333-3333-4333-8333-333333333333";

/** Thursday 24 September, afternoon: free to change until Wednesday noon. */
export const THURSDAY_NOON = "2026-09-24T06:30:00.000Z";

/** Tuesday 22 September, morning: inside 24 hours from NOW. */
export const TUESDAY_MORNING = "2026-09-22T03:30:00.000Z";

/** A booked, paid visit with Imran. */
export async function booked(type: string, start: string, amount: number) {
  const minutes = type === "first_fit" ? 180 : 90;
  const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
       synced_at)
     VALUES (?1, ?1, ?2, ?3, 'scheduled', ?4, ?5, 't1', ?6)`,
  )
    .bind(VISIT, PERSON, type, start, end, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, captured_at, created_at, updated_at)
     VALUES (?1, 'MM-2026-0841', ?2, ?3, 'pay_visit', ?4, 'INR', 'upi', 'captured', ?5, ?5, ?5)`,
  )
    .bind(PAYMENT, PERSON, VISIT, amount, "2026-09-20T06:30:00.000Z")
    .run();
}

export function client(overrides: Parameters<typeof fakeDependencies>[0] = {}, settings = {}) {
  return appFor("local", fakeDependencies(overrides), settings, "client");
}

export const visitRow = () =>
  env.DB.prepare("SELECT status, window_start, window_end FROM appointments WHERE id = ?1")
    .bind(VISIT)
    .first<{ status: string; window_start: string; window_end: string }>();

export const changes = () =>
  env.DB.prepare(
    "SELECT kind, notice, refund_amount, kept_amount, payment_id, now_start FROM visit_changes ORDER BY created_at",
  ).all();
