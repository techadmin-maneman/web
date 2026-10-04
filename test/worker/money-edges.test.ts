// The edges of booking and its money that the app's own flow seldom reaches: a hold asked for that is not there, one
// written before holds kept their terms, a code on a hold whose price is settled or whose time ran out, a hold given
// back once booked, and a claw-back with nothing left to take. NOW is Monday 21 September 2026, 12 noon in India;
// every name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking, giveBack } from "../../src/domain/bookings.ts";
import { clawBack } from "../../src/domain/credits.ts";
import { enterOnHold, removeFromHold } from "../../src/domain/discount-code-holds.ts";
import { clientHold } from "../../src/domain/holds.ts";
import { createStubPayments } from "../../src/providers/payments.ts";
import { captureLogs, markDatabase, NOW } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const HOLD = "33333333-3333-4333-8333-333333333333";
const LATER = new Date(NOW.getTime() + 60_000).toISOString();

beforeEach(async () => {
  captureLogs();
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

/** A service visit's hold on Tuesday morning, Rs. 2,000, in the state given; it holds until a minute from now. */
async function hold(shape: {
  state?: string;
  confirmedAt?: string;
  expiresAt?: string;
  tier?: string;
  credit?: 0 | 1;
}) {
  await env.DB.prepare(
    `INSERT INTO slot_holds (id, person_id, type, tier, date, window_label, technician_id, start_unit, amount,
       amount_ex_gst, gst_percent, state, use_credit, confirmed_at, expires_at, created_at, updated_at)
     VALUES (?1, ?2, 'service', ?3, '2026-09-22', 'morning', 't1', 0, 200000, 200000, 0, ?4, ?5, ?6, ?7, ?8, ?8)`,
  )
    .bind(
      HOLD,
      PERSON,
      shape.tier ?? "standard",
      shape.state ?? "held",
      shape.credit ?? 0,
      shape.confirmedAt ?? null,
      shape.expiresAt ?? LATER,
      NOW.toISOString(),
    )
    .run();
}

describe("a hold the app asks for", () => {
  it("is nobody's when it is not there", async () => {
    expect(await clientHold(env.DB, HOLD, PERSON, NOW)).toBeNull();
  });

  // A hold written before holds kept the terms they were sold under, of a service ops no longer offer.
  it("takes the book's terms and the visit's own name where the hold kept none", async () => {
    await hold({ tier: "retired_service" });

    expect(await clientHold(env.DB, HOLD, PERSON, NOW)).toMatchObject({
      service: { tier: "retired_service", name: "Service visit" },
    });
  });

  it("says what credits are left on a hold already let go", async () => {
    await hold({ state: "released", credit: 1 });

    expect(await clientHold(env.DB, HOLD, PERSON, NOW)).toMatchObject({ credit: { remaining: 0 } });
  });
});

describe("a discount code on a hold", () => {
  const payments = createStubPayments();
  const entry = { holdId: HOLD, personId: PERSON, text: "TENPC" };

  it("cannot go on, or come off, a hold that is not there", async () => {
    expect(await enterOnHold(env.DB, payments, entry, NOW)).toEqual({ kind: "not_found" });
    expect(await removeFromHold(env.DB, payments, entry, NOW)).toBe("not_found");
  });

  it("cannot change a price already settled, or one whose hold has run out", async () => {
    await hold({ confirmedAt: NOW.toISOString() });
    expect(await removeFromHold(env.DB, payments, entry, NOW)).toBe("price_settled");

    await env.DB.prepare("UPDATE slot_holds SET confirmed_at = NULL, expires_at = ?2 WHERE id = ?1")
      .bind(HOLD, NOW.toISOString())
      .run();
    expect(await removeFromHold(env.DB, payments, entry, NOW)).toBe("expired");
  });

  it("has nothing to come off a hold that carries none", async () => {
    await hold({});

    expect(await removeFromHold(env.DB, payments, entry, NOW)).toBe("none");
  });
});

describe("a hold booked or given back", () => {
  const payments = createStubPayments();

  it("is refused for a hold that is not there", async () => {
    await expect(confirmBooking(env.DB, payments, HOLD, NOW)).rejects.toThrow("no such hold to book");
    await expect(giveBack(env.DB, payments, HOLD, NOW, "test")).rejects.toThrow("no such hold to give back");
  });

  it("is not given back once booked, and refunds nothing", async () => {
    await hold({ state: "booked", confirmedAt: NOW.toISOString() });

    expect(await giveBack(env.DB, payments, HOLD, NOW, "test")).toEqual({ kind: "booked" });
    expect(payments.made.refunds).toEqual([]);
  });
});

describe("a claw-back", () => {
  it("writes nothing where the source granted nothing still left", async () => {
    await clawBack(env.DB, "referral", "no-such-referral", NOW);

    expect(await env.DB.prepare("SELECT id FROM credit_ledger").first()).toBeNull();
  });
});
