// A consultation photographs the client before and takes no after set, as the owner ruled. NOW is Monday
// 21 September 2026, 12 noon in India; the visit is today at 13:00. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase } from "../helpers.ts";
import { JOB, working } from "../job-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
});

const afterSets = () =>
  env.DB.prepare("SELECT COUNT(*) AS n FROM job_events WHERE appointment_id = ?1 AND kind = 'after_photos'")
    .bind(JOB)
    .first<{ n: number }>();

describe("a consultation's photographs", () => {
  it("are the before set alone: the card has no after step, and the API takes no after photograph", async () => {
    const job = await working("consultation");
    await job.workTo("outcome");

    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json<{ steps: string[] }>();
    expect(card.steps).not.toContain("after_photos");

    const before = await job.post(`/api/tech/jobs/${JOB}/photos/upload-url`, { phase: "before", angle: "front" }, "a");
    expect(before.status).toBe(201);
    const after = await job.post(`/api/tech/jobs/${JOB}/photos/upload-url`, { phase: "after", angle: "front" }, "b");
    expect(after.status).toBe(400);
    expect(await after.json()).toMatchObject({ error: { code: "invalid_request", fields: ["phase"] } });

    const afterSet = await job.post(`/api/tech/jobs/${JOB}/photos`, { phase: "after" }, "event-afterphotos-01");
    expect(afterSet.status).toBe(400);
    expect(await afterSet.json()).toMatchObject({ error: { code: "invalid_request", fields: ["phase"] } });
    expect(await afterSets()).toEqual({ n: 0 });

    // The outcome follows the consumables.
    const outcome = await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
    expect(outcome.status).toBe(202);
  });
});
