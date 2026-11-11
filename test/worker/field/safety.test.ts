// A technician's safety on a visit (src/routes/tech/safety.ts, src/routes/ops/sos.ts, docs/decisions/0248-safety.md):
// where they are, kept from check-in to the close, the latest alone, and gone at the close, a move or the sweep; the
// SOS, paged once, its position brought up to date while it is open, said safe, and marked handled by ops.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { sweepPositionsStatement } from "../../../src/domain/field/safety.ts";
import { isUrgent } from "../../../src/policy/alerts.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { JOB, SAMEER, working, type Working } from "../job-fixtures.ts";

const AT_THE_DOOR = { lat: 28.3988, lng: 77.07 };

beforeEach(async () => {
  await markDatabase();
});

const reading = (minutes: number, lat = 28.3988) => ({
  lat,
  lng: 77.07,
  accuracy_m: 12,
  at: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
});

const kept = () =>
  env.DB.prepare("SELECT lat, at FROM visit_positions WHERE appointment_id = ?1")
    .bind(JOB)
    .first<{ lat: number; at: string }>();

const sendPosition = (job: Working, body: object) => job.post(`/api/tech/jobs/${JOB}/position`, body, "position");

async function checkedIn(): Promise<Working> {
  const job = await working("service");
  await job.post(`/api/tech/jobs/${JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
  return job;
}

describe("where the technician is on a visit", () => {
  it("is kept from check-in, the latest reading alone", async () => {
    const job = await working("service");
    // Before the check-in it is no part of the visit.
    expect((await sendPosition(job, reading(0))).status).toBe(409);
    await job.post(`/api/tech/jobs/${JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    expect((await sendPosition(job, reading(2, 28.4))).status).toBe(204);
    expect((await sendPosition(job, reading(4, 28.41))).status).toBe(204);
    // A reading from before the one kept, arriving late, changes nothing.
    expect((await sendPosition(job, reading(1, 28.3))).status).toBe(204);
    expect(await kept()).toMatchObject({ lat: 28.41 });
  });

  it("is refused for a visit not the technician's", async () => {
    const job = await checkedIn();
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();
    expect((await sendPosition(job, reading(2))).status).toBe(404);
  });

  it("is gone once the visit closes, and is refused after it", async () => {
    const job = await checkedIn();
    await job.workTo("outcome");
    await sendPosition(job, reading(2));
    expect(await kept()).not.toBeNull();

    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
    expect(await kept()).toBeNull();
    expect((await sendPosition(job, reading(4))).status).toBe(409);
  });

  it("is gone once the visit is moved to another time, and refused until its new check-in", async () => {
    const job = await checkedIn();
    await sendPosition(job, reading(2));
    // A move sets the check-in aside (src/domain/dispatch/dispatch.ts), the technician and status unchanged.
    await env.DB.batch([
      env.DB.prepare("UPDATE job_events SET superseded = 1 WHERE appointment_id = ?1").bind(JOB),
      env.DB.prepare("UPDATE appointments SET window_start = '2026-09-21T10:30:00.000Z' WHERE id = ?1").bind(JOB),
    ]);
    expect(await kept()).toBeNull();
    expect((await sendPosition(job, reading(4))).status).toBe(409);
  });

  it("is gone once the visit is given to another technician, or called off", async () => {
    const job = await checkedIn();
    await sendPosition(job, reading(2));
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();
    expect(await kept()).toBeNull();

    // Sameer's now, with a position of theirs, until the visit is called off.
    await env.DB.prepare(
      "INSERT INTO visit_positions (appointment_id, technician_id, lat, lng, at, received_at) VALUES (?1, ?2, 28.4, 77, ?3, ?3)",
    )
      .bind(JOB, SAMEER, NOW.toISOString())
      .run();
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(JOB).run();
    expect(await kept()).toBeNull();
  });

  it("is swept twelve hours after it was last heard, should the close never come", async () => {
    const job = await checkedIn();
    await sendPosition(job, reading(2));
    await sweepPositionsStatement(env.DB, new Date(NOW.getTime() + 11 * 60 * 60_000)).run();
    expect(await kept()).not.toBeNull();
    await sweepPositionsStatement(env.DB, new Date(NOW.getTime() + 13 * 60 * 60_000)).run();
    expect(await kept()).toBeNull();
  });
});

describe("an SOS", () => {
  const raise = (job: Working, position: object | null = reading(0)) =>
    job.post("/api/tech/sos", { job_id: JOB, position }, "sos");

  it("pages ops once, urgently, with whose it is and the visit, and no position", async () => {
    const job = await checkedIn();
    const raised = await raise(job);
    expect(raised.status).toBe(201);
    const sos = await raised.json<{ id: string; sent_at: string; safe: boolean }>();
    expect(sos.safe).toBe(false);
    expect(isUrgent(`sos:${sos.id}`)).toBe(true);
    expect(job.deps.alerts).toHaveLength(1);
    expect(job.deps.alerts[0]).toContain(`SOS from Imran Qureshi on visit ${JOB}`);
    // Where they are is on the console's banner alone: the alert log and the logs keep a page longer than the SOS.
    expect(job.deps.alerts[0]).not.toContain("28.39");

    // A second press while it is open is the same SOS, and pages nobody again.
    const again = await (await raise(job, reading(3, 28.5))).json<{ id: string }>();
    expect(again.id).toBe(sos.id);
    expect(job.deps.alerts).toHaveLength(1);
    expect(await (await job.get("/api/tech/sos")).json()).toEqual({
      sos: { id: sos.id, sent_at: sos.sent_at, safe: false },
    });
  });

  it("takes each position the phone sends while it is open, and the console shows it", async () => {
    const job = await checkedIn();
    await raise(job, null);
    await sendPosition(job, reading(2, 28.42));

    const { open } = await (await job.opsGet("/api/sos")).json<{ open: unknown[] }>();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      technician: { name: "Imran Qureshi" },
      visit: { client_name: "Rohit Malhotra" },
      position: { lat: 28.42 },
      safe_at: null,
    });
  });

  it("is said safe by the technician, and ops are told once", async () => {
    const job = await checkedIn();
    const { id } = await (await raise(job)).json<{ id: string }>();
    expect((await job.post(`/api/tech/sos/${id}/safe`, undefined, "safe")).status).toBe(204);
    expect((await job.post(`/api/tech/sos/${id}/safe`, undefined, "safe-2")).status).toBe(204);
    expect(job.deps.alerts.filter((alert) => alert.includes("says they are safe"))).toHaveLength(1);
    expect(await (await job.get("/api/tech/sos")).json()).toMatchObject({ sos: { id, safe: true } });
  });

  it("is raised again after the technician said they are safe, and pages ops again some minutes on", async () => {
    let now = NOW;
    const job = await working("service", { now: () => now });
    await job.post(`/api/tech/jobs/${JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    const { id } = await (await raise(job)).json<{ id: string }>();
    await job.post(`/api/tech/sos/${id}/safe`, undefined, "safe");
    now = new Date(NOW.getTime() + 6 * 60_000);
    const again = await (await raise(job, reading(6))).json<{ id: string; safe: boolean }>();
    expect(again).toMatchObject({ id, safe: false });
    expect(job.deps.alerts.filter((alert) => alert.startsWith("SOS from"))).toHaveLength(2);
  });

  it("pages a raise after a safe ops were told at once, and no more within five minutes", async () => {
    let now = NOW;
    const job = await working("service", { now: () => now });
    await job.post(`/api/tech/jobs/${JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    const { id } = await (await raise(job)).json<{ id: string }>();
    for (const round of [1, 2, 3, 4, 5]) {
      now = new Date(NOW.getTime() + round * 30_000);
      await job.post(`/api/tech/sos/${id}/safe`, undefined, `safe-${String(round)}`);
      now = new Date(now.getTime() + 10_000);
      await raise(job, reading(round));
    }
    // Raised, said safe, raised again: each is paged. The flip-flops after them, inside the five minutes, page nothing.
    expect(job.deps.alerts.filter((alert) => alert.startsWith("SOS from"))).toHaveLength(2);
    expect(job.deps.alerts.filter((alert) => alert.includes("says they are safe"))).toHaveLength(1);
    // Ops' last word is the SOS: its alert stands open, and the safe one is closed.
    const { results } = await env.DB.prepare(
      "SELECT key FROM alerts WHERE key LIKE 'sos%' AND resolved_at IS NULL",
    ).all<{ key: string }>();
    expect(results.map((row) => row.key)).toEqual([`sos:${id}`]);
    expect(await (await job.get("/api/tech/sos")).json()).toMatchObject({ sos: { id, safe: false } });
  });

  it("keeps the last position heard when raised again with none", async () => {
    const job = await checkedIn();
    const { id } = await (await raise(job)).json<{ id: string }>();
    await job.post(`/api/tech/sos/${id}/safe`, undefined, "safe");
    await raise(job, null);
    const { open } = await (await job.opsGet("/api/sos")).json<{ open: unknown[] }>();
    expect(open[0]).toMatchObject({ id, safe_at: null, position: { lat: AT_THE_DOOR.lat } });
  });

  it("is raised again on the visit and with the position it carries, not the first one's", async () => {
    const job = await checkedIn();
    const { id } = await (await raise(job)).json<{ id: string }>();
    await job.post(`/api/tech/sos/${id}/safe`, undefined, "safe");
    await job.post("/api/tech/sos", { job_id: null, position: reading(3, 28.5) }, "sos-again");
    const { open } = await (await job.opsGet("/api/sos")).json<{ open: unknown[] }>();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id, visit: null, position: { lat: 28.5 }, safe_at: null });
  });

  it("takes a closer reading on the open SOS without raising it again", async () => {
    const job = await checkedIn();
    const { id } = await (await raise(job, null)).json<{ id: string }>();
    await job.post(`/api/tech/sos/${id}/safe`, undefined, "safe");
    expect((await job.post(`/api/tech/sos/${id}/position`, reading(1, 28.43), "closer")).status).toBe(204);
    const { open } = await (await job.opsGet("/api/sos")).json<{ open: unknown[] }>();
    expect(open[0]).toMatchObject({ position: { lat: 28.43 }, safe_at: NOW.toISOString() });
    expect(job.deps.alerts.filter((alert) => alert.startsWith("SOS from"))).toHaveLength(1);
  });

  it("names only the visit under way: one of another day, or before its check-in, is no part of it", async () => {
    const job = await working("service");
    const raised = await raise(job);
    expect(raised.status).toBe(201);
    const { open } = await (await job.opsGet("/api/sos")).json<{ open: { visit: unknown }[] }>();
    expect(open[0]?.visit).toBeNull();
    expect(job.deps.alerts[0]).not.toContain(JOB);
  });

  it("keeps no position in the alert log once handled", async () => {
    const job = await checkedIn();
    const { id } = await (await raise(job)).json<{ id: string }>();
    await job.post(`/api/tech/sos/${id}/safe`, undefined, "safe");
    await job.opsPost(`/api/sos/${id}/handled`);
    const { results } = await env.DB.prepare("SELECT message FROM alerts WHERE key LIKE 'sos%'").all<{
      message: string;
    }>();
    expect(results.length).toBeGreaterThan(0);
    expect(results.map((row) => row.message).join(" ")).not.toContain("28.39");
  });

  it("is marked handled by ops: who and when stay, where the technician was goes", async () => {
    const job = await checkedIn();
    const { id } = await (await raise(job)).json<{ id: string }>();
    expect((await job.opsPost(`/api/sos/${id}/handled`)).status).toBe(204);

    expect(await (await job.opsGet("/api/sos")).json()).toEqual({ open: [] });
    expect(await (await job.get("/api/tech/sos")).json()).toEqual({ sos: null });
    const row = await env.DB.prepare("SELECT lat, lng, handled_at, handled_by FROM sos_alerts WHERE id = ?1")
      .bind(id)
      .first();
    expect(row).toMatchObject({ lat: null, lng: null, handled_at: NOW.toISOString() });
    expect(row?.handled_by).not.toBeNull();
    expect((await job.opsPost(`/api/sos/${id}/handled`)).status).toBe(404);
  });
});
