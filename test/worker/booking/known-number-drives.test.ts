// A number the site knows, answered as a new number is where Google's drives decide a start
// (src/domain/booking/new-number-state.ts, docs/decisions/0210-booking-by-start-time.md). NOW is Monday 21 September
// 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { DriveCheck, TooTight } from "../../../src/domain/booking/drive-check.ts";
import { holdSlot } from "../../../src/domain/booking/hold-slot.ts";
import { newNumbersState } from "../../../src/domain/booking/new-number-state.ts";
import { siteVisit } from "../../../src/domain/booking/site-visit.ts";
import type { RoutesProvider } from "../../../src/providers/routes/index.ts";
import { LOCAL_SETTINGS, markDatabase, NOW } from "../helpers.ts";
import { anAddress, aPerson, aTechnician, aVisit } from "../fixtures/index.ts";

/** Google, answering every drive in an hour; and what it said was too tight. */
function slowRoads(): { drives: DriveCheck; tight: TooTight[] } {
  const tight: TooTight[] = [];
  const routes: RoutesProvider = {
    route: (stops) =>
      Promise.resolve({
        ok: true,
        legs: stops.slice(1).map(() => ({ seconds: 3600, meters: 1000 })),
        polyline: null,
      }),
    map: () => Promise.resolve({ ok: false, detail: "no map here" }),
    areaMap: () => Promise.resolve({ ok: false, detail: "not drawn here" }),
  };
  const drives: DriveCheck = {
    routes,
    alert: () => Promise.resolve(),
    settings: LOCAL_SETTINGS,
    refused: () => Promise.resolve(),
    answered: () => Promise.resolve(),
    tooTight: (short) => {
      tight.push(short);
    },
  };
  return { drives, tight };
}

/**
 * Noon on Wednesday 23 September, India's time: room after the technician's visit at 10:00 on the estimate's drive,
 * none on Google's hour.
 */
const AFTER_HIS_VISIT = new Date("2026-09-23T06:30:00.000Z");
const ASKED = {
  plan: "consultation" as const,
  date: "2026-09-23",
  pincode: "122018",
  window: "afternoon" as const,
  startsAt: AFTER_HIS_VISIT,
};

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    `INSERT INTO serviceable_pincodes (pincode, area, city, served, centre_lat, centre_lng)
     VALUES ('122018', 'Sector 65', 'Gurgaon', 1, 28.4, 77.05)`,
  ).run();
  const technician = await aTechnician({ city: "Gurgaon" });
  const client = await aPerson();
  await anAddress(client.id, { lat: 28.401, lng: 77.051 });
  await aVisit({
    person_id: client.id,
    technician_id: technician.id,
    window_start: "2026-09-23T04:30:00.000Z",
    window_end: "2026-09-23T05:30:00.000Z",
  });
});

describe("a number the site knows", () => {
  it("is answered taken where Google's drive leaves a new number's hold no room, as that hold is", async () => {
    const { drives, tight } = slowRoads();
    const known = await newNumbersState({ db: env.DB, now: NOW, selfServeBooking: true, drives }, ASKED);
    const visit = await siteVisit(env.DB, "consultation", ASKED.date, ASKED.pincode);
    const held = await holdSlot({
      db: env.DB,
      input: {
        personId: (await aPerson()).id,
        service: visit?.service ?? { type: "consultation", tier: "standard", minutes: 60 },
        date: ASKED.date,
        window: ASKED.window,
        startsAt: AFTER_HIS_VISIT,
        price: visit?.price ?? { amount: 0, amount_ex_gst: 0, gst_percent: 0 },
        pincode: ASKED.pincode,
        from: "site",
      },
      now: NOW,
      holdSeconds: 600,
      drives,
    });

    expect(held).toBeNull();
    expect(known).toEqual({ state: "taken", startsAt: null });
    // Google's hour and the time to park, beside the estimate's for the same road, which it tunes.
    expect(tight[0]).toMatchObject({ leg: "before", google_minutes: 70 });
  });

  it("is answered booked at the same start where Google is not asked", async () => {
    const known = await newNumbersState({ db: env.DB, now: NOW, selfServeBooking: true, drives: null }, ASKED);
    expect(known).toEqual({ state: "booked", startsAt: AFTER_HIS_VISIT });
  });
});
