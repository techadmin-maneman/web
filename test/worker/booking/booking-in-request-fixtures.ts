// What the booking-in-request tests share (booking-in-request*.test.ts): the clients and their sessions, a hold made
// and ordered, Razorpay's webhook signed, the queue the app sends messages to, and the rows each test reads back.

import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { fakeDependencies, fakeQueue, NOW, type TestDependencies, deliverRazorpay } from "../helpers.ts";
import { asClient, client, fittedInAugust, signedIn, type Call } from "../clients.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";

export const VISIT = "22222222-2222-4222-8222-222222222222";

export const PAYMENT = "33333333-3333-4333-8333-333333333333";

export const SECRET = "a-razorpay-webhook-secret-for-bookings";

/** Thursday 24 September, afternoon: free to change until Wednesday noon. */
export const THURSDAY_NOON = "2026-09-24T06:30:00.000Z";

export const SECOND = 1000;

export const at = (seconds: number) => new Date(NOW.getTime() + seconds * SECOND);

export const cookies = new Map<string, string>();

export let messageQueue: ReturnType<typeof fakeQueue>;

/** Puts this queue where the app sends its messages, for the test. */
export const useMessageQueue = (queue: ReturnType<typeof fakeQueue>) => {
  messageQueue = queue;
};

export const bindings = () => ({ MESSAGE_QUEUE: messageQueue, CRM_QUEUE: fakeQueue() });

export const call = (
  personId: string,
  path: string,
  init: Call = {},
  deps: TestDependencies = fakeDependencies(),
  database: D1Database = env.DB,
) => asClient(cookies.get(personId) ?? "", path, init, { deps, bindings: { ...bindings(), DB: database } });

/** Razorpay's signed webhook for a payment. */
export async function webhook(
  event: string,
  eventId: string,
  payment: object,
  deps: TestDependencies = fakeDependencies(),
) {
  const answer = await deliverRazorpay(
    { entity: "event", event, payload: { payment: { entity: payment } } },
    {
      eventId,
      deps,
      settings: { razorpay: { keyId: "rzp_test_ours", keySecret: "s", webhookSecret: SECRET } },
      bindings: bindings(),
    },
  );
  return answer.status;
}

/** Razorpay's payment entity for an order of ours, made at `madeAt`. */
export const payment = (id: string, ordered: { holdId: string; orderId: string; amount: number }, madeAt = at(30)) => ({
  id,
  amount: ordered.amount,
  currency: "INR",
  status: "captured",
  order_id: ordered.orderId,
  method: "upi",
  notes: { hold_id: ordered.holdId, person_id: PERSON },
  created_at: Math.floor(madeAt.getTime() / SECOND),
});

export async function signedInClient(id: string, mobile: string, name: string) {
  await client(id, mobile, name);
  cookies.set(id, await signedIn(id));
}

/** A client fitted in August, so a service visit is theirs to book. */
export async function fittedClient() {
  await signedInClient(PERSON, "+919810000001", "Rohit Malhotra");
  await fittedInAugust(PERSON);
}

/** A paid visit with Imran, a service visit unless `type` says. */
export async function booked(start: string, type = "service") {
  const minutes = type === "first_fit" ? 180 : 90;
  const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, technician_id,
       synced_at)
     VALUES (?1, ?1, ?2, ?3, 'standard', 'scheduled', ?4, ?5, 't1', ?6)`,
  )
    .bind(VISIT, PERSON, type, start, end, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, method, status,
       captured_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'pay_visit', 200000, 'INR', 'upi', 'captured', ?4, ?4, ?4)`,
  )
    .bind(PAYMENT, PERSON, VISIT, "2026-09-20T06:30:00.000Z")
    .run();
}

/** A hold for a service visit, and the Razorpay order the app opens Checkout with. */
export async function heldAndOrdered(body: object = { type: "service", date: "2026-09-24", window: "afternoon" }) {
  const held = await call(PERSON, "/api/holds", { method: "POST", body });
  expect(held.status).toBe(201);
  const hold = await held.json<{ id: string }>();
  const started = await call(PERSON, "/api/bookings", { method: "POST", body: { hold_id: hold.id } });
  const checkout = (await started.json<{ checkout: { order_id: string; amount: number } | null }>()).checkout;
  return { holdId: hold.id, orderId: checkout?.order_id ?? "", amount: checkout?.amount ?? 0 };
}

export const holdRow = (id: string) =>
  env.DB.prepare("SELECT state, appointment_id FROM slot_holds WHERE id = ?1")
    .bind(id)
    .first<{ state: string; appointment_id: string | null }>();

export const visitOf = (id: string | null | undefined) =>
  env.DB.prepare(
    `SELECT status, type, tier, technician_id, window_start, window_end, service_city, service_pincode,
       asked_checked_at
     FROM appointments WHERE id = ?1`,
  )
    .bind(id ?? "")
    .first();

export const visitsOf = (personId: string, type: string) =>
  env.DB.prepare("SELECT id, status FROM appointments WHERE person_id = ?1 AND type = ?2 ORDER BY window_start")
    .bind(personId, type)
    .all<{ id: string; status: string }>();

export const messagesOf = (personId: string) =>
  env.DB.prepare("SELECT kind, subject_id FROM outbound_messages WHERE person_id = ?1 ORDER BY created_at")
    .bind(personId)
    .all<{ kind: string; subject_id: string }>();

export const changes = () =>
  env.DB.prepare(
    "SELECT appointment_id, kind, notice, refund_amount, kept_amount, payment_id FROM visit_changes ORDER BY created_at",
  ).all();
