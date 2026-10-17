// The day's half-slot times in the console (src/routes/ops/slot-times.ts; docs/decisions/0102-window-times.md). NOW
// is Monday 21 September 2026, 12 noon in India. Nothing here is a real person or number.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { aVisit } from "../fixtures/visits.ts";

let ops: App;

const LATER = {
  unit_starts: ["10:00", "11:00", "12:30", "13:30", "14:30", "15:30", "17:00", "18:30"],
  day_end: "21:00",
};

const read = async () => (await request(ops, "/api/slot-times")).json<Record<string, unknown>>();

const set = (body: unknown) =>
  request(ops, "/api/slot-times", {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("GET /api/slot-times", () => {
  it("answers the times in code, their windows, no changes, and the day after the last a client can book", async () => {
    expect(await read()).toEqual({
      in_force: {
        applies_from: null,
        unit_starts: ["09:00", "10:30", "12:00", "13:00", "14:00", "15:00", "16:00", "18:00"],
        day_end: "20:00",
        windows: {
          morning: { start: "09:00", end: "12:00" },
          afternoon: { start: "12:00", end: "16:00" },
          evening: { start: "16:00", end: "20:00" },
        },
      },
      changes: [],
      // The app books 45 days from tomorrow (src/policy/next-visit.ts).
      earliest: "2026-11-06",
    });
  });
});

describe("POST /api/slot-times", () => {
  it("sets a change from its day, lists it under who set it, and moves the earliest past it", async () => {
    const answer = await set({ applies_from: "2026-11-06", ...LATER });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({ applies_from: "2026-11-06" });

    const after = await read();
    expect(after.changes).toEqual([
      { applies_from: "2026-11-06", ...LATER, set_by: "ops@localhost", set_at: expect.any(String) as string },
    ]);
    expect(after.earliest).toBe("2026-11-07");
    // Today is still under the times in code.
    expect((after.in_force as { applies_from: string | null }).applies_from).toBeNull();
    const audited = await env.DB.prepare("SELECT actor, detail FROM audit_log WHERE action = 'slot_times.set'").all();
    expect(audited.results).toEqual([
      { actor: "ops@localhost", detail: JSON.stringify({ applies_from: "2026-11-06" }) },
    ]);
  });

  it("refuses a day before the earliest", async () => {
    const answer = await set({ applies_from: "2026-11-05", ...LATER });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "slot_times_too_soon" } });
  });

  it("refuses times out of order, naming what is wrong, and a shape it cannot read", async () => {
    const wrong = await set({ applies_from: "2026-11-06", ...LATER, day_end: "18:00" });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: { code: "invalid_request", fields: ["not_in_order"] } });
    const short = await set({ applies_from: "2026-11-06", unit_starts: LATER.unit_starts.slice(1), day_end: "21:00" });
    expect(short.status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_times").first("n")).toBe(0);
  });

  it("refuses a half-slot shorter than the 45 minutes a half-slot is counted as", async () => {
    const answer = await set({
      applies_from: "2026-11-06",
      unit_starts: ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"],
      day_end: "13:00",
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["half_slot_too_short"] } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_times").first("n")).toBe(0);
  });
});

// A change could not be taken back: the day before a correction ran on the wrong times.
describe("DELETE /api/slot-times/{applies_from}", () => {
  const withdraw = (from: string) =>
    request(ops, `/api/slot-times/${from}`, { method: "DELETE", headers: { Origin: "https://maneman.test" } });

  it("withdraws the last change, still to come, under who withdrew it", async () => {
    await set({ applies_from: "2026-11-06", ...LATER });
    expect((await withdraw("2026-11-06")).status).toBe(204);
    expect((await read()).changes).toEqual([]);
    const audited = await env.DB.prepare(
      "SELECT actor, detail FROM audit_log WHERE action = 'slot_times.withdraw'",
    ).all();
    expect(audited.results).toEqual([
      { actor: "ops@localhost", detail: JSON.stringify({ applies_from: "2026-11-06" }) },
    ]);
  });

  it("keeps a change another follows, and one a visit is booked under", async () => {
    await set({ applies_from: "2026-11-06", ...LATER });
    await set({ applies_from: "2026-11-07", ...LATER });
    expect((await withdraw("2026-11-06")).status).toBe(409);

    expect((await withdraw("2026-11-07")).status).toBe(204);
    await aVisit({ window_start: "2026-11-08T04:30:00.000Z" });
    expect((await withdraw("2026-11-06")).status).toBe(409);
    expect((await withdraw("2026-12-01")).status).toBe(404);
  });
});
