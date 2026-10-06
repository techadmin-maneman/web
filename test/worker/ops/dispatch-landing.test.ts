// The dispatch board's writes under real conditions: a technician-only change,
// a visit with no room, two moves at once, and a client who cannot be messaged.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and
// address here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import {
  ROHIT,
  VIKRAM,
  IMRAN,
  SAMEER,
  FIT,
  REPLACEMENT,
  A,
  B,
  WEDNESDAY,
  TUESDAY,
  insertJob,
  shown,
} from "./dispatch-fixtures.ts";

let ops: App;

let messageQueue: ReturnType<typeof fakeQueue>;

beforeEach(async () => {
  await markDatabase();
  messageQueue = fakeQueue();
  ops = appFor("local", fakeDependencies(), {}, "ops");

  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, updated_at)
     VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Sec 40–65', ?3),
            (?2, ?2, 'Sameer Bhatt', 'SB', 1, 'Sec 1–39', ?3)`,
  )
    .bind(IMRAN, SAMEER, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(ROHIT, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810009902', 'Vikram Sethi')",
  )
    .bind(VIKRAM, NOW.toISOString())
    .run();
});

const bindings = () => ({ MESSAGE_QUEUE: messageQueue }) as unknown as Partial<Env>;

const opsPost = (path: string, body: unknown, app: App = ops) =>
  request(
    app,
    path,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    bindings(),
  );

/** A move sent from a board that shows the job as it stands, unless the body says otherwise. */
async function move(body: { appointment_id: string } & Record<string, unknown>, app: App = ops): Promise<Response> {
  const job = await shown(body.appointment_id);
  return opsPost(
    "/api/dispatch/move",
    { expected_technician_id: job?.technician_id ?? null, expected_starts_at: job?.window_start, ...body },
    app,
  );
}

interface RoomBody {
  appointment_id: string;
  rooms: { technician_id: string; date: string; windows: string[]; starts: { window: string; starts_at: string }[] }[];
  blackouts: string[];
}

const roomFor = (id: string, from: string) =>
  request(ops, `/api/dispatch/room?appointment_id=${id}&from=${from}`, {}, bindings());

/** Monday 21 September, today, in India, as UTC: each half-slot's start. NOW is 12:00. */
const TODAY = {
  date: "2026-09-21",
  "09:00": "2026-09-21T03:30:00.000Z",
  "12:00": "2026-09-21T06:30:00.000Z",
  "13:00": "2026-09-21T07:30:00.000Z",
  "16:00": "2026-09-21T10:30:00.000Z",
} as const;

const dispatchMoves = () =>
  env.DB.prepare("SELECT appointment_id, now_start, blackout_reason FROM dispatch_moves").all<{
    appointment_id: string;
    now_start: string;
    blackout_reason: string | null;
  }>();

// The brief: "Drop it on a cell with room", and "a cell that would
// clash is refused before the sheet opens". The board offered every window of
// every day and learnt of a clash only after a reason had been picked.
// A technician never takes two of a client's visits in a row (docs/decisions/0111).
describe("a client's visits in a row", () => {
  it("refuses to give a visit to the technician of the client's visit before it, and offers him no room", async () => {
    await insertJob(A, { type: "service", start: "2026-09-01T06:30:00.000Z", technician: SAMEER, status: "completed" });
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });

    const answer = await move({ appointment_id: FIT, technician_id: SAMEER, reason: "zone_rebalance" });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "back_to_back" } });
    expect(await shown(FIT)).toEqual({ technician_id: IMRAN, window_start: TUESDAY["12:00"] });

    const { rooms } = await (await roomFor(FIT, "2026-09-22")).json<RoomBody>();
    expect(rooms.filter((room) => room.technician_id === SAMEER)).toEqual([]);
  });

  it("refuses the technician of the client's visit after it, and lets the visit keep its own", async () => {
    await insertJob(B, { type: "service", start: "2026-09-25T06:30:00.000Z", technician: SAMEER });
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });

    const toSameer = await move({ appointment_id: FIT, technician_id: SAMEER, reason: "zone_rebalance" });
    expect(await toSameer.json()).toMatchObject({ error: { code: "back_to_back" } });
    // A move that keeps its technician and day puts nobody new beside the client.
    const morning = await move({ appointment_id: FIT, date: "2026-09-22", window: "morning", reason: "running_over" });
    expect(morning.status).toBe(200);
  });
});

describe("where a job in hand can go", () => {
  it("offers each window the job would land in, and none it would be refused", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });
    await insertJob(REPLACEMENT, { type: "replacement", start: TUESDAY["10:30"], technician: SAMEER, person: VIKRAM });
    expect((await opsPost(`/api/technicians/${SAMEER}/leave`, { from: "2026-09-24", to: "2026-09-24" })).status).toBe(
      200,
    );

    const answer = await roomFor(FIT, "2026-09-22");
    expect(answer.status).toBe(200);
    const { rooms } = await answer.json<RoomBody>();
    const windowsOf = (technician: string, date: string) =>
      rooms.find((room) => room.technician_id === technician && room.date === date)?.windows ?? [];

    // Imran's afternoon is where it already is; his morning has room, and no evening has room for a first fit.
    expect(windowsOf(IMRAN, "2026-09-22")).toEqual(["morning"]);
    // Sameer's replacement holds his morning and runs into the first fit's own 12:00.
    expect(windowsOf(SAMEER, "2026-09-22")).toEqual([]);
    expect(windowsOf(SAMEER, "2026-09-23")).toEqual(["morning", "afternoon"]);
    // Away on Thursday.
    expect(windowsOf(SAMEER, "2026-09-24")).toEqual([]);
    expect(rooms.every((room) => room.windows.length > 0)).toBe(true);
  });

  it("answers not found for a job no longer live", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN, status: "completed" });
    expect((await roomFor(FIT, "2026-09-22")).status).toBe(404);
  });
});

// At 09:58 four visits moved to that morning all landed at 09:00, at 10:02 one landed at 09:00 to
// 10:00, and a move to yesterday answered 200. The technician and the client were told a time nobody could meet.
describe("a move lands only at a start still ahead", () => {
  beforeEach(async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
  });

  it("takes today's window at its first start still to come, not one already under way", async () => {
    const answer = await move({
      appointment_id: A,
      technician_id: SAMEER,
      date: TODAY.date,
      window: "afternoon",
      reason: "client_asked",
    });

    expect(answer.status).toBe(200);
    // 12:00 is now, so the afternoon's next start, 13:00, is where it lands.
    expect(await shown(A)).toEqual({ technician_id: SAMEER, window_start: TODAY["13:00"] });
  });

  it("refuses today's window once every start in it has passed, and a day gone, writing nothing", async () => {
    const morning = await move({ appointment_id: A, date: TODAY.date, window: "morning", reason: "client_asked" });
    const yesterday = await move({ appointment_id: A, date: "2026-09-20", window: "evening", reason: "client_asked" });

    expect(morning.status).toBe(409);
    expect(await morning.json()).toMatchObject({ error: { code: "window_passed" } });
    expect(yesterday.status).toBe(409);
    expect(await yesterday.json()).toMatchObject({ error: { code: "past_day" } });
    expect((await dispatchMoves()).results).toEqual([]);
    expect(await shown(A)).toEqual({ technician_id: IMRAN, window_start: TUESDAY["09:00"] });
  });

  it("moves a visit whose own start has come to the window's next start, and tells the client of it", async () => {
    await insertJob(B, { type: "service", start: TODAY["12:00"], technician: IMRAN });

    const answer = await move({ appointment_id: B, date: TODAY.date, window: "afternoon", reason: "running_over" });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ client_notice: "call" });
    expect(await shown(B)).toEqual({ technician_id: IMRAN, window_start: TODAY["13:00"] });
  });

  it("gives a visit whose window has passed to another technician only at a later start", async () => {
    await insertJob(B, { type: "service", start: TODAY["09:00"], technician: IMRAN });

    const sameTime = await move({
      appointment_id: B,
      technician_id: SAMEER,
      date: TODAY.date,
      window: "morning",
      reason: "technician_unavailable",
    });

    expect(sameTime.status).toBe(409);
    expect(await sameTime.json()).toMatchObject({ error: { code: "window_passed" } });
    expect(await shown(B)).toEqual({ technician_id: IMRAN, window_start: TODAY["09:00"] });
  });

  it("offers today only at starts still ahead, with the start each window would take, and no day gone", async () => {
    const answer = await roomFor(A, "2026-09-20");
    expect(answer.status).toBe(200);
    const { rooms } = await answer.json<RoomBody>();
    const roomOf = (technician: string, date: string) =>
      rooms.find((room) => room.technician_id === technician && room.date === date);

    expect(roomOf(SAMEER, "2026-09-20")).toBeUndefined();
    expect(roomOf(SAMEER, TODAY.date)).toEqual({
      technician_id: SAMEER,
      date: TODAY.date,
      windows: ["afternoon", "evening"],
      starts: [
        { window: "afternoon", starts_at: TODAY["13:00"] },
        { window: "evening", starts_at: TODAY["16:00"] },
      ],
    });
    // Imran's Tuesday morning is where it already is.
    expect(roomOf(IMRAN, "2026-09-22")?.starts).toEqual([
      { window: "afternoon", starts_at: TUESDAY["12:00"] },
      { window: "evening", starts_at: "2026-09-22T10:30:00.000Z" },
    ]);
  });
});

// Owner decision 16: a move onto a blacked-out day is allowed, with a warning and a typed reason kept with the move.
describe("a move onto a blacked-out day", () => {
  const ontoWednesday = (id: string, extra: Record<string, unknown> = {}) =>
    move({ appointment_id: id, date: WEDNESDAY, window: "morning", reason: "client_asked", ...extra });

  beforeEach(async () => {
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES (?1, 'Dussehra')").bind(WEDNESDAY).run();
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
  });

  it("is refused without a reason, and nothing is written", async () => {
    const answer = await ontoWednesday(A);

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "blackout" } });
    expect((await dispatchMoves()).results).toEqual([]);
  });

  it("refuses a reason of nothing but spaces", async () => {
    const answer = await ontoWednesday(A, { blackout_reason: "   " });
    expect(answer.status).toBe(400);
  });

  it("goes ahead with a reason, kept with the move", async () => {
    const reason = "The client's only free day; Imran agreed to work it";

    const answer = await ontoWednesday(A, { blackout_reason: reason });

    expect(answer.status).toBe(200);
    expect((await dispatchMoves()).results).toEqual([
      expect.objectContaining({ appointment_id: A, blackout_reason: reason }),
    ]);
    expect(await shown(A)).toEqual({ technician_id: IMRAN, window_start: "2026-09-23T03:30:00.000Z" });
  });

  it("keeps no reason for a move onto any other day", async () => {
    const answer = await move({
      appointment_id: A,
      date: "2026-09-24",
      window: "morning",
      reason: "client_asked",
      blackout_reason: "Sent by habit",
    });

    expect(answer.status).toBe(200);
    expect((await dispatchMoves()).results[0]?.blackout_reason).toBeNull();
  });

  it("is offered on the board, which is told the day is blacked out", async () => {
    const { rooms, blackouts } = await (await roomFor(A, "2026-09-22")).json<RoomBody>();

    expect(blackouts).toEqual([WEDNESDAY]);
    expect(rooms.find((room) => room.technician_id === SAMEER && room.date === WEDNESDAY)?.windows).toEqual([
      "morning",
      "afternoon",
      "evening",
    ]);
  });
});

// Leave recorded over jobs already booked flagged nothing. Chetan's Wednesday job sat unmarked on his Away
// cell, stayed on his phone, and waited for nobody.
describe("leave recorded over jobs already booked", () => {
  /** Wednesday at 10:30 in India. */
  const WEDNESDAY_MORNING = "2026-09-23T05:00:00.000Z";

  interface LeaveAnswer {
    id: string;
    jobs: { appointment_id: string; starts_at: string; type: string; client: string | null }[];
  }

  const tasksOf = async (group: string) => {
    const body = await (
      await request(ops, "/api/tasks", {}, bindings())
    ).json<{
      groups: { group: string; tasks: { id: string; detail: string | null; since: string; due: string }[] }[];
    }>();
    return body.groups.find((each) => each.group === group)?.tasks ?? [];
  };

  it("names the jobs it falls on, and only those", async () => {
    await insertJob(A, { type: "service", start: WEDNESDAY_MORNING, technician: SAMEER });
    await insertJob(B, { type: "service", start: WEDNESDAY_MORNING, technician: IMRAN });
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["09:00"], technician: SAMEER });

    const answer = await opsPost(`/api/technicians/${SAMEER}/leave`, { from: WEDNESDAY, to: WEDNESDAY });

    expect(answer.status).toBe(200);
    expect((await answer.json<LeaveAnswer>()).jobs).toEqual([
      { appointment_id: A, starts_at: WEDNESDAY_MORNING, type: "service", client: "Rohit Malhotra" },
    ]);
  });

  it("puts each on the Tasks board, due by the job, until it is moved or the leave taken back", async () => {
    await insertJob(A, { type: "service", start: WEDNESDAY_MORNING, technician: SAMEER });
    const { id: leave } = await (
      await opsPost(`/api/technicians/${SAMEER}/leave`, { from: WEDNESDAY, to: WEDNESDAY })
    ).json<LeaveAnswer>();

    expect(await tasksOf("leave_conflict")).toEqual([
      expect.objectContaining({
        id: A,
        detail: `${WEDNESDAY_MORNING} Sameer Bhatt`,
        since: NOW.toISOString(),
        // Two days on would be after the job itself.
        due: WEDNESDAY_MORNING,
      }),
    ]);

    await opsPost(`/api/technicians/${SAMEER}/leave/${leave}/cancel`, {});
    expect(await tasksOf("leave_conflict")).toEqual([]);

    await opsPost(`/api/technicians/${SAMEER}/leave`, { from: WEDNESDAY, to: WEDNESDAY });
    await env.DB.prepare("UPDATE appointments SET technician_id = ?1 WHERE id = ?2").bind(IMRAN, A).run();
    expect(await tasksOf("leave_conflict")).toEqual([]);
  });
});
