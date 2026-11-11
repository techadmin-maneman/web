// Ops sending a landed step back to the technician, with why (src/routes/ops/step-send-backs.ts, ADR 0246): the card
// says so, the step lands again even long after the close, landing clears it, and the audit names no word of why.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { HOUR_MS } from "../../../src/lib/durations.ts";
import { markDatabase, NOW, request } from "../helpers.ts";
import { JOB, working } from "../job-fixtures.ts";

interface Story {
  sent_back: { kind: string; reason: string }[];
  may_send_back: string[];
}

interface Card {
  sent_back: { kind: string; reason: string; sent_at: string }[];
}

beforeEach(async () => {
  await markDatabase();
});

/** A service visit closed as done at NOW, on a clock the test moves. */
async function closedVisit() {
  const clock = { now: NOW };
  const job = await working("service", { now: () => clock.now });
  await job.workTo("outcome");
  await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
  return { job, clock };
}

describe("a step sent back", () => {
  it("is on the technician's card and the visit's drawer, with why, and is no longer offered there", async () => {
    const { job } = await closedVisit();
    const sent = await job.opsPost(`/api/visits/${JOB}/send-back`, {
      step: "consumables",
      reason: "Count the tape strips again.",
    });
    expect(sent.status).toBe(204);

    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json<Card>();
    expect(card.sent_back).toEqual([
      { kind: "consumables", reason: "Count the tape strips again.", sent_at: NOW.toISOString() },
    ]);
    const story = await (await request(job.ops, `/api/visits/${JOB}/story`)).json<Story>();
    expect(story.sent_back).toMatchObject([{ kind: "consumables", reason: "Count the tape strips again." }]);
    expect(story.may_send_back).toEqual(["before_photos", "checklist", "after_photos"]);
  });

  it("lands again hours after the close, which clears it, while a step not sent back is still refused", async () => {
    const { job, clock } = await closedVisit();
    await job.opsPost(`/api/visits/${JOB}/send-back`, { step: "consumables", reason: "Count again." });
    clock.now = new Date(NOW.getTime() + 3 * HOUR_MS);

    const again = await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [], short_reason: "other" },
      "event-consumables-02",
    );
    expect(again.status).toBe(202);
    expect((await (await job.get(`/api/tech/jobs/${JOB}`)).json<Card>()).sent_back).toEqual([]);

    const checklist = await job.post(`/api/tech/jobs/${JOB}/checklist`, { done: [] }, "event-checklist-02");
    expect(await checklist.json()).toMatchObject({ error: { code: "already_closed" } });
    // Once landed again, the consumables are closed like the rest.
    const third = await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [], short_reason: "other" },
      "event-consumables-03",
    );
    expect(await third.json()).toMatchObject({ error: { code: "already_closed" } });
  });

  it("is audited by the visit and the step, never a word of why", async () => {
    const { job } = await closedVisit();
    await job.opsPost(`/api/visits/${JOB}/send-back`, { step: "checklist", reason: "Scalp line missing." });
    const { results } = await env.DB.prepare(
      "SELECT subject_id, detail FROM audit_log WHERE action = 'visit.step_send_back'",
    ).all<{ subject_id: string; detail: string }>();
    expect(results).toEqual([{ subject_id: JOB, detail: JSON.stringify({ step: "checklist" }) }]);
  });

  it("is refused without a reason, for a step not landed, twice, and for a visit outside the caller's reach", async () => {
    const job = await working("service");
    await job.workTo("consumables");
    const sendBack = (step: string, reason = "Again, please.") =>
      job.opsPost(`/api/visits/${JOB}/send-back`, { step, reason });

    expect((await sendBack("checklist", "  ")).status).toBe(400);
    expect((await sendBack("consumables")).status).toBe(409);
    expect((await sendBack("checklist")).status).toBe(204);
    expect((await sendBack("checklist")).status).toBe(409);
    const elsewhere = await job.opsPost("/api/visits/00000000-0000-4000-8000-000000000000/send-back", {
      step: "checklist",
      reason: "Again.",
    });
    expect(elsewhere.status).toBe(404);
  });
});
