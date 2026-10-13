// A visit ops book free to make good what a client is owed (src/domain/booking/remakes.ts): a first fit left partly
// done, a piece of a recalled lot, and a piece that failed. NOW is Monday 21 September 2026, 12 noon in India. Every
// name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, NATURAL, ROHIT, WEDNESDAY, bindings, holdOf, rohit, technician, visit } from "./ops-visits-fixtures.ts";

const opsApp = () => appFor("local", fakeDependencies({ payments: createStubPayments() }), {}, "ops");

const book = (body: object) =>
  request(
    opsApp(),
    "/api/visits",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(body),
    },
    bindings(),
  );

const owed = async (kind: string) => {
  const answer = await request(opsApp(), `/api/visits/availability?client=${ROHIT}&kind=${kind}`);
  return (await answer.json<{ owed: { id: string; why: string; piece_code: string | null }[] }>()).owed;
};

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await technician(IMRAN, "Imran Qureshi", "IQ");
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

/** Rohit's first fit, left partly done on Saturday: the piece in the kit was not his. */
async function partlyDoneFit(): Promise<string> {
  const id = await visit(ROHIT, "first_fit", "terminated", "2026-09-19T04:30:00.000Z", IMRAN);
  await env.DB.prepare(
    `INSERT INTO visits (id, appointment_id, ended_at, outcome, partial_reason, updated_at)
     VALUES ('visit-row-1', ?1, '2026-09-19T06:00:00.000Z', 'partial', 'piece_not_ready', ?2)`,
  )
    .bind(id, NOW.toISOString())
    .run();
  return id;
}

/** A piece fitted to Rohit in August. */
async function piece(failedAt: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, replacement_due_at, failed_at, synced_at)
     VALUES ('piece-1', 'piece-1', ?1, 'MM-ESS-0000001-B', '2026-08-01', '2027-01-28', ?2, ?3)`,
  )
    .bind(ROHIT, failedAt, NOW.toISOString())
    .run();
}

describe("a first fit left partly done", () => {
  it("is booked again free, with no late fee, and its Tasks row closes", async () => {
    await rohit("consulted");
    const fit = await partlyDoneFit();
    expect(await owed("first_fit")).toEqual([
      { id: fit, why: "partial", piece_code: null, since: expect.any(String) as string },
    ]);

    const answer = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      date: WEDNESDAY,
      window: "morning",
      covers: fit,
    });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ hold_id: string; pays: string; price: { amount: number } }>();
    expect(body).toMatchObject({ pays: "nothing", price: { amount: 0 } });
    expect(await holdOf(body.hold_id)).toMatchObject({ amount: 0, pay_by_link: 0, no_show_charge: "nothing" });
    const fee = await env.DB.prepare("SELECT late_change_charge, late_fee_ex_gst FROM slot_holds WHERE id = ?1")
      .bind(body.hold_id)
      .first();
    expect(fee).toEqual({ late_change_charge: "nothing", late_fee_ex_gst: null });

    const closed = await env.DB.prepare("SELECT closed_by FROM task_closures WHERE subject_id = ?1").bind(fit).first();
    expect(closed).toEqual({ closed_by: "ops@localhost" });
    const audit = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'visit.book'").first<{
      detail: string;
    }>();
    expect(JSON.parse(audit?.detail ?? "{}")).toMatchObject({ covers: fit, covers_why: "partial" });
    expect(await owed("first_fit")).toEqual([]);
  });

  it("is refused once made good, and with a code, which a free visit has no use for", async () => {
    await rohit("consulted");
    const fit = await partlyDoneFit();
    const asked = { client: ROHIT, kind: "first_fit", tier: NATURAL.tier, date: WEDNESDAY, window: "morning" };

    const withCode = await book({ ...asked, covers: fit, code: "TENPC" });
    expect(withCode.status).toBe(400);
    expect(await withCode.json()).toMatchObject({ error: { code: "invalid_request", fields: ["covers"] } });
    const asReplacement = await book({ ...asked, kind: "replacement", tier: "standard", covers: fit });
    expect(asReplacement.status).toBe(400);
  });
});

describe("a piece to replace", () => {
  it("that failed is owed a replacement, free, until one is booked", async () => {
    await rohit("fitted");
    await piece("2026-09-18T06:00:00.000Z");
    expect(await owed("replacement")).toMatchObject([{ id: "piece-1", why: "failed", piece_code: "MM-ESS-0000001-B" }]);
    expect(await owed("first_fit")).toEqual([]);

    const answer = await book({
      client: ROHIT,
      kind: "replacement",
      date: WEDNESDAY,
      window: "morning",
      covers: "piece-1",
    });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ pays: "nothing", price: { amount: 0 } });
    expect(await owed("replacement")).toEqual([]);
  });

  it("of a recalled lot is owed for the recall; one still worn and not recalled is owed nothing", async () => {
    await rohit("fitted");
    await piece(null);
    expect(await owed("replacement")).toEqual([]);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO consumables (code, name, unit, unit_cost, created_at, updated_at)
         VALUES ('hs1', 'Essential 8x10 1B', 'piece', 1200000, ?1, ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO stock_lots (id, consumable_code, lot_code, expires_on, received_at)
         VALUES ('lot-1', 'hs1', 'MHI-E810', NULL, ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO recalls (id, number, lot_id, reason, raised_by, raised_at)
         VALUES ('rcl-1', 1, 'lot-1', 'Shedding', 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare("INSERT INTO recall_pieces (recall_id, piece_id, due_before) VALUES ('rcl-1', 'piece-1', NULL)"),
    ]);
    expect(await owed("replacement")).toMatchObject([{ id: "piece-1", why: "recall" }]);

    await env.DB.prepare("UPDATE recalls SET closed_at = ?1, closed_by = 'ops@localhost'")
      .bind(NOW.toISOString())
      .run();
    expect(await owed("replacement")).toEqual([]);
  });
});
