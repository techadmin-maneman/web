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

  it("pages ops once, urgently, with whose it is, the visit and a map", async () => {
    const job = await checkedIn();
    const raised = await raise(job);
    expect(raised.status).toBe(201);
    const sos = await raised.json<{ id: string; sent_at: string; safe: boolean }>();
    expect(sos.safe).toBe(false);
    expect(isUrgent(`sos:${sos.id}`)).toBe(true);
    expect(job.deps.alerts).toHaveLength(1);
    expect(job.deps.alerts[0]).toContain(`SOS from Imran Qureshi on visit ${JOB}`);
    expect(job.deps.alerts[0]).toContain("https://www.google.com/maps?q=28.3988,77.07");

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
      visit: { id: JOB, client_name: "Rohit Malhotra" },
      position: { lat: 28.42 },
      safe_at: null,
    });
  });

  it("is said safe by the technician, and ops are told", async () => {
    const job = await checkedIn();
    const { id } = await (await raise(job)).json<{ id: string }>();
    expect((await job.post(`/api/tech/sos/${id}/safe`, undefined, "safe")).status).toBe(204);
    expect(job.deps.alerts.at(-1)).toContain("Imran Qureshi says they are safe");
    expect(await (await job.get("/api/tech/sos")).json()).toMatchObject({ sos: { id, safe: true } });
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
