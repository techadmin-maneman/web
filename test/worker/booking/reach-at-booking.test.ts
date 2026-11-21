// Booking offers a start only to the technicians whose radius from home, or the overflow ring past it, takes in the
// address, and those inside their radius first (src/policy/reach.ts, ADR 0289). NOW is Monday 21 September 2026, 12
// noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { startOffers } from "../../../src/domain/booking/start-offers.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { client, IMRAN, SANDEEP, SANA, technician, visit } from "./client-booking-fixtures.ts";

/** A home, as ops set one: 28.4955 is 4 km north of the client, 28.5674 12 km, 28.7295 30 km. */
async function home(id: string, lat: number, lng: number) {
  await env.DB.prepare("UPDATE technicians SET home_lat = ?2, home_lng = ?3, home_label = 'Home' WHERE id = ?1")
    .bind(id, lat, lng)
    .run();
}

/** Tuesday's starts. */
async function tuesday(personId: string) {
  const [day] = await startOffers({
    db: env.DB,
    placing: { personId },
    visit: { type: "service", minutes: 90 },
    from: "2026-09-22",
    days: 1,
    now: NOW,
  });
  return day?.starts ?? [];
}

/** Who is offered Tuesday's starts, by any start. */
async function offered(personId: string): Promise<string[]> {
  const starts = await tuesday(personId);
  return [...new Set(starts.flatMap((start) => start.takers.map((taker) => taker.technician.id)))].sort();
}

let rohit: string;

beforeEach(async () => {
  await markDatabase();
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANDEEP, "Sandeep Rawat", "SR");
  await technician(SANA, "Sana Mirza", "SM");
  await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SANA).run();
  rohit = (await client()).id;
  await env.DB.prepare("UPDATE addresses SET lat = 28.4595, lng = 77.0266 WHERE person_id = ?1").bind(rohit).run();
});

describe("reach at booking", () => {
  it("offers the address only to those whose radius or ring takes it in", async () => {
    await home(IMRAN, 28.4955, 77.0266);
    await home(SANDEEP, 28.7295, 77.0266);
    expect(await offered(rohit)).toEqual([IMRAN]);
  });

  it("takes a technician's own radius over the business's", async () => {
    await home(IMRAN, 28.4955, 77.0266);
    await home(SANDEEP, 28.7295, 77.0266);
    await env.DB.prepare("UPDATE technicians SET radius_km = 40 WHERE id = ?1").bind(SANDEEP).run();
    expect(await offered(rohit)).toEqual([IMRAN, SANDEEP].sort());
  });

  it("sends someone into their ring only behind those whose radius takes the address in", async () => {
    await home(IMRAN, 28.4955, 77.0266);
    await home(SANDEEP, 28.5674, 77.0266);
    const starts = await tuesday(rohit);
    expect(starts.length).toBeGreaterThan(0);
    for (const start of starts) expect(start.takers[0]?.technician.id).toBe(IMRAN);
    expect(await offered(rohit)).toEqual([IMRAN, SANDEEP].sort());
  });

  it("puts a technician with no home pin in the ring, so a city whose pins are not set still books", async () => {
    await home(IMRAN, 28.7295, 77.0266);
    expect(await offered(rohit)).toEqual([SANDEEP]);
  });

  it("sends a technician with no home pin only after anyone whose home is known", async () => {
    await home(IMRAN, 28.4955, 77.0266);
    const both = (await tuesday(rohit)).filter((start) => start.takers.length === 2);
    expect(both.length).toBeGreaterThan(0);
    for (const start of both) expect(start.takers.map((taker) => taker.technician.id)).toEqual([IMRAN, SANDEEP]);
  });

  it("gives a start to the one with less booked that week, though the other drives a little less", async () => {
    // Imran lives 4 km from the client and Sandeep 6, but Imran has four and a half hours booked on Monday.
    await home(IMRAN, 28.4955, 77.0266);
    await home(SANDEEP, 28.5135, 77.0266);
    for (const at of ["03:30", "05:30", "07:30"])
      await visit(null, "service", "scheduled", `2026-09-21T${at}:00.000Z`, IMRAN);
    const both = (await tuesday(rohit)).filter((start) => start.takers.length === 2);
    expect(both.length).toBeGreaterThan(0);
    for (const start of both) expect(start.takers[0]?.technician.id).toBe(SANDEEP);
  });
});
