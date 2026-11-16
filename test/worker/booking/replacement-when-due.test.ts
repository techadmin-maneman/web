// A replacement is booked only when the hair system ends (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md):
// from the first day of the month it falls due,
// within how far ahead a visit may be booked, and not while one is booked. One owed free, by a remake or a recall, is
// ops' to book. NOW is Monday 21 September 2026, 12 noon in India; a visit may be booked up to 5 November. Every name
// and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, SANA, client, technician, visit, wornPiece } from "./client-booking-fixtures.ts";
import { aPackage } from "../fixtures/index.ts";
import { visitUpkeep } from "../../../src/domain/visits/visit-upkeep.ts";

let app: App;

beforeEach(async () => {
  await markDatabase();
  app = appFor("local", fakeDependencies(), {}, "client");
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANA, "Sana Mirza", "SM");
});

type Who = { readonly id: string; readonly cookie: string };

const typesOf = async (who: Who) =>
  (await (await request(app, "/api/me", { headers: { Cookie: who.cookie } })).json<{ booking: { types: string[] } }>())
    .booking.types;

const replacementDays = (who: Who) =>
  request(app, "/api/availability?type=replacement", { headers: { Cookie: who.cookie } });

const hold = (who: Who, date: string) =>
  request(app, "/api/holds", {
    method: "POST",
    headers: { Cookie: who.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
    body: JSON.stringify({ type: "replacement", date, window: "morning" }),
  });

/** The client's latest hair profile, recommending Essential, of the packages' own hair system spec. */
const profiled = (personId: string) =>
  env.DB.prepare(
    `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
       grey_percent, density_percent)
     VALUES (?1, ?1, 'ops@localhost', ?2, 'essential', 8, 10, '1B', 0, 100)`,
  )
    .bind(personId, NOW.toISOString())
    .run();

/**
 * A package ops sell, its hair system sold by a supplier in ten days and by a retired one in two, and held in the
 * central store or not. Its hair system's stock code.
 */
async function sold(code: string, { held }: { readonly held: boolean }): Promise<string> {
  const { hairSystem } = await aPackage({ code, name: `Mane Man ${code}`, firstFit: 3000000 });
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO suppliers (id, name, country, currency, payment_terms_days, warranty_days, created_at,
         updated_at, retired_at)
       VALUES ('sup-live', 'A supplier', 'CN', 'USD', 30, 90, ?1, ?1, NULL),
              ('sup-gone', 'A retired supplier', 'CN', 'USD', 30, 90, ?1, ?1, ?1)`,
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO supplier_items (supplier_id, consumable_code, unit_price, pack_size, minimum_order, lead_time_days,
         updated_at)
       VALUES ('sup-live', ?1, 12000, 1, 1, 10, ?2), ('sup-gone', ?1, 12000, 1, 1, 2, ?2)`,
    ).bind(hairSystem, at),
    ...(held
      ? [
          env.DB.prepare(
            "INSERT INTO stock_balances (consumable_code, place, quantity) VALUES (?1, 'central', 1)",
          ).bind(hairSystem),
        ]
      : []),
  ]);
  return hairSystem;
}

/** The first day the app offers a replacement on, asked as `query` names it. */
const opensOn = async (who: Who, query = "") =>
  await (
    await request(app, `/api/availability?type=replacement${query}`, { headers: { Cookie: who.cookie } })
  ).json<{
    opens: string;
    days: { date: string }[];
  }>();

describe("a replacement", () => {
  it("is not offered before the month its hair system falls due", async () => {
    const rohit = await client();
    // Due on 10 December: bookable from 1 December, past the last day a visit may be booked on.
    await wornPiece(rohit.id, "2026-12-10");

    expect(await typesOf(rohit)).toEqual(["service"]);
    expect((await replacementDays(rohit)).status).toBe(422);
    const held = await hold(rohit, "2026-10-15");
    expect(held.status).toBe(422);
    expect(await held.json()).toMatchObject({ error: { code: "not_bookable" } });
  });

  it("is offered from the first day of that month, and not a day before", async () => {
    const rohit = await client();
    await wornPiece(rohit.id, "2026-10-20");

    expect(await typesOf(rohit)).toEqual(["service", "replacement"]);
    const days = await (await replacementDays(rohit)).json<{ days: { date: string }[] }>();
    expect(days.days[0]?.date).toBe("2026-10-01");
    expect((await hold(rohit, "2026-09-30")).status).toBe(422);
    expect((await hold(rohit, "2026-10-01")).status).toBe(201);
  });

  it("opens the day after the quickest supplier still in use delivers, where nothing holds the hair system sold", async () => {
    const rohit = await client();
    await wornPiece(rohit.id, "2026-09-28");
    await profiled(rohit.id);
    await sold("essential", { held: false });
    await env.DB.prepare("UPDATE people SET package = 'essential' WHERE id = ?1").bind(rohit.id).run();

    // Ten days for the live supplier, the retired one's two days not counted: in time for the day after.
    const days = await opensOn(rohit);
    expect([days.opens, days.days[0]?.date]).toEqual(["2026-10-02", "2026-10-02"]);
    expect((await hold(rohit, "2026-10-01")).status).toBe(422);
    expect((await hold(rohit, "2026-10-02")).status).toBe(201);
  });

  it("reads the package the replacement is sold as: the one named, else the client's, a move's its own", async () => {
    const rohit = await client();
    await wornPiece(rohit.id, "2026-09-28");
    await profiled(rohit.id);
    // On Essential, which is held; Natural, which they may change to, nobody holds.
    await sold("essential", { held: true });
    await sold("natural", { held: false });
    await env.DB.prepare("UPDATE people SET package = 'essential' WHERE id = ?1").bind(rohit.id).run();

    expect((await opensOn(rohit)).opens).toBe("2026-09-22");
    expect((await opensOn(rohit, "&tier=natural")).opens).toBe("2026-10-02");
    // A replacement booked as Natural, moved: its own package, though the move names none.
    const booked = await visit(rohit.id, "replacement", "scheduled", "2026-10-05T04:30:00.000Z", IMRAN);
    await env.DB.prepare("UPDATE appointments SET tier = 'natural' WHERE id = ?1").bind(booked).run();
    expect((await opensOn(rohit, `&moving=${booked}`)).opens).toBe("2026-10-02");
  });

  it("counts as booked from the first day of the month its hair system falls due, as the order task reads it", async () => {
    const rohit = await client();
    // Booked on 1 October for a hair system due on 20 October, the first day it could be.
    await visit(rohit.id, "replacement", "scheduled", "2026-10-01T04:30:00.000Z", IMRAN);
    const piece = await wornPiece(rohit.id, "2026-10-20");
    const booked = () =>
      env.DB.prepare("SELECT replacement_booked FROM pieces WHERE id = ?1").bind(piece).first("replacement_booked");
    // The piece's own trigger reads it so as it lands; the booking's upkeep reads it so again.
    expect(await booked()).toBe(1);
    await env.DB.prepare("UPDATE pieces SET replacement_booked = 0 WHERE id = ?1").bind(piece).run();
    await env.DB.batch(visitUpkeep(env.DB, { people: [rohit.id] }, NOW.toISOString()));
    expect(await booked()).toBe(1);
  });

  it("never counts the replacement that fitted a piece as booked for it, when a recall brings its due day back", async () => {
    const rohit = await client();
    // A replacement on 3 October fitted the piece; a recall on 20 October makes it due that day.
    await visit(rohit.id, "replacement", "completed", "2026-10-03T04:30:00.000Z", IMRAN);
    const piece = await wornPiece(rohit.id, "2026-10-20", "2026-10-03");
    const booked = () =>
      env.DB.prepare("SELECT replacement_booked FROM pieces WHERE id = ?1").bind(piece).first("replacement_booked");
    expect(await booked()).toBe(0);
    await env.DB.batch(visitUpkeep(env.DB, { people: [rohit.id] }, NOW.toISOString()));
    expect(await booked()).toBe(0);
  });

  it("opens as usual where the hair system sold is on its way between places", async () => {
    const rohit = await client();
    await wornPiece(rohit.id, "2026-09-28");
    await profiled(rohit.id);
    const code = await sold("essential", { held: false });
    await env.DB.prepare("UPDATE people SET package = 'essential' WHERE id = ?1").bind(rohit.id).run();
    await env.DB.prepare(
      `INSERT INTO stock_transfers (id, consumable_code, quantity, from_place, to_place, state, sent_by, sent_at)
       VALUES ('tr-1', ?1, 1, 'central', 'central', 'in_transit', 'ops@localhost', ?2)`,
    )
      .bind(code, NOW.toISOString())
      .run();
    expect((await opensOn(rohit)).opens).toBe("2026-09-22");
  });

  it("refuses a hold before the hair system sold can be fitted, of the package named or a move's own", async () => {
    const rohit = await client();
    await wornPiece(rohit.id, "2026-09-28");
    await profiled(rohit.id);
    await sold("essential", { held: true });
    await sold("natural", { held: false });
    await env.DB.prepare("UPDATE people SET package = 'essential' WHERE id = ?1").bind(rohit.id).run();
    const holdAs = (date: string, extra: object) =>
      request(app, "/api/holds", {
        method: "POST",
        headers: { Cookie: rohit.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ type: "replacement", date, window: "morning", ...extra }),
      });

    expect((await holdAs("2026-10-01", { tier: "natural" })).status).toBe(422);
    expect((await holdAs("2026-10-02", { tier: "natural" })).status).toBe(201);
    const booked = await visit(rohit.id, "replacement", "scheduled", "2026-10-05T04:30:00.000Z", IMRAN);
    await env.DB.prepare("UPDATE appointments SET tier = 'natural' WHERE id = ?1").bind(booked).run();
    expect((await holdAs("2026-10-01", { moving: booked })).status).toBe(422);
  });

  it("is offered from tomorrow once its month has begun", async () => {
    const rohit = await client();
    await wornPiece(rohit.id, "2026-09-28");

    const days = await (await replacementDays(rohit)).json<{ days: { date: string }[] }>();
    expect(days.days[0]?.date).toBe("2026-09-22");
  });

  it("names on Home the hair system worn, when it was fitted and when its replacement opens", async () => {
    const rohit = await client();
    await env.DB.prepare("UPDATE people SET package = 'standard' WHERE id = ?1").bind(rohit.id).run();
    await wornPiece(rohit.id, "2026-12-10", "2026-06-10");

    const me = await (
      await request(app, "/api/me", { headers: { Cookie: rohit.cookie } })
    ).json<{
      hair_system: unknown;
    }>();
    expect(me.hair_system).toEqual({
      package: "standard",
      name: expect.any(String) as string,
      fitted_on: "2026-06-10",
      replace_after_months: expect.any(Number) as number,
      due_on: "2026-12-10",
      replacement_opens_on: "2026-12-01",
    });
  });

  it("is not offered for a client with no hair system on record", async () => {
    const rohit = await client();
    expect(await typesOf(rohit)).toEqual(["service"]);
  });

  it("is not offered again while one is booked", async () => {
    const rohit = await client();
    await wornPiece(rohit.id, "2026-09-30");
    await visit(rohit.id, "replacement", "scheduled", "2026-09-29T04:30:00.000Z", IMRAN);

    expect(await typesOf(rohit)).toEqual(["service"]);
  });

  it("owed by a failed hair system is ops' to book free, not the client's", async () => {
    const rohit = await client();
    const piece = await wornPiece(rohit.id, "2026-09-30");
    await env.DB.prepare("UPDATE pieces SET failed_at = ?2 WHERE id = ?1").bind(piece, NOW.toISOString()).run();

    expect(await typesOf(rohit)).toEqual(["service"]);
    expect((await hold(rohit, "2026-09-24")).status).toBe(422);
  });

  it("owed by a recall is ops' to book free, not the client's", async () => {
    const rohit = await client();
    await wornPiece(rohit.id, "2026-09-30");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO consumables (code, name, unit, unit_cost, reorder_kit, created_at, updated_at)
         VALUES ('hs-1', 'Essential', 'piece', 1, 0, ?1, ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        "INSERT INTO stock_lots (id, consumable_code, lot_code, received_at) VALUES ('lot-1', 'hs-1', 'BAD', ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO recalls (id, number, lot_id, reason, raised_by, raised_at)
         VALUES ('recall-1', 1, 'lot-1', 'Shedding', 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        "INSERT INTO recall_pieces (recall_id, piece_id, due_before) SELECT 'recall-1', id, replacement_due_at FROM pieces",
      ),
    ]);

    expect(await typesOf(rohit)).toEqual(["service"]);
    expect((await hold(rohit, "2026-09-24")).status).toBe(422);
  });
});
