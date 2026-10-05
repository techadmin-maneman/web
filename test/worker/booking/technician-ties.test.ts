// Who takes a hold when technicians are equally free that day (src/domain/technician-choice.ts): whoever holds the
// least over the week around that day, never whoever sorts first by name. NOW is Monday 21 September 2026, 12 noon
// in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { holdSlot } from "../../../src/domain/hold-slot.ts";
import { markDatabase, NOW } from "../helpers.ts";

const ADITYA = "t1";
const ZUBIN = "t2";
const CONSULTATION = { type: "consultation", tier: "standard", minutes: 60 } as const;
const FREE = { amount_ex_gst: 0, amount: 0, gst_percent: 0 };

/** A client with no visit done, so nobody is their regular technician. */
async function person(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Rohit Malhotra')")
    .bind(id, NOW.toISOString(), `+91981${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`)
    .run();
  return id;
}

/** A visit booked with a technician at 12 noon in India on a day. */
async function booked(technicianId: string, date: string): Promise<void> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, type, status, fsm_status, window_start, window_end, technician_id,
       fsm_modified_at, synced_at)
     VALUES (?1, ?1, 'service', 'scheduled', 'scheduled', ?2, ?3, ?4, ?5, ?5)`,
  )
    .bind(id, `${date}T06:30:00.000Z`, `${date}T08:00:00.000Z`, technicianId, NOW.toISOString())
    .run();
}

const holdOn = async (date: string, window: "morning" | "afternoon") => {
  const hold = await holdSlot(
    env.DB,
    { personId: await person(), service: CONSULTATION, date, window, price: FREE, from: "site" },
    NOW,
    600,
  );
  return hold?.technician.name;
};

beforeEach(async () => {
  await markDatabase();
  await env.DB.batch(
    [
      [ADITYA, "Aditya Rao", "AR"],
      [ZUBIN, "Zubin Shah", "ZS"],
    ].map(([id, name, initials]) =>
      env.DB.prepare(
        "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, ?1, ?2, ?3, 1, ?4)",
      ).bind(id, name, initials, NOW.toISOString()),
    ),
  );
});

describe("a hold between technicians equally free that day", () => {
  it("goes to whoever holds the least over the week around it, not to the first name", async () => {
    await booked(ADITYA, "2026-09-24");
    expect(await holdOn("2026-09-23", "morning")).toBe("Zubin Shah");
  });

  it("spreads light days across technicians rather than giving every one to the first name", async () => {
    const taken = [];
    for (const date of ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"])
      taken.push(await holdOn(date, "morning"));
    expect(taken.filter((name) => name === "Aditya Rao")).toHaveLength(2);
    expect(taken.filter((name) => name === "Zubin Shah")).toHaveLength(2);
  });

  it("still goes first to whoever holds less that day, whatever the week holds", async () => {
    await booked(ADITYA, "2026-09-24");
    await booked(ADITYA, "2026-09-25");
    await booked(ZUBIN, "2026-09-23");
    expect(await holdOn("2026-09-23", "morning")).toBe("Aditya Rao");
  });
});
