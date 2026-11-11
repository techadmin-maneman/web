// A consultation's pick from Options (src/routes/tech/jobs.outcome.ts, ADR 0247): sent with a close going ahead, kept on
// the visit's outcome, and read by ops on the client's First fit to book task; refused on any other close.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { NEXT_VISIT_DAYS } from "../../../src/policy/next-visit.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { aGenericFirstFit, aPackage } from "../fixtures/index.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { JOB, working } from "../job-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  await aPackage({ code: "natural", name: "Mane Man Natural", firstFit: 4_500_000, validFrom: "2026-09-01" });
});

const picked = () =>
  env.DB.prepare("SELECT picked_tier FROM visit_outcomes WHERE appointment_id = ?1").bind(JOB).first<{
    picked_tier: string | null;
  }>();

describe("a consultation's pick from Options", () => {
  it("goes with a close going ahead, and ops read it on the First fit to book task", async () => {
    const job = await working("consultation");
    await job.workTo("outcome");
    const close = { outcome: "done", going_ahead: true, product: "natural" };
    expect((await job.post(`/api/tech/jobs/${JOB}/outcome`, close, "outcome-1")).status).toBe(202);
    expect(await picked()).toEqual({ picked_tier: "natural" });

    // A consulted client is a task once they have waited the days ops give them to book themselves.
    const later = new Date(NOW.getTime() + NEXT_VISIT_DAYS.first_fit_to_book * 24 * 60 * 60 * 1000);
    const { tasks } = await outstandingTasks(env.DB, later, TASK_SLA_HOURS);
    const task = tasks.find((one) => one.group === "first_fit_to_book");
    expect(task?.facts).toMatchObject({ group: "first_fit_to_book", picked: "Mane Man Natural" });
  });

  // Every product has its consultation, first fit, service and replacement under one tier: the pick is its first fit.
  it("is named on the task by its first fit, whichever of the product's services comes first", async () => {
    await aGenericFirstFit();
    const job = await working("consultation");
    await job.workTo("outcome");
    const close = { outcome: "done", going_ahead: true, product: "standard" };
    expect((await job.post(`/api/tech/jobs/${JOB}/outcome`, close, "outcome-1")).status).toBe(202);

    const later = new Date(NOW.getTime() + NEXT_VISIT_DAYS.first_fit_to_book * 24 * 60 * 60 * 1000);
    const { tasks } = await outstandingTasks(env.DB, later, TASK_SLA_HOURS);
    const task = tasks.find((one) => one.group === "first_fit_to_book");
    expect(task?.facts).toMatchObject({ picked: "First fit" });
  });

  it("is refused with a client not going ahead, and of a product not on offer that day", async () => {
    const job = await working("consultation");
    await job.workTo("outcome");
    const notNow = { outcome: "done", going_ahead: false, product: "natural" };
    expect((await job.post(`/api/tech/jobs/${JOB}/outcome`, notNow, "outcome-1")).status).toBe(400);
    const unknown = { outcome: "done", going_ahead: true, product: "platinum" };
    expect((await job.post(`/api/tech/jobs/${JOB}/outcome`, unknown, "outcome-2")).status).toBe(400);
  });

  it("is refused on a visit that is no consultation", async () => {
    const job = await working("service");
    await job.workTo("outcome");
    const close = { outcome: "done", going_ahead: true, product: "natural" };
    expect((await job.post(`/api/tech/jobs/${JOB}/outcome`, close, "outcome-1")).status).toBe(400);
  });
});
