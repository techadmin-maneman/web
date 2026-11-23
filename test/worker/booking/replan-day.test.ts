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
import { fakeDependencies, fakeQueue, LOCAL_CONFIG, markDatabase, NOW } from "../helpers.ts";
import { ALERT_WORDS } from "../../../src/config/alert-words.ts";
import { createLogger } from "../../../src/log.ts";
import { failedIn } from "../../../src/scheduled/allotment-jobs.ts";
import { CRON_JOBS } from "../../../src/scheduled/cron.ts";
import { runCronJobs } from "../../../src/scheduled/cron-runner.ts";
import { client, IMRAN, SANA, SANDEEP, technician, visit } from "./client-booking-fixtures.ts";
import { aHold } from "../fixtures/index.ts";
import { racedBy } from "./raced-db.ts";

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

/** Leave on Tuesday, all day or `from` to `to`. */
async function leave(technicianId: string, from: string | null = null, to: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO technician_leave (id, technician_id, from_date, to_date, from_time, to_time, actor, created_at)
     VALUES (?1, ?2, ?3, ?3, ?4, ?5, 'ops@maneman.test', ?6)`,
  )
    .bind(crypto.randomUUID(), technicianId, TUESDAY, from, to, NOW.toISOString())
    .run();
}

/** The draft given to Imran, who lives 2 km from the client, so only his day stops it staying with him. */
const withImran = () =>
  env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(visitId, IMRAN).run();

describe("a day's drafts re-planned", () => {
  it("gives a draft to whoever it costs least, keeps it a draft, records the move, and keeps the day locked", async () => {
    const { moved } = await replanDay(env.DB, {
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

  it("moves a draft off a technician since away all day, or on leave over it, to whoever else can take it", async () => {
    await withImran();
    await leave(IMRAN);
    const inputs = await readOpsInputs(env.DB, NOW);
    expect(await replanDay(env.DB, { city: "Gurgaon", date: TUESDAY, now: NOW, inputs })).toEqual({
      moved: 1,
      stranded: [],
      unmoved: [],
    });
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 1 });

    await env.DB.prepare("DELETE FROM technician_leave").run();
    await withImran();
    await leave(IMRAN, "10:30", "12:30");
    expect((await replanDay(env.DB, { city: "Gurgaon", date: TUESDAY, now: NOW, inputs })).moved).toBe(1);
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 1 });
  });

  it("tells of a draft that was to leave a day that no longer fits where a hold stopped its move being written", async () => {
    await withImran();
    await leave(IMRAN);
    const rival = await aHold({ person_id: (await client()).id, technician_id: SANDEEP });
    const holdLocks = () =>
      env.DB.prepare("INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES (?1, ?2, 'rev:1', ?3)")
        .bind(SANDEEP, TUESDAY, rival.id)
        .run();
    const inputs = await readOpsInputs(env.DB, NOW);
    expect(await replanDay(racedBy(holdLocks), { city: "Gurgaon", date: TUESDAY, now: NOW, inputs })).toEqual({
      moved: 0,
      stranded: [],
      unmoved: [{ visitId, technicianId: IMRAN, start: 11 * 60 }],
    });
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
  });

  it("names no draft ops fixed, or gave to another, while its move off a day that no longer fits was written", async () => {
    await withImran();
    await leave(IMRAN);
    const inputs = await readOpsInputs(env.DB, NOW);
    const opsFix = () =>
      env.DB.prepare("UPDATE appointments SET technician_draft = 0, technician_id = ?2 WHERE id = ?1")
        .bind(visitId, SANDEEP)
        .run();
    expect(await replanDay(racedBy(opsFix), { city: "Gurgaon", date: TUESDAY, now: NOW, inputs })).toEqual({
      moved: 0,
      stranded: [],
      unmoved: [],
    });
  });

  it("leaves a draft nobody else can take with its technician, and tells Operations of it once", async () => {
    await withImran();
    await leave(IMRAN);
    await leave(SANDEEP);
    const { moved, stranded } = await replanDay(env.DB, {
      city: "Gurgaon",
      date: TUESDAY,
      now: NOW,
      inputs: await readOpsInputs(env.DB, NOW),
    });
    expect({ moved, stranded }).toEqual({
      moved: 0,
      stranded: [{ visitId, technicianId: IMRAN, start: 11 * 60 }],
    });
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
    // The hourly re-plan at 12:20 am takes Tuesday, and tells it once however often it runs.
    const hourly = () =>
      runCronJobs(
        CRON_JOBS.filter((each) => each.name === "replan_drafts"),
        {
          env: { ...env, MESSAGE_QUEUE: fakeQueue() },
          deps: fakeDependencies({ now: () => indiaInstant("2026-09-21", "00:20") }),
          config: LOCAL_CONFIG,
          log: createLogger(),
        },
      );
    await hourly();
    await hourly();
    const { results } = await env.DB.prepare("SELECT key, message FROM alerts WHERE key LIKE 'draft_stranded:%'").all();
    expect(results).toEqual([
      {
        key: `draft_stranded:${visitId}:${TUESDAY}`,
        message: ALERT_WORDS.draft_stranded({
          technician: "Imran Qureshi",
          day: TUESDAY,
          start: "11:00",
          visit: visitId,
        }),
      },
    ]);
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
    expect((await replan(holdLocks)).moved).toBe(0);
    await env.DB.prepare("DELETE FROM slot_claims").run();
    const opsFix = () =>
      env.DB.prepare("UPDATE appointments SET technician_draft = 0 WHERE id = ?1").bind(visitId).run();
    expect((await replan(opsFix)).moved).toBe(0);
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
    const { moved } = await replanDay(env.DB, {
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
    const { moved } = await replanDay(env.DB, {
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
    const { moved } = await replanDay(env.DB, {
      city: "Gurgaon",
      date: TUESDAY,
      now: NOW,
      inputs: await readOpsInputs(env.DB, NOW),
    });
    expect(moved).toBe(0);
    expect(await visitRow()).toEqual({ technician_id: SANDEEP, technician_draft: 0 });
  });

  it("re-plans tomorrow in the half hour before the lock, a city a run, once each, and the lock fixes it", async () => {
    for (const city of ["Delhi", "Noida"]) {
      const id = await visit(null, "service", "scheduled", indiaInstant(TUESDAY, "15:00").toISOString(), IMRAN);
      await env.DB.prepare("UPDATE appointments SET technician_draft = 1, service_city = ?2 WHERE id = ?1")
        .bind(id, city)
        .run();
    }
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
    expect(await checkBeforeLock(env.DB, indiaInstant("2026-09-21", "17:25"), before)).toEqual([]);
    expect(await checkBeforeLock(env.DB, half, before)).toEqual(["Delhi"]);
    expect(await checkBeforeLock(env.DB, indiaInstant("2026-09-21", "17:36"), before)).toEqual(["Gurgaon"]);
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 1 });
    // The next run takes the city left, and once a day: the one after takes none.
    expect(await checkBeforeLock(env.DB, indiaInstant("2026-09-21", "17:41"), before)).toEqual(["Noida"]);
    expect(await checkBeforeLock(env.DB, indiaInstant("2026-09-21", "17:46"), before)).toEqual([]);
    await lockDueDrafts(env.DB, indiaInstant("2026-09-21", "18:01"), { readHours });
    expect(await visitRow()).toEqual({ technician_id: IMRAN, technician_draft: 0 });
  });

  it("checks two cities a run where more than the half hour's six share a lock hour, so every one is checked", async () => {
    for (const city of ["Agra", "Bhiwadi", "Delhi", "Faridabad", "Jaipur", "Noida"]) {
      const id = await visit(null, "service", "scheduled", indiaInstant(TUESDAY, "15:00").toISOString(), IMRAN);
      await env.DB.prepare("UPDATE appointments SET technician_draft = 1, service_city = ?2 WHERE id = ?1")
        .bind(id, city)
        .run();
    }
    const taken = new Set<string>();
    const before = {
      readHours: () => Promise.resolve({ national: 18, cities: new Map<string, number>() }),
      firstToday: (city: string) => {
        const first = !taken.has(city);
        taken.add(city);
        return Promise.resolve(first);
      },
      check: () => Promise.resolve(),
      failed: () => undefined,
    };
    const runs = [];
    for (const time of ["17:31", "17:36", "17:41", "17:46", "17:51"]) {
      runs.push(await checkBeforeLock(env.DB, indiaInstant("2026-09-21", time), before));
    }
    expect(runs).toEqual([["Agra", "Bhiwadi"], ["Delhi", "Faridabad"], ["Gurgaon", "Jaipur"], ["Noida"], []]);
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
    const { moved } = await replanDay(env.DB, {
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
    const { moved } = await replanDay(env.DB, {
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
          : replanDay(env.DB, { city, date, now: midnight, inputs }).then((done) => done.moved),
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
