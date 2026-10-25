// What happened on a visit, for its drawer on the board (src/routes/ops/visit-story.ts): each step the phone landed, in
// order, by whom, and how it ended. The drawer said only "Consultation · 1 slot".

import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, request } from "../helpers.ts";
import { JOB, working } from "../job-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
});

describe("a visit's story", () => {
  it("is each step the technician took, in order, by them, and how the visit ended", async () => {
    const job = await working("consultation");
    await job.workTo("outcome");
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");

    const answer = await request(job.ops, `/api/visits/${JOB}/story`);
    expect(answer.status).toBe(200);
    const { steps } = await answer.json<{ steps: { kind: string; technician: string; outcome: string | null }[] }>();
    expect(steps.map((step) => step.kind)).toEqual([
      "check_in",
      "start",
      "before_photos",
      "checklist",
      "consumables",
      "outcome",
    ]);
    expect(steps.at(-1)).toMatchObject({ outcome: "done" });
    expect(steps.every((step) => step.technician === "Imran Qureshi")).toBe(true);
  });

  it("is nothing before the technician arrives, and no visit outside the caller's reach", async () => {
    const job = await working("service");
    expect(await (await request(job.ops, `/api/visits/${JOB}/story`)).json()).toEqual({ steps: [] });
    expect((await request(job.ops, "/api/visits/00000000-0000-4000-8000-000000000000/story")).status).toBe(404);
  });
});
