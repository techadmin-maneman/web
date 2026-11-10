// A client's record for the technicians (docs/decisions/0242-client-record.md): the alerts and the note left at a close,
// kept on the client, never in the event, once however often the phone sends the close; the job card's alerts and
// handoff; and the client's history with its photographs, for the technician's own job alone. NOW is Monday 21
// September 2026, 12 noon in India; today's job is at 13:00. Every name here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { captureLogs, markDatabase, NOW } from "../helpers.ts";
import { MINUTE_MS } from "../../../src/lib/durations.ts";
import { IMRAN, JOB, PERSON, SAMEER, working, type Working } from "../job-fixtures.ts";
import { aPerson, aVisit } from "../fixtures/index.ts";

const EARLIER = "22222222-2222-4222-8222-222222222299";
const OLDER = "22222222-2222-4222-8222-222222222298";
const LATER = "22222222-2222-4222-8222-222222222297";
const OPEN = "22222222-2222-4222-8222-222222222296";
const PHOTO = "44444444-4444-4444-8444-444444444441";

beforeEach(async () => {
  captureLogs();
  await markDatabase();
});

/** Rohit's service visit on 1 September, done by Imran, with a note for the next, its after photographs and a piece. */
async function anEarlierVisit(): Promise<void> {
  const at = "2026-09-01T05:00:00.000Z";
  await aVisit({
    id: EARLIER,
    person_id: PERSON,
    status: "completed",
    window_start: at,
    technician_id: IMRAN,
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO handoff_notes (appointment_id, person_id, technician_id, body, written_at)
       VALUES (?1, ?2, ?3, 'Edge lifting at the left temple.', ?4)`,
    ).bind(EARLIER, PERSON, IMRAN, at),
    env.DB.prepare(
      "INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES ('set-1', ?1, 'after', ?2)",
    ).bind(EARLIER, at),
    env.DB.prepare(
      `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, taken_at, created_at)
       VALUES (?1, 'set-1', 'front', 'after/front.jpg', 'image/jpeg', 3, ?2, ?2)`,
    ).bind(PHOTO, at),
  ]);
  await env.CLIENT_PHOTOS.put("after/front.jpg", new Uint8Array([1, 2, 3]));
}

const outcome = (job: Working, body: object, event = "event-outcome-01") =>
  job.post(`/api/tech/jobs/${JOB}/outcome`, body, event);

describe("what a close leaves on the client's record", () => {
  it("keeps the note for the next technician and an alert, once, in their own tables and not in the event", async () => {
    const job = await working("service");
    await job.workTo("outcome");
    const close = { outcome: "done", handoff_note: "Use the softer tape.", client_alert: "Allergic to latex." };
    expect((await outcome(job, close)).status).toBe(202);
    expect((await outcome(job, close)).status).toBe(202);

    expect(await env.DB.prepare("SELECT body, technician_id FROM handoff_notes").all()).toMatchObject({
      results: [{ body: "Use the softer tape.", technician_id: IMRAN }],
    });
    expect(await env.DB.prepare("SELECT body, appointment_id FROM client_alerts").all()).toMatchObject({
      results: [{ body: "Allergic to latex.", appointment_id: JOB }],
    });
    const event = await env.DB.prepare("SELECT body FROM job_events WHERE kind = 'outcome'").first<{ body: string }>();
    expect(event?.body).not.toContain("tape");
    expect(event?.body).not.toContain("latex");
  });

  it("leaves nothing from another step's event ID sent to the close", async () => {
    const job = await working("service");
    await job.workTo("outcome");
    const answer = await outcome(job, { outcome: "done", client_alert: "Late." }, "event-checkin-01");
    expect(answer.status).toBe(202);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM client_alerts").first()).toEqual({ n: 0 });
  });

  it("keeps the close sent again within the hour after it, and nothing it brings past the hour", async () => {
    let now = NOW;
    const job = await working("service", { now: () => now });
    await job.workTo("outcome");
    expect((await outcome(job, { outcome: "done" })).status).toBe(202);

    now = new Date(NOW.getTime() + 10 * MINUTE_MS);
    expect((await outcome(job, { outcome: "done", handoff_note: "Use the softer tape." })).status).toBe(202);
    now = new Date(NOW.getTime() + 61 * MINUTE_MS);
    expect((await outcome(job, { outcome: "done", client_alert: "Late." })).status).toBe(202);

    expect(await env.DB.prepare("SELECT body FROM handoff_notes").all()).toMatchObject({
      results: [{ body: "Use the softer tape." }],
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM client_alerts").first()).toEqual({ n: 0 });
  });

  it("refuses a note past its length", async () => {
    const job = await working("service");
    await job.workTo("outcome");
    const answer = await outcome(job, { outcome: "done", handoff_note: "x".repeat(501) });
    expect(answer.status).toBe(400);
  });
});

describe("the job card", () => {
  it("carries the client's alerts and the note left at their visit before, whoever left it, with its photographs", async () => {
    const job = await working("service");
    await anEarlierVisit();
    await env.DB.prepare(
      "INSERT INTO client_alerts (id, person_id, body, staff, written_at) VALUES ('al-1', ?1, 'Allergic to latex.', 'ops@maneman.in', ?2)",
    )
      .bind(PERSON, "2026-09-02T05:00:00.000Z")
      .run();
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json<Record<string, unknown>>();
    expect(card).toMatchObject({
      client_alerts: [{ body: "Allergic to latex.", raised_by: { kind: "staff" } }],
      handoff: {
        note: "Edge lifting at the left temple.",
        technician: "Imran",
        visit_id: EARLIER,
        date: "2026-09-01",
        photos: [{ angle: "front", url: `/api/tech/jobs/${JOB}/history-photos/${PHOTO}` }],
      },
    });
  });
});

describe("the handoff on the card", () => {
  it("is the latest note left at an earlier visit, whoever left it", async () => {
    const job = await working("service");
    await anEarlierVisit();
    await aVisit({ id: OLDER, person_id: PERSON, status: "completed", window_start: "2026-08-01T05:00:00.000Z" });
    await env.DB.batch([
      env.DB.prepare("UPDATE handoff_notes SET technician_id = ?1").bind(SAMEER),
      env.DB.prepare(
        `INSERT INTO handoff_notes (appointment_id, person_id, technician_id, body, written_at)
         VALUES (?1, ?2, ?3, 'An older note.', '2026-08-01T05:00:00.000Z')`,
      ).bind(OLDER, PERSON, IMRAN),
    ]);
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json<Record<string, unknown>>();
    expect(card).toMatchObject({ handoff: { note: "Edge lifting at the left temple.", technician: "Sameer" } });
  });
});

describe("the client's history", () => {
  it("is each visit closed before the job, newest first, with its note, photographs, and result", async () => {
    const job = await working("service");
    await anEarlierVisit();
    const answer = await job.get(`/api/tech/jobs/${JOB}/client-history`);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({
      alerts: [],
      visits: [
        {
          id: EARLIER,
          date: "2026-09-01",
          type: "service",
          technician: "Imran",
          note: "Edge lifting at the left temple.",
          photos: [{ angle: "front", url: `/api/tech/jobs/${JOB}/history-photos/${PHOTO}` }],
          consumables: [],
          piece: null,
        },
      ],
    });
    const photo = await job.get(`/api/tech/jobs/${JOB}/history-photos/${PHOTO}`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("is not found for a job ops gave to another technician, nor its photographs", async () => {
    const job = await working("service");
    await anEarlierVisit();
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();
    expect((await job.get(`/api/tech/jobs/${JOB}/client-history`)).status).toBe(404);
    expect((await job.get(`/api/tech/jobs/${JOB}/history-photos/${PHOTO}`)).status).toBe(404);
  });

  it("serves no photograph of another client's visit through this job", async () => {
    const job = await working("service");
    await anEarlierVisit();
    await aPerson({ id: "p-other" });
    await env.DB.prepare("UPDATE appointments SET person_id = 'p-other' WHERE id = ?1").bind(EARLIER).run();
    expect((await job.get(`/api/tech/jobs/${JOB}/history-photos/${PHOTO}`)).status).toBe(404);
  });

  it("leaves out the job's own visit, a later one and one not closed, and lists the rest newest first", async () => {
    const job = await working("service");
    await anEarlierVisit();
    await aVisit({ id: OLDER, person_id: PERSON, status: "completed", window_start: "2026-08-01T05:00:00.000Z" });
    await aVisit({ id: LATER, person_id: PERSON, status: "completed", window_start: "2026-09-25T05:00:00.000Z" });
    await aVisit({ id: OPEN, person_id: PERSON, status: "scheduled", window_start: "2026-09-10T05:00:00.000Z" });
    const { visits } = await (
      await job.get(`/api/tech/jobs/${JOB}/client-history`)
    ).json<{ visits: { id: string }[] }>();
    expect(visits.map((visit) => visit.id)).toEqual([EARLIER, OLDER]);
  });

  it("gives a closed visit's result and what its last consumables step used, not every step sent", async () => {
    const job = await working("service");
    await job.workTo("consumables");
    const used = (quantity: number, event: string) =>
      job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [{ name: "Walker tape", quantity }] }, event);
    expect((await used(2, "event-consumables-01")).status).toBe(202);
    expect((await used(3, "event-consumables-02")).status).toBe(202);
    await job.post(`/api/tech/jobs/${JOB}/photos`, { phase: "after" }, "event-afterphotos-01");
    expect((await outcome(job, { outcome: "done" })).status).toBe(202);
    // The day's next job of the client's, Imran's too, reads the closed one as history.
    await env.DB.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?1").bind(JOB).run();
    await aVisit({ id: LATER, person_id: PERSON, window_start: "2026-09-21T10:30:00.000Z", technician_id: IMRAN });

    const answer = await job.get(`/api/tech/jobs/${LATER}/client-history`);
    expect(await answer.json()).toMatchObject({
      visits: [{ id: JOB, result: "done", consumables: [{ name: "Walker tape", quantity: 3 }] }],
    });
  });

  it("gives the piece its last piece step fitted, not the one it named before", async () => {
    const job = await working("replacement");
    await job.workTo("piece");
    const piece = (code: string, event: string) => job.post(`/api/tech/jobs/${JOB}/piece`, { piece_code: code }, event);
    expect((await piece("MM-STD-5520-A", "event-piece-01")).status).toBe(202);
    expect((await piece("MM-STD-5521-A", "event-piece-02")).status).toBe(202);
    await env.DB.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?1").bind(JOB).run();
    await aVisit({ id: LATER, person_id: PERSON, window_start: "2026-09-21T10:30:00.000Z", technician_id: IMRAN });

    const answer = await job.get(`/api/tech/jobs/${LATER}/client-history`);
    expect(await answer.json()).toMatchObject({ visits: [{ id: JOB, piece: "MM-STD-5521-A" }] });
  });

  it("serves no photograph of a visit after the job's", async () => {
    const job = await working("service");
    await anEarlierVisit();
    await env.DB.prepare("UPDATE appointments SET window_start = '2026-09-25T05:00:00.000Z' WHERE id = ?1")
      .bind(EARLIER)
      .run();
    expect((await job.get(`/api/tech/jobs/${JOB}/history-photos/${PHOTO}`)).status).toBe(404);
  });

  it("is not found for a job still locked, nor its photographs", async () => {
    const job = await working("service");
    await anEarlierVisit();
    // Tomorrow's job opens at 6 pm today; it is noon.
    await env.DB.prepare(
      "UPDATE appointments SET window_start = '2026-09-22T07:30:00.000Z', window_end = '2026-09-22T09:00:00.000Z' WHERE id = ?1",
    )
      .bind(JOB)
      .run();
    expect((await job.get(`/api/tech/jobs/${JOB}/client-history`)).status).toBe(404);
    expect((await job.get(`/api/tech/jobs/${JOB}/history-photos/${PHOTO}`)).status).toBe(404);
  });
});
