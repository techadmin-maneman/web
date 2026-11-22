// The piece step scanned from the kit (src/routes/tech/jobs.piece.ts, src/domain/inventory/piece-use.ts,
// src/domain/inventory/piece-returns.ts; docs/decisions/0163-pieces-scanned-from-the-kit.md). NOW is Monday 21 September
// 2026, 12 noon in India.
//
// What these hold: the job card lists each kit hair system's labelled pieces; a label one of them carries names its
// hair system and lot whatever the step said; an expired one is refused; a piece with no label is fitted from the kit
// under a label made for it, which its unit then carries (src/domain/inventory/made-labels.ts); and a piece
// that comes off at a replacement is held in the kit as returned, its unit with it where it is one of ours.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { madeLabel, ownLabelsBack } from "../../../src/domain/inventory/made-labels.ts";
import { aPerson } from "../fixtures/index.ts";
import { markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, JOB, PERSON, working, type Working } from "../job-fixtures.ts";

let job: Working;
let code: string;

async function added(grey: number): Promise<string> {
  const answer = await job.opsPost("/api/hair-systems", {
    product: "essential",
    base_width_in: 8,
    base_length_in: 10,
    colour: "1B",
    grey_percent: grey,
    density_percent: 100,
    unit_cost: 1_200_000,
  });
  return (await answer.json<{ code: string }>()).code;
}

/** The labels in Imran's kit of a hair system, delivered with the lot given and handed to them. */
async function inTheKit(of: string, lot: Record<string, string>, quantity = 2): Promise<string[]> {
  await job.opsPost("/api/stock/deliveries", { consumable_code: of, quantity, ...lot });
  await job.opsPost("/api/stock/transfers", { consumable_code: of, quantity, from: "central", to: IMRAN });
  const { units } = await (
    await request(job.ops, `/api/stock/units?consumable_code=${of}&place_id=${IMRAN}`)
  ).json<{ units: { code: string }[] }>();
  return units.map((unit) => unit.code).sort();
}

async function setUp(type: string): Promise<void> {
  await markDatabase();
  job = await working(type);
  await env.DB.prepare(
    `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
     VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
  )
    .bind(NOW.toISOString())
    .run();
  code = await added(20);
}

describe("a piece scanned from the kit", () => {
  beforeEach(async () => {
    await setUp("first_fit");
  });

  it("is listed on the job card, and names its hair system and lot whatever the step said", async () => {
    const other = await added(30);
    const [label = ""] = await inTheKit(code, { lot_code: "HS-1", expires_on: "2028-03-31" });
    await inTheKit(other, {});
    const card = await (
      await job.get(`/api/tech/jobs/${JOB}`)
    ).json<{ kit_hair_systems: { code: string; units: { code: string; lot_code: string | null }[] }[] }>();
    const listed = card.kit_hair_systems.find((each) => each.code === code);
    expect(listed?.units.map((unit) => unit.code)).toContain(label);
    expect(listed?.units[0]?.lot_code).toBe("HS-1");

    await job.workTo("consumables");
    await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [], short_reason: "other" }, "event-consumables-01");
    const step = await job.post(
      `/api/tech/jobs/${JOB}/piece`,
      { piece_code: label, stock_code: other },
      "event-piece-01",
    );
    expect(step.status).toBe(202);
    const body = await env.DB.prepare("SELECT body FROM job_events WHERE kind = 'piece'").first<string>("body");
    expect(JSON.parse(body ?? "{}")).toMatchObject({ piece_code: label, stock_code: code, supplier_lot: "HS-1" });
    expect(
      await env.DB.prepare("SELECT state FROM stock_units WHERE code = ?1").bind(label).first<string>("state"),
    ).toBe("fitted");
  });

  it("is refused once it has expired", async () => {
    const [label = ""] = await inTheKit(code, { lot_code: "OLD", expires_on: "2026-09-20" });
    await job.workTo("consumables");
    await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [], short_reason: "other" }, "event-consumables-01");
    const step = await job.post(`/api/tech/jobs/${JOB}/piece`, { piece_code: label }, "event-piece-01");
    expect(step.status).toBe(400);
    expect((await step.json<{ error: { fields?: string[] } }>()).error.fields).toEqual(["piece_code"]);
  });
});

// A label lost or never stuck on never stops the fit.
describe("a piece with no label", () => {
  beforeEach(async () => {
    await setUp("first_fit");
  });

  const fit = async (body: object, event: string) => {
    await job.workTo("consumables");
    await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [], short_reason: "other" }, "event-consumables-01");
    return job.post(`/api/tech/jobs/${JOB}/piece`, body, event);
  };
  /** The lot of the unit fitted. */
  const fittedLot = () =>
    env.DB.prepare(
      `SELECT l.lot_code FROM stock_units u JOIN stock_lots l ON l.id = u.lot_id
       WHERE u.consumable_code = ?1 AND u.state = 'fitted'`,
    )
      .bind(code)
      .first<string>("lot_code");
  const recorded = async () =>
    JSON.parse(
      (await env.DB.prepare("SELECT body FROM job_events WHERE kind = 'piece' ORDER BY rowid DESC").first<string>(
        "body",
      )) ?? "{}",
    ) as { piece_code?: string; no_label?: boolean; stock_code?: string };

  it("is fitted as the hair system picked from the kit, under a label made for it, the same one sent again", async () => {
    await inTheKit(code, { lot_code: "HS-1", expires_on: "2028-03-31" });
    expect((await fit({ no_label: true, stock_code: code }, "event-piece-01")).status).toBe(202);
    const first = await recorded();
    expect(first).toMatchObject({ no_label: true, stock_code: code });
    expect(first.piece_code).toMatch(/^MM-NL-\d{7}-[A-Z]$/);
    // One of the kit's pieces is fitted, not gone missing, though its label was never read.
    const states = await env.DB.prepare(
      "SELECT state, COUNT(*) AS n FROM stock_units WHERE consumable_code = ?1 GROUP BY state ORDER BY state",
    )
      .bind(code)
      .all();
    expect(states.results).toEqual([
      { state: "fitted", n: 1 },
      { state: "held", n: 1 },
    ]);
    // The unit fitted carries the made label, so a recall of its lot finds the piece by it.
    const fitted = () =>
      env.DB.prepare("SELECT code FROM stock_units WHERE consumable_code = ?1 AND state = 'fitted'")
        .bind(code)
        .first<string>("code");
    expect(await fitted()).toBe(first.piece_code);

    expect(
      (await job.post(`/api/tech/jobs/${JOB}/piece`, { no_label: true, stock_code: code }, "event-piece-02")).status,
    ).toBe(202);
    expect((await recorded()).piece_code).toBe(first.piece_code);
    expect(await fitted()).toBe(first.piece_code);
  });

  it("is refused where every piece of the hair system has expired, and taken from a lot in date", async () => {
    await inTheKit(code, { lot_code: "OLD", expires_on: "2026-09-20" });
    const refused = await fit({ no_label: true, stock_code: code }, "event-piece-01");
    expect(refused.status).toBe(400);
    expect((await refused.json<{ error: { fields?: string[] } }>()).error.fields).toEqual(["stock_code"]);

    await inTheKit(code, { lot_code: "NEW", expires_on: "2028-03-31" });
    const step = await job.post(`/api/tech/jobs/${JOB}/piece`, { no_label: true, stock_code: code }, "event-piece-02");
    expect(step.status).toBe(202);
    // The older lot leaves first by label, but a piece with none is one known to be in date.
    expect(await fittedLot()).toBe("NEW");
  });

  it("is not refused when sent again, or corrected, once only expired pieces are left", async () => {
    await inTheKit(code, { lot_code: "OLD", expires_on: "2026-09-20" });
    await inTheKit(code, { lot_code: "NEW", expires_on: "2028-03-31" }, 1);
    const step = { no_label: true, stock_code: code };
    expect((await fit(step, "event-piece-01")).status).toBe(202);
    expect((await job.post(`/api/tech/jobs/${JOB}/piece`, step, "event-piece-01")).status).toBe(202);
    expect((await job.post(`/api/tech/jobs/${JOB}/piece`, step, "event-piece-02")).status).toBe(202);
    expect(await fittedLot()).toBe("NEW");
  });

  it("is a piece of no lot before one of a lot past its date", async () => {
    await inTheKit(code, { lot_code: "OLD", expires_on: "2026-09-20" });
    await inTheKit(code, {});
    expect((await fit({ no_label: true, stock_code: code }, "event-piece-01")).status).toBe(202);
    const lots = await env.DB.prepare("SELECT lot_id FROM stock_units WHERE consumable_code = ?1 AND state = 'fitted'")
      .bind(code)
      .all<{ lot_id: string | null }>();
    expect(lots.results).toEqual([{ lot_id: null }]);
  });

  it("is a piece never labelled before a unit, whichever lot expires first", async () => {
    const later = await inTheKit(code, { lot_code: "LATER", expires_on: "2028-03-31" });
    // One of the later lot's pieces lost its unit, so it is a piece never labelled.
    const lost = await env.DB.prepare("SELECT id FROM stock_units WHERE code = ?1")
      .bind(later[0] ?? "")
      .first<string>("id");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM stock_unit_events WHERE unit_id = ?1").bind(lost),
      env.DB.prepare("DELETE FROM stock_units WHERE id = ?1").bind(lost),
    ]);
    await inTheKit(code, { lot_code: "SOONER", expires_on: "2027-01-31" });
    expect((await fit({ no_label: true, stock_code: code }, "event-piece-01")).status).toBe(202);
    const fittedUnits = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM stock_units WHERE state = 'fitted'",
    ).first<number>("n");
    expect(fittedUnits).toBe(0);
    const left = await env.DB.prepare(
      `SELECT b.quantity FROM stock_lot_balances b JOIN stock_lots l ON l.id = b.lot_id
       WHERE b.place = ?1 AND l.lot_code = 'LATER'`,
    )
      .bind(IMRAN)
      .first<number>("quantity");
    expect(left).toBe(1);
  });

  /** The units of a lot kept for another client's made-to-order. */
  async function keptForAnother(lot: string): Promise<void> {
    await aPerson({ id: "p-other", name: "Someone Else" });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO suppliers (id, name, country, currency, payment_terms_days, warranty_days, created_at, updated_at)
         VALUES ('sup-1', 'Supplier', 'CN', 'USD', 30, 90, ?1, ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO custom_orders (id, number, person_id, product, base_width_in, base_length_in, colour, grey_percent,
           density_percent, supplier_id, supplier_price, amount, state, raised_by, raised_at, updated_at)
         VALUES ('co-1', 1, 'p-other', 'essential', 8, 10, '1B', 20, 100, 'sup-1', 12000, 4500000, 'paid', 'test', ?1, ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `UPDATE stock_units SET custom_order_id = 'co-1'
         WHERE lot_id = (SELECT id FROM stock_lots WHERE lot_code = ?1)`,
      ).bind(lot),
    ]);
  }

  it("is never a piece kept for another client's made-to-order", async () => {
    await inTheKit(code, { lot_code: "KEPT", expires_on: "2027-01-31" }, 1);
    await inTheKit(code, { lot_code: "FREE", expires_on: "2028-03-31" }, 1);
    await keptForAnother("KEPT");
    expect((await fit({ no_label: true, stock_code: code }, "event-piece-01")).status).toBe(202);
    expect(await fittedLot()).toBe("FREE");
  });

  it("is refused where every piece of the hair system the kit holds is kept for another client", async () => {
    await inTheKit(code, { lot_code: "KEPT", expires_on: "2027-01-31" }, 1);
    await keptForAnother("KEPT");
    const refused = await fit({ no_label: true, stock_code: code }, "event-piece-01");
    expect(refused.status).toBe(400);
    expect((await refused.json<{ error: { fields?: string[] } }>()).error.fields).toEqual(["stock_code"]);
  });

  it("is a recalled lot's piece never labelled only after a sound lot's unit", async () => {
    const recalled = await inTheKit(code, { lot_code: "RECALLED", expires_on: "2028-03-31" }, 1);
    // The recalled lot's piece lost its unit, so it is a piece never labelled.
    const lost = await env.DB.prepare("SELECT id FROM stock_units WHERE code = ?1")
      .bind(recalled[0] ?? "")
      .first<string>("id");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM stock_unit_events WHERE unit_id = ?1").bind(lost),
      env.DB.prepare("DELETE FROM stock_units WHERE id = ?1").bind(lost),
      env.DB.prepare("UPDATE stock_lots SET recalled_at = ?1 WHERE lot_code = 'RECALLED'").bind(NOW.toISOString()),
    ]);
    await inTheKit(code, { lot_code: "SOUND", expires_on: "2028-03-31" }, 1);
    expect((await fit({ no_label: true, stock_code: code }, "event-piece-01")).status).toBe(202);
    expect(await fittedLot()).toBe("SOUND");
  });

  it("gives the made label to the unit a scanned step fitted, sent again with no label", async () => {
    const [label = ""] = await inTheKit(code, {});
    expect((await fit({ piece_code: label, stock_code: code }, "event-piece-01")).status).toBe(202);
    const step = { no_label: true, stock_code: code };
    expect((await job.post(`/api/tech/jobs/${JOB}/piece`, step, "event-piece-02")).status).toBe(202);
    const made = (await recorded()).piece_code;
    expect(made).toMatch(/^MM-NL-\d{7}-[A-Z]$/);
    const fitted = await env.DB.prepare("SELECT code FROM stock_units WHERE state = 'fitted'").all<{ code: string }>();
    expect(fitted.results).toEqual([{ code: made }]);
  });

  it("gives the made label to one unit only, the visit's latest fitted, where it has two of the hair system", async () => {
    const [earlier = "", later = ""] = await inTheKit(code, {});
    // Another technician fitted one of them on this visit before it came to Imran.
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE stock_units SET state = 'fitted', place = NULL, appointment_id = ?1, moved_at = '2026-09-21T03:00:00.000Z'
         WHERE code = ?2`,
      ).bind(JOB, earlier),
      env.DB.prepare(
        "UPDATE stock_balances SET quantity = quantity - 1 WHERE consumable_code = ?1 AND place = ?2",
      ).bind(code, IMRAN),
    ]);
    expect((await fit({ no_label: true, stock_code: code }, "event-piece-01")).status).toBe(202);
    const made = (await recorded()).piece_code;
    const fitted = await env.DB.prepare("SELECT code FROM stock_units WHERE state = 'fitted' ORDER BY code").all<{
      code: string;
    }>();
    expect(fitted.results.map((unit) => unit.code).sort()).toEqual([earlier, made].sort());
    expect(later).not.toBe(made);
  });

  it("gives a unit its own label back only where it is back in the kit", async () => {
    const [label = ""] = await inTheKit(code, {});
    const made = await madeLabel(env.DB, JOB);
    const unit = await env.DB.prepare("SELECT id FROM stock_units WHERE code = ?1").bind(label).first<string>("id");
    await env.DB.prepare("UPDATE stock_units SET code = ?1, state = 'fitted' WHERE id = ?2").bind(made, unit).run();
    await env.DB.batch(ownLabelsBack(env.DB, [unit ?? ""], "essential"));
    const codeOf = () => env.DB.prepare("SELECT code FROM stock_units WHERE id = ?1").bind(unit).first<string>("code");
    expect(await codeOf()).toBe(made);
    await env.DB.prepare("UPDATE stock_units SET state = 'held' WHERE id = ?1").bind(unit).run();
    await env.DB.batch(ownLabelsBack(env.DB, [unit ?? ""], "essential"));
    expect(await codeOf()).toBe(label);
  });

  it("gives a unit put back by a correction its own label again, and the made one to the unit fitted", async () => {
    const other = await added(30);
    await inTheKit(code, {});
    await inTheKit(other, {});
    const all = await env.DB.prepare("SELECT id, code FROM stock_units").all<{ id: string; code: string }>();
    const before = new Map(all.results.map((unit) => [unit.id, unit.code]));
    expect((await fit({ no_label: true, stock_code: code }, "event-piece-01")).status).toBe(202);
    const made = (await recorded()).piece_code;
    const first = (await env.DB.prepare("SELECT id FROM stock_units WHERE state = 'fitted'").first<string>("id")) ?? "";
    const corrected = { no_label: true, stock_code: other };
    expect((await job.post(`/api/tech/jobs/${JOB}/piece`, corrected, "event-piece-02")).status).toBe(202);
    const back = await env.DB.prepare("SELECT state, code FROM stock_units WHERE id = ?1")
      .bind(first)
      .first<{ state: string; code: string }>();
    expect(back).toEqual({ state: "held", code: before.get(first) });
    const now = await env.DB.prepare("SELECT consumable_code, code FROM stock_units WHERE state = 'fitted'").all();
    expect(now.results).toEqual([{ consumable_code: other, code: made }]);
  });

  it("is made a label no piece of another visit or unit of stock carries already", async () => {
    const own = await madeLabel(env.DB, JOB);
    const [label = ""] = await inTheKit(code, {});
    await env.DB.prepare("UPDATE stock_units SET code = ?1 WHERE code = ?2").bind(own, label).run();
    const past = await madeLabel(env.DB, JOB);
    expect(past).not.toBe(own);
    expect(past).toMatch(/^MM-NL-\d{7}-[A-Z]$/);
    await env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, synced_at)
       VALUES ('pc-other', 'pc-other', ?1, ?2, '2026-03-21T06:30:00.000Z', ?3)`,
    )
      .bind(PERSON, past, NOW.toISOString())
      .run();
    const next = await madeLabel(env.DB, JOB);
    expect([own, past]).not.toContain(next);
  });

  it("is refused with no hair system picked, with a label sent as well, or with neither label nor none", async () => {
    const [label = ""] = await inTheKit(code, {});
    const refused = async (body: object, event: string) => {
      const step = await fit(body, event);
      expect(step.status).toBe(400);
      return (await step.json<{ error: { fields?: string[] } }>()).error.fields;
    };
    expect(await refused({ no_label: true }, "event-piece-01")).toEqual(["stock_code"]);
    expect(await refused({ no_label: true, piece_code: label, stock_code: code }, "event-piece-02")).toEqual([
      "piece_code",
    ]);
    expect(await refused({ stock_code: code }, "event-piece-03")).toEqual(["piece_code"]);
  });
});

describe("a piece that comes off", () => {
  beforeEach(async () => {
    await setUp("replacement");
  });

  it("is held in the kit as returned, its unit with it, once however often the step lands", async () => {
    const [worn = "", fresh = ""] = await inTheKit(code, {});
    // The worn piece went on Rohit at an earlier visit.
    await env.DB.batch([
      env.DB.prepare("UPDATE stock_units SET state = 'fitted', place = NULL WHERE code = ?1").bind(worn),
      env.DB.prepare(
        `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, synced_at)
         VALUES ('pc-1', 'pc-1', ?1, ?2, '2026-03-21T06:30:00.000Z', ?3)`,
      ).bind(PERSON, worn, NOW.toISOString()),
    ]);
    await job.workTo("consumables");
    await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [], short_reason: "other" }, "event-consumables-01");
    const step = {
      piece_code: fresh,
      stock_code: code,
      old_piece: { piece_code: worn, failure_reason: "Base lifting at the front" },
    };
    for (let replay = 0; replay < 2; replay += 1) {
      expect((await job.post(`/api/tech/jobs/${JOB}/piece`, step, "event-piece-01")).status).toBe(202);
    }
    const { results } = await env.DB.prepare(
      "SELECT piece_code, technician_id, reason, handed_in_at FROM piece_returns",
    ).all();
    expect(results).toEqual([
      { piece_code: worn, technician_id: IMRAN, reason: "Base lifting at the front", handed_in_at: null },
    ]);
    expect(await env.DB.prepare("SELECT state, place FROM stock_units WHERE code = ?1").bind(worn).first()).toEqual({
      state: "returned",
      place: IMRAN,
    });
  });

  it("is held in the kit to hand in when it came off because it was due, with no reason", async () => {
    const [worn = "", fresh = ""] = await inTheKit(code, {});
    await env.DB.prepare("UPDATE stock_units SET state = 'fitted', place = NULL WHERE code = ?1").bind(worn).run();
    await job.workTo("piece");
    const step = { piece_code: fresh, stock_code: code, old_piece: { piece_code: worn } };
    expect((await job.post(`/api/tech/jobs/${JOB}/piece`, step, "event-piece-01")).status).toBe(202);
    const returned = await env.DB.prepare("SELECT piece_code, reason FROM piece_returns").all();
    expect(returned.results).toEqual([{ piece_code: worn, reason: null }]);
    expect(await env.DB.prepare("SELECT state, place FROM stock_units WHERE code = ?1").bind(worn).first()).toEqual({
      state: "returned",
      place: IMRAN,
    });
  });
});
