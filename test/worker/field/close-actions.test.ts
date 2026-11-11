// What the technician does from a closed visit (src/routes/tech/jobs.close.ts, ADR 0246): texts a one visit's payment
// link again, three times a day at most, and suggests how to finish a visit left partly done, which ops read on its
// task. Each for the technician's own visit alone.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { JOB, SAMEER, working } from "../job-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
});

/** A link Razorpay made for the visit, not yet paid. */
async function withLink() {
  const at = NOW.toISOString();
  await env.DB.prepare(
    `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, razorpay_link_id,
       short_url, sent_at, created_at, updated_at)
     VALUES ('44444444-4444-4444-8444-444444444444', ?1, 'natural', 4500000, 4500000, 0, 'plink_made',
       'https://rzp.io/i/made', ?2, ?2, ?2)`,
  )
    .bind(JOB, at)
    .run();
}

describe("a payment link texted again from the close", () => {
  it("is texted three times a day at most", async () => {
    const job = await working("service");
    await withLink();
    const resend = (n: number) =>
      job.post(`/api/tech/jobs/${JOB}/payment-link/resend`, undefined, `resend-${String(n)}`);
    for (const n of [1, 2, 3]) {
      const answer = await resend(n);
      expect(answer.status).toBe(200);
      expect(["resent", "not_texted"]).toContain((await answer.json<{ outcome: string }>()).outcome);
    }
    expect((await resend(4)).status).toBe(429);
  });

  it("is nothing for a visit with no link, or one given to another technician", async () => {
    const job = await working("service");
    expect((await job.post(`/api/tech/jobs/${JOB}/payment-link/resend`, undefined, "resend-1")).status).toBe(404);
    await withLink();
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();
    expect((await job.post(`/api/tech/jobs/${JOB}/payment-link/resend`, undefined, "resend-2")).status).toBe(404);
  });
});

describe("finishing a visit left partly done", () => {
  it("keeps the technician's suggestion on the visit's task, a later one in place of the earlier", async () => {
    const job = await working("service");
    await job.workTo("outcome");
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "partial", reason: "client_stopped_it" }, "outcome-1");

    const ask = (what: string, n: number) =>
      job.post(`/api/tech/jobs/${JOB}/finish-ask`, { ask: what }, `finish-${String(n)}`);
    expect((await ask("tomorrow_morning", 1)).status).toBe(204);
    expect((await ask("ops_call", 2)).status).toBe(204);

    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    const task = tasks.find((one) => one.group === "partial_visit");
    expect(task?.facts).toMatchObject({ group: "partial_visit", ask: "ops_call" });
  });

  it("is refused for a visit closed done, and for one that is not the technician's", async () => {
    const job = await working("service");
    await job.workTo("outcome");
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "outcome-1");
    expect((await job.post(`/api/tech/jobs/${JOB}/finish-ask`, { ask: "ops_call" }, "finish-1")).status).toBe(409);
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();
    expect((await job.post(`/api/tech/jobs/${JOB}/finish-ask`, { ask: "ops_call" }, "finish-2")).status).toBe(404);
  });
});
