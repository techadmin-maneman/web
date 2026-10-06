// A technician's day: each step, piece and move is written in the request that makes it. NOW is Monday 21 September
// 2026, 12 noon in India; today's job is at 13:00. Every name, number and label here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { openTechnicianSession } from "../../../src/domain/dispatch/technicians.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import {
  PERSON,
  NEIGHBOUR,
  TODAY_JOB,
  OTHER_JOB,
  IMRAN,
  SAMEER,
  AT_THE_DOOR,
  TODAY_START,
  minutesAfterStart,
  uuidv7At,
  booked,
} from "./field-work-fixtures.ts";

let messageQueue: ReturnType<typeof fakeQueue>;

let cookie: string;

const bindings = () => ({ MESSAGE_QUEUE: messageQueue }) as unknown as Partial<Env>;

/** A write from the technician's phone that reaches the API at `at`, as a phone replaying its outbox does. */
const postAt = (at: Date, path: string, body: unknown, eventId: string) =>
  request(
    appFor("local", fakeDependencies({ now: () => at }), {}, "tech"),
    path,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://maneman.test",
        "Content-Type": "application/json",
        "X-Client-Event-Id": eventId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings(),
  );

/** Each step, its body, and the minute after the start the phone took it, sent together at `sentAt`. */
async function work(sentAt: Date, jobId: string, steps: readonly (readonly [string, unknown, number])[]) {
  for (const [step, body, minute] of steps) {
    const answer = await postAt(sentAt, `/api/tech/jobs/${jobId}/${step}`, body, uuidv7At(minute));
    expect(answer.status, `${step} at minute ${String(minute)}`).toBeLessThan(300);
  }
}

beforeEach(async () => {
  await markDatabase();
  messageQueue = fakeQueue();
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, hand_written, updated_at)
       VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Gurgaon', '+919810000009', 1, ?3),
              (?2, ?2, 'Sameer Bhatt', 'SB', 1, 'Gurgaon', '+919810000008', 1, ?3)`,
    ).bind(IMRAN, SAMEER, at),
    env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name)
       VALUES (?1, ?3, '+919810000001', 'Rohit Malhotra'), (?2, ?3, '+919810000002', 'Vikram Sethi')`,
    ).bind(PERSON, NEIGHBOUR, at),
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, lat, lng, geocoded_at)
       VALUES ('addr-1', ?1, ?2, 'House 7', 'Sector 65', 'Gurgaon', '122018', 28.398, 77.07, ?2)`,
    ).bind(PERSON, at),
  ]);
  await booked(TODAY_JOB, { start: TODAY_START.toISOString() });
  cookie = `mm_tech=${await openTechnicianSession(env.DB, {
    technicianId: IMRAN,
    deviceId: "phone-abc-123",
    label: "Chrome on Android",
    now: NOW,
  })}`;
});

// A replacement: the old piece comes off, failed, and a new one goes on.
describe("the piece", () => {
  const REPLACEMENT = OTHER_JOB;
  const UP_TO_THE_PIECE = [
    ["checkin", AT_THE_DOOR, 2],
    ["start", undefined, 5],
    ["photos", { phase: "before" }, 10],
    ["checklist", { done: [] }, 30],
    ["consumables", { items: [] }, 40],
  ] as const;

  beforeEach(async () => {
    await booked(REPLACEMENT, { start: TODAY_START.toISOString(), type: "replacement" });
    await env.DB.prepare("DELETE FROM appointments WHERE id = ?1").bind(TODAY_JOB).run();
    await env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, fitted_at, replacement_due_at, synced_at)
       VALUES ('piece-old', 'piece-old', ?1, 'MM-STD-4417-B', 'Standard base', '2026-03-25', '2026-09-21', ?2),
              ('piece-theirs', 'piece-theirs', ?3, 'MM-STD-9999-A', 'Standard base', '2026-05-02', '2026-10-29', ?2)`,
    )
      .bind(PERSON, NOW.toISOString(), NEIGHBOUR)
      .run();
  });

  const pieces = () =>
    env.DB.prepare(
      `SELECT piece_code, person_id, fsm_id = id AS own_fsm_id, appointment_id, base, supplier_lot, fitted_at,
         replacement_due_at, failure_reason
       FROM pieces ORDER BY piece_code`,
    ).all();

  const piece = (body: object, eventId = uuidv7At(50), sentAt = minutesAfterStart(60)) =>
    postAt(sentAt, `/api/tech/jobs/${REPLACEMENT}/piece`, body, eventId);

  it("records the new piece and the old one's failure when the step lands", async () => {
    // Sent at 9 am the next day; the piece went on at 13:50 on the visit's day.
    const nextMorning = new Date("2026-09-22T03:30:00.000Z");
    await work(nextMorning, REPLACEMENT, UP_TO_THE_PIECE);

    const answer = await piece(
      {
        piece_code: "MM-STD-5520-A",
        base: "Standard base",
        supplier_lot: "LOT-2026-09",
        old_piece: { piece_code: "MM-STD-4417-B", failure_reason: "Adhesive lifted at the front" },
      },
      uuidv7At(50),
      nextMorning,
    );

    expect(answer.status).toBe(202);
    expect((await pieces()).results).toEqual([
      {
        piece_code: "MM-STD-4417-B",
        person_id: PERSON,
        own_fsm_id: 1,
        appointment_id: null,
        base: "Standard base",
        supplier_lot: null,
        fitted_at: "2026-03-25",
        replacement_due_at: "2026-09-21",
        failure_reason: "Adhesive lifted at the front",
      },
      {
        piece_code: "MM-STD-5520-A",
        person_id: PERSON,
        own_fsm_id: 1,
        appointment_id: REPLACEMENT,
        base: "Standard base",
        supplier_lot: "LOT-2026-09",
        // Fitted on the 21st in India, whatever day the write arrived; due 180 days on.
        fitted_at: "2026-09-21",
        replacement_due_at: "2027-03-20",
        failure_reason: null,
      },
      expect.objectContaining({ piece_code: "MM-STD-9999-A", person_id: NEIGHBOUR }),
    ]);
  });

  it("records a piece that failed on the client's head, and fits nothing", async () => {
    await work(minutesAfterStart(60), REPLACEMENT, UP_TO_THE_PIECE);

    await piece({ piece_code: "MM-STD-4417-B", failure_reason: "Torn at the crown" });

    const rows = (await pieces()).results as { piece_code: string; failure_reason: string | null }[];
    expect(rows.map((row) => [row.piece_code, row.failure_reason])).toEqual([
      ["MM-STD-4417-B", "Torn at the crown"],
      ["MM-STD-9999-A", null],
    ]);
  });

  it("records the piece once, however often the phone sends the step", async () => {
    await work(minutesAfterStart(60), REPLACEMENT, UP_TO_THE_PIECE);
    const body = { piece_code: "MM-STD-5520-A", base: "Standard base" };
    const eventId = uuidv7At(50);

    await piece(body, eventId);
    const replayed = await piece(body, eventId);
    // Sent again as a new step, as a technician who opened the screen again sends it: still this visit's own piece.
    const again = await piece(body, uuidv7At(55));

    expect(await replayed.json()).toMatchObject({ replayed: true });
    expect(again.status).toBe(202);
    const fitted = await env.DB.prepare("SELECT COUNT(*) AS n FROM pieces WHERE piece_code = 'MM-STD-5520-A'").first<{
      n: number;
    }>();
    expect(fitted?.n).toBe(1);
  });

  it("refuses a label another client's piece carries, and records nothing", async () => {
    await work(minutesAfterStart(60), REPLACEMENT, UP_TO_THE_PIECE);

    const answer = await piece({ piece_code: "MM-STD-9999-A", base: "Standard base" });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "piece_code", fields: ["piece_code"] } });
    const landed = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM job_events WHERE appointment_id = ?1 AND kind = 'piece'",
    )
      .bind(REPLACEMENT)
      .first<{ n: number }>();
    expect(landed?.n).toBe(0);
    expect((await pieces()).results).toHaveLength(2);
  });

  it("refuses the client's own old piece sent as the new one", async () => {
    await work(minutesAfterStart(60), REPLACEMENT, UP_TO_THE_PIECE);

    const answer = await piece({ piece_code: "MM-STD-4417-B", base: "Standard base" });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "piece_code", fields: ["piece_code"] } });
  });

  it("refuses another client's piece as the one that came off", async () => {
    await work(minutesAfterStart(60), REPLACEMENT, UP_TO_THE_PIECE);

    const answer = await piece({
      piece_code: "MM-STD-5520-A",
      old_piece: { piece_code: "MM-STD-9999-A", failure_reason: "Torn" },
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "piece_code", fields: ["old_piece"] } });
    const theirs = await env.DB.prepare("SELECT failed_at FROM pieces WHERE id = 'piece-theirs'").first();
    expect(theirs).toEqual({ failed_at: null });
  });
});
