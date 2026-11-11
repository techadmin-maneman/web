// The technician's own quality over the last 30 days (src/routes/tech/quality.ts): visits checked in by the booked
// start, and their first fits fitted again within 30 days; and Me's grade, city and number (src/routes/tech/auth.ts).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, NOW } from "../helpers.ts";
import { aVisit } from "../fixtures/index.ts";
import { AT, writeRow } from "../fixtures/rows.ts";
import { IMRAN, JOB, PERSON, SAMEER, working, type Working } from "../job-fixtures.ts";

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

/** Another first fit for the same client, by `technician`, `daysAgo` days ago. */
const fittedAgain = (technician: string, daysAgo: number) =>
  aVisit({ person_id: PERSON, type: "first_fit", window_start: ago(daysAgo * DAY), technician_id: technician });

describe("the technician's quality", () => {
  it("counts a visit checked in by its booked start on time", async () => {
    await checkedInAt(ago(60), ago(30));
    expect(await quality()).toEqual({ visits: 1, on_time: 1, fits: 0, redone: 0 });
  });

  it("counts a visit checked in after its booked start late", async () => {
    await checkedInAt(ago(60), ago(90));
    expect(await quality()).toEqual({ visits: 1, on_time: 0, fits: 0, redone: 0 });
  });

  it("counts a first fit redone where the client is fitted again within 30 days, by whoever", async () => {
    await env.DB.prepare("UPDATE appointments SET status = 'completed', window_start = ?2 WHERE id = ?1")
      .bind(JOB, ago(10 * DAY))
      .run();
    await fittedAgain(SAMEER, 5);
    expect(await quality()).toMatchObject({ fits: 1, redone: 1 });
  });

  it("does not count a fit again more than 30 days on, nor a visit older than 30 days", async () => {
    await env.DB.prepare("UPDATE appointments SET status = 'completed', window_start = ?2 WHERE id = ?1")
      .bind(JOB, ago(40 * DAY))
      .run();
    await fittedAgain(SAMEER, 5);
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
