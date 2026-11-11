// The technician's own quality over the last 30 days (src/routes/tech/quality.ts): visits checked in by the booked
// start, and their first fits fitted again within 30 days; and Me's grade, city and number (src/routes/tech/auth.ts).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, NOW } from "../helpers.ts";
import { REMAKE_BOOKED } from "../../../src/domain/booking/remakes.ts";
import { AT, writeRow } from "../fixtures/rows.ts";
import { IMRAN, JOB, working, type Working } from "../job-fixtures.ts";

const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const DAY = 24 * 60;

let job: Working;

beforeEach(async () => {
  await markDatabase();
  job = await working("first_fit");
});

const quality = async () => (await job.get("/api/tech/quality")).json();

/** The visit checked in at `at`, booked to start at `starts`. */
async function checkedInAt(at: string, starts: string): Promise<void> {
  await job.post(`/api/tech/jobs/${JOB}/checkin`, { lat: 28.3988, lng: 77.07 }, "event-checkin-01");
  await env.DB.batch([
    env.DB.prepare("UPDATE job_events SET occurred_at = ?2 WHERE appointment_id = ?1 AND kind = 'check_in'").bind(
      JOB,
      at,
    ),
    env.DB.prepare("UPDATE appointments SET window_start = ?2 WHERE id = ?1").bind(JOB, starts),
  ]);
}

/** The visit as a first fit, ended `status`, `daysAgo` days ago. */
const fitEnded = (status: "completed" | "terminated", daysAgo: number) =>
  env.DB.prepare("UPDATE appointments SET type = 'first_fit', status = ?2, window_start = ?3 WHERE id = ?1")
    .bind(JOB, status, ago(daysAgo * DAY))
    .run();

/** Its free refit booked `daysAgo` days ago, which closes its Tasks row as the booking does. */
const refitBooked = (daysAgo: number) =>
  writeRow(
    "task_closures",
    { id: crypto.randomUUID(), task_group: "partial_visit", subject_id: JOB, reason: REMAKE_BOOKED },
    { closed_by: "ops@maneman.in", closed_at: ago(daysAgo * DAY) },
  );

describe("the technician's quality", () => {
  it("counts a visit checked in by its booked start on time", async () => {
    await checkedInAt(ago(60), ago(30));
    expect(await quality()).toEqual({ visits: 1, on_time: 1, fits: 0, redone: 0 });
  });

  it("counts a visit checked in after its booked start late", async () => {
    await checkedInAt(ago(60), ago(90));
    expect(await quality()).toEqual({ visits: 1, on_time: 0, fits: 0, redone: 0 });
  });

  it("counts a first fit left partly done as redone once its free refit is booked within 30 days", async () => {
    await fitEnded("terminated", 20);
    expect(await quality()).toMatchObject({ fits: 1, redone: 0 });
    await refitBooked(10);
    expect(await quality()).toMatchObject({ fits: 1, redone: 1 });
  });

  it("counts a fit done as a fit, not redone, and none older than 30 days", async () => {
    await fitEnded("completed", 10);
    expect(await quality()).toMatchObject({ fits: 1, redone: 0 });
    await fitEnded("terminated", 40);
    await refitBooked(5);
    expect(await quality()).toMatchObject({ fits: 0, redone: 0 });
  });

  it("leaves out a first fit nobody was home for", async () => {
    await fitEnded("terminated", 10);
    await writeRow(
      "visit_outcomes",
      { appointment_id: JOB, outcome: "partial", partial_reason: "no_show", updated_at: AT },
      {},
    );
    expect(await quality()).toMatchObject({ fits: 0, redone: 0 });
  });
});

describe("who is signed in", () => {
  it("names their grade, city and number for Me", async () => {
    const grade = crypto.randomUUID();
    await writeRow("pay_grades", { id: grade, name: "Senior", created_by: "finance@maneman.in", created_at: AT }, {});
    await env.DB.prepare("UPDATE technicians SET pay_grade_id = ?2 WHERE id = ?1").bind(IMRAN, grade).run();
    expect(await (await job.get("/api/tech/me")).json()).toMatchObject({
      grade: "Senior",
      city: null,
      mobile: "+919810000009",
    });
  });
});
