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
import type { Push } from "../../../src/providers/web-push.ts";
import { NOW } from "../clock.ts";
import { markDatabase } from "../helpers.ts";
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

async function appointment(id: string, technicianId: string, windowStart: string, status = "scheduled") {
  const end = new Date(Date.parse(windowStart) + 90 * MINUTE_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
       service_city, service_pincode, synced_at)
     VALUES (?1, ?1, ?2, 'service', ?3, ?4, ?5, ?6, 'Gurgaon', '122018', ?4)`,
  )
    .bind(id, PERSON, status, windowStart, end, technicianId)
    .run();
}

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
    };
  };

  beforeEach(async () => {
    await env.DB.prepare("UPDATE technicians SET home_lat = 28.45, home_lng = 77.02 WHERE id = ?1").bind(IMRAN).run();
  });

  it("tells the technician to leave within ten minutes of setting off, once", async () => {
    const { unlockHour, rules } = await given();
    const day = () => given();
    const [first] = await jobsOn({ db: env.DB, technicianId: IMRAN, date: "2026-09-21", now: NOW, unlockHour, rules });
    const leaveBy = Date.parse(first?.leave_by ?? "");
    const early = new Date(leaveBy - 12 * MINUTE_MS);
    const due = new Date(leaveBy - 8 * MINUTE_MS);

    expect(await writeTimedAlerts(env.DB, { now: early, rules: day })).toBe(0);
    expect(await writeTimedAlerts(env.DB, { now: due, rules: day })).toBe(1);
    await writeTimedAlerts(env.DB, { now: new Date(leaveBy - 3 * MINUTE_MS), rules: day });
    expect(await alerts()).toMatchObject([{ kind: "time_to_leave", appointment_id: JOB }]);
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
