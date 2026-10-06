// Booking a visit from the console (src/routes/ops/visits.ts): every kind, for a client ops are talking to. A paid
// visit holds its slot while a Razorpay payment link is open and is booked once the link is paid; a free one, one a
// credit pays for, and a consultation and fit in one visit are booked at once. NOW is Monday 21 September 2026,
// 12 noon in India, so the first bookable day is Tuesday the 22nd. Every name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { grantCredits } from "../../../src/domain/money/credits.ts";
import { type PaymentsProvider } from "../../../src/providers/payments/index.ts";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import { appFor, captureLogs, fakeDependencies, LOCAL_SETTINGS, markDatabase, NOW, request } from "../helpers.ts";
import {
  IMRAN,
  SANDEEP,
  ROHIT,
  NATURAL,
  SERVICE_PRICE,
  WEDNESDAY,
  bindings,
  technician,
  visit,
  rohit,
  makeCode,
  holdOf,
  holdsCount,
} from "./ops-visits-fixtures.ts";

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

describe("POST /api/visits: what is booked at once", () => {
  it("books a free consultation at once, and audits it", async () => {
    await rohit();
    const answer = await book({ client: ROHIT, kind: "consultation", date: WEDNESDAY, window: "morning" });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ hold_id: string } & Record<string, unknown>>();
    expect(body).toMatchObject({
      outcome: "booked",
      pays: "nothing",
      visit_id: expect.any(String) as string,
      link: null,
      date: WEDNESDAY,
      window: "morning",
      service: { tier: "standard", name: "Consultation", minutes: 60 },
      price: { amount: 0 },
    });
    const hold = await holdOf(body.hold_id);
    expect(hold).toMatchObject({ state: "booked", type: "consultation", pay_by_link: 0 });
    expect(hold?.confirmed_at).toBe(NOW.toISOString());

    const audit = await env.DB.prepare("SELECT subject_id, detail FROM audit_log WHERE action = 'visit.book'").first<{
      subject_id: string;
      detail: string;
    }>();
    expect(audit?.subject_id).toBe(ROHIT);
    expect(JSON.parse(audit?.detail ?? "{}")).toEqual({
      hold_id: body.hold_id,
      kind: "consultation",
      tier: "standard",
      date: WEDNESDAY,
      window: "morning",
      pays: "nothing",
    });
  });

  it("books with the technician ops chose, and refuses him in a window he is busy in", async () => {
    await rohit("fitted");
    const chosen = await book({
      client: ROHIT,
      kind: "service",
      date: WEDNESDAY,
      window: "morning",
      technician: SANDEEP,
    });
    const body = await chosen.json<{ hold_id: string; technician: object }>();
    expect(body.technician).toEqual({ id: SANDEEP, name: "Sandeep Rawat" });
    expect((await holdOf(body.hold_id))?.technician_id).toBe(SANDEEP);

    await visit(null, "service", "scheduled", "2026-09-23T06:30:00.000Z", IMRAN); // Wednesday, 12 noon
    const busy = await book({
      client: ROHIT,
      kind: "service",
      date: WEDNESDAY,
      window: "afternoon",
      technician: IMRAN,
    });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: { code: "taken" } });
  });

  it("refuses a window nobody is free in, and holds nothing", async () => {
    await rohit();
    await visit(null, "service", "scheduled", "2026-09-23T03:30:00.000Z", IMRAN);
    await visit(null, "service", "scheduled", "2026-09-23T03:30:00.000Z", SANDEEP);
    const answer = await book({ client: ROHIT, kind: "consultation", date: WEDNESDAY, window: "morning" });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "taken" } });
    expect(await holdsCount()).toBe(0);
  });

  it("books a consultation and fit in one visit with nothing paid, under its own terms, the code waiting for the link", async () => {
    await rohit();
    await makeCode();
    const answer = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      one_visit: true,
      date: WEDNESDAY,
      window: "morning",
      code: "tenpc",
    });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ hold_id: string } & Record<string, unknown>>();
    expect(body).toMatchObject({ outcome: "booked", pays: "nothing", price: { amount: 0 } });
    expect(await holdOf(body.hold_id)).toMatchObject({
      one_visit: 1,
      amount: 0,
      no_show_charge: "nothing",
      tier: NATURAL.tier,
    });
    const use = await env.DB.prepare("SELECT amount_off FROM discount_code_uses WHERE hold_id = ?1")
      .bind(body.hold_id)
      .first();
    expect(use).toEqual({ amount_off: null });
  });

  it("refuses a one visit in the evening, or one that is not a first fit", async () => {
    await rohit();
    const evening = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      one_visit: true,
      date: WEDNESDAY,
      window: "evening",
    });
    expect(evening.status).toBe(400);
    expect(await evening.json()).toMatchObject({ error: { code: "invalid_request", fields: ["window"] } });
    const service = await book({ client: ROHIT, kind: "service", one_visit: true, date: WEDNESDAY, window: "morning" });
    expect(service.status).toBe(400);
    expect(await service.json()).toMatchObject({ error: { code: "invalid_request", fields: ["one_visit"] } });
  });

  it("books a fitted client's service visit on a credit at once", async () => {
    await rohit("fitted");
    await grantCredits(env.DB, { personId: ROHIT, visits: 1, source: "ops", sourceId: "goodwill", now: NOW }).run();
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ hold_id: string } & Record<string, unknown>>();
    expect(body).toMatchObject({ outcome: "booked", pays: "credit", link: null });
    expect(await holdOf(body.hold_id)).toMatchObject({ use_credit: 1, confirmed_at: NOW.toISOString() });
    expect(payments.made.links).toEqual([]);
  });
});

describe("POST /api/visits: what is refused", () => {
  it("refuses a second first fit while one is still to come", async () => {
    await rohit("consulted");
    await visit(ROHIT, "first_fit", "scheduled", "2026-09-28T03:30:00.000Z", IMRAN);
    const answer = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      date: WEDNESDAY,
      window: "morning",
    });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "already_booked" } });
  });

  it("refuses a second first fit while the link for the first is still open, and sends no second link", async () => {
    await rohit("consulted");
    const first = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      date: WEDNESDAY,
      window: "morning",
    });
    expect(await first.json()).toMatchObject({ outcome: "awaiting_payment" });
    const second = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      date: "2026-09-25",
      window: "morning",
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "already_booked" } });
    expect(payments.made.links).toHaveLength(1);
    expect(await holdsCount()).toBe(1);
  });

  it("books a first fit again once the first link has closed unpaid", async () => {
    await rohit("consulted");
    await book({ client: ROHIT, kind: "first_fit", tier: NATURAL.tier, date: WEDNESDAY, window: "morning" });
    await env.DB.prepare("UPDATE slot_holds SET expires_at = ?1, grace_seconds = 0").bind(NOW.toISOString()).run();
    const again = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      date: "2026-09-25",
      window: "morning",
    });
    expect(again.status).toBe(201);
  });

  it("refuses a client it does not have, and one who has been erased", async () => {
    const unknown = await book({ client: ROHIT, kind: "consultation", date: WEDNESDAY, window: "morning" });
    expect(unknown.status).toBe(404);
    await rohit();
    await env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(ROHIT, NOW.toISOString()).run();
    const erased = await book({ client: ROHIT, kind: "consultation", date: WEDNESDAY, window: "morning" });
    expect(erased.status).toBe(404);
  });

  it("refuses a first fit on a day the console offers no hair system, and a day that cannot be booked", async () => {
    await rohit("consulted");
    await env.DB.prepare("UPDATE services SET retired_date = '2026-01-01' WHERE kind = 'first_fit'").run();
    const noProduct = await book({ client: ROHIT, kind: "first_fit", date: WEDNESDAY, window: "morning" });
    expect(noProduct.status).toBe(422);
    expect(await noProduct.json()).toMatchObject({ error: { code: "no_product" } });

    const today = await book({ client: ROHIT, kind: "service", date: "2026-09-21", window: "evening" });
    expect(today.status).toBe(422);
    expect(await today.json()).toMatchObject({ error: { code: "not_bookable" } });
  });
});

describe("GET /api/visits/availability", () => {
  const look = (query: string) => request(opsApp(), `/api/visits/availability?${query}`);

  it("offers each window's free technicians, never the one who took the client's last visit, with how it is paid", async () => {
    // Imran fitted Rohit, so he does not take Rohit's next visit (docs/decisions/0111).
    await rohit("fitted");
    await visit(null, "service", "scheduled", "2026-09-22T03:30:00.000Z", SANDEEP); // Tuesday, 9 am
    const answer = await look(`client=${ROHIT}&kind=service`);
    expect(answer.status).toBe(200);
    const body = await answer.json<{
      services: object[];
      pays: string;
      days: { date: string; windows: { window: string; technicians: { id: string }[] }[] }[];
    }>();
    expect(body.services).toEqual([
      {
        tier: "standard",
        name: "Service visit",
        minutes: 90,
        price: { amount_ex_gst: SERVICE_PRICE, amount: SERVICE_PRICE, gst_percent: 0 },
      },
    ]);
    expect(body.pays).toBe("link");
    expect(body.days).toHaveLength(14);
    expect(body.days[0]?.date).toBe("2026-09-22");
    const tuesday = body.days[0]?.windows.map((each) => [each.window, each.technicians.map((one) => one.id)]);
    expect(tuesday).toEqual([
      ["morning", []],
      ["afternoon", [SANDEEP]],
      ["evening", [SANDEEP]],
    ]);
  });

  it("offers a first fit as the hair systems the console sells, and a credit as how a service visit is paid", async () => {
    await rohit("fitted");
    await grantCredits(env.DB, { personId: ROHIT, visits: 2, source: "ops", sourceId: "goodwill", now: NOW }).run();
    const service = await (await look(`client=${ROHIT}&kind=service`)).json<{ pays: string; credits: number }>();
    expect(service).toMatchObject({ pays: "credit", credits: 2 });
    const fit = await (await look(`client=${ROHIT}&kind=first_fit`)).json<{ services: { tier: string }[] }>();
    expect(fit.services.map((each) => each.tier)).toContain(NATURAL.tier);
  });
});
