// A hold moves on to the next technician only when another hold took his time (src/domain/booking/hold-slot.ts, holdSlot).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { holdSlot } from "../../../src/domain/booking/hold-slot.ts";
import { markDatabase, NOW } from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const CONSULTATION = { type: "consultation", tier: "standard", minutes: 60 } as const;
const FREE = { amount_ex_gst: 0, amount: 0, gst_percent: 0 };

beforeEach(async () => {
  await markDatabase();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
    ).bind(NOW.toISOString()),
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
    ).bind(PERSON, NOW.toISOString()),
  ]);
});

// A new number's person written twice at once broke people's unique key, which read as the window gone.
describe("a hold whose batch fails on another table's key", () => {
  it("is told as the failure it is, not as a window taken", async () => {
    const twice = env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('another', ?1, '+919810000001', 'Rohit Malhotra')",
    ).bind(NOW.toISOString());

    const placing = holdSlot({
      db: env.DB,
      input: {
        personId: PERSON,
        service: CONSULTATION,
        date: "2026-09-23",
        window: "morning",
        price: FREE,
        from: "site",
        alongside: [twice],
      },
      now: NOW,
      holdSeconds: 600,
    });

    await expect(placing).rejects.toThrow("UNIQUE constraint failed: people.mobile_e164");
  });
});
