// Room made at booking (src/domain/booking/make-room.ts, ADR 0292): a start nobody can take is offered where one of a
// technician's drafts can go to another who may take it at its time, and holding it moves that draft in the same
// batch. NOW is Monday 21 September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { holdSlot } from "../../../src/domain/booking/hold-slot.ts";
import { startOffers } from "../../../src/domain/booking/start-offers.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { aHold } from "../fixtures/index.ts";
import { client, IMRAN, SANA, SANDEEP, technician, visit } from "./client-booking-fixtures.ts";

const TUESDAY = "2026-09-22";
const SERVICE = { type: "service", tier: "standard", minutes: 60 } as const;
const FREE = { amount_ex_gst: 0, amount: 0, gst_percent: 0 };

/** Where someone is: a technician's home, or a client's address. 28.4595 is the client booking; 28.55 near Sandeep. */
async function home(id: string, lat: number, radiusKm: number | null = null) {
  await env.DB.prepare(
    "UPDATE technicians SET home_lat = ?2, home_lng = 77.0266, home_label = 'Home', radius_km = ?3 WHERE id = ?1",
  )
    .bind(id, lat, radiusKm)
    .run();
}
const livesAt = (personId: string, lat: number) =>
  env.DB.prepare("UPDATE addresses SET lat = ?2, lng = 77.0266 WHERE person_id = ?1").bind(personId, lat).run();

/** A visit on Tuesday, at 11:00 unless `at` says, a draft unless `fixed`. */
async function elevenOClock(personId: string, technicianId: string, { fixed = false, at = "11:00" } = {}) {
  const id = await visit(personId, "service", "scheduled", indiaInstant(TUESDAY, at).toISOString(), technicianId);
  await env.DB.prepare(
    `UPDATE appointments SET technician_draft = ?2, service_city = 'Gurgaon', service_pincode = '122018'
     WHERE id = ?1`,
  )
    .bind(id, fixed ? 0 : 1)
    .run();
  return id;
}

let rohit: string;
let draft: string;

beforeEach(async () => {
  await markDatabase();
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANDEEP, "Sandeep Rawat", "SR");
  // Sana, switched off since, did the clients' last visits, so the rotation bars neither of the others.
  await technician(SANA, "Sana Mirza", "SM");
  await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SANA).run();
  // Imran lives 2 km from Rohit; Sandeep 12 km, beyond his 5 km ring and its overflow.
  await home(IMRAN, 28.4775);
  await home(SANDEEP, 28.5674, 5);
  rohit = (await client()).id;
  await livesAt(rohit, 28.4595);
  // Anjali lives 2 km from Sandeep, and her draft has Imran at 11:00.
  const anjali = (await client()).id;
  await livesAt(anjali, 28.55);
  draft = await elevenOClock(anjali, IMRAN);
});

/** Who could take Rohit's service at 11:00 on Tuesday, and the draft each would move. */
async function atEleven() {
  const [tuesday] = await startOffers({
    db: env.DB,
    placing: { personId: rohit, pincode: "122018" },
    visit: { type: "service", minutes: SERVICE.minutes },
    from: TUESDAY,
    days: 1,
    now: NOW,
  });
  return tuesday?.starts
    .find((start) => start.time === "11:00")
    ?.takers.map((taker) => ({ technician: taker.technician.id, draft: taker.room?.draft.id, to: taker.room?.to }));
}

/** Rohit's service held at 11:00 on Tuesday, with what the batch writes ahead of it. */
const holdEleven = (alongside: readonly D1PreparedStatement[] = []) =>
  holdSlot({
    db: env.DB,
    input: {
      personId: rohit,
      service: SERVICE,
      date: TUESDAY,
      window: "morning",
      price: FREE,
      pincode: "122018",
      startsAt: indiaInstant(TUESDAY, "11:00"),
      alongside,
    },
    now: NOW,
    holdSeconds: 600,
  });

const draftRow = () =>
  env.DB.prepare("SELECT technician_id, technician_draft FROM appointments WHERE id = ?1").bind(draft).first();

describe("room made at booking", () => {
  it("offers a start only a draft's move frees, with the technician who had the draft", async () => {
    expect(await atEleven()).toEqual([{ technician: IMRAN, draft, to: SANDEEP }]);
  });

  it("moves the draft as the start is held, a draft still, with no move's lock left", async () => {
    expect((await holdEleven())?.technician.id).toBe(IMRAN);
    expect(await draftRow()).toEqual({ technician_id: SANDEEP, technician_draft: 1 });
    expect(
      await env.DB.prepare("SELECT was_technician_id, now_technician_id, reason, actor FROM dispatch_moves").all(),
    ).toMatchObject({
      results: [{ was_technician_id: IMRAN, now_technician_id: SANDEEP, reason: "zone_rebalance", actor: "allotment" }],
    });
    const claims = await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_claims WHERE move_id IS NOT NULL").first("n");
    expect(claims).toBe(0);
  });

  it("writes nothing, the draft left where it was, where the day it would go to changed since it was read", async () => {
    // Another hold locks Sandeep's Tuesday between the look and the write, in the same batch, ahead of the move.
    const rival = await aHold({ person_id: (await client()).id, technician_id: SANDEEP });
    const locked = env.DB.prepare(
      "INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES (?1, ?2, 'rev:1', ?3)",
    ).bind(SANDEEP, TUESDAY, rival.id);
    expect(await holdEleven([locked])).toBeNull();
    expect(await draftRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dispatch_moves").first("n")).toBe(0);
  });

  it("holds a start that moves nothing, where the window asked for has one, though moving a draft costs less", async () => {
    // Imran's fixed 16:30 is far north, so Rohit at 13:30 means a long way round; at 12:00, with the draft gone, less.
    const north = (await client()).id;
    await livesAt(north, 28.56);
    await elevenOClock(north, IMRAN, { fixed: true, at: "16:30" });
    const hold = await holdSlot({
      db: env.DB,
      // The afternoon's first starts need Anjali's draft moved; from 13:30 Imran is free as his day stands.
      input: { personId: rohit, service: SERVICE, date: TUESDAY, window: "afternoon", price: FREE, pincode: "122018" },
      now: NOW,
      holdSeconds: 600,
    });
    expect(hold?.technician.id).toBe(IMRAN);
    expect(hold?.startsAt.toISOString()).toBe(indiaInstant(TUESDAY, "13:30").toISOString());
    expect(await draftRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dispatch_moves").first("n")).toBe(0);
  });

  it("makes no room by moving a visit whose technician is fixed", async () => {
    await env.DB.prepare("UPDATE appointments SET technician_draft = 0 WHERE id = ?1").bind(draft).run();
    expect(await atEleven()).toBeUndefined();
  });

  it("makes no room where nobody else may take the draft, or has its time free", async () => {
    // Sandeep's ring no longer reaches Anjali.
    await home(SANDEEP, 28.5674, 1);
    expect(await atEleven()).toBeUndefined();
    // His ring reaches her again, but his 11:00 is taken by a visit of his own.
    await home(SANDEEP, 28.5674, 5);
    const other = (await client()).id;
    await livesAt(other, 28.56);
    await elevenOClock(other, SANDEEP, { fixed: true });
    expect(await atEleven()).toBeUndefined();
  });
});
