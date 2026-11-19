// The starts offered leave out those Google's kept drive leaves no room for (src/domain/booking/start-offers.ts,
// src/domain/booking/drive-check.ts): a start a hold was refused for is not offered again, and Google is not asked.
// NOW is Monday 21 September 2026, noon in India. Every pin here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { startOffers } from "../../../src/domain/booking/start-offers.ts";
import { driveThrough } from "../../../src/domain/platform/road-drives.ts";
import type { RoutesProvider } from "../../../src/providers/routes/index.ts";
import { LOCAL_SETTINGS, markDatabase, NOW } from "../helpers.ts";
import { client, IMRAN, SANA, technician } from "./client-booking-fixtures.ts";

const HOME = { lat: 28.4955, lng: 77.0266 };
const DOOR = { lat: 28.4595, lng: 77.0266 };

/** Google, answering every leg in `minutes`, and how often it was asked. */
function google(minutes: number): { routes: RoutesProvider; asked: () => number } {
  let asked = 0;
  const routes: RoutesProvider = {
    route: (stops) => {
      asked += 1;
      const legs = stops.slice(1).map(() => ({ seconds: minutes * 60, meters: 1000 }));
      return Promise.resolve({ ok: true, legs, polyline: null });
    },
    map: () => Promise.resolve({ ok: false, detail: "no map here" }),
    areaMap: () => Promise.resolve({ ok: false, detail: "not drawn here" }),
  };
  return { routes, asked: () => asked };
}

/** Tuesday's starts offered to the client, as India's clock writes them. */
async function offered(personId: string): Promise<string[]> {
  const [day] = await startOffers({
    db: env.DB,
    placing: { personId },
    visit: { type: "service", minutes: 90 },
    from: "2026-09-22",
    days: 1,
    now: NOW,
  });
  return day?.starts.map((start) => start.time) ?? [];
}

let rohit: string;

beforeEach(async () => {
  await markDatabase();
  await technician(IMRAN, "Imran Qureshi", "IQ");
  // Who took the client's last visit, and takes no more.
  await technician(SANA, "Sana Mirza", "SM");
  await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SANA).run();
  await env.DB.prepare("UPDATE technicians SET home_lat = ?2, home_lng = ?3, home_label = 'Home' WHERE id = ?1")
    .bind(IMRAN, HOME.lat, HOME.lng)
    .run();
  rohit = (await client()).id;
  await env.DB.prepare("UPDATE addresses SET lat = ?2, lng = ?3 WHERE person_id = ?1")
    .bind(rohit, DOOR.lat, DOOR.lng)
    .run();
});

describe("The starts offered", () => {
  it("leave out those Google's kept drive from home leaves no room for, and keep the rest", async () => {
    const before = await offered(rohit);
    expect(before.length).toBeGreaterThan(0);

    // A hold asked Google, which found the drive from home three hours long, and kept the answer.
    const slow = google(180);
    const answer = await driveThrough(
      env.DB,
      { routes: slow.routes, alert: () => Promise.resolve() },
      { points: [HOME, DOOR], at: { now: NOW, settings: LOCAL_SETTINGS } },
    );
    expect(answer.ok).toBe(true);

    const after = await offered(rohit);
    // Three hours and the time to park from the day's opening: nothing before then is offered, the rest still is.
    const first = before[0] ?? "";
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThan(before.length);
    expect(after.every((time) => time > first)).toBe(true);
    expect(after).toEqual(before.filter((time) => time >= (after[0] ?? "")));
    // Google was asked once, by the hold, and never by the offers.
    expect(slow.asked()).toBe(1);
  });
});
