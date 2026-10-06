// What the money path tests share (money-path*.test.ts): the clients signed in, a hold made and ordered, Razorpay's
// webhook signed, a payment, and the rows and passes each reads.

import { env } from "cloudflare:workers";
import { bookUnbookedHolds } from "../../../src/domain/booking/unbooked-holds.ts";
import { createLogger } from "../../../src/log.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { createCallBudget, type CallBudget } from "../../../src/lib/call-budget.ts";
import type { PaymentsProvider } from "../../../src/providers/payments/index.ts";
import { fakeDependencies, fakeQueue, NOW, deliverRazorpay } from "../helpers.ts";
import { asClient, client, fittedInAugust, signedIn, type Call } from "../clients.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";

export const OTHER = "55555555-5555-4555-8555-555555555555";

export const SECRET = "a-razorpay-webhook-secret-for-the-money-path";

export const SECOND = 1000;

export const at = (seconds: number) => new Date(NOW.getTime() + seconds * SECOND);

export const cookies = new Map<string, string>();

export const call = (personId: string, path: string, init: Call = {}, now = NOW) =>
  asClient(cookies.get(personId) ?? "", path, init, { now, bindings: { MESSAGE_QUEUE: fakeQueue() } });

export async function fittedPerson(id: string, mobile: string, name: string) {
  await client(id, mobile, name);
  await fittedInAugust(id, `fit-${id}`);
  cookies.set(id, await signedIn(id));
}

export interface Through {
  readonly payments?: PaymentsProvider;
  readonly refund?: object;
  /** The database the webhook writes through, as when its connection is lost part-way. */
  readonly db?: D1Database;
}

/**
 * Razorpay's signed webhook for a payment, or for `through.refund` of it, delivered at `now`. It books the hold itself,
 * refunding through `through.payments` a payment made too late.
 */
export async function webhook(event: string, eventId: string, payment: object, now: Date, through: Through = {}) {
  const payments = through.payments ?? createStubPayments();
  const refund = through.refund === undefined ? {} : { refund: { entity: through.refund } };
  const answer = await deliverRazorpay(
    { entity: "event", event, payload: { payment: { entity: payment }, ...refund } },
    {
      eventId,
      deps: fakeDependencies({ now: () => now, payments }),
      settings: { razorpay: { keyId: "rzp_test_money", keySecret: "s", webhookSecret: SECRET } },
      bindings: { MESSAGE_QUEUE: fakeQueue(), ...(through.db === undefined ? {} : { DB: through.db }) },
    },
  );
  return { status: answer.status };
}

/** A service visit held on Thursday afternoon, and its Razorpay order. */
export async function heldAndOrdered(personId: string, now = NOW, date = "2026-09-24", window = "afternoon") {
  const body = { type: "service", date, window };
  const held = await call(personId, "/api/holds", { method: "POST", body }, now);
  const hold = await held.json<{ id: string; expires_at: string }>();
  const started = await call(personId, "/api/bookings", { method: "POST", body: { hold_id: hold.id } }, now);
  const checkout = (await started.json<{ checkout: { order_id: string; amount: number } | null }>()).checkout;
  return { holdId: hold.id, orderId: checkout?.order_id ?? "", amount: checkout?.amount ?? 0 };
}

/** Razorpay's payment entity: `madeAt` is Razorpay's own time for it. */
export const payment = (id: string, ordered: { holdId: string; orderId: string; amount: number }, madeAt: Date) => ({
  id,
  amount: ordered.amount,
  currency: "INR",
  status: "captured",
  order_id: ordered.orderId,
  method: "upi",
  notes: { hold_id: ordered.holdId, person_id: PERSON },
  created_at: Math.floor(madeAt.getTime() / SECOND),
});

export const holdRow = (id: string) =>
  env.DB.prepare("SELECT state, refunded_at FROM slot_holds WHERE id = ?1").bind(id).first();

export const scheduledServiceVisits = (personId: string) =>
  env.DB.prepare("SELECT id FROM appointments WHERE person_id = ?1 AND type = 'service' AND status = 'scheduled'")
    .bind(personId)
    .all();

/** The cron's half-hour pass over paid holds: how many it booked. */
export function halfHourPass(now: Date, budget: CallBudget = createCallBudget(40), deps = fakeDependencies()) {
  return bookUnbookedHolds(env.DB, { ...deps, notify: () => Promise.resolve(), budget, log: createLogger() }, now);
}
