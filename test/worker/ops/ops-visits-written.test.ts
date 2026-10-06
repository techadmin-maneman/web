// Booking a visit from the console (src/routes/ops/visits.ts): every kind, for a client ops are talking to. A paid
// visit holds its slot while a Razorpay payment link is open and is booked once the link is paid; a free one, one a
// credit pays for, and a consultation and fit in one visit are booked at once. NOW is Monday 21 September 2026,
// 12 noon in India, so the first bookable day is Tuesday the 22nd. Every name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { creditBalance, grantCredits } from "../../../src/domain/money/credits.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { type PaymentsProvider } from "../../../src/providers/payments/index.ts";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import { appFor, captureLogs, fakeDependencies, LOCAL_SETTINGS, markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, SANDEEP, ROHIT, NATURAL, WEDNESDAY, bindings, technician, rohit } from "./ops-visits-fixtures.ts";

let payments: StubPayments;

/** What a test may change about the console: its payments and staging's handsets. */
interface Vendors {
  readonly payments?: PaymentsProvider;
  readonly allowlist?: string[];
}

const opsApp = (vendors: Vendors = {}) => {
  const deps = fakeDependencies({ payments: vendors.payments ?? payments });
  const allowlist = vendors.allowlist ?? LOCAL_SETTINGS.messaging.allowlist;
  const settings = { messaging: { ...LOCAL_SETTINGS.messaging, allowlist } };
  return appFor("local", deps, settings, "ops");
};

const book = (body: object, vendors: Vendors = {}) =>
  request(
    opsApp(vendors),
    "/api/visits",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(body),
    },
    bindings(),
  );

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  payments = createStubPayments();
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANDEEP, "Sandeep Rawat", "SR");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('first_fit', ?1, ?2, 180, 1, 'ops@localhost', ?3)`,
    ).bind(NATURAL.tier, NATURAL.name, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
       VALUES ('first_fit', ?1, ?2, 0, '2026-09-01')`,
    ).bind(NATURAL.tier, NATURAL.amount),
  ]);
});

describe("POST /api/visits: the visit written in the request", () => {
  it("writes a free consultation in the request, with the window the client asked for, and its task goes", async () => {
    await rohit();
    await env.DB.prepare(
      `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
       VALUES ('request-1', ?1, '122018', ?2, 'afternoon', ?3)`,
    )
      .bind(ROHIT, WEDNESDAY, NOW.toISOString())
      .run();
    const waiting = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(waiting.tasks.map((task) => task.group)).toContain("consultation_request");

    const answer = await book({ client: ROHIT, kind: "consultation", date: WEDNESDAY, window: "morning" });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ visit_id: string; outcome: string }>();
    expect(body.outcome).toBe("booked");
    const booked = await env.DB.prepare(
      "SELECT status, type, asked_window, asked_checked_at FROM appointments WHERE id = ?1",
    )
      .bind(body.visit_id)
      .first();
    expect(booked).toEqual({
      status: "scheduled",
      type: "consultation",
      asked_window: "afternoon",
      asked_checked_at: NOW.toISOString(),
    });
    const after = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(after.tasks.map((task) => task.group)).not.toContain("consultation_request");
  });

  it("writes a consultation and fit in one visit in the request, marked as one", async () => {
    await rohit();
    const answer = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      one_visit: true,
      date: WEDNESDAY,
      window: "morning",
    });
    const body = await answer.json<{ visit_id: string; outcome: string }>();
    expect(body.outcome).toBe("booked");
    const booked = await env.DB.prepare("SELECT type, tier, one_visit FROM appointments WHERE id = ?1")
      .bind(body.visit_id)
      .first();
    expect(booked).toEqual({ type: "first_fit", tier: NATURAL.tier, one_visit: "booked" });
  });

  it("writes a service visit on a credit in the request, the credit spent on it", async () => {
    await rohit("fitted");
    await grantCredits(env.DB, { personId: ROHIT, visits: 1, source: "ops", sourceId: "goodwill", now: NOW }).run();
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" });
    const body = await answer.json<{ visit_id: string; outcome: string; pays: string }>();
    expect(body).toMatchObject({ outcome: "booked", pays: "credit" });
    expect((await creditBalance(env.DB, ROHIT, NOW)).visits).toBe(0);
  });

  it("books nothing for a paid visit until its link is paid", async () => {
    await rohit("fitted");
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" });
    const body = await answer.json<{ hold_id: string; outcome: string }>();
    expect(body.outcome).toBe("awaiting_payment");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM appointments WHERE person_id = ?1 AND status = 'scheduled'")
        .bind(ROHIT)
        .first(),
    ).toEqual({ n: 0 });
  });
});
