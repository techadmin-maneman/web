// A city's drafts on a day, re-planned and written (src/domain/booking/replan-day.ts, ADR 0290). NOW is Monday 21
// September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkBeforeLock,
  lockDueDrafts,
  replanAhead,
  replanDateAt,
} from "../../../src/domain/booking/allotment-lock.ts";
import { replanDay } from "../../../src/domain/booking/replan-day.ts";
import { loadDayPlans } from "../../../src/domain/booking/day-plans.ts";
import { readOpsInputs } from "../../../src/domain/platform/ops-settings.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";
import { fakeDependencies, markDatabase, NOW } from "../helpers.ts";
import { ALERT_WORDS } from "../../../src/config/alert-words.ts";
import { createLogger } from "../../../src/log.ts";
import { failedIn } from "../../../src/scheduled/allotment-jobs.ts";
import { client, IMRAN, SANA, SANDEEP, technician, visit } from "./client-booking-fixtures.ts";
import { aHold } from "../fixtures/index.ts";

/** A home, as ops set one: 28.4775 is 2 km north of the client, 28.5674 12 km. */
async function home(id: string, lat: number) {
  await env.DB.prepare("UPDATE technicians SET home_lat = ?2, home_lng = 77.0266, home_label = 'Home' WHERE id = ?1")
    .bind(id, lat)
    .run();
}

const TUESDAY = "2026-09-22";
let visitId: string;

beforeEach(async () => {
  await markDatabase();
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANDEEP, "Sandeep Rawat", "SR");
  // Sana, switched off since, did the client's last visit, so the rotation bars neither of the others.
  await technician(SANA, "Sana Mirza", "SM");
  await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SANA).run();
  await home(IMRAN, 28.4775);
  await home(SANDEEP, 28.5674);
  const rohit = (await client()).id;
  await env.DB.prepare("UPDATE addresses SET lat = 28.4595, lng = 77.0266 WHERE person_id = ?1").bind(rohit).run();
  // Booked with Sandeep, 12 km away and in his ring, though Imran lives 2 km from the client.
  visitId = await visit(rohit, "service", "scheduled", indiaInstant(TUESDAY, "11:00").toISOString(), SANDEEP);
  await env.DB.prepare(
    "UPDATE appointments SET technician_draft = 1, service_city = 'Gurgaon', service_pincode = '122018' WHERE id = ?1",
  )
    .bind(visitId)
    .run();
});

const visitRow = () =>
  env.DB.prepare("SELECT technician_id, technician_draft FROM appointments WHERE id = ?1").bind(visitId).first();

/**
 * The database, with `raced` done just before the re-plan writes its moves, after it read the day: as a hold, or ops,
 * can change the day between the two.
 */
function racedBy(raced: () => Promise<unknown>): D1Database {
  let writing = false;
  let done = false;
  return new Proxy(env.DB, {
    get(target, key) {
      if (key === "prepare") {
        return (sql: string) => {
          if (sql.includes("INSERT INTO dispatch_moves")) writing = true;
          return target.prepare(sql);
        };
      }
      if (key === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (writing && !done) {
            done = true;
            await raced();
          }
          return target.batch(statements);
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

describe("a day's drafts re-planned", () => {
  it("gives a draft to whoever it costs least, keeps it a draft, records the move, and keeps the day locked", async () => {
    const moved = await replanDay(env.DB, {
      city: "Gurgaon",
      date: TUESDAY,
      now: NOW,
      inputs: await readOpsInputs(env.DB, NOW),
    });
    expect(moved).toBe(1);
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
    expect(
      await env.DB.prepare("SELECT was_technician_id, now_technician_id, reason, actor FROM dispatch_moves").all(),
    ).toMatchObject({
      results: [{ was_technician_id: SANDEEP, now_technician_id: IMRAN, reason: "zone_rebalance", actor: "allotment" }],
    });
    // The lock on Imran's day is kept, so a hold planned on it before the move fails rather than miss the draft.
    expect((await env.DB.prepare("SELECT technician_id, date, claim FROM slot_claims").all()).results).toEqual([
      { technician_id: IMRAN, date: TUESDAY, claim: "rev:1" },
    ]);
    const plans = await loadDayPlans({
      db: env.DB,
      technicianIds: [IMRAN],
      from: TUESDAY,
      to: TUESDAY,
      now: NOW,
      inputs: await readOpsInputs(env.DB, NOW),
    });
    expect(plans.revision(IMRAN, TUESDAY)).toBe(1);
  });

  it("writes nothing where a hold locked the day it would go to, or the draft was fixed, after it was read", async () => {
    const inputs = await readOpsInputs(env.DB, NOW);
    const replan = (raced: () => Promise<unknown>) =>
      replanDay(racedBy(raced), { city: "Gurgaon", date: TUESDAY, now: NOW, inputs });
    const rival = await aHold({ person_id: (await client()).id, technician_id: IMRAN });
    const holdLocks = () =>
      env.DB.prepare("INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES (?1, ?2, 'rev:1', ?3)")
        .bind(IMRAN, TUESDAY, rival.id)
        .run();
    expect(await replan(holdLocks)).toBe(0);
    await env.DB.prepare("DELETE FROM slot_claims").run();
    const opsFix = () =>
      env.DB.prepare("UPDATE appointments SET technician_draft = 0 WHERE id = ?1").bind(visitId).run();
    expect(await replan(opsFix)).toBe(0);
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dispatch_moves").first("n")).toBe(0);
  });

  // A client's paid move waits to be booked onto the visit as it was; the rest of the day re-plans around it.
  it("leaves a draft whose client's move waits on payment, and moves the day's others", async () => {
    const other = (await client()).id;
    await env.DB.prepare("UPDATE addresses SET lat = 28.4596, lng = 77.0266 WHERE person_id = ?1").bind(other).run();
    const waiting = await visit(other, "service", "scheduled", indiaInstant(TUESDAY, "15:00").toISOString(), SANDEEP);
    await env.DB.prepare(
      "UPDATE appointments SET technician_draft = 1, service_city = 'Gurgaon', service_pincode = '122018' WHERE id = ?1",
    )
      .bind(waiting)
      .run();
    await aHold({
      person_id: other,
      technician_id: SANDEEP,
      moves_appointment_id: waiting,
      confirmed_at: NOW.toISOString(),
    });
    const moved = await replanDay(env.DB, {
      city: "Gurgaon",
      date: TUESDAY,
      now: NOW,
      inputs: await readOpsInputs(env.DB, NOW),
    });
    expect(moved).toBe(1);
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
    const kept = await env.DB.prepare("SELECT technician_id FROM appointments WHERE id = ?1").bind(waiting).first();
    expect(kept).toEqual({ technician_id: SANDEEP });
  });

  it("never gives a draft to whoever did the client's visit before it", async () => {
    await env.DB.prepare("UPDATE appointments SET technician_id = ?1 WHERE status = 'completed'").bind(IMRAN).run();
    const moved = await replanDay(env.DB, {
      city: "Gurgaon",
      date: TUESDAY,
      now: NOW,
      inputs: await readOpsInputs(env.DB, NOW),
    });
    expect(moved).toBe(0);
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 1 });
  });

  it("never moves a visit already fixed", async () => {
    await env.DB.prepare("UPDATE appointments SET technician_draft = 0 WHERE id = ?1").bind(visitId).run();
    const moved = await replanDay(env.DB, {
      city: "Gurgaon",
      date: TUESDAY,
      now: NOW,
      inputs: await readOpsInputs(env.DB, NOW),
    });
    expect(moved).toBe(0);
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 0 });
  });

  it("re-plans tomorrow in the half hour before the lock, once a city, and the lock fixes it", async () => {
    const half = indiaInstant("2026-09-21", "17:31");
    const inputs = await readOpsInputs(env.DB, half);
    const readHours = () => Promise.resolve({ national: 18, cities: new Map<string, number>() });
    const taken = new Set<string>();
    const before = {
      readHours,
      firstToday: (city: string) => {
        const first = !taken.has(city);
        taken.add(city);
        return Promise.resolve(first);
      },
      check: (city: string, date: string) => replanDay(env.DB, { city, date, now: half, inputs }),
      failed: () => undefined,
    };
    // Earlier in the hour no lock is near, and nothing is read.
    expect(await checkBeforeLock(env.DB, indiaInstant("2026-09-21", "17:25"), before)).toBeNull();
    expect(await checkBeforeLock(env.DB, half, before)).toBe("Gurgaon");
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
    // Once a day: the next run takes no city.
    expect(await checkBeforeLock(env.DB, indiaInstant("2026-09-21", "17:36"), before)).toBeNull();
    await lockDueDrafts(env.DB, indiaInstant("2026-09-21", "18:01"), { readHours });
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 0 });
  });

  it("fixes tomorrow as it stands where its check fails, and says which city failed", async () => {
    const failed: string[] = [];
    const readHours = () => Promise.resolve({ national: 18, cities: new Map<string, number>() });
    await checkBeforeLock(env.DB, indiaInstant("2026-09-21", "17:31"), {
      readHours,
      firstToday: () => Promise.resolve(true),
      check: () => Promise.reject(new Error("D1 overloaded")),
      failed: (city) => {
        failed.push(city);
      },
    });
    expect(failed).toEqual(["Gurgaon"]);
    await lockDueDrafts(env.DB, indiaInstant("2026-09-21", "18:01"), { readHours });
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 0 });
  });

  it("writes nothing, the board's version included, before any of tomorrow's drafts is due", async () => {
    const version = () => env.DB.prepare("SELECT version FROM board_version").first<{ version: number }>();
    const before = await version();
    await lockDueDrafts(env.DB, indiaInstant("2026-09-21", "17:45"), {
      readHours: () => Promise.resolve({ national: 18, cities: new Map<string, number>() }),
    });
    expect(await version()).toEqual(before);
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 1 });
  });

  it("leaves a draft with a move proposal still open as it stands, for the client to answer", async () => {
    await env.DB.prepare(
      `INSERT INTO move_proposals (id, appointment_id, technician_id, date, window_label, reason, proposed_by,
         expected_technician_id, expected_start, created_at, expires_at)
       SELECT 'mp1', id, technician_id, '2026-09-23', 'morning', 'zone_rebalance', 'ops@maneman.test', technician_id,
         window_start, ?1, '2026-09-22T12:30:00.000Z' FROM appointments WHERE id = ?2`,
    )
      .bind(NOW.toISOString(), visitId)
      .run();
    const moved = await replanDay(env.DB, {
      city: "Gurgaon",
      date: TUESDAY,
      now: NOW,
      inputs: await readOpsInputs(env.DB, NOW),
    });
    expect(moved).toBe(0);
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 1 });
  });

  it("re-plans a draft whose move proposal has run out unanswered", async () => {
    await env.DB.prepare(
      `INSERT INTO move_proposals (id, appointment_id, technician_id, date, window_label, reason, proposed_by,
         expected_technician_id, expected_start, created_at, expires_at)
       SELECT 'mp1', id, technician_id, '2026-09-23', 'morning', 'zone_rebalance', 'ops@maneman.test', technician_id,
         window_start, ?1, '2026-09-21T06:00:00.000Z' FROM appointments WHERE id = ?2`,
    )
      .bind(NOW.toISOString(), visitId)
      .run();
    const moved = await replanDay(env.DB, {
      city: "Gurgaon",
      date: TUESDAY,
      now: NOW,
      inputs: await readOpsInputs(env.DB, NOW),
    });
    expect(moved).toBe(1);
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
  });
});

/** The nation's reminder hour, 6 pm, and no city's own. */
const NATIONAL_SIX = () => Promise.resolve({ national: 18, cities: new Map<string, number>() });

describe("each hour's re-plan", () => {
  // Midnight takes tomorrow, 1 am the day after, and so on round the week.
  it("re-plans the hour's day ahead in each city, leaves them drafts, and goes on past a city that fails", async () => {
    const midnight = indiaInstant("2026-09-21", "00:20");
    const inputs = await readOpsInputs(env.DB, midnight);
    const noida = await visit(null, "service", "scheduled", indiaInstant(TUESDAY, "15:00").toISOString(), IMRAN);
    await env.DB.prepare("UPDATE appointments SET technician_draft = 1, service_city = 'Noida' WHERE id = ?1")
      .bind(noida)
      .run();
    const failed: string[] = [];
    const moved = await replanAhead(env.DB, midnight, {
      readHours: NATIONAL_SIX,
      replan: (city, date) =>
        city === "Noida"
          ? Promise.reject(new Error("D1 overloaded"))
          : replanDay(env.DB, { city, date, now: midnight, inputs }),
      failed: (city) => {
        failed.push(city);
      },
      left: () => undefined,
    });
    expect({ moved, failed }).toEqual({ moved: 1, failed: ["Noida"] });
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
  });

  it("tells Operations once of a city whose drafts on a day could not be re-planned", async () => {
    const midnight = indiaInstant("2026-09-21", "00:20");
    const failed = failedIn({ log: createLogger(), deps: fakeDependencies({ now: () => midnight }) });
    await failed("Noida", TUESDAY, new Error("D1 overloaded"));
    await failed("Noida", TUESDAY, new Error("D1 overloaded"));
    const { results } = await env.DB.prepare("SELECT key, message FROM alerts WHERE key LIKE 'replan_failed:%'").all();
    expect(results).toEqual([
      { key: `replan_failed:Noida:${TUESDAY}`, message: ALERT_WORDS.replan_failed({ city: "Noida", day: TUESDAY }) },
    ]);
  });

  /** The cities a turn left out, as it warns of them. */
  let left: string[] = [];

  /** The cities one hour's run re-plans, with what the hours of the locks say. */
  async function turnAt(time: string, readHours = NATIONAL_SIX): Promise<string[]> {
    const replanned: string[] = [];
    left = [];
    await replanAhead(env.DB, indiaInstant("2026-09-21", time), {
      readHours,
      replan: (city) => {
        replanned.push(city);
        return Promise.resolve(0);
      },
      failed: () => undefined,
      left: (cities) => {
        left = [...cities];
      },
    });
    return replanned;
  }

  it("takes three cities a turn, and the day's next turn the ones after them, round again", async () => {
    for (const city of ["Delhi", "Faridabad", "Noida"]) {
      const id = await visit(null, "service", "scheduled", indiaInstant(TUESDAY, "15:00").toISOString(), IMRAN);
      await env.DB.prepare("UPDATE appointments SET technician_draft = 1, service_city = ?2 WHERE id = ?1")
        .bind(id, city)
        .run();
    }
    // Tomorrow's turns are at midnight and 7 am, before any lock is near.
    expect(await turnAt("00:20")).toEqual(["Delhi", "Faridabad", "Gurgaon"]);
    expect(await turnAt("07:20")).toEqual(["Noida", "Delhi", "Faridabad"]);
    // Four cities are well within a day's three turns: nothing to warn of.
    expect(left).toEqual([]);
  });

  it("warns of the cities past what a day's three turns reach", async () => {
    const cities = ["Agra", "Bhiwadi", "Delhi", "Faridabad", "Ghaziabad", "Jaipur", "Meerut", "Noida", "Panipat"];
    for (const city of cities) {
      const id = await visit(null, "service", "scheduled", indiaInstant(TUESDAY, "15:00").toISOString(), IMRAN);
      await env.DB.prepare("UPDATE appointments SET technician_draft = 1, service_city = ?2 WHERE id = ?1")
        .bind(id, city)
        .run();
    }
    // Ten cities with Gurgaon: the tenth by name is past nine.
    await turnAt("00:20");
    expect(left).toEqual(["Panipat"]);
  });

  // Gurgaon locks at 3 pm: from 2:30 its tomorrow is the check's, which knows Google's word.
  it("leaves tomorrow alone in a city whose check before the lock has begun", async () => {
    const atThree = () => Promise.resolve({ national: 18, cities: new Map([["Gurgaon", 15]]) });
    expect(await turnAt("14:20", atThree)).toEqual(["Gurgaon"]);
    expect(await turnAt("14:50", atThree)).toEqual([]);
  });

  it("takes tomorrow at midnight, the day after at 1 am, and the seventh day at 6 am", () => {
    expect(replanDateAt(indiaInstant("2026-09-21", "00:20"))).toBe("2026-09-22");
    expect(replanDateAt(indiaInstant("2026-09-21", "01:20"))).toBe("2026-09-23");
    expect(replanDateAt(indiaInstant("2026-09-21", "06:20"))).toBe("2026-09-28");
    expect(replanDateAt(indiaInstant("2026-09-21", "07:20"))).toBe("2026-09-22");
  });
});
