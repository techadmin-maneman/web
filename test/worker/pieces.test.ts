// The pieces tab and the technician's label lookup (src/domain/pieces.ts), and the utilisation the board writes to
// events. NOW is Monday 21 September 2026, 12 noon in India. Every code is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { recordUtilisation } from "../../src/domain/dispatch.ts";
import { failedPieceStatement, fittedPieceStatement, piecesOf, type FittedPiece } from "../../src/domain/pieces.ts";
import { openTechnicianSession } from "../../src/domain/technicians.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-111111111112";
const IMRAN = "33333333-3333-4333-8333-333333333331";
const JOB = "22222222-2222-4222-8222-222222222221";

const FITTED: FittedPiece = {
  personId: PERSON,
  appointmentId: JOB,
  pieceCode: "MM-STD-4417-B",
  base: "Standard base",
  supplierLot: "LOT-2026-07",
  fittedOn: "2026-07-01",
  replacementDue: "2026-12-28",
  now: NOW,
};

const fail = (personId: string, reason: string, now = NOW) =>
  failedPieceStatement(env.DB, { personId, pieceCode: FITTED.pieceCode, reason, now }).run();

let tech: App;
let ops: App;

beforeEach(async () => {
  await markDatabase();
  const deps = fakeDependencies();
  tech = appFor("local", deps, {}, "tech");
  ops = appFor("local", deps, {}, "ops");

  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
     VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Gurgaon', '+919810000009', ?2)`,
  )
    .bind(IMRAN, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
     VALUES (?1, ?1, ?2, 'replacement', 'scheduled', '2026-09-21T07:30:00.000Z', '2026-09-21T09:45:00.000Z', ?3, ?4)`,
  )
    .bind(JOB, PERSON, IMRAN, NOW.toISOString())
    .run();
});

describe("a piece the technician fitted", () => {
  it("is recorded once, however often its step lands", async () => {
    await fittedPieceStatement(env.DB, FITTED).run();
    await fittedPieceStatement(env.DB, { ...FITTED, now: new Date(NOW.getTime() + 60_000) }).run();

    expect(await piecesOf(env.DB, PERSON)).toEqual([
      expect.objectContaining({
        piece_code: "MM-STD-4417-B",
        base: "Standard base",
        supplier_lot: "LOT-2026-07",
        fitted_at: "2026-07-01",
        replacement_due_at: "2026-12-28",
        failed_at: null,
      }),
    ]);
  });

  it("keeps the first failure recorded, with its reason", async () => {
    await fittedPieceStatement(env.DB, FITTED).run();
    await fail(PERSON, "base torn at the hairline");
    await fail(PERSON, "lifting at the front", new Date(NOW.getTime() + 60_000));

    const [piece] = await piecesOf(env.DB, PERSON);
    expect(piece).toMatchObject({ failed_at: NOW.toISOString(), failure_reason: "base torn at the hairline" });
  });

  it("is never marked failed by another client's visit", async () => {
    await fittedPieceStatement(env.DB, FITTED).run();
    await fail(OTHER, "base torn at the hairline");

    const [piece] = await piecesOf(env.DB, PERSON);
    expect(piece).toMatchObject({ failed_at: null, failure_reason: null });
  });
});

describe("the label the technician scans", () => {
  it("is found in our records, and says whether it is this job's client's", async () => {
    await fittedPieceStatement(env.DB, FITTED).run();
    const cookie = `mm_tech=${await openTechnicianSession(env.DB, {
      technicianId: IMRAN,
      deviceId: "phone-abc-123",
      label: null,
      now: NOW,
    })}`;

    const answer = await request(tech, `/api/tech/pieces/lookup?code=MM-STD-4417-B&job=${JOB}`, {
      headers: { Cookie: cookie },
    });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      piece: {
        piece_code: "MM-STD-4417-B",
        base: "Standard base",
        supplier_lot: "LOT-2026-07",
        fitted_at: "2026-07-01",
        replacement_due_at: "2026-12-28",
        failed_at: null,
        failure_reason: null,
      },
      belongs_to_this_job: true,
    });
    const unknown = await request(tech, "/api/tech/pieces/lookup?code=MM-STD-0000-Z", {
      headers: { Cookie: cookie },
    });
    expect(unknown.status).toBe(404);
  });
});

describe("GET /api/clients/:id/pieces", () => {
  it("reads the client's pieces from our records", async () => {
    await fittedPieceStatement(env.DB, FITTED).run();
    const answer = await request(ops, `/api/clients/${PERSON}/pieces`);

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      pieces: [
        {
          piece_code: "MM-STD-4417-B",
          base: "Standard base",
          supplier_lot: "LOT-2026-07",
          fitted_at: "2026-07-01",
          replacement_due_at: "2026-12-28",
          failed_at: null,
          failure_reason: null,
        },
      ],
    });
  });
});

describe("the utilisation the board writes to events daily", () => {
  it("records yesterday's share of the day's slots, once", async () => {
    // Yesterday: one replacement, a slot and a half of the one technician's four.
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
         synced_at)
       VALUES ('yesterday', 'yesterday', ?1, 'replacement', 'scheduled', '2026-09-20T04:30:00.000Z',
         '2026-09-20T06:45:00.000Z', ?2, ?3)`,
    )
      .bind(PERSON, IMRAN, NOW.toISOString())
      .run();

    expect(await recordUtilisation(env.DB, NOW)).toBe("2026-09-20");
    expect(await recordUtilisation(env.DB, NOW)).toBeNull();

    const event = await env.DB.prepare(
      "SELECT subject_id, payload_json FROM events WHERE name = 'dispatch_utilisation'",
    ).first<{ subject_id: string; payload_json: string }>();
    expect(event?.subject_id).toBe("2026-09-20");
    expect(JSON.parse(event?.payload_json ?? "{}")).toEqual({
      percent: 38,
      technicians: 1,
      slots_per_day: 4,
    });
  });
});
