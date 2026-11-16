// A replacement is booked only when the hair system ends (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md):
// from the first day of the month it falls due,
// within how far ahead a visit may be booked, and not while one is booked. One owed free, by a remake or a recall, is
// ops' to book. NOW is Monday 21 September 2026, 12 noon in India; a visit may be booked up to 5 November. Every name
// and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { returnedToStock } from "../../../src/domain/clients/client-package.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, SANA, client, technician, visit, wornPiece } from "./client-booking-fixtures.ts";

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

  it("opens from the quickest supplier's lead time where no place holds the hair system of the package asked for", async () => {
    const rohit = await client();
    await wornPiece(rohit.id, "2026-09-28");
    const at = NOW.toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
           grey_percent, density_percent)
         VALUES ('hp-1', ?1, 'ops@localhost', ?2, 'essential', 8, 10, '1B', 20, 100)`,
      ).bind(rohit.id, at),
      env.DB.prepare(
        `INSERT INTO consumables (code, name, unit, unit_cost, reorder_kit, created_at, updated_at)
         VALUES ('hs-essential', 'Essential 8x10', 'piece', 1200000, 0, ?1, ?1)`,
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO hair_systems (code, product, base_width_in, base_length_in, colour, grey_percent, density_percent)
         VALUES ('hs-essential', 'essential', 8, 10, '1B', 20, 100)`,
      ),
      env.DB.prepare(
        `INSERT INTO suppliers (id, name, country, currency, payment_terms_days, warranty_days, created_at, updated_at)
         VALUES ('sup-1', 'A supplier', 'CN', 'USD', 30, 90, ?1, ?1)`,
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO supplier_items (supplier_id, consumable_code, unit_price, pack_size, minimum_order, lead_time_days,
           updated_at)
         VALUES ('sup-1', 'hs-essential', 12000, 1, 1, 10, ?1)`,
      ).bind(at),
    ]);

    // None held anywhere: the days open ten days on, when the quickest supplier can deliver one.
    const days = await (await replacementDays(rohit)).json<{ days: { date: string }[] }>();
    expect(days.days[0]?.date).toBe("2026-10-01");
    expect((await hold(rohit, "2026-09-25")).status).toBe(422);
    expect((await hold(rohit, "2026-10-01")).status).toBe(201);
  });

  it("closes the order of the hair system worn, back to stock, only when booked as another package", async () => {
    const rohit = await client();
    const piece = await wornPiece(rohit.id, "2026-09-28");
    await env.DB.prepare("UPDATE people SET package = 'essential' WHERE id = ?1").bind(rohit.id).run();
    const booked = (id: string, tier: string) =>
      env.DB.batch([
        returnedToStock(env.DB, { id, personId: rohit.id, type: "replacement", tier, at: NOW.toISOString() }),
      ]);
    const closed = async () =>
      (
        await env.DB.prepare(
          "SELECT subject_id, reason FROM task_closures WHERE task_group = 'replacement_order'",
        ).all()
      ).results;

    await booked("v-same", "essential");
    expect(await closed()).toEqual([]);
    await booked("v-other", "natural");
    expect(await closed()).toEqual([
      { subject_id: piece, reason: "Returned to stock: the replacement is booked as natural" },
    ]);
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
