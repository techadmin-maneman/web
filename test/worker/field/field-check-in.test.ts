// Checking in at the door: the fence, the WhatsApp the client is sent on arrival, and the guards a check-in passes.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and photograph here is made up.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { openTechnicianSession } from "../../../src/domain/technicians.ts";
import { NOW, request } from "../helpers.ts";
import {
  AS_THE_BOARD_SHOWS_IT,
  AT_THE_DOOR,
  bindings,
  DOWN_THE_ROAD,
  get,
  IMRAN,
  insertJob,
  LATER_JOB,
  messageQueue,
  minutesAfterStart,
  opsPost,
  OTHER_JOB,
  post,
  postAt,
  SAMEER,
  tech,
  TODAY_JOB,
  TODAY_START,
  useFieldDay,
} from "./field-fixtures.ts";

useFieldDay();

describe("checking in", () => {
  it("fails outside the radius, records the distance it measured, and starts no wait", async () => {
    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, DOWN_THE_ROAD, "event-far-01");
    const body = await answer.json<{ passed: boolean; distance_m: number; radius_m: number; wait_ends_at: null }>();

    expect(answer.status).toBe(200);
    expect(body.passed).toBe(false);
    expect(body.distance_m).toBeGreaterThan(2000);
    expect(body.radius_m).toBe(200);
    expect(body.wait_ends_at).toBeNull();

    // The row is written either way, so the radius can be tuned from real data.
    const row = await env.DB.prepare("SELECT passed, distance_m, radius_m FROM checkins WHERE appointment_id = ?1")
      .bind(TODAY_JOB)
      .first<{ passed: number; distance_m: number; radius_m: number }>();
    expect(row).toMatchObject({ passed: 0, radius_m: 200 });
    expect(row?.distance_m).toBeGreaterThan(2000);
    // Nothing landed, so the job cannot be started.
    expect((await post(`/api/tech/jobs/${TODAY_JOB}/start`, undefined, "event-start-01")).status).toBe(409);
  });

  // A building pin far from its door blocked the whole job, and ops had no lever but the radius for everyone.
  it("passes outside the radius once ops let him in, keeping the distance and naming who let him", async () => {
    const refused = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, DOWN_THE_ROAD, "event-far-01");
    expect((await refused.json<{ passed: boolean }>()).passed).toBe(false);

    const noReason = await opsPost(`/api/visits/${TODAY_JOB}/let-in`, { reason: "  " });
    expect(noReason.status).toBe(400);
    const letIn = await opsPost(`/api/visits/${TODAY_JOB}/let-in`, { reason: "The pin is at the society gate" });
    expect(letIn.status).toBe(200);

    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, DOWN_THE_ROAD, "event-far-02");
    const body = await answer.json<{ passed: boolean; distance_m: number }>();
    expect(body.passed).toBe(true);
    expect(body.distance_m).toBeGreaterThan(2000);
    const rows = await env.DB.prepare(
      "SELECT passed, waived_by FROM checkins WHERE appointment_id = ?1 ORDER BY created_at, passed",
    )
      .bind(TODAY_JOB)
      .all();
    expect(rows.results).toEqual([
      { passed: 0, waived_by: null },
      { passed: 1, waived_by: expect.any(String) as string },
    ]);
    expect((await opsPost(`/api/visits/${TODAY_JOB}/let-in`, { reason: "Again" })).status).toBe(409);
    const audited = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'visit.checkin_waive'",
    ).first();
    expect(audited).toEqual({ n: 1 });
  });

  it("passes inside it, and opens the no-show wait", async () => {
    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-near-01");
    const body = await answer.json<{ passed: boolean; distance_m: number; wait_ends_at: string }>();

    expect(body.passed).toBe(true);
    expect(body.distance_m).toBeLessThan(200);
    // An hour early, so fifteen minutes from the booked start.
    expect(body.wait_ends_at).toBe(minutesAfterStart(15).toISOString());
  });

  it("waits fifteen minutes from a check-in after the booked start", async () => {
    const late = await postAt(
      minutesAfterStart(20),
      `/api/tech/jobs/${TODAY_JOB}/checkin`,
      AT_THE_DOOR,
      "event-late-01",
    );
    expect((await late.json<{ wait_ends_at: string }>()).wait_ends_at).toBe(minutesAfterStart(35).toISOString());
  });

  // The audit's gate: a 4 pm visit was checked in at 11:06 and could be closed as a no-show at 11:11.
  it("refuses a check-in before the earliest check-in, says when it opens, and lands nothing", async () => {
    await insertJob(OTHER_JOB, { start: "2026-09-21T10:30:00.000Z" });
    const fourPmLessAnHour = "2026-09-21T09:30:00.000Z";

    const answer = await post(`/api/tech/jobs/${OTHER_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({
      error: { code: "too_early_to_arrive", earliest_at: fourPmLessAnHour },
    });

    const landed = await env.DB.prepare("SELECT COUNT(*) AS n FROM job_events WHERE appointment_id = ?1")
      .bind(OTHER_JOB)
      .first<{ n: number }>();
    expect(landed?.n).toBe(0);
    // Refused before it is measured: no distance is kept.
    const measured = await env.DB.prepare("SELECT COUNT(*) AS n FROM checkins WHERE appointment_id = ?1")
      .bind(OTHER_JOB)
      .first<{ n: number }>();
    expect(measured?.n).toBe(0);
    const told = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM outbound_messages WHERE kind = 'arrival_notice'",
    ).first<{ n: number }>();
    expect(told?.n).toBe(0);
    // Five minutes on, the job cannot close as a no-show, and no case opens.
    const fiveMinutesOn = new Date(NOW.getTime() + 5 * 60_000);
    const closed = await postAt(fiveMinutesOn, `/api/tech/jobs/${OTHER_JOB}/no-show`, undefined, "event-ns-01");
    expect(closed.status).not.toBe(200);
    const cases = await env.DB.prepare("SELECT COUNT(*) AS n FROM no_show_cases").first<{ n: number }>();
    expect(cases?.n).toBe(0);

    // The card says when check-in opens, and it lands from then.
    const card = await (await get(`/api/tech/jobs/${OTHER_JOB}`)).json<{ checkin_from: string }>();
    expect(card.checkin_from).toBe(fourPmLessAnHour);
    const opens = new Date(fourPmLessAnHour);
    const inTime = await postAt(opens, `/api/tech/jobs/${OTHER_JOB}/checkin`, AT_THE_DOOR, "event-checkin-02");
    expect(inTime.status).toBe(200);
  });

  it("refuses a check-in before the earliest check-in ops set", async () => {
    await env.DB.prepare(
      `INSERT INTO ops_settings (name, value, set_by, set_at)
       VALUES ('phone_clock', '{"before_start": 30, "held_offline": 24}', 'ops', ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    expect(await answer.json()).toMatchObject({
      error: { code: "too_early_to_arrive", earliest_at: minutesAfterStart(-30).toISOString() },
    });
  });

  it("gives the card the wait and the distance, so a phone that lost its copy can still close a no-show", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    const job = await (
      await get(`/api/tech/jobs/${TODAY_JOB}`)
    ).json<{
      progress: { wait_ends_at: string | null; distance_m: number | null };
    }>();
    expect(job.progress.wait_ends_at).toBe(minutesAfterStart(15).toISOString());
    expect(job.progress.distance_m).toBeLessThan(200);
  });

  it("refuses a check-in on a day other than the job's own", async () => {
    const answer = await post(`/api/tech/jobs/${LATER_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "not_today" } });
    const landed = await env.DB.prepare("SELECT COUNT(*) AS n FROM job_events WHERE appointment_id = ?1")
      .bind(LATER_JOB)
      .first<{ n: number }>();
    expect(landed?.n).toBe(0);
  });
});

// ADR 0047 promised the arrival WhatsApp, and the no-show evidence reads its receipt; nothing ever wrote one, so the
// only evidence was the day-before reminder. The consumer sends it only with the client's consent to
// WhatsApp about visits, and records why when it does not.
describe("the arrival WhatsApp", () => {
  const arrivals = () =>
    env.DB.prepare(
      "SELECT id, subject_id, state, last_error FROM outbound_messages WHERE kind = 'arrival_notice' ORDER BY rowid",
    ).all<{ id: string; subject_id: string; state: string; last_error: string | null }>();

  it("is queued once, at the first check-in that passes", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, DOWN_THE_ROAD, "event-far-01");
    expect((await arrivals()).results).toEqual([]);

    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-near-01");
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-near-02");

    const { results } = await arrivals();
    expect(results).toEqual([
      { id: expect.any(String) as string, subject_id: TODAY_JOB, state: "queued", last_error: null },
    ]);
    expect(messageQueue.sent).toEqual([{ message_id: results[0]?.id, request_id: expect.any(String) as string }]);
  });

  it("is recorded as not sent when the check-in reaches us too late to tell the client anything", async () => {
    // Checked in at the booked start with no signal, and heard of forty minutes on.
    await postAt(
      minutesAfterStart(40),
      `/api/tech/jobs/${TODAY_JOB}/checkin`,
      { ...AT_THE_DOOR, at: TODAY_START.toISOString() },
      "event-checkin-01",
    );

    expect((await arrivals()).results).toEqual([
      {
        id: expect.any(String) as string,
        subject_id: TODAY_JOB,
        state: "skipped",
        last_error: "the check-in reached us too late to tell the client",
      },
    ]);
    expect(messageQueue.sent).toEqual([]);
  });

  it("is the message a no-show case reads the receipt of", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    const arrival = (await arrivals()).results[0]?.id;

    // Sixteen minutes after the booked start the wait has run.
    const closed = await postAt(minutesAfterStart(16), `/api/tech/jobs/${TODAY_JOB}/no-show`, undefined, "event-ns-01");
    expect(closed.status).toBe(200);

    const opened = await env.DB.prepare("SELECT message_id FROM no_show_cases").first<{ message_id: string }>();
    expect(opened?.message_id).toBe(arrival);
  });
});

// A check-in is measured and recorded only once it may land: the job is his, today's, and as his phone holds it. The
// no-show's wait runs from the job's own technician's check-in, and a check-in sent again is answered as it landed.
describe("a check-in, guarded before it is measured", () => {
  const CHECK_IN = `/api/tech/jobs/${TODAY_JOB}/checkin`;
  const NO_SHOW = `/api/tech/jobs/${TODAY_JOB}/no-show`;
  const WAIT_RUN = new Date(NOW.getTime() + 16 * 60_000);

  const checkIns = async () =>
    (await env.DB.prepare("SELECT technician_id, passed, job_event_id FROM checkins ORDER BY rowid").all()).results;

  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;
  const arrivalNotices = () => count("SELECT COUNT(*) AS n FROM outbound_messages WHERE kind = 'arrival_notice'");
  const cases = () => count("SELECT COUNT(*) AS n FROM no_show_cases");

  /** Sameer's phone, signed in, as the Cookie header of a write. */
  async function sameer(): Promise<{ Cookie: string }> {
    const session = await openTechnicianSession(env.DB, {
      technicianId: SAMEER,
      deviceId: "phone-def-456",
      label: "Chrome on Android",
      now: NOW,
    });
    return { Cookie: `mm_tech=${session}` };
  }

  const giveToSameer = () =>
    opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      reason: "technician_unavailable",
    });

  it("is not found on a job that was never his, and measures and records nothing", async () => {
    const asSameer = await sameer();

    const probe = await postAt(NOW, CHECK_IN, DOWN_THE_ROAD, "event-probe-01", asSameer);
    expect(probe.status).toBe(404);
    expect(await probe.json()).not.toHaveProperty("distance_m");
    expect((await postAt(WAIT_RUN, NO_SHOW, undefined, "event-probe-02", asSameer)).status).toBe(404);

    expect(await checkIns()).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM job_events")).toBe(0);
  });

  it("measures nothing on a job ops moved off him, however often he tries", async () => {
    expect((await giveToSameer()).status).toBe(200);

    for (const [position, eventId] of [
      [DOWN_THE_ROAD, "event-probe-01"],
      [AT_THE_DOOR, "event-probe-02"],
      [{ lat: 28.41, lng: 77.05 }, "event-probe-03"],
    ] as const) {
      const answer = await post(CHECK_IN, position, eventId);
      expect(answer.status).toBe(409);
      const body = await answer.json<Record<string, unknown>>();
      expect(body).toMatchObject({ error: { code: "superseded", fields: ["technician"] } });
      expect(JSON.stringify(body)).not.toContain("distance");
    }
    expect(await checkIns()).toEqual([]);
  });

  it("measures nothing on his own job before its day", async () => {
    const answer = await post(`/api/tech/jobs/${LATER_JOB}/checkin`, DOWN_THE_ROAD, "event-probe-01");

    expect(answer.status).toBe(409);
    expect(JSON.stringify(await answer.json())).not.toContain("distance");
    expect(await checkIns()).toEqual([]);
  });

  it("refuses a superseded check-in sent again just as the first time, and tells the client nothing", async () => {
    await giveToSameer();

    const first = await post(CHECK_IN, AT_THE_DOOR, "event-checkin-01");
    const again = await post(CHECK_IN, AT_THE_DOOR, "event-checkin-01");

    for (const answer of [first, again]) {
      expect(answer.status).toBe(409);
      expect(await answer.json()).toMatchObject({
        error: { code: "superseded", fields: ["technician"], moved: { technician: "Sameer", at: NOW.toISOString() } },
      });
    }
    expect(await checkIns()).toEqual([]);
    expect(await arrivalNotices()).toBe(0);
    expect(messageQueue.sent).toEqual([]);
  });

  it("answers a check-in sent again after a lost answer as it landed: one row, the same wait, one notice", async () => {
    const first = await (await post(CHECK_IN, AT_THE_DOOR, "event-checkin-01")).json<Record<string, unknown>>();
    const later = new Date(NOW.getTime() + 10 * 60_000);
    const again = await postAt(later, CHECK_IN, AT_THE_DOOR, "event-checkin-01");

    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({
      passed: true,
      distance_m: first.distance_m,
      radius_m: 200,
      checked_in_at: first.checked_in_at,
      wait_ends_at: first.wait_ends_at,
      accepted: { event_id: "event-checkin-01", replayed: true },
    });
    const rows = await checkIns();
    expect(rows).toEqual([{ technician_id: IMRAN, passed: 1, job_event_id: expect.any(String) as string }]);
    expect(await arrivalNotices()).toBe(1);
    expect(messageQueue.sent).toHaveLength(1);
    const card = await (await get(`/api/tech/jobs/${TODAY_JOB}`)).json<{ progress: { wait_ends_at: string } }>();
    expect(card.progress.wait_ends_at).toBe(first.wait_ends_at);
  });

  it("is not the check-in of the technician given the job after it, who must arrive himself", async () => {
    await post(CHECK_IN, AT_THE_DOOR, "event-checkin-01");
    // Moved straight in the database, which supersedes nothing of ours.
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(TODAY_JOB, SAMEER).run();
    const asSameer = await sameer();

    const card = await request(tech, `/api/tech/jobs/${TODAY_JOB}`, { headers: asSameer }, bindings());
    expect(await card.json()).toMatchObject({ progress: { checked_in_at: null, wait_ends_at: null } });
    const closed = await postAt(WAIT_RUN, NO_SHOW, undefined, "event-noshow-01", asSameer);
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ error: { code: "out_of_order" } });
    expect(await cases()).toBe(0);

    const arrived = await postAt(WAIT_RUN, CHECK_IN, AT_THE_DOOR, "event-checkin-02", asSameer);
    expect(await arrived.json()).toMatchObject({
      passed: true,
      accepted: { progress: { checked_in_at: WAIT_RUN.toISOString() } },
    });
  });

  it("does not close a no-show on a check-in ops cleared to move the job later that day", async () => {
    await post(CHECK_IN, AT_THE_DOOR, "event-checkin-01");
    const moved = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      date: "2026-09-21",
      window: "evening",
      reason: "running_over",
      clear_check_in: true,
    });
    expect(moved.status).toBe(200);

    const closed = await postAt(WAIT_RUN, NO_SHOW, undefined, "event-noshow-01");
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ error: { code: "out_of_order" } });
    expect(await cases()).toBe(0);
    const card = await (await get(`/api/tech/jobs/${TODAY_JOB}`)).json<{ progress: { checked_in_at: null } }>();
    expect(card.progress.checked_in_at).toBeNull();
  });
});
