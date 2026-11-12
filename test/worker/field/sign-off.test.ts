// The client signs off a fit before it closes done (docs/decisions/0254-client-signs-off-the-fit.md): the technician
// asks; the client signs or flags in their app, or on the technician's phone; or the
// technician records that the client declined to sign, which opens a Tasks row. NOW is Monday 21 September 2026,
// 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { JOB, PERSON, SAMEER, working, type Working } from "../job-fixtures.ts";

const ALL_TICKED = { hairline: true, blend: true, secure: true };

beforeEach(async () => {
  await markDatabase();
});

/** A replacement worked up to its outcome, its sign-off left to the test. */
async function replacementToTheClose(): Promise<Working> {
  const job = await working("replacement");
  await job.workTo("piece");
  const steps: [string, object, string][] = [
    ["piece", { piece_code: "MM-STD-5520-A" }, "event-piece-01"],
    ["checklist", { done: [] }, "event-checklist-01"],
    ["consumables", { items: [], short_reason: "other" }, "event-consumables-01"],
    ["photos", { phase: "after" }, "event-afterphotos-01"],
  ];
  for (const [step, body, event] of steps) {
    expect((await job.post(`/api/tech/jobs/${JOB}/${step}`, body, event)).status).toBe(202);
  }
  return job;
}

const close = (job: Working, event = "event-outcome-01") =>
  job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, event);
const ask = (job: Working, event = "event-ask-01") => job.post(`/api/tech/jobs/${JOB}/sign-off-request`, {}, event);
const card = async (job: Working) =>
  (await (await job.get(`/api/tech/jobs/${JOB}`)).json<{ sign_off: Record<string, unknown> | null }>()).sign_off;

/** The client, signed in to their app. */
async function clientApp() {
  const app = appFor("local", fakeDependencies(), {}, "client");
  const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
  return (body: object) =>
    request(app, `/api/visits/${JOB}/sign-off`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(body),
    });
}

describe("a fit's sign-off", () => {
  it("is not taken by a service visit, which closes done without one", async () => {
    const job = await working("service");
    await job.workTo("outcome");
    expect((await ask(job)).status).toBe(400);
    expect((await close(job)).status).toBe(202);
  });

  it("holds the fit's close done until the client signs, in their app, every check ticked", async () => {
    const job = await replacementToTheClose();
    const refused = await close(job);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "invalid_request", fields: ["sign_off"] } });

    const sign = await clientApp();
    expect((await sign({ result: "signed", checks: ALL_TICKED })).status).toBe(409);

    const asked = await ask(job);
    expect(await asked.json()).toMatchObject({ state: "asked", asks: 1 });
    expect(await card(job)).toMatchObject({ state: "asked", asks: 1 });

    const open = await sign({ result: "signed", checks: { ...ALL_TICKED, blend: false } });
    expect(open.status).toBe(422);
    expect(await open.json()).toMatchObject({ error: { code: "sign_off_checks_open" } });

    expect((await sign({ result: "signed", checks: ALL_TICKED })).status).toBe(200);
    expect(await card(job)).toMatchObject({ state: "signed", signed_on: "client_app", signed_at: NOW.toISOString() });
    expect((await close(job)).status).toBe(202);
    expect((await sign({ result: "flagged", checks: ALL_TICKED, flag_text: "Late." })).status).toBe(409);
  });

  it("carries a flag to the technician's phone, and is asked again once it is put right", async () => {
    const job = await replacementToTheClose();
    await ask(job);
    const sign = await clientApp();
    const flagged = await sign({
      result: "flagged",
      checks: { ...ALL_TICKED, hairline: false },
      flag_text: "The left edge lifts",
    });
    expect(flagged.status).toBe(200);
    expect(await card(job)).toMatchObject({ state: "flagged", flag_text: "The left edge lifts" });
    expect((await close(job)).status).toBe(400);

    expect(await (await ask(job, "event-ask-02")).json()).toMatchObject({ state: "asked" });
    expect(await card(job)).toMatchObject({ state: "asked", asks: 2 });
    expect((await sign({ result: "signed", checks: ALL_TICKED })).status).toBe(200);
    expect((await close(job)).status).toBe(202);
  });

  it("is signed on the technician's phone, asked there first where the phone queued both with no signal", async () => {
    const job = await replacementToTheClose();
    const answer = { result: "signed", checks: ALL_TICKED };
    const signed = await job.post(`/api/tech/jobs/${JOB}/sign-off`, { answer }, "event-phone-01");
    expect(signed.status).toBe(200);
    expect(await card(job)).toMatchObject({ state: "signed", signed_on: "technician_phone" });
    expect((await close(job)).status).toBe(202);
  });

  it("closes with the technician's why when the client declines, and gives Care a Tasks row", async () => {
    const job = await replacementToTheClose();
    await ask(job);
    const declined = await job.post(
      `/api/tech/jobs/${JOB}/sign-off-declined`,
      { reason: "Client in a hurry" },
      "event-decline-01",
    );
    expect(await declined.json()).toMatchObject({ state: "declined", declined_reason: "Client in a hurry" });
    expect((await close(job)).status).toBe(202);

    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks).toContainEqual(
      expect.objectContaining({
        group: "fit_unsigned",
        id: JOB,
        facts: { group: "fit_unsigned", kind: "replacement", reason: "Client in a hurry", technician: "Imran Qureshi" },
      }),
    );
  });

  it("lands as the phone's outbox replays it, offline then back: the decline and the close once each", async () => {
    const job = await replacementToTheClose();
    // The phone queued these with no signal, and sends its outbox twice over once it has one.
    for (let replay = 0; replay < 2; replay += 1) {
      const declined = await job.post(`/api/tech/jobs/${JOB}/sign-off-declined`, { reason: "No phone" }, "event-d-1");
      expect(declined.status).toBe(200);
      expect((await close(job, "event-outcome-01")).status).toBe(202);
    }
    const outcomes = await env.DB.prepare("SELECT COUNT(*) AS n FROM job_events WHERE kind = 'outcome'").first<{
      n: number;
    }>();
    expect(outcomes?.n).toBe(1);
    expect(await card(job)).toMatchObject({ state: "declined" });
  });

  it("answers each write sent again, and one a fit has moved past, with where it stands", async () => {
    const job = await replacementToTheClose();
    await ask(job, "event-ask-01");
    const sign = await clientApp();
    await sign({ result: "flagged", checks: ALL_TICKED, flag_text: "The left edge lifts" });
    // The first ask's answer was lost, and the phone sends it again: the flag stands.
    expect((await ask(job, "event-ask-01")).status).toBe(200);
    expect(await card(job)).toMatchObject({ state: "flagged", asks: 1 });

    await ask(job, "event-ask-02");
    await sign({ result: "signed", checks: ALL_TICKED });
    // A decline and a signature the phone queued before it heard, answered with the client's sign-off.
    const declined = await job.post(`/api/tech/jobs/${JOB}/sign-off-declined`, { reason: "No phone" }, "event-d-1");
    expect(await declined.json()).toMatchObject({ state: "signed", signed_on: "client_app" });
    const onPhone = await job.post(
      `/api/tech/jobs/${JOB}/sign-off`,
      { answer: { result: "signed", checks: ALL_TICKED } },
      "event-phone-01",
    );
    expect(await onPhone.json()).toMatchObject({ state: "signed", signed_on: "client_app" });
    expect((await close(job)).status).toBe(202);
  });

  it("refuses the technician the visit was taken from, as any write of theirs", async () => {
    const job = await replacementToTheClose();
    await ask(job);
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();

    const asked = await ask(job, "event-ask-02");
    expect(asked.status).toBe(409);
    expect(await asked.json()).toMatchObject({ error: { code: "superseded", fields: ["technician"] } });
    const declined = await job.post(`/api/tech/jobs/${JOB}/sign-off-declined`, { reason: "Gone" }, "event-d-3");
    expect(declined.status).toBe(409);
    expect(await env.DB.prepare("SELECT state FROM fit_sign_offs").first()).toEqual({ state: "asked" });
  });

  it("is asked no more once the visit has closed", async () => {
    const job = await replacementToTheClose();
    await job.post(`/api/tech/jobs/${JOB}/sign-off-declined`, { reason: "No phone" }, "event-d-1");
    await close(job);
    const asked = await ask(job);
    expect(asked.status).toBe(409);
    expect(await asked.json()).toMatchObject({ error: { code: "already_closed" } });
  });

  it("stays signed once signed: a decline after it changes nothing", async () => {
    const job = await replacementToTheClose();
    await ask(job);
    await (
      await clientApp()
    )({ result: "signed", checks: ALL_TICKED });
    const late = await job.post(`/api/tech/jobs/${JOB}/sign-off-declined`, { reason: "Changed mind" }, "event-d-2");
    expect(late.status).toBe(200);
    expect(await card(job)).toMatchObject({ state: "signed", declined_reason: null });
  });

  it("is not asked of a partly done fit, which closes without one", async () => {
    const job = await replacementToTheClose();
    const partial = await job.post(
      `/api/tech/jobs/${JOB}/outcome`,
      { outcome: "partial", reason: "client_stopped_it" },
      "event-outcome-01",
    );
    expect(partial.status).toBe(202);
  });
});
