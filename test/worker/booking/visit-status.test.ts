// The visit's status machine (src/domain/visits/visit-status.ts): each step moves a visit only forward, from the statuses it
// allows, and a closed visit's row is written once. NOW is Monday 21 September 2026, 12 noon in India. Every ID is
// made up.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_STATUSES,
  closeVisit,
  moveVisit,
  type AppointmentStatus,
  type Step,
} from "../../../src/domain/visits/visit-status.ts";
import { NOW } from "../helpers.ts";

const BOOKED_AT = "2026-09-20T06:30:00.000Z";
const AT = NOW.toISOString();
const STARTED = "2026-09-21T07:40:00.000Z";
const ENDED = "2026-09-21T09:10:00.000Z";

/** Where each step takes a visit, by the status it is in. A status a step does not name refuses it. */
const MOVES: Readonly<Record<Step, Partial<Record<AppointmentStatus, AppointmentStatus>>>> = {
  check_in: { scheduled: "dispatched" },
  start: { scheduled: "in_progress", dispatched: "in_progress" },
  done: { scheduled: "completed", dispatched: "completed", in_progress: "completed" },
  partial: { scheduled: "terminated", dispatched: "terminated", in_progress: "terminated" },
  no_show: { scheduled: "terminated", dispatched: "terminated" },
  cancel: { scheduled: "cancelled", dispatched: "cancelled" },
};

const STEP_NAMES = Object.keys(MOVES) as Step[];

/** Every step from every status: the status it should end in, which is where it was when the step is refused. */
const CASES = STEP_NAMES.flatMap((step) =>
  APPOINTMENT_STATUSES.map((from) => [step, from, MOVES[step][from] ?? from] as const),
);

/** A visit booked without FSM, in the status given. Its ID. */
async function visitIn(status: AppointmentStatus, options: { deleted?: boolean } = {}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, type, window_start, window_end, status, synced_at, deleted_at)
     VALUES (?1, ?1, 'service', '2026-09-21T07:30:00.000Z', '2026-09-21T09:00:00.000Z', ?2, ?3, ?4)`,
  )
    .bind(id, status, BOOKED_AT, options.deleted === true ? BOOKED_AT : null)
    .run();
  return id;
}

const visitRow = (id: string) =>
  env.DB.prepare("SELECT status, synced_at FROM appointments WHERE id = ?1")
    .bind(id)
    .first<{ status: string; synced_at: string }>();

const closedRow = (id: string) =>
  env.DB.prepare(
    "SELECT started_at, ended_at, duration_minutes, outcome, partial_reason, updated_at FROM visits WHERE appointment_id = ?1",
  )
    .bind(id)
    .first();

describe("moveVisit", () => {
  it.each(CASES)("%s from %s ends %s", async (step, from, expected) => {
    const id = await visitIn(from);

    const result = await moveVisit(env.DB, id, step, AT).run();

    const moved = expected !== from;
    // The count takes in what the appointments' triggers write as well, so it tells only none from some.
    expect(result.meta.changes > 0).toBe(moved);
    expect(await visitRow(id)).toEqual({ status: expected, synced_at: moved ? AT : BOOKED_AT });
  });

  it("never moves a visit that is gone", async () => {
    const id = await visitIn("scheduled", { deleted: true });

    const result = await moveVisit(env.DB, id, "check_in", AT).run();

    expect(result.meta.changes).toBe(0);
    expect((await visitRow(id))?.status).toBe("scheduled");
  });
});

describe("closeVisit", () => {
  it("writes a done job's visit with its times and duration, beside the move that completes it", async () => {
    const id = await visitIn("in_progress");

    await env.DB.batch([
      moveVisit(env.DB, id, "done", AT),
      closeVisit({
        db: env.DB,
        appointmentId: id,
        outcome: "done",
        times: { startedAt: STARTED, endedAt: ENDED },
        partialReason: null,
        at: AT,
      }),
    ]);

    expect((await visitRow(id))?.status).toBe("completed");
    expect(await closedRow(id)).toEqual({
      started_at: STARTED,
      ended_at: ENDED,
      duration_minutes: 90,
      outcome: "done",
      partial_reason: null,
      updated_at: AT,
    });
  });

  it("keeps a partial job's reason", async () => {
    const id = await visitIn("in_progress");

    await env.DB.batch([
      moveVisit(env.DB, id, "partial", AT),
      closeVisit({
        db: env.DB,
        appointmentId: id,
        outcome: "partial",
        times: { startedAt: STARTED, endedAt: ENDED },
        partialReason: "client_unwell",
        at: AT,
      }),
    ]);

    expect((await visitRow(id))?.status).toBe("terminated");
    expect(await closedRow(id)).toMatchObject({ outcome: "partial", partial_reason: "client_unwell" });
  });

  it("writes a no-show with no start and no duration", async () => {
    const id = await visitIn("dispatched");

    await env.DB.batch([
      moveVisit(env.DB, id, "no_show", AT),
      closeVisit({
        db: env.DB,
        appointmentId: id,
        outcome: "no_show",
        times: { startedAt: null, endedAt: ENDED },
        partialReason: null,
        at: AT,
      }),
    ]);

    expect((await visitRow(id))?.status).toBe("terminated");
    expect(await closedRow(id)).toMatchObject({
      started_at: null,
      ended_at: ENDED,
      duration_minutes: null,
      outcome: "no_show",
    });
  });

  it.each(["cancelled", "terminated"] as const)(
    "writes nothing for a visit already %s, whose move to done was refused",
    async (status) => {
      const id = await visitIn(status);

      await env.DB.batch([
        moveVisit(env.DB, id, "done", AT),
        closeVisit({
          db: env.DB,
          appointmentId: id,
          outcome: "done",
          times: { startedAt: STARTED, endedAt: ENDED },
          partialReason: null,
          at: AT,
        }),
      ]);

      expect((await visitRow(id))?.status).toBe(status);
      expect(await closedRow(id)).toBeNull();
    },
  );

  it("writes nothing for a visit not yet closed", async () => {
    const id = await visitIn("in_progress");

    await closeVisit({
      db: env.DB,
      appointmentId: id,
      outcome: "done",
      times: { startedAt: STARTED, endedAt: ENDED },
      partialReason: null,
      at: AT,
    }).run();

    expect(await closedRow(id)).toBeNull();
  });

  it("keeps the first close when a second comes", async () => {
    const id = await visitIn("in_progress");
    await env.DB.batch([
      moveVisit(env.DB, id, "done", AT),
      closeVisit({
        db: env.DB,
        appointmentId: id,
        outcome: "done",
        times: { startedAt: STARTED, endedAt: ENDED },
        partialReason: null,
        at: AT,
      }),
    ]);

    const later = "2026-09-21T10:00:00.000Z";
    await env.DB.batch([
      moveVisit(env.DB, id, "done", later),
      closeVisit({
        db: env.DB,
        appointmentId: id,
        outcome: "done",
        times: { startedAt: ENDED, endedAt: later },
        partialReason: null,
        at: later,
      }),
    ]);

    expect((await visitRow(id))?.synced_at).toBe(AT);
    expect(await closedRow(id)).toMatchObject({ started_at: STARTED, ended_at: ENDED, updated_at: AT });
  });
});
