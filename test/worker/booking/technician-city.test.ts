// A visit goes only to a technician in its own city, and a technician with no city takes none until ops set one
// (docs/decisions/0117-a-technician-takes-visits-in-their-own-city.md). NOW is Monday 21 September 2026, noon in India.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { availability } from "../../../src/domain/booking/availability.ts";
import { holdSlot } from "../../../src/domain/booking/hold-slot.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { pincode } from "../site/consultations-fixtures.ts";

const CONSULTATION = { type: "consultation", tier: "standard", minutes: 60 } as const;
const FREE = { amount_ex_gst: 0, amount: 0, gst_percent: 0 };
const GURGAON = "122018";
const NOIDA = "201301";

async function person(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Rohit Malhotra')")
    .bind(id, NOW.toISOString(), `+91981${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`)
    .run();
  return id;
}

const holdAt = async (pin: string) => {
  const hold = await holdSlot({
    db: env.DB,
    input: {
      personId: await person(),
      service: CONSULTATION,
      date: "2026-09-23",
      window: "morning",
      price: FREE,
      from: "site",
      pincode: pin,
    },
    now: NOW,
    holdSeconds: 600,
  });
  return hold?.technician.name ?? null;
};

const morningOpenAt = async (pin: string) => {
  const [day] = await availability({
    db: env.DB,
    placing: { personId: null, pincode: pin },
    visit: { minutes: 60 },
    from: "2026-09-23",
    days: 1,
    now: NOW,
  });
  return day?.windows.find((window) => window.window === "morning")?.open ?? false;
};

beforeEach(async () => {
  await markDatabase();
  await pincode(GURGAON, "Sector 65", "Gurgaon", true);
  await pincode(NOIDA, "Sector 18", "Noida", true);
  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at, city, fits_trained)
     VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1, 'Gurgaon', 1),
            ('t2', 't2', 'Kabir Sood', 'KS', 1, ?1, 'Delhi', 1),
            ('t3', 't3', 'Faizan Ali', 'FA', 1, ?1, NULL, 1)`,
  )
    .bind(NOW.toISOString())
    .run();
});

describe("a visit and the technicians who may take it", () => {
  it("offers and holds a Gurgaon visit with Gurgaon's technician, and no one else once she is taken", async () => {
    expect(await morningOpenAt(GURGAON)).toBe(true);
    expect(await holdAt(GURGAON)).toBe("Imran Qureshi");
    // Delhi's technician and the one with no city are free, and are offered nothing in Gurgaon.
    expect(await morningOpenAt(GURGAON)).toBe(false);
    expect(await holdAt(GURGAON)).toBeNull();
  });

  it("offers nothing in a city no technician works in", async () => {
    expect(await morningOpenAt(NOIDA)).toBe(false);
    expect(await holdAt(NOIDA)).toBeNull();
  });

  it("takes the city from the client's address where the booking names no pincode", async () => {
    const client = await person();
    await env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
       VALUES ('ad1', ?1, ?2, 'Palm Grove Society', 'Sector 18', 'Noida', ?3)`,
    )
      .bind(client, NOW.toISOString(), NOIDA)
      .run();
    const [day] = await availability({
      db: env.DB,
      placing: { personId: client },
      visit: { minutes: 60 },
      from: "2026-09-23",
      days: 1,
      now: NOW,
    });
    expect(day?.windows.some((window) => window.open)).toBe(false);
  });
});

// A day closed in one city closes no other, and a first fit goes only to a technician trained to fit (ADR 0119).
describe("a city's own closed days, and first fits", () => {
  const DELHI = "110048";

  beforeEach(async () => {
    await pincode(DELHI, "Greater Kailash II", "Delhi", true);
  });

  it("closes a day in Gurgaon alone, leaving Delhi open", async () => {
    await env.DB.prepare(
      "INSERT INTO city_blackouts (date, city, reason) VALUES ('2026-09-23', 'Gurgaon', 'Local holiday')",
    ).run();
    expect(await morningOpenAt(GURGAON)).toBe(false);
    expect(await holdAt(GURGAON)).toBeNull();
    expect(await morningOpenAt(DELHI)).toBe(true);
  });

  it("offers and holds a first fit only with a technician trained to fit", async () => {
    const fitOpen = async () => {
      const [day] = await availability({
        db: env.DB,
        placing: { personId: null, pincode: GURGAON },
        visit: { minutes: 180, fitting: true },
        from: "2026-09-23",
        days: 1,
        now: NOW,
      });
      return day?.windows.find((window) => window.window === "morning")?.open ?? false;
    };
    expect(await fitOpen()).toBe(true);

    await env.DB.prepare("UPDATE technicians SET fits_trained = 0 WHERE id = 't1'").run();
    expect(await fitOpen()).toBe(false);
    const fit = await holdSlot({
      db: env.DB,
      input: {
        personId: await person(),
        service: { type: "first_fit", tier: "standard", minutes: 180 },
        date: "2026-09-23",
        window: "morning",
        price: FREE,
        from: "site",
        pincode: GURGAON,
      },
      now: NOW,
      holdSeconds: 600,
    });
    expect(fit).toBeNull();
    // A consultation needs no fitter.
    expect(await holdAt(GURGAON)).toBe("Imran Qureshi");
  });
});
