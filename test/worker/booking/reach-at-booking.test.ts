// Booking offers a start only to the technicians whose reach from home takes in the address (src/policy/reach.ts,
// ADR 0223). NOW is Monday 21 September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { startOffers } from "../../../src/domain/booking/start-offers.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { client, IMRAN, SANDEEP, SANA, technician } from "./client-booking-fixtures.ts";

/** A home, as ops set one: Imran's a few km from the client, Sandeep's some 30 km north. */
async function home(id: string, lat: number, lng: number) {
  await env.DB.prepare("UPDATE technicians SET home_lat = ?2, home_lng = ?3, home_label = 'Home' WHERE id = ?1")
    .bind(id, lat, lng)
    .run();
}

/** Who is offered Tuesday's starts, by any start. */
async function offered(personId: string): Promise<string[]> {
  const [day] = await startOffers({
    db: env.DB,
    placing: { personId },
    visit: { type: "service", minutes: 90 },
    from: "2026-09-22",
    days: 1,
    now: NOW,
  });
  return [...new Set(day?.starts.flatMap((start) => start.takers.map((taker) => taker.technician.id)) ?? [])].sort();
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
  it("offers the address only to those whose reach takes it in", async () => {
    await home(IMRAN, 28.4955, 77.0266);
    await home(SANDEEP, 28.7295, 77.0266);
    expect(await offered(rohit)).toEqual([IMRAN]);
  });

  it("takes a technician's own reach over the business's", async () => {
    await home(IMRAN, 28.4955, 77.0266);
    await home(SANDEEP, 28.7295, 77.0266);
    await env.DB.prepare("UPDATE technicians SET reach_min = 180 WHERE id = ?1").bind(SANDEEP).run();
    expect(await offered(rohit)).toEqual([IMRAN, SANDEEP].sort());
  });

  it("leaves a technician with no home pin to the city, as before reaches", async () => {
    await home(IMRAN, 28.7295, 77.0266);
    expect(await offered(rohit)).toEqual([SANDEEP]);
  });
});
