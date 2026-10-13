// Recalls (src/domain/field/recalls.ts, src/routes/ops/recalls.ts; docs/decisions/0187-recalls.md). NOW is Monday
// 21 September 2026, 12 noon in India.
//
// What these hold: a lot is recalled once, with why; the recall says where its stock is and who wears its pieces, each
// worn piece made due today; the kit's pieces of it leave the job card's list; a transfer takes a recalled lot last;
// and a recall is closed once.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, JOB, PERSON, working, type Working } from "../job-fixtures.ts";
import { composeRecallNotice } from "../../../src/domain/field/recall-notice.ts";

interface Detail {
  id: string;
  closed_at: string | null;
  held: { place_id: string; quantity: number }[];
  worn: { piece_code: string; person: string; due_on: string | null }[];
}

let job: Working;
let code: string;
let lot: string;
let worn: string;

const labelsAt = async (place: string) =>
  (
    await (
      await request(job.ops, `/api/stock/units?consumable_code=${code}&place_id=${place}`)
    ).json<{
      units: { code: string; lot_code: string | null }[];
    }>()
  ).units;

beforeEach(async () => {
  await markDatabase();
  job = await working("first_fit");
  await env.DB.prepare(
    `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
     VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
  )
    .bind(NOW.toISOString())
    .run();
  const added = await job.opsPost("/api/hair-systems", {
    product: "essential",
    base_width_in: 8,
    base_length_in: 10,
    colour: "1B",
    grey_percent: 20,
    density_percent: 100,
    unit_cost: 1_200_000,
  });
  code = (await added.json<{ code: string }>()).code;
  await job.opsPost("/api/stock/deliveries", {
    consumable_code: code,
    quantity: 3,
    lot_code: "BAD",
    expires_on: "2028-03-31",
  });
  await job.opsPost("/api/stock/deliveries", {
    consumable_code: code,
    quantity: 2,
    lot_code: "SOON",
    expires_on: "2027-03-31",
  });
  await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 3, from: "central", to: IMRAN });
  lot = (await env.DB.prepare("SELECT id FROM stock_lots WHERE lot_code = 'BAD'").first<string>("id")) ?? "";
  worn = (await labelsAt("central")).find((unit) => unit.lot_code === "BAD")?.code ?? "";
  await env.DB.batch([
    env.DB.prepare("UPDATE stock_units SET state = 'fitted', place = NULL, appointment_id = ?2 WHERE code = ?1").bind(
      worn,
      JOB,
    ),
    env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, replacement_due_at, appointment_id, synced_at)
       VALUES ('piece-1', 'piece-1', ?1, ?2, '2026-09-01', '2027-03-01', ?3, ?4)`,
    ).bind(PERSON, worn, JOB, NOW.toISOString()),
  ]);
});

describe("a recall", () => {
  it("blocks a lot once, saying where its stock is and who wears it, each worn piece made due today", async () => {
    const book = await (await request(job.ops, "/api/recalls")).json<{ lots: { id: string }[] }>();
    expect(book.lots.map((each) => each.id)).toContain(lot);

    const raised = await job.opsPost("/api/recalls", { lot_id: lot, reason: "Supplier warned of shedding" });
    const detail = await raised.json<Detail>();
    expect(detail.held.map((each) => [each.place_id, each.quantity]).sort()).toEqual([
      [IMRAN, 1],
      ["central", 2],
    ]);
    expect(detail.worn).toEqual([
      { piece_id: "piece-1", piece_code: worn, person_id: PERSON, person: "Rohit Malhotra", due_on: "2026-09-21" },
    ]);
    const kept = await env.DB.prepare("SELECT due_before FROM recall_pieces").first();
    expect(kept).toEqual({ due_before: "2027-03-01" });
    expect((await job.opsPost("/api/recalls", { lot_id: lot, reason: "Again" })).status).toBe(400);

    const card = await (
      await job.get(`/api/tech/jobs/${JOB}`)
    ).json<{ kit_hair_systems: { code: string; units: { lot_code: string | null }[] }[] }>();
    const listed = card.kit_hair_systems.find((each) => each.code === code)?.units.map((unit) => unit.lot_code) ?? [];
    expect(listed).not.toContain("BAD");

    const closed = await job.opsPost(`/api/recalls/${detail.id}/close`, {});
    expect((await closed.json<Detail>()).closed_at).not.toBeNull();
    expect((await job.opsPost(`/api/recalls/${detail.id}/close`, {})).status).toBe(404);
  });

  it("tells each client who wears it, gives Care a call, and dates the order from the recall", async () => {
    const raised = await (await job.opsPost("/api/recalls", { lot_id: lot, reason: "Shedding" })).json<Detail>();
    const told = await env.DB.prepare(
      "SELECT person_id, kind, subject_kind, subject_id FROM outbound_messages WHERE kind = 'recall_notice'",
    ).all();
    expect(told.results).toEqual([
      { person_id: PERSON, kind: "recall_notice", subject_kind: "recall", subject_id: raised.id },
    ]);
    expect(await composeRecallNotice(env.DB, raised.id, PERSON)).toEqual({
      template: "recall_notice_v1",
      params: ["Rohit"],
    });

    const board = await (
      await request(job.ops, "/api/tasks")
    ).json<{ groups: { group: string; tasks: { id: string; detail: string | null; since: string }[] }[] }>();
    const tasksOf = (group: string) => board.groups.find((each) => each.group === group)?.tasks ?? [];
    expect(tasksOf("recall_call")).toEqual([expect.objectContaining({ id: PERSON, detail: worn })]);
    // Ordered from the day of the recall, not born a lead time overdue.
    expect(tasksOf("replacement_order")[0]?.since).toBe(NOW.toISOString());

    // Booked, the call and the notice are done with.
    await env.DB.prepare("UPDATE pieces SET replacement_booked = 1").run();
    expect(await composeRecallNotice(env.DB, raised.id, PERSON)).toEqual({
      skip: "the recall is closed, or its replacement is booked",
    });
  });

  it("leaves a recalled lot to go last when stock is sent on", async () => {
    await job.opsPost("/api/stock/deliveries", {
      consumable_code: code,
      quantity: 1,
      lot_code: "LATER",
      expires_on: "2029-03-31",
    });
    await job.opsPost("/api/recalls", { lot_id: lot, reason: "Supplier warned of shedding" });
    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 1, from: "central", to: IMRAN });
    const kit = await labelsAt(IMRAN);
    expect(kit.map((unit) => unit.lot_code).sort()).toEqual(["BAD", "LATER", "SOON", "SOON"]);
    expect((await labelsAt("central")).map((unit) => unit.lot_code)).toEqual(["BAD"]);
  });

  it("refuses a lot that is not there, and a recall that is not", async () => {
    expect((await job.opsPost("/api/recalls", { lot_id: "nothing", reason: "Shedding" })).status).toBe(400);
    expect((await request(job.ops, "/api/recalls/nothing")).status).toBe(404);
    expect((await job.opsPost("/api/recalls/nothing/close", {})).status).toBe(404);
    const book = await (await request(job.ops, "/api/recalls")).json<{ recalls: unknown[] }>();
    expect(book.recalls).toEqual([]);
  });
});
