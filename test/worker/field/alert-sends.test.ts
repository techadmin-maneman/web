// What writes a technician's alerts, and what pushes them (docs/decisions/0250-guides-and-alerts.md): a job in the
// coming week moved, given to another or called off, by trigger; time to leave, running over and the day ahead, by the
// cron; and a push for each, to the phones signed in as its technician, against a fake push service. NOW is Monday 21
// September 2026, 12 noon in India; Rohit's visit is at 1 pm. The triggers read the database's own clock, so the jobs
// they watch are set from it. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  dropOldAlerts,
  pushNewAlerts,
  writeDayAhead,
  writeTimedAlerts,
} from "../../../src/domain/field/alert-sends.ts";
import { jobsOn } from "../../../src/domain/field/tech-jobs.ts";
import { createCachedOpsInputs } from "../../../src/domain/platform/ops-settings.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import type { Push } from "../../../src/providers/web-push.ts";
import { techAlertsJob } from "../../../src/scheduled/tech-alerts.ts";
import { NOW } from "../clock.ts";
import { aVisit } from "../fixtures/index.ts";
import { fakeDependencies, LOCAL_CONFIG, markDatabase } from "../helpers.ts";
import { IMRAN, JOB, PERSON, SAMEER, working, type Working } from "../job-fixtures.ts";

let job: Working;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const AHEAD = "22222222-2222-4222-8222-222222222299";

interface Alert {
  technician_id: string;
  kind: string;
  appointment_id: string | null;
  starts_at: string | null;
  was_starts_at: string | null;
  finish_by: string | null;
  jobs: number | null;
  pushed_at: string | null;
}
const alerts = async (): Promise<Alert[]> =>
  (
    await env.DB.prepare(
      `SELECT technician_id, kind, appointment_id, starts_at, was_starts_at, finish_by, jobs, pushed_at
         FROM tech_alerts ORDER BY rowid`,
    ).all<Alert>()
  ).results;

const appointment = (id: string, technicianId: string, windowStart: string) =>
  aVisit({ id, person_id: PERSON, technician_id: technicianId, window_start: windowStart });

const turnOff = (kind: string) =>
  env.DB.prepare("INSERT INTO tech_alert_kinds_off (technician_id, kind, set_at) VALUES (?1, ?2, ?3)")
    .bind(IMRAN, kind, NOW.toISOString())
    .run();

beforeEach(async () => {
  await markDatabase();
  job = await working("service");
});

describe("a job in the coming week, changed", () => {
  const tomorrow = new Date(Date.now() + DAY_MS).toISOString();
  const later = new Date(Date.now() + DAY_MS + 2 * 60 * MINUTE_MS).toISOString();
  const move = (to: string) =>
    env.DB.prepare("UPDATE appointments SET window_start = ?2 WHERE id = ?1").bind(AHEAD, to).run();

  beforeEach(async () => {
    await appointment(AHEAD, IMRAN, tomorrow);
  });

  it("moved, tells the technician the new time and the old, once each move", async () => {
    await move(later);
    await move(tomorrow);
    expect(await alerts()).toMatchObject([
      { technician_id: IMRAN, kind: "job_moved", appointment_id: AHEAD, starts_at: later, was_starts_at: tomorrow },
      { technician_id: IMRAN, kind: "job_moved", appointment_id: AHEAD, starts_at: tomorrow, was_starts_at: later },
    ]);
  });

  it("given to another technician, tells the one who had it", async () => {
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(AHEAD, SAMEER).run();
    expect(await alerts()).toMatchObject([{ technician_id: IMRAN, kind: "job_reassigned", starts_at: tomorrow }]);
  });

  it("called off from the console, tells the technician", async () => {
    const cancelled = await job.opsPost(`/api/visits/${AHEAD}/cancel`, {
      confirm: true,
      notice: "free",
      reason: "The client is travelling.",
    });
    expect(cancelled.status).toBe(200);
    expect(await alerts()).toMatchObject([{ technician_id: IMRAN, kind: "job_cancelled", appointment_id: AHEAD }]);
  });

  it("called off or given to another as its technician waits at the door, after its time, tells them", async () => {
    const late = "22222222-2222-4222-8222-222222222298";
    const later = "22222222-2222-4222-8222-222222222297";
    const twentyMinutesAgo = new Date(Date.now() - 20 * MINUTE_MS).toISOString();
    await appointment(late, IMRAN, twentyMinutesAgo);
    await appointment(later, IMRAN, twentyMinutesAgo);
    await env.DB.prepare("UPDATE appointments SET status = 'dispatched' WHERE id IN (?1, ?2)").bind(late, later).run();
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(late).run();
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(later, SAMEER).run();
    expect(await alerts()).toMatchObject([
      { technician_id: IMRAN, kind: "job_cancelled", appointment_id: late },
      { technician_id: IMRAN, kind: "job_reassigned", appointment_id: later },
    ]);
  });

  it("called off, tells the technician", async () => {
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(AHEAD).run();
    expect(await alerts()).toMatchObject([{ technician_id: IMRAN, kind: "job_cancelled", appointment_id: AHEAD }]);
  });

  it("tells nothing to a technician who turned job changes off, or of a job beyond the week", async () => {
    await turnOff("job_changes");
    await move(later);
    await env.DB.prepare("DELETE FROM tech_alert_kinds_off").run();
    const beyond = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();
    await appointment("22222222-2222-4222-8222-222222222298", IMRAN, beyond(9));
    await env.DB.prepare("UPDATE appointments SET window_start = ?2 WHERE id = ?1")
      .bind("22222222-2222-4222-8222-222222222298", beyond(10))
      .run();
    expect(await alerts()).toEqual([]);
  });
});

describe("the cron's alerts", () => {
  const given = async () => {
    const inputs = await createCachedOpsInputs()(env.DB, NOW);
    return {
      unlockHour: inputs.addressUnlockHour,
      rules: { booking: inputs.bookingRules, drive: inputs.driveEstimate },
      leaveNoticeMin: inputs.leaveNoticeMin,
    };
  };

  beforeEach(async () => {
    await env.DB.prepare("UPDATE technicians SET home_lat = 28.45, home_lng = 77.02 WHERE id = ?1").bind(IMRAN).run();
  });

  const leaveByOf = async (now: Date) => {
    const { unlockHour, rules } = await given();
    const [first] = await jobsOn({ db: env.DB, technicianId: IMRAN, date: "2026-09-21", now, unlockHour, rules });
    return Date.parse(first?.leave_by ?? "");
  };

  it("tells the technician to leave within the notice ops set of setting off, once for each time the job starts", async () => {
    const day = () => given();
    const leaveBy = await leaveByOf(NOW);
    expect(await writeTimedAlerts(env.DB, { now: new Date(leaveBy - 12 * MINUTE_MS), rules: day })).toBe(0);
    expect(await writeTimedAlerts(env.DB, { now: new Date(leaveBy - 8 * MINUTE_MS), rules: day })).toBe(1);
    await writeTimedAlerts(env.DB, { now: new Date(leaveBy - 3 * MINUTE_MS), rules: day });
    expect(await alerts()).toMatchObject([{ kind: "time_to_leave", appointment_id: JOB }]);

    // Moved an hour later: told again, for the new time.
    await env.DB.prepare("UPDATE appointments SET window_start = '2026-09-21T08:30:00.000Z' WHERE id = ?1")
      .bind(JOB)
      .run();
    const later = await leaveByOf(NOW);
    await writeTimedAlerts(env.DB, { now: new Date(later - 8 * MINUTE_MS), rules: day });
    expect((await alerts()).map((alert) => alert.starts_at)).toEqual([
      "2026-09-21T07:30:00.000Z",
      "2026-09-21T08:30:00.000Z",
    ]);
  });

  it("tells the technician to leave as long before setting off as ops set", async () => {
    const leaveBy = await leaveByOf(NOW);
    expect((await job.opsPost("/api/settings/leave_notice_min", { value: 20 })).status).toBe(200);
    expect(await writeTimedAlerts(env.DB, { now: new Date(leaveBy - 15 * MINUTE_MS), rules: () => given() })).toBe(1);
  });

  it("tells nothing to leave once the technician has checked in at the door", async () => {
    const leaveBy = await leaveByOf(NOW);
    await env.DB.prepare("UPDATE appointments SET status = 'dispatched' WHERE id = ?1").bind(JOB).run();
    expect(await writeTimedAlerts(env.DB, { now: new Date(leaveBy - 8 * MINUTE_MS), rules: () => given() })).toBe(0);
  });

  it("says a visit under way runs into the next, by when to finish", async () => {
    const day = () => given();
    await appointment(AHEAD, IMRAN, "2026-09-21T09:30:00.000Z");
    await env.DB.prepare("UPDATE appointments SET status = 'in_progress' WHERE id = ?1").bind(JOB).run();
    await turnOff("time_to_leave");

    await writeTimedAlerts(env.DB, { now: new Date("2026-09-21T09:20:00.000Z"), rules: day });
    const [over, ...more] = await alerts();
    expect(more).toEqual([]);
    expect(over).toMatchObject({ kind: "running_over", appointment_id: AHEAD });
    expect(Date.parse(over?.finish_by ?? "")).toBeLessThan(Date.parse("2026-09-21T09:20:00.000Z"));
  });

  it("sends the next day's jobs, how many and from when, to each technician with any who has it on", async () => {
    await appointment(AHEAD, IMRAN, "2026-09-22T05:30:00.000Z");
    await appointment("22222222-2222-4222-8222-222222222298", IMRAN, "2026-09-22T08:00:00.000Z");
    expect(await writeDayAhead(env.DB, { now: NOW, date: "2026-09-22" })).toBe(1);
    expect(await alerts()).toMatchObject([
      {
        technician_id: IMRAN,
        kind: "day_ahead",
        appointment_id: AHEAD,
        jobs: 2,
        starts_at: "2026-09-22T05:30:00.000Z",
      },
    ]);

    await env.DB.prepare("DELETE FROM tech_alerts").run();
    await turnOff("day_ahead");
    expect(await writeDayAhead(env.DB, { now: NOW, date: "2026-09-22" })).toBe(0);
  });

  it("sends the next day's jobs in the hour ops set for it, and only then", async () => {
    await appointment(AHEAD, IMRAN, "2026-09-22T05:30:00.000Z");
    const run = (now: Date) =>
      techAlertsJob({
        env,
        deps: fakeDependencies({ now: () => now }),
        config: LOCAL_CONFIG,
        log: createLogger(),
        budget: createCallBudget(10),
        inputs: () => createCachedOpsInputs()(env.DB, now),
      });
    await run(new Date("2026-09-21T14:25:00.000Z")); // 7:55 pm in India
    expect(await alerts()).toEqual([]);
    await run(new Date("2026-09-21T14:35:00.000Z")); // 8:05 pm
    expect(await alerts()).toMatchObject([{ kind: "day_ahead", appointment_id: AHEAD }]);

    // Ops set it an hour earlier; the next day is sent from 7 pm.
    await env.DB.prepare("DELETE FROM tech_alerts").run();
    expect((await job.opsPost("/api/settings/day_ahead_hour", { value: 19 })).status).toBe(200);
    await run(new Date("2026-09-22T13:35:00.000Z")); // 7:05 pm on the 22nd, for the 23rd
    await appointment("22222222-2222-4222-8222-222222222297", IMRAN, "2026-09-23T05:30:00.000Z");
    await run(new Date("2026-09-22T13:40:00.000Z"));
    expect(await alerts()).toMatchObject([
      { kind: "day_ahead", appointment_id: "22222222-2222-4222-8222-222222222297" },
    ]);
  });

  it("deletes alerts older than the inbox shows", async () => {
    await env.DB.prepare(
      `INSERT INTO tech_alerts (id, technician_id, kind, appointment_id, date, once_key, sent_at)
       VALUES ('old', ?1, 'time_to_leave', ?2, '2026-09-10', 'old', ?3), ('new', ?1, 'job_moved', ?2, '2026-09-20', 'new', ?4)`,
    )
      .bind(IMRAN, JOB, new Date(NOW.getTime() - 9 * DAY_MS).toISOString(), NOW.toISOString())
      .run();
    await dropOldAlerts(env.DB, NOW);
    expect((await alerts()).map((alert) => alert.kind)).toEqual(["job_moved"]);
  });
});

describe("a push", () => {
  const ENDPOINT = "https://fcm.googleapis.com/fcm/send/imran-phone";

  beforeEach(async () => {
    const device = await env.DB.prepare("SELECT id FROM technician_devices WHERE technician_id = ?1")
      .bind(IMRAN)
      .first<{ id: string }>();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO push_subscriptions (device_id, endpoint, subscribed_at) VALUES (?1, ?2, ?3)").bind(
        device?.id,
        ENDPOINT,
        NOW.toISOString(),
      ),
      env.DB.prepare(
        `INSERT INTO tech_alerts (id, technician_id, kind, appointment_id, date, once_key, sent_at)
         VALUES ('al1', ?1, 'time_to_leave', ?2, '2026-09-21', 'al1', ?3)`,
      ).bind(IMRAN, JOB, new Date(NOW.getTime() - MINUTE_MS).toISOString()),
    ]);
  });

  const pushed = async () =>
    (await env.DB.prepare("SELECT pushed_at FROM tech_alerts WHERE id = 'al1'").first<{ pushed_at: string | null }>())
      ?.pushed_at ?? null;

  it("goes once to each phone signed in as the alert's technician", async () => {
    const push = job.deps.push;
    expect(await pushNewAlerts(env.DB, { push, budget: createCallBudget(10), now: NOW })).toBe(1);
    expect(await pushNewAlerts(env.DB, { push, budget: createCallBudget(10), now: NOW })).toBe(0);
    expect(job.deps.pushes).toEqual([ENDPOINT]);
    expect(await pushed()).toBe(NOW.toISOString());
  });

  it("goes to no phone signed out, and the alert waits in the inbox", async () => {
    await env.DB.prepare("UPDATE sessions SET revoked_at = ?1").bind(NOW.toISOString()).run();
    expect(await pushNewAlerts(env.DB, { push: job.deps.push, budget: createCallBudget(10), now: NOW })).toBe(0);
    expect(job.deps.pushes).toEqual([]);
    expect(await pushed()).toBeNull();
  });

  it("goes for no alert already read in the app, and to no technician switched off", async () => {
    await env.DB.prepare("UPDATE tech_alerts SET read_at = ?1").bind(NOW.toISOString()).run();
    expect(await pushNewAlerts(env.DB, { push: job.deps.push, budget: createCallBudget(10), now: NOW })).toBe(0);
    await env.DB.prepare("UPDATE tech_alerts SET read_at = NULL").run();
    await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(IMRAN).run();
    expect(await pushNewAlerts(env.DB, { push: job.deps.push, budget: createCallBudget(10), now: NOW })).toBe(0);
    expect(job.deps.pushes).toEqual([]);
  });

  it("forgets a subscription the push service no longer has", async () => {
    const gone: Push = () => Promise.resolve("gone");
    await pushNewAlerts(env.DB, { push: gone, budget: createCallBudget(10), now: NOW });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first<{ n: number }>()).toEqual({
      n: 0,
    });
  });

  it("left by a run with no calls to spare, goes with the next", async () => {
    expect(await pushNewAlerts(env.DB, { push: job.deps.push, budget: createCallBudget(0), now: NOW })).toBe(0);
    expect(await pushed()).toBeNull();
    expect(await pushNewAlerts(env.DB, { push: job.deps.push, budget: createCallBudget(10), now: NOW })).toBe(1);
  });
});
