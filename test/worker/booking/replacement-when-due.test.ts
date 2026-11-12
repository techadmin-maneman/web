// A replacement is booked only when the hair system ends (owner, 12 November 2026;
// docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md): from the first day of the month it falls due,
// within how far ahead a visit may be booked, and not while one is booked. One owed free, by a remake or a recall, is
// ops' to book. NOW is Monday 21 September 2026, 12 noon in India; a visit may be booked up to 5 November. Every name
// and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
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

  it("is offered from tomorrow once its month has begun", async () => {
    const rohit = await client();
    await wornPiece(rohit.id, "2026-09-28");

    const days = await (await replacementDays(rohit)).json<{ days: { date: string }[] }>();
    expect(days.days[0]?.date).toBe("2026-09-22");
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
