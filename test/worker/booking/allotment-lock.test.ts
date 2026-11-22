// A visit's technician fixed the evening before (src/domain/booking/allotment-lock.ts, ADR 0290): booked as a draft
// unless its day's reminder hour has passed, and fixed by the lock at that hour. NOW is Monday 21 September 2026,
// 12 noon in India; the reminder hour is 6 pm unless a city sets its own.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../../src/config/message-templates.ts";
import { bookedAsDraft, daySettled, leftToTheLock, lockDrafts } from "../../../src/domain/booking/allotment-lock.ts";
import { jobsOn } from "../../../src/domain/field/tech-jobs.ts";
import { composeVisitMessage } from "../../../src/domain/messages/visit-message-text.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";
import { DRIVE_ESTIMATE } from "../../../src/policy/drive-estimate.ts";
import { DRIVE_LEARNING, DRIVE_TIMES } from "../../../src/policy/learned-drives.ts";
import { BOOKING_RULES } from "../../../src/policy/start-times.ts";
import { aConsent } from "../fixtures/index.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { client, IMRAN, technician, visit } from "./client-booking-fixtures.ts";

const HOURS = { national: 18, cities: new Map([["Noida", 11]]) };
const at = (date: string, time: string) => indiaInstant(date, time);

describe("a visit booked", () => {
  it("is a draft for tomorrow before its city's reminder hour, and further ahead, but never for today", () => {
    expect(bookedAsDraft(at("2026-09-21", "17:00"), "Gurgaon", NOW, HOURS)).toBe(false);
    expect(bookedAsDraft(at("2026-09-22", "10:00"), "Gurgaon", NOW, HOURS)).toBe(true);
    expect(bookedAsDraft(at("2026-09-23", "10:00"), "Gurgaon", NOW, HOURS)).toBe(true);
  });

  it("is fixed at once for tomorrow once its city's reminder hour has come", () => {
    expect(bookedAsDraft(at("2026-09-22", "10:00"), "Gurgaon", at("2026-09-21", "18:05"), HOURS)).toBe(false);
    // Noida's own hour, 11 am, has come by noon.
    expect(bookedAsDraft(at("2026-09-22", "10:00"), "Noida", NOW, HOURS)).toBe(false);
  });
});

describe("the evening's lock", () => {
  let today: string;
  let tomorrow: string;
  let later: string;

  beforeEach(async () => {
    await markDatabase();
    await technician(IMRAN, "Imran Qureshi", "IQ");
    today = await visit(null, "service", "scheduled", at("2026-09-21", "16:00").toISOString(), IMRAN);
    tomorrow = await visit(null, "service", "scheduled", at("2026-09-22", "10:00").toISOString(), IMRAN);
    later = await visit(null, "service", "scheduled", at("2026-09-23", "10:00").toISOString(), IMRAN);
    await env.DB.prepare("UPDATE appointments SET technician_draft = 1, service_city = 'Gurgaon'").run();
  });

  const drafts = async () =>
    (
      await env.DB.prepare("SELECT id FROM appointments WHERE technician_draft = 1 ORDER BY window_start").all<{
        id: string;
      }>()
    ).results.map((row) => row.id);

  it("fixes only today's before the reminder hour", async () => {
    await lockDrafts(env.DB, NOW, HOURS).run();
    // Today's, were its evening's lock ever missed, is fixed too.
    expect(await drafts()).toEqual([tomorrow, later]);
    expect(await drafts()).not.toContain(today);
  });

  it("fixes tomorrow's at the reminder hour, and leaves the day after a draft", async () => {
    await lockDrafts(env.DB, at("2026-09-21", "18:00"), HOURS).run();
    expect(await drafts()).toEqual([later]);
  });

  it("counts tomorrow as settled for a technician only once their city's drafts are fixed, not when the hour comes", async () => {
    await env.DB.prepare("UPDATE technicians SET city = 'Gurgaon' WHERE id = ?1").bind(IMRAN).run();
    const settled = (now: Date) =>
      daySettled(env.DB, { technicianId: IMRAN, date: "2026-09-22", now, nationalHour: 18 });
    expect(await settled(at("2026-09-21", "17:59"))).toBe(false);
    // 6 pm has come, and the lock, a minute into the hour, has not yet run.
    expect(await settled(at("2026-09-21", "18:00"))).toBe(false);
    await lockDrafts(env.DB, at("2026-09-21", "18:01"), HOURS).run();
    expect(await settled(at("2026-09-21", "18:01"))).toBe(true);
  });

  it("fixes tomorrow's in a city whose own reminder hour has come, before the nation's", async () => {
    await env.DB.prepare("UPDATE appointments SET service_city = 'Noida' WHERE id = ?1").bind(tomorrow).run();
    await lockDrafts(env.DB, NOW, HOURS).run();
    expect(await drafts()).toEqual([later]);
  });
});

describe("a draft's technician", () => {
  let personId: string;
  let visitId: string;

  beforeEach(async () => {
    await markDatabase();
    await technician(IMRAN, "Imran Qureshi", "IQ");
    personId = (await client(false, { lastWith: IMRAN })).id;
    await aConsent(personId);
    visitId = await visit(personId, "service", "scheduled", at("2026-09-23", "10:00").toISOString(), IMRAN);
    await env.DB.prepare("UPDATE appointments SET technician_draft = 1 WHERE id = ?1").bind(visitId).run();
  });

  const told = async () => {
    const composed = await composeVisitMessage(env.DB, "visit_moved", visitId, personId);
    return "skip" in composed ? composed.skip : renderMessage(composed.template, composed.params);
  };
  const theirs = async () =>
    jobsOn({
      db: env.DB,
      technicianId: IMRAN,
      date: "2026-09-23",
      now: NOW,
      unlockHour: 18,
      rules: { booking: BOOKING_RULES, drive: DRIVE_ESTIMATE, times: DRIVE_TIMES, learning: DRIVE_LEARNING },
    });

  it("is not named to the client, nor on the technician's list, until it is fixed", async () => {
    expect(await told()).toContain("with our technician");
    expect(await theirs()).toHaveLength(0);

    await env.DB.prepare("UPDATE appointments SET technician_draft = 0 WHERE id = ?1").bind(visitId).run();
    expect(await told()).toContain("with Imran");
    expect(await theirs()).toHaveLength(1);
  });
});

describe("the drafts left to the evening's check and lock", () => {
  const hours = { national: 18, cities: new Map([["Pune", 20]]) };
  const at = (date: string, time: string) => indiaInstant(date, time);

  it("are today's, whatever the hour, and tomorrow's once the half hour before its city's own lock has begun", () => {
    expect(leftToTheLock(hours, { city: "Gurgaon", date: "2026-09-21" }, at("2026-09-21", "08:00"))).toBe(true);
    expect(leftToTheLock(hours, { city: "Gurgaon", date: "2026-09-22" }, at("2026-09-21", "17:20"))).toBe(false);
    expect(leftToTheLock(hours, { city: "Gurgaon", date: "2026-09-22" }, at("2026-09-21", "17:40"))).toBe(true);
    // Pune locks at 8 pm, so its drafts are a booking's to move until 7:30.
    expect(leftToTheLock(hours, { city: "Pune", date: "2026-09-22" }, at("2026-09-21", "17:40"))).toBe(false);
    expect(leftToTheLock(hours, { city: "Pune", date: "2026-09-22" }, at("2026-09-21", "19:40"))).toBe(true);
    // The day after tomorrow is the hourly re-plan's and a booking's, whatever the hour.
    expect(leftToTheLock(hours, { city: "Gurgaon", date: "2026-09-23" }, at("2026-09-21", "17:40"))).toBe(false);
  });
});
