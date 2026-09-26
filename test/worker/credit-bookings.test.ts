// Booking with a service-visit credit (board C5), and what moving or cancelling such a visit does to the credit
// (docs/decisions/0033-credit-ledger.md, "Spending"). NOW is Monday 21 September 2026, 12 noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../src/config/message-templates.ts";
import { confirmBooking } from "../../src/domain/bookings.ts";
import { creditBalance, grantCredits } from "../../src/domain/credits.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { composeVisitMessage } from "../../src/domain/visit-messages.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
import { createStubPayments } from "../../src/providers/razorpay.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const world = () => ({
  ...EMPTY_FSM,
  items: [{ id: "item-service", name: "Service visit", type: "Service" as const, price: null }],
});

let cookie: string;
const app = () => appFor("local", fakeDependencies(), {}, "client");
const post = (path: string, body: object, bindings = {}) =>
  request(
    app(),
    path,
    {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(body),
    },
    bindings,
  );

async function credits(visits: number) {
  await grantCredits(env.DB, { personId: PERSON, visits, source: "ops", sourceId: "o1", now: NOW }).run();
}

/** A service visit held, and booked in FSM and the mirror. Returns the visit's ID. */
async function bookService(
  date = "2026-09-24",
  window = "afternoon",
): Promise<{ visitId: string; hold: Record<string, unknown> }> {
  const hold = await (await post("/api/holds", { type: "service", date, window })).json<Record<string, unknown>>();
  const started = await post("/api/bookings", { hold_id: hold.id }, { FSM_QUEUE: fakeQueue() });
  expect(await started.json()).toEqual({ hold_id: hold.id, checkout: null });
  expect(
    await confirmBooking(env.DB, createStubFsm(world()), createStubPayments(), String(hold.id), NOW, {
      labelAsTest: true,
    }),
  ).toBe("booked");
  const visit = await env.DB.prepare("SELECT appointment_id FROM slot_holds WHERE id = ?1").bind(hold.id).first<{
    appointment_id: string;
  }>();
  // The mirror gives a booked visit its work order; changing it needs one.
  await env.DB.prepare("UPDATE appointments SET fsm_work_order_id = 'fsm-order-1' WHERE id = ?1")
    .bind(visit?.appointment_id)
    .run();
  return { visitId: visit?.appointment_id ?? "", hold };
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'contact-1')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  // Fitted, so service visits are what they book.
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end, technician_id,
       fsm_modified_at, synced_at)
     VALUES ('fit', 'fsm-fit', ?1, 'first_fit', 'completed', 'Completed', '2026-08-01T03:30:00.000Z',
       '2026-08-01T06:30:00.000Z', 't1', ?2, ?2)`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at) VALUES ('c1', ?1, 'whatsapp_visits', 'whatsapp-visits-v1', 1, ?2)",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

describe("booking with a credit", () => {
  it("covers a service visit with a credit, skips payment, and redeems it once the visit is booked", async () => {
    await credits(2);
    const { visitId, hold } = await bookService();
    expect(hold).toMatchObject({ price: { amount: 200000 }, credit: { remaining: 1 } });
    expect(await creditBalance(env.DB, PERSON, NOW)).toMatchObject({ visits: 1 });
    const redeemed = await env.DB.prepare("SELECT visits FROM credit_ledger WHERE kind = 'redeem' AND source_id = ?1")
      .bind(visitId)
      .first();
    expect(redeemed).toEqual({ visits: -1 });
    const composed = await composeVisitMessage(env.DB, "payment_receipt", visitId, PERSON);
    expect("skip" in composed ? composed : renderMessage(composed.template, composed.params)).toBe(
      "Hello Rohit, your service visit is booked for Thu 24 Sep, 12 to 4 pm, with Imran. One of your visit credits covers it.",
    );
  });

  it("asks for payment as ever without a credit", async () => {
    const hold = await (await post("/api/holds", { type: "service", date: "2026-09-24", window: "afternoon" })).json();
    expect(hold).toMatchObject({ credit: null });
    const started = await (await post("/api/bookings", { hold_id: (hold as { id: string }).id })).json();
    expect(started).toMatchObject({ checkout: { amount: 200000 } });
  });
});

describe("changing a visit paid with a credit", () => {
  it("gives the credit back when cancelled more than 24 hours out", async () => {
    await credits(1);
    const { visitId } = await bookService("2026-09-24");
    const terms = await (await post(`/api/appointments/${visitId}/cancel`, { confirm: false })).json();
    expect(terms).toMatchObject({ notice: "free", refund: 0, kept: 0, credit: "restored" });
    await post(
      `/api/appointments/${visitId}/cancel`,
      { confirm: true, notice: "free" },
      { MESSAGE_QUEUE: fakeQueue() },
    );
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(1);
    const composed = await composeVisitMessage(env.DB, "cancel_confirmation", visitId, PERSON);
    expect("skip" in composed ? composed : renderMessage(composed.template, composed.params)).toBe(
      "Hello Rohit, your service visit on Thu 24 Sep is cancelled. Your visit credit is back.",
    );
  });

  it("loses the credit when cancelled inside 24 hours", async () => {
    await credits(1);
    const { visitId } = await bookService("2026-09-22", "morning");
    const terms = await (await post(`/api/appointments/${visitId}/cancel`, { confirm: false })).json();
    expect(terms).toMatchObject({ notice: "late", credit: "lost" });
    await post(
      `/api/appointments/${visitId}/cancel`,
      { confirm: true, notice: "late" },
      { MESSAGE_QUEUE: fakeQueue() },
    );
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(0);
  });
});
