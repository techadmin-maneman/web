// Clients steered to the times that drive least (src/policy/steering.ts, ADR 0293): the app's and the site's times
// leave out a start that adds more driving than ops allow, never the day's last, and mark the cheapest; a client's
// hold takes only a start offered; ops see and may hold every start. NOW is Monday 21 September 2026, 12 noon in
// India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { availability, freeTechnicians } from "../../../src/domain/booking/availability.ts";
import { holdSlot } from "../../../src/domain/booking/hold-slot.ts";
import { startOffers } from "../../../src/domain/booking/start-offers.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { client, IMRAN, SANA, technician, visit } from "./client-booking-fixtures.ts";

const TUESDAY = "2026-09-22";
const SERVICE = { type: "service", tier: "standard", minutes: 60 } as const;
const FREE = { amount_ex_gst: 0, amount: 0, gst_percent: 0 };
/** Two times a day marked, and no time offered to a client that adds more than 10 minutes of driving. */
const STEERED = { recommended: 2, drive_cap: 10 };

let rohit: string;

beforeEach(async () => {
  await markDatabase();
  await technician(IMRAN, "Imran Qureshi", "IQ");
  // Sana, switched off since, did Rohit's last visit, so the rotation bars nobody.
  await technician(SANA, "Sana Mirza", "SM");
  await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SANA).run();
  await env.DB.prepare("UPDATE technicians SET home_lat = 28.4775, home_lng = 77.0266 WHERE id = ?1").bind(IMRAN).run();
  rohit = (await client()).id;
  await env.DB.prepare("UPDATE addresses SET lat = 28.4595, lng = 77.0266 WHERE person_id = ?1").bind(rohit).run();
  // Imran's fixed visit far north at 15:00: Rohit's starts around it add far more driving than his morning's do.
  const north = (await client()).id;
  await env.DB.prepare("UPDATE addresses SET lat = 28.62, lng = 77.0266 WHERE person_id = ?1").bind(north).run();
  const far = await visit(north, "service", "scheduled", indiaInstant(TUESDAY, "15:00").toISOString(), IMRAN);
  await env.DB.prepare("UPDATE appointments SET service_city = 'Gurgaon', service_pincode = '122018' WHERE id = ?1")
    .bind(far)
    .run();
  await env.DB.prepare("INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('steering', ?1, 'ops', ?2)")
    .bind(JSON.stringify(STEERED), NOW.toISOString())
    .run();
});

const placing = () => ({ personId: rohit, pincode: "122018" });

/** Every start some technician can take on Tuesday, unsteered, with its best technician's driving and cost. */
async function everyStart() {
  const [tuesday] = await startOffers({
    db: env.DB,
    placing: placing(),
    visit: { type: "service", minutes: SERVICE.minutes },
    from: TUESDAY,
    days: 1,
    now: NOW,
  });
  return (tuesday?.starts ?? []).map((start) => ({
    time: start.time,
    startsAt: start.startsAt,
    drive: start.takers[0]?.addedDrive ?? 0,
    cost: start.takers[0]?.cost ?? 0,
  }));
}

/** Tuesday's starts as the app and the site offer them. */
async function clientStarts() {
  const [tuesday] = await availability({
    db: env.DB,
    placing: placing(),
    visit: { type: "service", minutes: SERVICE.minutes },
    from: TUESDAY,
    days: 1,
    now: NOW,
  });
  return tuesday?.starts ?? [];
}

const holdAt = (startsAt: Date, from: "app" | "ops") =>
  holdSlot({
    db: env.DB,
    input: { personId: rohit, service: SERVICE, date: TUESDAY, window: "afternoon", price: FREE, startsAt, from },
    now: NOW,
    holdSeconds: 600,
  });

describe("times steered for clients", () => {
  it("leaves out a start that drives more than ops allow, but never the day's last, and marks the cheapest", async () => {
    const every = await everyStart();
    const last = every.at(-1)?.time;
    const over = every.filter((start) => start.drive > STEERED.drive_cap && start.time !== last);
    // The day has starts above the cap, and some below it, so the steering has something to do.
    expect(over.length).toBeGreaterThan(0);
    expect(over.length).toBeLessThan(every.length - 1);
    const offered = await clientStarts();
    expect(offered.map((start) => start.time)).toEqual(
      every.filter((start) => !over.includes(start)).map((start) => start.time),
    );
    const cheapest = [...offered]
      .map((start) => every.find((each) => each.time === start.time))
      .sort((a, b) => (a?.cost ?? 0) - (b?.cost ?? 0) || (a?.time ?? "").localeCompare(b?.time ?? ""))
      .slice(0, STEERED.recommended)
      .map((start) => start?.time);
    expect(offered.filter((start) => start.recommended).map((start) => start.time)).toEqual(
      cheapest.sort((a, b) => (a ?? "").localeCompare(b ?? "")),
    );
  });

  it("shows ops every start", async () => {
    const [tuesday] = await freeTechnicians({
      db: env.DB,
      personId: rohit,
      visit: { type: "service", minutes: SERVICE.minutes },
      from: TUESDAY,
      days: 1,
      now: NOW,
    });
    expect(tuesday?.starts.map((start) => start.time)).toEqual((await everyStart()).map((start) => start.time));
  });

  it("holds a start not offered to clients for ops, never for a client", async () => {
    const every = await everyStart();
    const last = every.at(-1)?.time;
    const hidden = every.find((start) => start.drive > STEERED.drive_cap && start.time !== last);
    expect(hidden).toBeDefined();
    if (hidden === undefined) return;
    expect(await holdAt(hidden.startsAt, "app")).toBeNull();
    expect((await holdAt(hidden.startsAt, "ops"))?.startsAt.toISOString()).toBe(hidden.startsAt.toISOString());
  });
});
