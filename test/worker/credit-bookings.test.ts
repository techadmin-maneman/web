// Booking with a service-visit credit (board C5), one credit for one visit however the bookings race, and what moving
// or cancelling such a visit does to the credit (docs/decisions/0033-credit-ledger.md, "Spending"). NOW is Monday
// 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../src/config/message-templates.ts";
import { confirmBooking } from "../../src/domain/bookings.ts";
import { clawBack, creditBalance, grantCredits } from "../../src/domain/credits.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { composeVisitMessage } from "../../src/domain/visit-messages.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
import { createStubPayments } from "../../src/providers/payments.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  request,
  savedAddress,
} from "./helpers.ts";

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
  await savedAddress(PERSON);
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

describe("one credit pays for one visit", () => {
  const hold = async (date: string, window = "afternoon") =>
    (await post("/api/holds", { type: "service", date, window })).json<{
      id: string;
      credit: unknown;
      price: unknown;
    }>();
  const book = async (holdId: string) =>
    (await post("/api/bookings", { hold_id: holdId }, { FSM_QUEUE: fakeQueue() })).json<{
      hold_id: string;
      checkout: { amount: number } | null;
    }>();
  const get = async (path: string) =>
    (await request(app(), path, { headers: { Cookie: cookie, Origin: "https://maneman.test" } })).json();
  const confirm = (holdId: string, now = NOW, options = {}) =>
    confirmBooking(env.DB, createStubFsm(world()), createStubPayments(), holdId, now, {
      labelAsTest: true,
      ...options,
    });
  const redeems = async () =>
    (await env.DB.prepare("SELECT source_id FROM credit_ledger WHERE kind = 'redeem'").all()).results;

  it("asks for payment on a second visit booked in another tab while the first waits to be booked", async () => {
    await credits(1);
    const first = await hold("2026-09-24");
    expect(await book(first.id)).toEqual({ hold_id: first.id, checkout: null });

    expect(await get("/api/me")).toMatchObject({ credits: null });
    expect(await get("/api/refer")).toMatchObject({ credits: { visits: 0, earliest_expiry: null } });
    const second = await hold("2026-09-25");
    expect(second).toMatchObject({ credit: null, price: { amount: 200000 } });
    expect(await book(second.id)).toMatchObject({ checkout: { amount: 200000 } });

    expect(await confirm(first.id)).toBe("booked");
    expect(await redeems()).toHaveLength(1);
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(0);
  });

  it("covers one of two visits booked in two tabs at the same moment, and asks payment for the other", async () => {
    await credits(1);
    const first = await hold("2026-09-24");
    const second = await hold("2026-09-25");
    // Each tab held its visit on the credit before either was booked.
    await env.DB.prepare("UPDATE slot_holds SET state = 'held', use_credit = 1").run();

    const answers = await Promise.all([book(first.id), book(second.id)]);
    const onCredit = answers.filter((answer) => answer.checkout === null);
    const paid = answers.filter((answer) => answer.checkout?.amount === 200000);
    expect([onCredit.length, paid.length]).toEqual([1, 1]);
  });

  it("asks for payment on a hold whose credit another device's booking took after the hold was made", async () => {
    await credits(1);
    const first = await hold("2026-09-24");
    await book(first.id);
    const second = await hold("2026-09-25");
    // The second device read the balance just before the first booking was confirmed.
    await env.DB.prepare("UPDATE slot_holds SET use_credit = 1 WHERE id = ?1").bind(second.id).run();

    expect(await get(`/api/holds/${second.id}`)).toMatchObject({ credit: null });
    expect(await book(second.id)).toMatchObject({ checkout: { amount: 200000 } });
    const flipped = await env.DB.prepare("SELECT use_credit, confirmed_at FROM slot_holds WHERE id = ?1")
      .bind(second.id)
      .first();
    expect(flipped).toEqual({ use_credit: 0, confirmed_at: null });
  });

  it("confirms a replayed booking call once, and redeems one credit for it", async () => {
    await credits(1);
    const first = await hold("2026-09-24");
    expect(await book(first.id)).toEqual({ hold_id: first.id, checkout: null });
    expect(await book(first.id)).toEqual({ hold_id: first.id, checkout: null });
    expect(await get(`/api/holds/${first.id}`)).toMatchObject({ credit: { remaining: 0 } });

    expect(await confirm(first.id)).toBe("booked");
    expect(await confirm(first.id)).toBe("already_booked");
    expect(await redeems()).toHaveLength(1);
  });

  it("covers only the first of three visits booked back to back on one credit", async () => {
    await credits(1);
    const started: unknown[] = [];
    const holds: string[] = [];
    for (const date of ["2026-09-24", "2026-09-25", "2026-09-28"]) {
      const held = await hold(date);
      holds.push(held.id);
      started.push(await book(held.id));
    }
    const [onCredit, ...paid] = started;
    expect(onCredit).toEqual({ hold_id: holds[0], checkout: null });
    expect(paid).toHaveLength(2);
    for (const answer of paid) expect(answer).toMatchObject({ checkout: { amount: 200000 } });

    expect(await confirm(String(holds[0]))).toBe("booked");
    const covered = await env.DB.prepare("SELECT use_credit FROM slot_holds ORDER BY date").all();
    expect(covered.results).toEqual([{ use_credit: 1 }, { use_credit: 0 }, { use_credit: 0 }]);
    expect(await redeems()).toHaveLength(1);
  });

  it("spends one credit from each grant when two credit visits are booked at the same moment", async () => {
    const soon = new Date("2026-10-01T18:29:59.999Z");
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o2", now: NOW, expiresAt: soon })
      .run();
    const first = await hold("2026-09-24");
    await book(first.id);
    const second = await hold("2026-09-25");
    expect(await book(second.id)).toEqual({ hold_id: second.id, checkout: null });

    expect(await Promise.all([confirm(first.id), confirm(second.id)])).toEqual(["booked", "booked"]);
    const drawn = await env.DB.prepare(
      "SELECT g.source_id FROM credit_ledger r JOIN credit_ledger g ON g.id = r.grant_id WHERE r.kind = 'redeem'",
    ).all();
    expect(drawn.results.map((grant) => grant.source_id).sort()).toEqual(["o1", "o2"]);
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(0);
  });

  it("redeems the credit as the visit is booked, under the visit FSM's webhook mirrored first", async () => {
    await credits(1);
    const first = await hold("2026-09-24");
    await book(first.id);
    await env.DB.prepare(
      "UPDATE slot_holds SET fsm_work_order_id = 'fsm-order-9', fsm_appointment_id = 'fsm-visit-9' WHERE id = ?1",
    )
      .bind(first.id)
      .run();
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end, technician_id,
         fsm_modified_at, synced_at)
       VALUES ('mirrored', 'fsm-visit-9', ?1, 'service', 'scheduled', 'Scheduled', '2026-09-24T06:30:00.000Z',
         '2026-09-24T07:30:00.000Z', 't1', ?2, ?2)`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();

    expect(await confirm(first.id)).toBe("booked");
    expect(await redeems()).toEqual([{ source_id: "mirrored" }]);
  });

  it("books a credit visit whose credit was clawed back since, and tells ops nothing paid for it", async () => {
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "referral", sourceId: "r1", now: NOW }).run();
    const first = await hold("2026-09-24");
    await book(first.id);
    // The friend's first fit was refunded under the guarantee before this visit was booked.
    await clawBack(env.DB, "referral", "r1", NOW);
    const deps = fakeDependencies();

    expect(await confirm(first.id, NOW, { alertOnce: deps.alertOnce })).toBe("booked");
    expect(await redeems()).toEqual([]);
    expect(deps.alerts).toEqual([expect.stringContaining("had none left")]);
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
