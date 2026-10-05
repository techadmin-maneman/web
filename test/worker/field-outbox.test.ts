// A phone's writes sent late: the time it claims for them, and its outbox replayed once.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and photograph here is made up.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { NOW, request } from "./helpers.ts";
import {
  AS_THE_BOARD_SHOWS_IT,
  AT_THE_DOOR,
  beforePhotos,
  bindings,
  minutesAfterStart,
  ops,
  opsPost,
  post,
  postAt,
  SAMEER,
  startJob,
  TODAY_JOB,
  TODAY_START,
  useFieldDay,
  uuidv7At,
} from "./field-fixtures.ts";

useFieldDay();

// A check-in's time is the evidence a no-show is charged on, and the phone's
// clock is the technician's to set (docs/decisions/0065-a-technicians-writes-reach-fsm.md).
describe("the phone's clock", () => {
  it("keeps a back-dated check-in's claim, bounds it, and runs the no-show wait on our clock too", async () => {
    // Ten minutes after the booked start, the phone says he arrived three hours ago.
    const received = minutesAfterStart(10);
    const claimed = minutesAfterStart(-180);
    const answer = await postAt(
      received,
      `/api/tech/jobs/${TODAY_JOB}/checkin`,
      { ...AT_THE_DOOR, at: claimed.toISOString() },
      "event-checkin-01",
    );
    const body = await answer.json<{ checked_in_at: string; wait_ends_at: string }>();

    // No earlier than an hour before the booked start; the wait ends fifteen minutes after we heard.
    expect(body.checked_in_at).toBe(minutesAfterStart(-60).toISOString());
    expect(body.wait_ends_at).toBe(minutesAfterStart(25).toISOString());

    const early = await postAt(minutesAfterStart(11), `/api/tech/jobs/${TODAY_JOB}/no-show`, undefined, "event-ns-01");
    expect(early.status).toBe(425);
    const closed = await postAt(minutesAfterStart(25), `/api/tech/jobs/${TODAY_JOB}/no-show`, undefined, "event-ns-01");
    expect(closed.status).toBe(200);

    const { cases } = await (
      await request(ops, "/api/no-shows", {}, bindings())
    ).json<{
      cases: Record<string, unknown>[];
    }>();
    expect(cases[0]).toMatchObject({
      checked_in_at: minutesAfterStart(-60).toISOString(),
      phone_checked_in_at: claimed.toISOString(),
      received_at: received.toISOString(),
      window_start: TODAY_START.toISOString(),
      window_end: minutesAfterStart(90).toISOString(),
      minutes_late: -60,
      wait_ends_at: minutesAfterStart(25).toISOString(),
    });
  });

  // Only the check-in kept what the phone said; a start held over a day kept no phone time at all.
  it("keeps on every step what the phone said beside the time it was held to", async () => {
    await postAt(minutesAfterStart(10), `/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, uuidv7At(-90));
    // Queued an hour and a half before the booked start, by its event ID, and sent ten minutes after it.
    await postAt(minutesAfterStart(10), `/api/tech/jobs/${TODAY_JOB}/start`, undefined, uuidv7At(-90));
    const { results } = await env.DB.prepare(
      "SELECT kind, occurred_at, claimed_at FROM job_events WHERE appointment_id = ?1 ORDER BY rowid",
    )
      .bind(TODAY_JOB)
      .all();

    expect(results).toEqual([
      {
        kind: "check_in",
        occurred_at: minutesAfterStart(-60).toISOString(),
        claimed_at: minutesAfterStart(-90).toISOString(),
      },
      {
        kind: "start",
        occurred_at: minutesAfterStart(-60).toISOString(),
        claimed_at: minutesAfterStart(-90).toISOString(),
      },
    ]);
  });

  // The owner kept the hour on 27 September 2026, as a console setting (docs/decisions/0088-every-policy-in-the-console.md).
  it("bounds a back-dated check-in to the margin ops set", async () => {
    await env.DB.prepare(
      `INSERT INTO ops_settings (name, value, set_by, set_at)
       VALUES ('phone_clock', '{"before_start": 30, "held_offline": 24}', 'ops', ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    const answer = await postAt(
      minutesAfterStart(10),
      `/api/tech/jobs/${TODAY_JOB}/checkin`,
      { ...AT_THE_DOOR, at: minutesAfterStart(-180).toISOString() },
      "event-checkin-01",
    );
    expect((await answer.json<{ checked_in_at: string }>()).checked_in_at).toBe(minutesAfterStart(-30).toISOString());
  });
});

describe("the outbox", () => {
  it("lands a replayed event once", async () => {
    await startJob();
    await beforePhotos();
    const body = { done: ["piece_removed", "scalp_cleaned"] };

    const first = await post(`/api/tech/jobs/${TODAY_JOB}/checklist`, body, "event-checklist-01");
    const again = await post(`/api/tech/jobs/${TODAY_JOB}/checklist`, body, "event-checklist-01");

    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ event_id: "event-checklist-01", replayed: false });
    expect(again.status).toBe(202);
    expect(await again.json()).toMatchObject({ event_id: "event-checklist-01", replayed: true });

    const landed = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM job_events WHERE appointment_id = ?1 AND event_id = 'event-checklist-01'",
    )
      .bind(TODAY_JOB)
      .first<{ n: number }>();
    expect(landed?.n).toBe(1);
  });

  it("refuses a step sent before the one ahead of it", async () => {
    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/outcome`, { outcome: "done" }, "event-early-01");

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "out_of_order", fields: ["start"] } });
  });

  it("rejects a write as superseded once ops have reassigned the job", async () => {
    await startJob();
    await beforePhotos();
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(TODAY_JOB, SAMEER).run();

    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checklist`, { done: [] }, "event-late-01");

    expect(answer.status).toBe(409);
    // Moved straight in the database, so nothing of ours says when.
    expect(await answer.json()).toMatchObject({
      error: { code: "superseded", fields: ["technician"], moved: { technician: "Sameer", at: null } },
    });
    const row = await env.DB.prepare(
      "SELECT superseded, fsm_write_state FROM job_events WHERE event_id = 'event-late-01'",
    ).first<{ superseded: number; fsm_write_state: string }>();
    expect(row).toEqual({ superseded: 1, fsm_write_state: "rejected" });
  });

  // Open point 92, ruled by the owner on 27 September 2026: "the other technician's first name may reach the phone.
  // Name the technician the job went to, and when."
  it("names the technician ops gave the job to, by first name alone, and when they moved it", async () => {
    const moved = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      reason: "technician_unavailable",
    });
    expect(moved.status).toBe(200);

    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    expect(answer.status).toBe(409);
    const { error } = await answer.json<{ error: Record<string, unknown> }>();
    // Nothing else of Sameer's: not his whole name, his number or his zone.
    expect(error).toEqual({
      code: "superseded",
      request_id: expect.any(String) as string,
      fields: ["technician"],
      moved: { technician: "Sameer", at: NOW.toISOString() },
    });
  });

  it("names nobody for a job that was cancelled, whoever it was left with", async () => {
    await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      reason: "technician_unavailable",
    });
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(TODAY_JOB).run();

    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    expect(answer.status).toBe(409);
    const { error } = await answer.json<{ error: Record<string, unknown> }>();
    expect(error).toMatchObject({ code: "superseded", fields: ["status", "technician"] });
    expect(error).not.toHaveProperty("moved");
  });

  it("rejects a write as superseded once ops have moved the job to another time", async () => {
    const heldStart = TODAY_START.toISOString();
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    // Ops move it to 16:00 while the phone is offline, still holding 13:00.
    await env.DB.prepare("UPDATE appointments SET window_start = ?2 WHERE id = ?1")
      .bind(TODAY_JOB, minutesAfterStart(180).toISOString())
      .run();

    const answer = await postAt(NOW, `/api/tech/jobs/${TODAY_JOB}/start`, undefined, "event-start-01", {
      "X-Job-Starts-At": heldStart,
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "superseded", fields: ["time"] } });
  });

  it("refuses a check-in on a job moved to another day, even from a phone that does not say what it held", async () => {
    await env.DB.prepare("UPDATE appointments SET window_start = '2026-09-22T07:30:00.000Z' WHERE id = ?1")
      .bind(TODAY_JOB)
      .run();

    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "not_today" } });
  });
});
