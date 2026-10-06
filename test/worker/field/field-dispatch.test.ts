// Dispatch: moving a job, once the technician has begun, and leave over booked jobs.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and photograph here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "../../../apps/tech/src/store/uuidv7.ts";
import { occupancy, placement } from "../../../src/domain/booking/occupancy.ts";
import { NOW, request } from "../helpers.ts";
import {
  AS_THE_BOARD_SHOWS_IT,
  AT_THE_DOOR,
  bindings,
  IMRAN,
  LATER_JOB,
  insertJob,
  minutesAfterStart,
  ops,
  opsPost,
  OTHER_JOB,
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

describe("dispatch", () => {
  it("refuses a move that would give one technician two jobs in one window", async () => {
    // Sameer already has another client's job in Monday's afternoon window.
    await insertJob(OTHER_JOB, { start: "2026-09-21T07:30:00.000Z", technician: SAMEER, person: null });

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      date: "2026-09-21",
      window: "afternoon",
      reason: "zone_rebalance",
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "clash" } });
    const moved = await env.DB.prepare("SELECT technician_id FROM appointments WHERE id = ?1")
      .bind(TODAY_JOB)
      .first<{ technician_id: string }>();
    expect(moved?.technician_id).toBe(IMRAN);
  });

  it("carries no amount on the board, and no leave where none is recorded", async () => {
    const answer = await request(ops, "/api/dispatch?from=2026-09-21", {}, bindings());
    const body = await answer.text();

    expect(answer.status).toBe(200);
    const board = JSON.parse(body) as {
      dates: string[];
      technicians: { technician_id: string; days: { blocks: unknown[] }[] }[];
      utilisation: { date: string; percent: number }[];
      leave: unknown[];
    };
    expect(board.dates).toHaveLength(7);
    expect(board.technicians.map((row) => row.technician_id)).toEqual([IMRAN, SAMEER]);
    expect(board.utilisation[0]).toEqual({ date: "2026-09-21", percent: 13 });
    expect(board.leave).toEqual([]);
    expect(body).not.toMatch(/amount|"paise"/i);
  });
});

// A visit the technician has begun stays where he is working it: moved, his phone would carry on with a visit now
// booked for another day or another technician.
describe("dispatch, once the technician has begun", () => {
  // Rohit's Friday visit, Imran's too, set aside: it would stand beside a move of today's to another day with him, and
  // a technician never takes two of a client's visits in a row (docs/decisions/0111).
  beforeEach(async () => {
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(LATER_JOB).run();
  });

  const moveToSameerTomorrow = () =>
    opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "morning",
      reason: "running_over",
    });

  /** Tomorrow at 09:00 in India, where a move to tomorrow's morning puts today's job. */
  const TOMORROW_MORNING = "2026-09-22T03:30:00.000Z";

  const moveTomorrowMorning = (extra: Record<string, unknown> = {}) =>
    opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      date: "2026-09-22",
      window: "morning",
      reason: "client_asked",
      ...extra,
    });

  const visitNow = () =>
    env.DB.prepare("SELECT technician_id, window_start FROM appointments WHERE id = ?1").bind(TODAY_JOB).first();

  const stepsLanded = async () =>
    (
      await env.DB.prepare("SELECT kind, superseded FROM job_events WHERE appointment_id = ?1 ORDER BY received_at")
        .bind(TODAY_JOB)
        .all()
    ).results;

  const checkInsCleared = async () =>
    (
      await env.DB.prepare("SELECT subject_id, detail FROM audit_log WHERE action = 'dispatch.check_in_cleared'").all<{
        subject_id: string;
        detail: string;
      }>()
    ).results;

  const roomNow = () => request(ops, `/api/dispatch/room?appointment_id=${TODAY_JOB}&from=2026-09-21`, {}, bindings());

  /** Today's job as the board draws it on Imran's row. */
  async function blockOnTheBoard(): Promise<Record<string, unknown> | undefined> {
    const board = await (
      await request(ops, "/api/dispatch?from=2026-09-21", {}, bindings())
    ).json<{ technicians: { technician_id: string; days: { blocks: Record<string, unknown>[] }[] }[] }>();
    const row = board.technicians.find((each) => each.technician_id === IMRAN);
    return row?.days[0]?.blocks.find((block) => block.appointment_id === TODAY_JOB);
  }

  it("refuses to move a visit he has checked in at, and writes nothing", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    const answer = await moveToSameerTomorrow();

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "in_progress" } });
    expect(await visitNow()).toEqual({ technician_id: IMRAN, window_start: TODAY_START.toISOString() });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dispatch_moves").first()).toEqual({ n: 0 });
  });

  it("refuses to move a visit he has started", async () => {
    await startJob();

    const answer = await moveToSameerTomorrow();

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "in_progress" } });
    expect(await visitNow()).toEqual({ technician_id: IMRAN, window_start: TODAY_START.toISOString() });
  });

  it("offers room once he has checked in, none once he has started, and the board says how far he has got", async () => {
    expect(await blockOnTheBoard()).toMatchObject({ begun: null });
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    expect((await roomNow()).status).toBe(200);
    expect(await blockOnTheBoard()).toMatchObject({ begun: "arrived" });
    await post(`/api/tech/jobs/${TODAY_JOB}/start`, undefined, "event-start-01");
    expect((await roomNow()).status).toBe(404);
    expect(await blockOnTheBoard()).toMatchObject({ begun: "started" });
  });

  it("moves a visit he has only checked in at once ops clear the check-in, and records who chose it", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    const answer = await moveTomorrowMorning({ clear_check_in: true });

    expect(answer.status).toBe(200);
    expect(await visitNow()).toEqual({ technician_id: IMRAN, window_start: TOMORROW_MORNING });
    expect(await stepsLanded()).toEqual([{ kind: "check_in", superseded: 1 }]);
    const move = await env.DB.prepare("SELECT id FROM dispatch_moves").first<{ id: string }>();
    expect(await checkInsCleared()).toEqual([{ subject_id: TODAY_JOB, detail: JSON.stringify({ move_id: move?.id }) }]);
  });

  it("refuses his next step sent with the start he saw at check-in, and takes his check-in on the new day", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    await moveTomorrowMorning({ clear_check_in: true });

    const start = await postAt(minutesAfterStart(5), `/api/tech/jobs/${TODAY_JOB}/start`, undefined, uuidv7At(5), {
      "X-Job-Starts-At": TODAY_START.toISOString(),
    });

    expect(start.status).toBe(409);
    expect(await start.json()).toMatchObject({ error: { code: "superseded", fields: ["time"] } });
    const tomorrow = new Date(Date.parse(TOMORROW_MORNING) + 2 * 60_000);
    const checkIn = `/api/tech/jobs/${TODAY_JOB}/checkin`;
    const atTheNewTime = { "X-Job-Starts-At": TOMORROW_MORNING };
    const again = await postAt(tomorrow, checkIn, AT_THE_DOOR, uuidv7(tomorrow.getTime()), atTheNewTime);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ passed: true });
    expect((await stepsLanded()).filter((step) => step.superseded === 0)).toEqual([
      { kind: "check_in", superseded: 0 },
    ]);
  });

  it("will not clear the check-in of a visit he has started, and writes nothing", async () => {
    await startJob();

    const answer = await moveTomorrowMorning({ clear_check_in: true });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "in_progress" } });
    expect(await visitNow()).toEqual({ technician_id: IMRAN, window_start: TODAY_START.toISOString() });
    expect(await stepsLanded()).toEqual([
      { kind: "check_in", superseded: 0 },
      { kind: "start", superseded: 0 },
    ]);
    expect(await checkInsCleared()).toEqual([]);
  });

  it("moves a visit nobody has begun as any other move, clearing nothing", async () => {
    const answer = await moveTomorrowMorning({ clear_check_in: true });

    expect(answer.status).toBe(200);
    expect(await visitNow()).toEqual({ technician_id: IMRAN, window_start: TOMORROW_MORNING });
    expect(await checkInsCleared()).toEqual([]);
  });
});

// Leave goes through the same clash check as a visit, so nothing has to
// remember to ask: the board refuses it, and so does the client's own booking.
describe("leave", () => {
  const recordLeave = (technicianId: string, from: string, to: string, note?: string) =>
    opsPost(`/api/technicians/${technicianId}/leave`, { from, to, ...(note === undefined ? {} : { note }) });

  it("refuses a job on a day the technician is away, and names it as leave, not a clash", async () => {
    // Sameer is away on the 22nd; his day is otherwise empty.
    expect((await recordLeave(SAMEER, "2026-09-22", "2026-09-23", "Family wedding")).status).toBe(200);

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "morning",
      reason: "zone_rebalance",
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "on_leave" } });
    // Refused before any write, here as for a clash.
    const unmoved = await env.DB.prepare("SELECT technician_id FROM appointments WHERE id = ?1")
      .bind(TODAY_JOB)
      .first<{ technician_id: string }>();
    expect(unmoved?.technician_id).toBe(IMRAN);
  });

  it("draws the leave on the board, clipped to the week it shows", async () => {
    // A fortnight from the 20th: the board's week ends on the 27th.
    expect((await recordLeave(IMRAN, "2026-09-20", "2026-10-03")).status).toBe(200);

    const board = await (
      await request(ops, "/api/dispatch?from=2026-09-21", {}, bindings())
    ).json<{ leave: { technician_id: string; from: string; to: string; note: string | null }[] }>();
    expect(board.leave).toEqual([{ technician_id: IMRAN, from: "2026-09-21", to: "2026-09-27", note: null }]);
  });

  it("takes leave back, and the day can be worked again", async () => {
    const recorded = await recordLeave(SAMEER, "2026-09-22", "2026-09-22");
    const { id } = await recorded.json<{ id: string }>();

    expect((await opsPost(`/api/technicians/${SAMEER}/leave/${id}/cancel`, {})).status).toBe(200);
    // A second cancel finds nothing: the row is already taken back.
    expect((await opsPost(`/api/technicians/${SAMEER}/leave/${id}/cancel`, {})).status).toBe(404);

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "morning",
      reason: "zone_rebalance",
    });
    expect(answer.status).toBe(200);
  });

  it("refuses dates that do not make a period, and records nothing", async () => {
    expect((await recordLeave(SAMEER, "2026-09-23", "2026-09-22")).status).toBe(400);
    expect((await recordLeave(SAMEER, "2026-09-22", "2028-09-22")).status).toBe(400);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM technician_leave").first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("is recorded against the ops user who entered it", async () => {
    await recordLeave(IMRAN, "2026-09-24", "2026-09-24", "Doctor");
    const row = await env.DB.prepare("SELECT technician_id, note, actor FROM technician_leave").first<{
      technician_id: string;
      note: string;
      actor: string;
    }>();
    expect(row).toMatchObject({ technician_id: IMRAN, note: "Doctor" });
    expect(row?.actor).not.toBe("");

    const audit = await env.DB.prepare("SELECT action FROM audit_log WHERE subject_id = ?1").bind(IMRAN).first<{
      action: string;
    }>();
    expect(audit?.action).toBe("technician.leave");
  });

  it("keeps a client from booking the day at all, so the two cannot disagree", async () => {
    await recordLeave(IMRAN, "2026-09-24", "2026-09-24");
    await recordLeave(SAMEER, "2026-09-24", "2026-09-24");

    const board = await (
      await request(ops, "/api/dispatch?from=2026-09-21", {}, bindings())
    ).json<{ leave: { technician_id: string }[] }>();
    expect(board.leave.map((period) => period.technician_id).sort()).toEqual([IMRAN, SAMEER].sort());

    const held = await occupancy(env.DB, "2026-09-24", "2026-09-24", NOW);
    expect(held(IMRAN, "2026-09-24").onLeave).toBe(true);
    // A service visit's two half-slots (src/policy/visit-length.ts).
    expect(placement(held(IMRAN, "2026-09-24"), "morning", 2)).toBeNull();
    expect(placement(held(IMRAN, "2026-09-25"), "morning", 2)).not.toBeNull();
  });
});
