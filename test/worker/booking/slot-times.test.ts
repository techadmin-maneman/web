// The times of a working day's half-slots, set by ops from a day nothing is booked or bookable on
// (src/domain/slot-times.ts; docs/decisions/0102-window-times.md). NOW is Monday 21 September 2026, 12 noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { heldVisitTimes, occupancy } from "../../../src/domain/scheduling.ts";
import { loadSlotSchedule, setSlotTimes } from "../../../src/domain/slot-times.ts";
import { DEFAULT_SLOT_TIMES, type SlotTimes } from "../../../src/policy/slot-times.ts";
import { markDatabase, NOW } from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const TECHNICIAN = "33333333-3333-4333-8333-333333333333";
const HORIZON = 45;
/** The first day a change may apply from with nothing booked: 45 days from tomorrow, and a day. */
const EARLIEST = "2026-11-06";

const LATER: SlotTimes = {
  unitStarts: ["10:00", "11:00", "12:30", "13:30", "14:30", "15:30", "17:00", "18:30"],
  dayEnd: "21:00",
};

const audit = {
  surface: "ops",
  actor: { kind: "staff", id: "ops@localhost" },
  action: "slot_times.set",
  requestId: "r-1",
} as const;

const set = (appliesFrom: string, times: SlotTimes = LATER) =>
  setSlotTimes(env.DB, { times, appliesFrom, staff: "ops@localhost", now: NOW, horizonDays: HORIZON, audit });

async function visitOn(date: string, time = "10:30") {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, technician_id, type, status, fsm_status, window_start, window_end,
       fsm_modified_at, synced_at)
     VALUES (?1, ?1, ?2, ?3, 'service', 'scheduled', 'Scheduled', ?4, ?5, ?6, ?6)`,
  )
    .bind(
      crypto.randomUUID(),
      PERSON,
      TECHNICIAN,
      new Date(`${date}T${time}:00+05:30`).toISOString(),
      new Date(new Date(`${date}T${time}:00+05:30`).getTime() + 90 * 60_000).toISOString(),
      NOW.toISOString(),
    )
    .run();
}

async function holdOn(date: string, unit: number) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
       gst_percent, state, expires_at, created_at, updated_at, confirmed_at)
     VALUES (?1, ?2, 'service', ?3, 'morning', ?4, ?5, 0, 0, 0, 'held', ?6, ?6, ?6, ?6)`,
  )
    .bind(id, PERSON, date, TECHNICIAN, unit, NOW.toISOString())
    .run();
  return id;
}

beforeEach(async () => {
  await markDatabase();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
    ).bind(PERSON, NOW.toISOString()),
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, 'resource-1', 'Imran Qureshi', 'IQ', 1, ?2)",
    ).bind(TECHNICIAN, NOW.toISOString()),
  ]);
});

describe("a change of times", () => {
  it("applies from its day on, each day before it keeping the times it had", async () => {
    expect(await set(EARLIEST)).toEqual({ kind: "set", appliesFrom: EARLIEST });
    const schedule = await loadSlotSchedule(env.DB);
    expect(schedule.on("2026-11-05")).toEqual(DEFAULT_SLOT_TIMES);
    expect(schedule.on(EARLIEST)).toMatchObject(LATER);
    expect(schedule.on("2027-03-01")).toMatchObject(LATER);
    // 12:15 is the afternoon under the times in code, and still the morning under the later ones.
    expect(schedule.at(new Date("2026-11-05T12:15:00+05:30")).window).toBe("afternoon");
    expect(schedule.at(new Date(`${EARLIEST}T12:15:00+05:30`)).window).toBe("morning");
  });

  it("is audited in the same write, naming who set it", async () => {
    await set(EARLIEST);
    const rows = await env.DB.prepare("SELECT action, actor, subject_kind FROM audit_log").all();
    expect(rows.results).toEqual([{ action: "slot_times.set", actor: "ops@localhost", subject_kind: null }]);
    const change = await env.DB.prepare("SELECT set_by, day_end FROM slot_times").first();
    expect(change).toEqual({ set_by: "ops@localhost", day_end: "21:00" });
  });

  it("is refused before the day after the last a client can book, saying the earliest", async () => {
    expect(await set("2026-11-05")).toEqual({ kind: "too_soon", earliest: EARLIEST });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_times").first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first("n")).toBe(0);
  });

  it("waits for the day after the last visit already booked, or held, and after any change before it", async () => {
    await visitOn("2026-12-01");
    expect(await set(EARLIEST)).toEqual({ kind: "too_soon", earliest: "2026-12-02" });
    await holdOn("2026-12-10", 0);
    expect(await set("2026-12-02")).toEqual({ kind: "too_soon", earliest: "2026-12-11" });
    expect(await set("2026-12-11")).toEqual({ kind: "set", appliesFrom: "2026-12-11" });
    expect(await set("2026-12-11", DEFAULT_SLOT_TIMES)).toEqual({ kind: "too_soon", earliest: "2026-12-12" });
  });

  it("is refused as it is written if a visit was booked on or after its day meanwhile", async () => {
    // FSM's own booking far ahead, mirrored after the check and before the write: the write's guard stops it.
    const racing = {
      prepare: (sql: string) => env.DB.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        await visitOn("2026-12-01");
        return env.DB.batch(statements);
      },
    } as unknown as D1Database;
    const written = await setSlotTimes(racing, {
      times: LATER,
      appliesFrom: EARLIEST,
      staff: "ops@localhost",
      now: NOW,
      horizonDays: HORIZON,
      audit,
    });
    expect(written).toEqual({ kind: "too_soon", earliest: "2026-12-02" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_times").first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first("n")).toBe(0);
  });

  it("is refused with what is wrong with the times", async () => {
    expect(await set(EARLIEST, { ...LATER, dayEnd: "18:00" })).toEqual({ kind: "invalid", problems: ["not_in_order"] });
  });

  it("is never changed or deleted once made", async () => {
    await set(EARLIEST);
    await expect(env.DB.prepare("UPDATE slot_times SET day_end = '22:00'").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM slot_times").run()).rejects.toThrow(/append-only/);
  });
});

describe("a day under a change of times", () => {
  it("starts a held visit at its half-slot's time on that day", async () => {
    await set(EARLIEST);
    const before = { date: "2026-11-05", start_unit: 2, type: "service" as const, minutes: 90 };
    const after = { ...before, date: EARLIEST };
    expect((await heldVisitTimes(env.DB, before)).start.toISOString()).toBe("2026-11-05T06:30:00.000Z"); // 12:00
    expect((await heldVisitTimes(env.DB, after)).start.toISOString()).toBe(`${EARLIEST}T07:00:00.000Z`); // 12:30
  });

  it("puts a visit in the half-slot and window its time falls in that day", async () => {
    await set(EARLIEST);
    await visitOn(EARLIEST, "12:15");
    const held = await occupancy(env.DB, EARLIEST, EARLIEST, NOW);
    const day = held(TECHNICIAN, EARLIEST);
    // The morning's second half-slot, from 11:00, under the later times; the afternoon's first under the old ones.
    expect([...day.windows]).toEqual(["morning"]);
    expect([...day.units].sort()).toEqual([1, 2]);
  });
});
