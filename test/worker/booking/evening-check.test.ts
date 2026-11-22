// Tomorrow checked on Google before it is fixed (src/domain/booking/evening-check.ts, ADR 0290): a drive Google's
// traffic leaves too little room for rules its technician out of the draft and the day is re-planned once more; what
// still falls short is left as it stands and ops are told. NOW is Monday 21 September 2026, 12 noon in India. Every
// name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { eveningCheck, type EveningCheck } from "../../../src/domain/booking/evening-check.ts";
import { readOpsInputs } from "../../../src/domain/platform/ops-settings.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";
import type { Point, RoutesProvider } from "../../../src/providers/routes/index.ts";
import { LOCAL_SETTINGS, markDatabase, NOW } from "../helpers.ts";
import { client, IMRAN, SANA, SANDEEP, technician, visit } from "./client-booking-fixtures.ts";

const TUESDAY = "2026-09-22";
/** Imran's home, 2 km north of the client; Sandeep's, 12 km. */
const IMRANS_HOME = 28.4775;
const SANDEEPS_HOME = 28.5674;

/** Google answering each drive in `minutes(from)`, by the pin it sets off from; and what ops were told. */
function google(minutes: (from: Point) => number): { check: EveningCheck; told: string[] } {
  const told: string[] = [];
  const routes: RoutesProvider = {
    route: (stops) =>
      Promise.resolve({
        ok: true,
        // Each leg sets off from the stop before it, which every leg has.
        legs: stops.slice(0, -1).map((from) => ({ seconds: minutes(from) * 60, meters: 1000 })),
        polyline: null,
      }),
    map: () => Promise.resolve({ ok: false, detail: "no map here" }),
    areaMap: () => Promise.resolve({ ok: false, detail: "not drawn here" }),
  };
  const check: EveningCheck = {
    routes,
    alert: () => Promise.resolve(),
    alertOnce: (raised) => {
      told.push(raised.key);
      return Promise.resolve();
    },
    settings: LOCAL_SETTINGS,
  };
  return { check, told };
}

let visitId: string;

/** The client at their own pin, a draft booked with Sandeep at 11 on Tuesday. */
async function booked(clientLat: number) {
  const rohit = (await client()).id;
  await env.DB.prepare("UPDATE addresses SET lat = ?2, lng = 77.0266 WHERE person_id = ?1")
    .bind(rohit, clientLat)
    .run();
  visitId = await visit(rohit, "service", "scheduled", indiaInstant(TUESDAY, "11:00").toISOString(), SANDEEP);
  await env.DB.prepare(
    "UPDATE appointments SET technician_draft = 1, service_city = 'Gurgaon', service_pincode = '122018' WHERE id = ?1",
  )
    .bind(visitId)
    .run();
}

beforeEach(async () => {
  await markDatabase();
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANDEEP, "Sandeep Rawat", "SR");
  await technician(SANA, "Sana Mirza", "SM");
  await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SANA).run();
  for (const [id, lat] of [
    [IMRAN, IMRANS_HOME],
    [SANDEEP, SANDEEPS_HOME],
  ] as const) {
    await env.DB.prepare("UPDATE technicians SET home_lat = ?2, home_lng = 77.0266, home_label = 'Home' WHERE id = ?1")
      .bind(id, lat)
      .run();
  }
});

const visitRow = () =>
  env.DB.prepare("SELECT technician_id, technician_draft FROM appointments WHERE id = ?1").bind(visitId).first();

const run = async (check: EveningCheck) =>
  eveningCheck(env.DB, check, { city: "Gurgaon", date: TUESDAY, now: NOW, inputs: await readOpsInputs(env.DB, NOW) });

describe("tomorrow checked on Google", () => {
  it("gives a draft to another technician where Google leaves its first no room, and tells nobody", async () => {
    await booked(28.4595);
    // From Imran's home the road is jammed: three hours; from anywhere else, ten minutes.
    const { check, told } = google((from) => (from.lat === IMRANS_HOME ? 180 : 10));
    await run(check);
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 1 });
    expect(told).toEqual([]);
  });

  it("leaves a draft as it stands where nobody's drive has room, and tells ops the drive", async () => {
    await booked(28.4596);
    const { check, told } = google(() => 180);
    await run(check);
    expect(await visitRow()).toMatchObject({ technician_draft: 1 });
    expect(told).toHaveLength(1);
    expect(told[0]).toMatch(/^leg_short:t[12]:2026-09-22:11:00$/);
  });

  it("asks Google nothing where the routes provider is off, and re-plans on the estimate alone", async () => {
    await booked(28.4597);
    const { check, told } = google(() => 180);
    await eveningCheck(
      env.DB,
      { ...check, routes: null },
      { city: "Gurgaon", date: TUESDAY, now: NOW, inputs: await readOpsInputs(env.DB, NOW) },
    );
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
    expect(told).toEqual([]);
  });
});
