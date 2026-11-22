// The night's learning of drive times (src/domain/booking/learn-drives.ts): a technician's drives between their jobs
// in the weeks before today, each city's slots learned from them afresh, and the pace the day plans and the
// technician's list take once a slot has the drives ops ask for. The two clients live 10 km apart in Gurgaon; the
// morning's job closes at 10, India's clock, and the drive to the next is timed from there to its check-in.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { learnDrives } from "../../../src/domain/booking/learn-drives.ts";
import { loadDayPlans } from "../../../src/domain/booking/day-plans.ts";
import { jobsOn } from "../../../src/domain/field/tech-jobs.ts";
import { atPace, DRIVE_ESTIMATE, driveMinutes } from "../../../src/policy/drive-estimate.ts";
import { DRIVE_LEARNING, DRIVE_TIMES } from "../../../src/policy/learned-drives.ts";
import { BOOKING_RULES, WORKING_HOURS } from "../../../src/policy/start-times.ts";
import { aCheckin, anAddress, anOutcome, aPerson, aTechnician, aVisit } from "../fixtures/index.ts";
import { captureLogs, markDatabase, NOW, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const TECH = "tech-learning";
const HERE = { lat: 28.45, lng: 77.05 };
const THERE = { lat: 28.45 + 10 / 111.195, lng: 77.05 };
/** What the estimate gives for the drive between them, setting off at 10. */
const ESTIMATED = driveMinutes(HERE, THERE, 10, DRIVE_ESTIMATE);
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();
const plus = (instant: string, minutes: number) => new Date(Date.parse(instant) + minutes * 60_000).toISOString();

let clients: { here: string; there: string };
/** Where each client lives, which a check-in at their door is made at. */
let doors: { here: string; there: string };

/** On `date`, a job at 9 closed at 10, and the next checked in `took` minutes later, before the break's window. */
async function aDayOfTwo(date: string, took: number): Promise<void> {
  const first = await aVisit({
    person_id: clients.here,
    technician_id: TECH,
    status: "completed",
    window_start: at(date, "09:00"),
  });
  const next = await aVisit({
    person_id: clients.there,
    technician_id: TECH,
    status: "completed",
    window_start: at(date, "11:30"),
  });
  const [one, two] = [
    { id: first.id ?? "", technicianId: TECH },
    { id: next.id ?? "", technicianId: TECH },
  ];
  await aCheckin(one, { at: at(date, "09:00"), address_id: doors.here });
  await anOutcome(one, at(date, "10:00"));
  await aCheckin(two, { at: plus(at(date, "10:00"), took), address_id: doors.there });
  await anOutcome(two, at(date, "14:00"));
}

const factors = async () =>
  (
    await env.DB.prepare(
      "SELECT city, day_kind, hour, factor_pct, drives FROM drive_factors ORDER BY city, day_kind, hour",
    ).all()
  ).results;

const learnNow = () => learnDrives(env.DB, { now: NOW, weeks: 8, estimate: DRIVE_ESTIMATE, booking: BOOKING_RULES });

/** A slot of Gurgaon's, learned already. */
const aLearnedSlot = (dayKind: string, hour: number, factorPct: number, drives: number) =>
  env.DB.prepare(
    "INSERT INTO drive_factors (city, day_kind, hour, factor_pct, drives, learned_at) VALUES ('Gurgaon', ?1, ?2, ?3, ?4, ?5)",
  )
    .bind(dayKind, hour, factorPct, drives, NOW.toISOString())
    .run();

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await aTechnician({ id: TECH });
  const [here, there] = [(await aPerson()).id ?? "", (await aPerson()).id ?? ""];
  const [hereDoor, thereDoor] = [await anAddress(here, HERE), await anAddress(there, THERE)];
  clients = { here, there };
  doors = { here: hereDoor.id ?? "", there: thereDoor.id ?? "" };
});

describe("the night's learning", () => {
  it("keeps each slot's middle drive against its estimate, leaving out a drive far over it", async () => {
    // Tuesday to Thursday, a fifth, a half and four-fifths over the estimate; Friday four times it; Saturday on it.
    const tooks = [1.2, 1.5, 1.8].map((times) => Math.round(ESTIMATED * times));
    for (const [index, took] of tooks.entries()) await aDayOfTwo(`2026-09-${String(15 + index)}`, took);
    await aDayOfTwo("2026-09-18", ESTIMATED * 4);
    await aDayOfTwo("2026-09-19", ESTIMATED);

    expect(await learnNow()).toEqual({ cities: 1, drives: 4 });
    expect(await factors()).toEqual([
      {
        city: "Gurgaon",
        day_kind: "weekday",
        hour: 10,
        factor_pct: Math.round(((tooks[1] ?? 0) / ESTIMATED) * 100),
        drives: 3,
      },
      { city: "Gurgaon", day_kind: "weekend", hour: 10, factor_pct: 100, drives: 1 },
    ]);
  });

  it("learns afresh each night, from the weeks ops set before today, and keeps nothing of a city with no drives", async () => {
    await env.DB.prepare(
      "INSERT INTO drive_factors (city, day_kind, hour, factor_pct, drives, learned_at) VALUES ('Pune', 'weekday', 9, 130, 40, ?1)",
    )
      .bind(NOW.toISOString())
      .run();
    // Nine weeks back, and today: neither learned from.
    await aDayOfTwo("2026-07-20", ESTIMATED);
    await aDayOfTwo("2026-09-21", ESTIMATED);

    expect(await learnNow()).toEqual({ cities: 0, drives: 0 });
    expect(await factors()).toEqual([]);
  });
});

describe("a learned slot", () => {
  const plansWith = (learning: Partial<typeof DRIVE_LEARNING>, times = DRIVE_TIMES) =>
    loadDayPlans({
      db: env.DB,
      technicianIds: [TECH],
      from: "2026-09-22",
      to: "2026-09-26",
      now: NOW,
      inputs: { workingHours: WORKING_HOURS, driveTimes: times, driveLearning: { ...DRIVE_LEARNING, ...learning } },
    });

  it("paces the day plans once it has the drives ops ask for, on its kind of day only", async () => {
    await aLearnedSlot("weekday", 10, 150, 20);
    const plans = await plansWith({ min_drives: 20 });
    expect(plans.day(TECH, "2026-09-22")?.pace?.[10]).toBe(150);
    expect(plans.day(TECH, "2026-09-22")?.pace?.[11]).toBe(100);
    expect(plans.day(TECH, "2026-09-26")?.pace).toBeNull();
  });

  it("stands aside until then, and wherever ops use the estimate", async () => {
    await aLearnedSlot("weekday", 10, 150, 20);
    expect((await plansWith({ min_drives: 21 })).day(TECH, "2026-09-22")?.pace).toBeNull();
    expect((await plansWith({ min_drives: 20 }, { use: "estimate" })).day(TECH, "2026-09-22")?.pace).toBeNull();
  });

  it("gives the technician the drive to their next job at its pace", async () => {
    // Tuesday's 10:30 and 2 pm; the first is done with its wrap-up at ten past twelve.
    await aVisit({ person_id: clients.here, technician_id: TECH });
    await aVisit({ person_id: clients.there, technician_id: TECH, window_start: at("2026-09-22", "14:00") });
    const nextDrive = async (use: "learned" | "estimate") => {
      const rules = { booking: BOOKING_RULES, drive: DRIVE_ESTIMATE, times: { use }, learning: DRIVE_LEARNING };
      const [first] = await jobsOn({
        db: env.DB,
        technicianId: TECH,
        date: "2026-09-22",
        now: NOW,
        unlockHour: 18,
        rules,
      });
      return first?.next?.drive_minutes;
    };
    await aLearnedSlot("weekday", 12, 200, 20);
    expect(await nextDrive("learned")).toBe(2 * ((await nextDrive("estimate")) ?? 0));
  });
});

describe("the Driving report", () => {
  const OPS = "ops@maneman.in";
  const report = (query: string, email = OPS) => request(opsAs(person(email)), `/api/reports/driving?${query}`);

  beforeEach(async () => {
    // Tuesday and Wednesday a fifth and a half over the estimate; Thursday four times it, which is not counted.
    await aDayOfTwo("2026-09-15", Math.round(ESTIMATED * 1.2));
    await aDayOfTwo("2026-09-16", Math.round(ESTIMATED * 1.5));
    await aDayOfTwo("2026-09-17", ESTIMATED * 4);
    await aLearnedSlot("weekday", 10, 150, 20);
    await aLearnedSlot("weekend", 10, 90, 3);
    await listStaff(OPS, ["operations:view:national"]);
  });

  it("sets each technician's and city's drives planned at today's pace against what they took, by week", async () => {
    const answer = await report("weeks=4&by=week");
    expect(answer.status).toBe(200);
    const body = await answer.json();
    const planned = 2 * atPace(ESTIMATED, 150, DRIVE_ESTIMATE);
    const taken = Math.round(ESTIMATED * 1.2) + Math.round(ESTIMATED * 1.5);
    const week = { period: "2026-09-14", drives: 2, planned_minutes: planned, actual_minutes: taken };
    expect(body).toEqual({
      from: "2026-08-24",
      to: "2026-09-20",
      by_technician: [{ ...week, technician_id: TECH, name: "Imran Qureshi", city: "Gurgaon" }],
      by_city: [{ ...week, city: "Gurgaon" }],
      factors: [
        { city: "Gurgaon", day_kind: "weekday", hour: 10, factor_pct: 150, drives: 20, in_use: true },
        { city: "Gurgaon", day_kind: "weekend", hour: 10, factor_pct: 90, drives: 3, in_use: false },
      ],
      learning: { use: "learned", min_drives: 20 },
    });
  });

  it("counts them by day, the latest first", async () => {
    const body = await (await report("weeks=1&by=day")).json<{ by_city: { period: string; drives: number }[] }>();
    expect(body.by_city.map((row) => [row.period, row.drives])).toEqual([
      ["2026-09-16", 1],
      ["2026-09-15", 1],
    ]);
  });

  it("is for those who see Operations everywhere, once the Staff list is enforced", async () => {
    await enforce();
    await listStaff("gurgaon@maneman.in", ["operations:view:city:Gurgaon"]);
    expect((await report("weeks=4")).status).toBe(200);
    expect((await report("weeks=4", "gurgaon@maneman.in")).status).toBe(403);
  });
});
