// The piece a technician fits or takes off, and a label already on record.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and photograph here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NOW } from "../helpers.ts";
import {
  AT_THE_DOOR,
  insertJob,
  minutesAfterStart,
  OTHER_JOB,
  PERSON,
  postAt,
  TODAY_START,
  useFieldDay,
  uuidv7At,
} from "./field-fixtures.ts";

useFieldDay();

// A replacement: the old piece comes off, failed, and a new one goes on.
describe("the piece", () => {
  const REPLACEMENT = OTHER_JOB;

  beforeEach(async () => {
    await insertJob(REPLACEMENT, { start: TODAY_START.toISOString(), type: "replacement" });
    await env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, fitted_at, replacement_due_at, synced_at)
       VALUES ('piece-old', 'piece-old', ?1, 'MM-STD-4417-B', 'Standard base', '2026-03-25', '2026-09-21', ?2)`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();
  });

  /** Every step of the replacement up to the piece, worked from 13:02, and replayed the next morning. */
  async function upToThePiece(at: Date): Promise<void> {
    const steps: [string, unknown, number][] = [
      ["checkin", AT_THE_DOOR, 2],
      ["start", undefined, 5],
      ["photos", { phase: "before" }, 10],
      ["checklist", { done: [] }, 30],
      ["consumables", { items: [{ name: "Adhesive", quantity: 2 }] }, 40],
    ];
    for (const [step, body, minute] of steps) {
      const answer = await postAt(at, `/api/tech/jobs/${REPLACEMENT}/${step}`, body, uuidv7At(minute));
      expect(answer.status).toBeLessThan(300);
    }
  }

  it("records the new piece with its base and lot, and the old one as failed with its reason", async () => {
    // Sent at 9 am the next day; the piece went on at 23:40 on the visit's day.
    const nextMorning = new Date("2026-09-22T03:30:00.000Z");
    await upToThePiece(nextMorning);
    const answer = await postAt(
      nextMorning,
      `/api/tech/jobs/${REPLACEMENT}/piece`,
      {
        piece_code: "MM-STD-5520-A",
        base: "Standard base",
        supplier_lot: "LOT-2026-09",
        old_piece: { piece_code: "MM-STD-4417-B", failure_reason: "Adhesive lifted at the front" },
      },
      uuidv7At(610),
    );
    expect(answer.status).toBe(202);

    const pieces = await env.DB.prepare(
      "SELECT piece_code, fitted_at, replacement_due_at, failure_reason FROM pieces ORDER BY piece_code",
    ).all();
    expect(pieces.results).toEqual([
      {
        piece_code: "MM-STD-4417-B",
        fitted_at: "2026-03-25",
        replacement_due_at: "2026-09-21",
        failure_reason: "Adhesive lifted at the front",
      },
      // Fitted on the 21st in India, whatever day the write arrived; due 180 days on.
      { piece_code: "MM-STD-5520-A", fitted_at: "2026-09-21", replacement_due_at: "2027-03-20", failure_reason: null },
    ]);
  });

  it("refuses a label that is not a piece's, for the old piece as for the new", async () => {
    await upToThePiece(minutesAfterStart(60));
    const answer = await postAt(
      minutesAfterStart(60),
      `/api/tech/jobs/${REPLACEMENT}/piece`,
      { piece_code: "MM-STD-5520-A", old_piece: { piece_code: "MM-STD-4417 B", failure_reason: "Torn" } },
      uuidv7At(50),
    );

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["old_piece"] } });
  });

  it("keeps what was used, with quantities, where ops can count stock", async () => {
    await upToThePiece(minutesAfterStart(60));

    const used = await env.DB.prepare("SELECT name, quantity FROM consumables_used WHERE appointment_id = ?1")
      .bind(REPLACEMENT)
      .all();
    expect(used.results).toEqual([{ name: "Adhesive", quantity: 2 }]);
  });
});

// A label is one piece's: typed again for another client, or this client's old piece typed as the new one, it would
// record nothing for this client, or two clients' pieces as one. The technician corrects it on the phone.
describe("a piece label already on record", () => {
  const REPLACEMENT = OTHER_JOB;
  const NEIGHBOUR = "11111111-1111-4111-8111-111111111112";

  beforeEach(async () => {
    await insertJob(REPLACEMENT, { start: TODAY_START.toISOString(), type: "replacement" });
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000002', 'Vikram Sethi')",
    )
      .bind(NEIGHBOUR, NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, fitted_at, replacement_due_at, synced_at)
       VALUES ('piece-old', 'piece-old', ?1, 'MM-STD-4417-B', 'Standard base', '2026-03-25', '2026-09-21', ?2),
              ('piece-theirs', 'piece-theirs', ?3, 'MM-STD-9999-A', 'Standard base', '2026-05-02', '2026-10-29', ?2)`,
    )
      .bind(PERSON, NOW.toISOString(), NEIGHBOUR)
      .run();
    const sentAt = minutesAfterStart(60);
    const steps: [string, unknown, number][] = [
      ["checkin", AT_THE_DOOR, 2],
      ["start", undefined, 5],
      ["photos", { phase: "before" }, 10],
      ["checklist", { done: [] }, 30],
      ["consumables", { items: [] }, 40],
    ];
    for (const [step, body, minute] of steps) {
      const answer = await postAt(sentAt, `/api/tech/jobs/${REPLACEMENT}/${step}`, body, uuidv7At(minute));
      expect(answer.status).toBeLessThan(300);
    }
  });

  const piece = (body: object) =>
    postAt(minutesAfterStart(60), `/api/tech/jobs/${REPLACEMENT}/piece`, body, uuidv7At(50));

  const pieceSteps = () =>
    env.DB.prepare("SELECT COUNT(*) AS n FROM job_events WHERE appointment_id = ?1 AND kind = 'piece'")
      .bind(REPLACEMENT)
      .first();

  it("is refused when another client's piece carries it, and nothing lands", async () => {
    const answer = await piece({ piece_code: "MM-STD-9999-A", base: "Standard base" });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "piece_code", fields: ["piece_code"] } });
    expect(await pieceSteps()).toEqual({ n: 0 });
  });

  it("is refused when it is the client's own piece from an earlier visit", async () => {
    const answer = await piece({
      piece_code: "MM-STD-4417-B",
      old_piece: { piece_code: "MM-STD-4417-B", failure_reason: "Torn" },
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "piece_code", fields: ["piece_code"] } });
  });

  it("is refused as the piece that came off when it is another client's", async () => {
    const answer = await piece({
      piece_code: "MM-STD-5520-A",
      old_piece: { piece_code: "MM-STD-9999-A", failure_reason: "Torn" },
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "piece_code", fields: ["old_piece"] } });
    expect(await pieceSteps()).toEqual({ n: 0 });
  });

  it("lands once corrected", async () => {
    await piece({ piece_code: "MM-STD-9999-A" });

    const corrected = await postAt(
      minutesAfterStart(60),
      `/api/tech/jobs/${REPLACEMENT}/piece`,
      { piece_code: "MM-STD-5520-A", old_piece: { piece_code: "MM-STD-4417-B", failure_reason: "Torn" } },
      uuidv7At(51),
    );

    expect(corrected.status).toBe(202);
    expect(await pieceSteps()).toEqual({ n: 1 });
  });
});
