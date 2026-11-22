// Tomorrow checked on Google before it is fixed (src/domain/booking/evening-check.ts, ADR 0290): a drive Google's
// traffic leaves too little room for rules its technician out of the draft and the day is re-planned once more; what
// still falls short is left as it stands and ops are told. NOW is Monday 21 September 2026, 12 noon in India. Every
// name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { EVENING_DRIVES, eveningCheck, type EveningCheck } from "../../../src/domain/booking/evening-check.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { readOpsInputs } from "../../../src/domain/platform/ops-settings.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";
import type { Point, RoutesProvider } from "../../../src/providers/routes/index.ts";
import { fakeDependencies, fakeQueue, LOCAL_CONFIG, LOCAL_SETTINGS, markDatabase, NOW } from "../helpers.ts";
import { createLogger } from "../../../src/log.ts";
import { CRON_JOBS } from "../../../src/scheduled/cron.ts";
import { runCronJobs } from "../../../src/scheduled/cron-runner.ts";
import { client, IMRAN, SANA, SANDEEP, technician, visit } from "./client-booking-fixtures.ts";

const TUESDAY = "2026-09-22";
/** Imran's home, 2 km north of the client; Sandeep's, 12 km. */
const IMRANS_HOME = 28.4775;
const SANDEEPS_HOME = 28.5674;

/** Google answering each drive in `minutes(from)`, by the pin it sets off from; when each was asked to set off; and
 * what ops were told. */
function google(minutes: (from: Point) => number): { check: EveningCheck; told: string[]; departures: string[] } {
  const told: string[] = [];
  const departures: string[] = [];
  const routes: RoutesProvider = {
    route: (stops, departing) => {
      departures.push(departing?.departAt.toISOString() ?? "on the road alone");
      return Promise.resolve({
        ok: true,
        // Each leg sets off from the stop before it, which every leg has.
        legs: stops.slice(0, -1).map((from) => ({ seconds: minutes(from) * 60, meters: 1000 })),
        polyline: null,
      });
    },
    map: () => Promise.resolve({ ok: false, detail: "no map here" }),
    areaMap: () => Promise.resolve({ ok: false, detail: "not drawn here" }),
  };
  const check: EveningCheck = {
    routes,
    drives: createCallBudget(EVENING_DRIVES),
    alert: () => Promise.resolve(),
    alertOnce: (raised) => {
      told.push(raised.key);
      return Promise.resolve();
    },
    settings: LOCAL_SETTINGS,
  };
  return { check, told, departures };
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
    const { check, told, departures } = google((from) => (from.lat === IMRANS_HOME ? 180 : 10));
    await run(check);
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 1 });
    expect(told).toEqual([]);
    // Each drive from home on the traffic of Tuesday morning, setting off before the 11 o'clock visit.
    expect(departures.length).toBeGreaterThan(0);
    for (const departure of departures) {
      expect(departure >= indiaInstant(TUESDAY, "09:00").toISOString()).toBe(true);
      expect(departure < indiaInstant(TUESDAY, "11:00").toISOString()).toBe(true);
    }
  });

  it("leaves a draft as it stands where nobody's drive has room, and tells ops the drive", async () => {
    await booked(28.4596);
    const { check, told } = google(() => 180);
    await run(check);
    expect(await visitRow()).toMatchObject({ technician_draft: 1 });
    expect(told).toHaveLength(1);
    expect(told[0]).toMatch(/^leg_short:t[12]:2026-09-22:11:00$/);
  });

  it("asks Google no more drives than the run has left, and leaves the rest on the estimate", async () => {
    await booked(28.4598);
    const { check, told, departures } = google(() => 180);
    await run({ ...check, drives: createCallBudget(0) });
    expect(departures).toEqual([]);
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
    expect(told).toEqual([]);
  });

  it("runs in the cron: checked on Google half an hour before, then fixed with messaging off, every board told", async () => {
    await booked(28.4599);
    const { check, departures } = google(() => 10);
    const version = async () =>
      (await env.DB.prepare("SELECT version FROM board_version").first<{ version: number }>())?.version ?? 0;
    const before = await version();
    const messagingOff = {
      ...LOCAL_CONFIG,
      settings: { ...LOCAL_CONFIG.settings, messaging: { ...LOCAL_CONFIG.settings.messaging, enabled: false } },
    };
    const run = (job: string, time: string) =>
      runCronJobs(
        CRON_JOBS.filter((each) => each.name === job),
        {
          env: { ...env, MESSAGE_QUEUE: fakeQueue() },
          deps: fakeDependencies({ now: () => indiaInstant("2026-09-21", time), routes: check.routes }),
          config: messagingOff,
          log: createLogger(),
        },
      );
    await run("evening_check", "17:31");
    expect(departures.length).toBeGreaterThan(0);
    expect(await visitRow()).toMatchObject({ technician_draft: 1 });
    await run("visit_reminders", "18:01");
    expect(await visitRow()).toMatchObject({ technician_draft: 0 });
    expect(await version()).toBeGreaterThan(before);
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
