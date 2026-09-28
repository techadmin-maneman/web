// Booking in the app: availability and holds (docs/decisions/0045-self-serve-booking.md),
// over the window-to-slot map (0035) and the clash check (0034). NOW is Monday
// 21 September 2026, 12 noon in India, so the first bookable day is Tuesday the
// 22nd. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { VISIT_BLOCKS } from "../../src/config/scheduling.ts";
import type { VisitType } from "../../src/config/visit-types.ts";
import { placement, unitAt } from "../../src/domain/scheduling.ts";
import { unitsFor } from "../../src/policy/visit-length.ts";
import { windowAt } from "../../src/policy/windows.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { appFor, fakeDependencies, LOCAL_SETTINGS, markDatabase, NOW, request, savedAddress } from "./helpers.ts";

const IMRAN = "t1";
const SANDEEP = "t2";

async function technician(id: string, name: string, initials: string) {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
  )
    .bind(id, `fsm-${id}`, name, initials, NOW.toISOString())
    .run();
}

let people = 0;
/**
 * A client with a session and a saved address; fitted, with Imran as their regular technician, unless `lead`.
 * `withoutAddress`: one who has not given their address yet.
 */
async function client(lead = false, { withoutAddress = false } = {}): Promise<{ id: string; cookie: string }> {
  people += 1;
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Rohit Malhotra')")
    .bind(id, NOW.toISOString(), `+9198100000${String(people).padStart(2, "0")}`)
    .run();
  if (!withoutAddress) await savedAddress(id, "122018");
  await visit(id, lead ? "consultation" : "service", "completed", "2026-09-01T06:30:00.000Z", IMRAN);
  const session = await openSession(env.DB, { kind: "client", subjectId: id, deviceLabel: null, now: NOW });
  return { id, cookie: `mm_app=${session}` };
}

async function visit(
  personId: string | null,
  type: string,
  status: string,
  startsAt: string,
  technicianId: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end, technician_id,
       fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?6, ?7, ?8, ?8)`,
  )
    .bind(id, `fsm-${id}`, personId, type, status, startsAt, technicianId, NOW.toISOString())
    .run();
  return id;
}

let app: App;
const later = (minutes: number) =>
  appFor("local", fakeDependencies({ now: () => new Date(NOW.getTime() + minutes * 60_000) }), {}, "client");

const hold = (who: { cookie: string }, body: object, on: App = app) =>
  request(on, "/api/holds", {
    method: "POST",
    headers: { Cookie: who.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  await markDatabase();
  app = appFor("local", fakeDependencies(), {}, "client");
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANDEEP, "Sandeep Rawat", "SR");
});

/** The half-slots a kind's own length holds (src/policy/visit-length.ts). */
const unitsOf = (type: VisitType) => unitsFor(VISIT_BLOCKS[type].minutes);

describe("the working day", () => {
  it("places a visit at the first free half-slot of its window, one job per window", () => {
    const empty = { units: new Set<number>(), windows: new Set<"morning" | "afternoon" | "evening">(), onLeave: false };
    expect(placement(empty, "afternoon", unitsOf("service"))).toBe(2);
    expect(placement({ ...empty, units: new Set([2, 3]) }, "afternoon", unitsOf("service"))).toBe(4);
    expect(
      placement({ ...empty, windows: new Set(["afternoon"] as const) }, "afternoon", unitsOf("service")),
    ).toBeNull();
    // A first fit is two slots: it cannot start in the evening's last half-slots.
    expect(placement(empty, "evening", unitsOf("first_fit"))).toBeNull();
    expect(placement(empty, "morning", unitsOf("first_fit"))).toBe(0);
  });

  it("offers a technician on leave no window at all, whatever else their day holds", () => {
    const away = { units: new Set<number>(), windows: new Set<"morning" | "afternoon" | "evening">(), onLeave: true };
    expect(placement(away, "morning", unitsOf("service"))).toBeNull();
    expect(placement(away, "afternoon", unitsOf("consultation"))).toBeNull();
    expect(placement(away, "evening", unitsOf("service"))).toBeNull();
  });

  it("reads a time of day as its half-slot and window", () => {
    expect([unitAt("09:00"), unitAt("11:15"), unitAt("12:00"), unitAt("18:30")]).toEqual([0, 1, 2, 7]);
    expect([windowAt("09:30"), windowAt("12:00"), windowAt("16:00")]).toEqual(["morning", "afternoon", "evening"]);
  });
});

describe("GET /api/availability", () => {
  it("offers 14 days from tomorrow, each window with the regular technician where he is free", async () => {
    const rohit = await client();
    const answer = await request(app, "/api/availability?type=service", { headers: { Cookie: rohit.cookie } });
    expect(answer.status).toBe(200);
    const body = await answer.json<{
      price: object;
      regular: object;
      days: { date: string; windows: { window: string; with: string | null }[] }[];
    }>();
    expect(body.price).toEqual({ amount_ex_gst: 200000, amount: 200000, gst_percent: 0 });
    expect(body.regular).toEqual({ name: "Imran Qureshi", initials: "IQ" });
    expect(body.days).toHaveLength(14);
    expect(body.days[0]).toEqual({
      date: "2026-09-22",
      price: { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 },
      windows: [
        { window: "morning", with: "regular" },
        { window: "afternoon", with: "regular" },
        { window: "evening", with: "regular" },
      ],
    });
  });

  it("offers another technician where the regular one is busy, and marks a window full where both are", async () => {
    const rohit = await client();
    await visit(null, "service", "scheduled", "2026-09-23T06:30:00.000Z", IMRAN); // Wednesday, 12 noon
    const once = await (
      await request(app, "/api/availability?type=service&from=2026-09-23", { headers: { Cookie: rohit.cookie } })
    ).json<{ days: { windows: { window: string; with: string | null }[] }[] }>();
    expect(once.days[0]?.windows[1]).toEqual({ window: "afternoon", with: "another" });

    await visit(null, "first_fit", "dispatched", "2026-09-23T07:30:00.000Z", SANDEEP); // Wednesday, 1 pm
    const twice = await (
      await request(app, "/api/availability?type=service&from=2026-09-23", { headers: { Cookie: rohit.cookie } })
    ).json<{ days: { windows: { window: string; with: string | null }[] }[] }>();
    expect(twice.days[0]?.windows[1]).toEqual({ window: "afternoon", with: null });
  });

  it("will not offer a kind of visit the client may not book, and is off where self-serve booking is", async () => {
    const lead = await client(true);
    const service = await request(app, "/api/availability?type=service", { headers: { Cookie: lead.cookie } });
    expect(service.status).toBe(422);
    const firstFit = await request(app, "/api/availability?type=first_fit", { headers: { Cookie: lead.cookie } });
    expect(firstFit.status).toBe(200);

    const off = appFor("local", fakeDependencies(), { ...LOCAL_SETTINGS, selfServeBooking: false }, "client");
    const answer = await request(off, "/api/availability?type=first_fit", { headers: { Cookie: lead.cookie } });
    expect(answer.status).toBe(409);
    expect((await answer.json<{ error: { code: string } }>()).error.code).toBe("ops_assisted");
  });
});

describe("POST /api/holds", () => {
  const TUESDAY_AFTERNOON = { type: "service", date: "2026-09-22", window: "afternoon" };

  it("holds the window for ten minutes with the regular technician, at the price book's price", async () => {
    const rohit = await client();
    const answer = await hold(rohit, TUESDAY_AFTERNOON);
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({
      type: "service",
      date: "2026-09-22",
      window: "afternoon",
      starts_at: "2026-09-22T06:30:00.000Z",
      ends_at: "2026-09-22T08:00:00.000Z",
      technician: { name: "Imran Qureshi", initials: "IQ" },
      price: { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 },
      late_fee: null,
      // Moving is free until 24 hours before the window opens.
      free_until: "2026-09-21T06:30:00.000Z",
      expires_at: "2026-09-21T06:40:00.000Z",
      state: "held",
    });
  });

  it("gives the next client another technician, and the one after that nobody", async () => {
    const [first, second, third] = [await client(), await client(), await client()];
    expect((await hold(first, TUESDAY_AFTERNOON)).status).toBe(201);
    const secondHold = await hold(second, TUESDAY_AFTERNOON);
    expect(await secondHold.json()).toMatchObject({ technician: { name: "Sandeep Rawat" } });
    const thirdHold = await hold(third, TUESDAY_AFTERNOON);
    expect(thirdHold.status).toBe(409);
    expect((await thirdHold.json<{ error: { code: string } }>()).error.code).toBe("taken");
  });

  it("lets the time go when a hold lapses, or when its client holds another", async () => {
    const [first, second, third] = [await client(), await client(), await client()];
    await hold(first, TUESDAY_AFTERNOON);
    await hold(second, TUESDAY_AFTERNOON);
    // Thirteen minutes on, past the ten and the two minutes' grace a payment may still land in, the first two
    // holds have lapsed, and the window is free again.
    const afterwards = await hold(third, TUESDAY_AFTERNOON, later(13));
    expect(afterwards.status).toBe(201);
    // The first client now holds Wednesday instead, which lets Tuesday's claim go even before it lapses.
    const moved = await (await hold(first, { ...TUESDAY_AFTERNOON, date: "2026-09-23" })).json<{ id: string }>();
    expect(moved.id).toBeDefined();
  });

  // The countdown and the grace are ops' to set; a hold keeps the ones it was made with
  // (docs/decisions/0088-every-policy-in-the-console.md).
  const paymentHold = (minutes: { countdown: number; grace: number }) =>
    env.DB.prepare(
      "INSERT OR REPLACE INTO ops_settings (name, value, set_by, set_at) VALUES ('payment_hold', ?1, 'ops', ?2)",
    )
      .bind(JSON.stringify(minutes), NOW.toISOString())
      .run();

  it("holds a slot for the minutes ops set, and keeps its time for the grace they set after them", async () => {
    await paymentHold({ countdown: 15, grace: 5 });
    const [first, second] = [await client(), await client()];
    const held = await hold(first, TUESDAY_AFTERNOON);
    expect(await held.json()).toMatchObject({ expires_at: "2026-09-21T06:45:00.000Z" });
    await hold(second, TUESDAY_AFTERNOON);
    const third = await client();
    expect((await hold(third, TUESDAY_AFTERNOON, later(19))).status).toBe(409);
    expect((await hold(third, TUESDAY_AFTERNOON, later(21))).status).toBe(201);
  });

  it("keeps a hold to the grace it was made with, whatever ops set after", async () => {
    await paymentHold({ countdown: 10, grace: 5 });
    const [first, second, third] = [await client(), await client(), await client()];
    await hold(first, TUESDAY_AFTERNOON);
    await hold(second, TUESDAY_AFTERNOON);
    await paymentHold({ countdown: 10, grace: 1 });
    // Thirteen minutes on is past a minute's grace, but not the five these two holds were made with.
    expect((await hold(third, TUESDAY_AFTERNOON, later(13))).status).toBe(409);
    expect(await env.DB.prepare("SELECT grace_seconds FROM slot_holds").all()).toMatchObject({
      results: [{ grace_seconds: 300 }, { grace_seconds: 300 }],
    });
  });

  // The horizon is ops' to set, 45 days from tomorrow to begin with (docs/decisions/0086-the-next-visit-is-offered.md).
  it("carries a first fit's late fee, and refuses a day past the 45 days from tomorrow", async () => {
    const lead = await client(true);
    const answer = await hold(lead, { type: "first_fit", date: "2026-09-24", window: "morning" });
    expect(await answer.json()).toMatchObject({
      price: { amount_ex_gst: 3000000, amount: 3000000 },
      late_fee: { amount_ex_gst: 400000, amount: 400000 },
      ends_at: "2026-09-24T06:30:00.000Z",
    });
    expect((await hold(lead, { type: "first_fit", date: "2026-11-06", window: "morning" })).status).toBe(422);
    expect((await hold(lead, { type: "first_fit", date: "2026-09-21", window: "evening" })).status).toBe(422);
    expect((await hold(lead, { type: "first_fit", date: "2026-11-05", window: "morning" })).status).toBe(201);
  });

  it("holds the visit at the pincode of the client's saved address", async () => {
    const rohit = await client(false, { withoutAddress: true });
    await savedAddress(rohit.id, "122011");
    const { id } = await (await hold(rohit, TUESDAY_AFTERNOON)).json<{ id: string }>();
    const held = await env.DB.prepare("SELECT pincode FROM slot_holds WHERE id = ?1").bind(id).first();
    expect(held).toEqual({ pincode: "122011" });
  });

  // The owner's ruling of 27 September 2026 (src/policy/booking.ts; ADR 0079).
  it("holds no slot for a client who has not given their address, and says why", async () => {
    const rohit = await client(false, { withoutAddress: true });
    const answer = await hold(rohit, TUESDAY_AFTERNOON);
    expect(answer.status).toBe(409);
    expect((await answer.json<{ error: { code: string } }>()).error.code).toBe("address_required");
    const held = await env.DB.prepare("SELECT COUNT(*) AS holds FROM slot_holds").first();
    expect(held).toEqual({ holds: 0 });

    await savedAddress(rohit.id);
    expect((await hold(rohit, TUESDAY_AFTERNOON)).status).toBe(201);
  });

  it("moves no visit for a client who has not given their address", async () => {
    const rohit = await client(false, { withoutAddress: true });
    const booked = await visit(rohit.id, "service", "scheduled", "2026-09-24T06:30:00.000Z", IMRAN);
    await env.DB.prepare("UPDATE appointments SET fsm_work_order_id = 'fsm-order-1' WHERE id = ?1").bind(booked).run();
    const move = { ...TUESDAY_AFTERNOON, date: "2026-09-25", moving: booked };
    const answer = await hold(rohit, move);
    expect(answer.status).toBe(409);
    expect((await answer.json<{ error: { code: string } }>()).error.code).toBe("address_required");

    await savedAddress(rohit.id);
    expect((await hold(rohit, move)).status).toBe(201);
  });

  it("shows a hold as lapsed once its ten minutes are up, and lets the client release it", async () => {
    const rohit = await client();
    const { id } = await (await hold(rohit, TUESDAY_AFTERNOON)).json<{ id: string }>();
    const lapsed = await request(later(11), `/api/holds/${id}`, { headers: { Cookie: rohit.cookie } });
    expect(await lapsed.json()).toMatchObject({ state: "expired" });

    const release = await request(app, `/api/holds/${id}`, {
      method: "DELETE",
      headers: { Cookie: rohit.cookie, Origin: "https://maneman.test" },
    });
    expect(release.status).toBe(204);
    const released = await request(app, `/api/holds/${id}`, { headers: { Cookie: rohit.cookie } });
    expect(await released.json()).toMatchObject({ state: "released" });
  });
});

describe("what a client may book, and when (docs/decisions/0068-a-paid-hold-is-kept.md)", () => {
  const availability = async (who: { cookie: string }, type = "service") =>
    (await request(app, `/api/availability?type=${type}`, { headers: { Cookie: who.cookie } })).json<{
      days: { date: string; price: { amount: number }; windows: { with: string | null }[] }[];
    }>();

  it("offers no second first fit while one is still to happen, nor starts paying for one (LIFE-09)", async () => {
    const lead = await client(true);
    const first = await (
      await hold(lead, { type: "first_fit", date: "2026-09-24", window: "morning" })
    ).json<{
      id: string;
    }>();
    // Ops booked the first fit in FSM meanwhile.
    await visit(lead.id, "first_fit", "scheduled", "2026-09-25T03:30:00.000Z", SANDEEP);
    const second = await hold(lead, { type: "first_fit", date: "2026-09-26", window: "morning" });
    expect(second.status).toBe(422);
    const paying = await request(app, "/api/bookings", {
      method: "POST",
      headers: { Cookie: lead.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ hold_id: first.id }),
    });
    expect(paying.status).toBe(409);
  });

  it("offers nothing, and holds nothing, on a day ops blacked out (BIZ-25)", async () => {
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-09-23', 'Dussehra')").run();
    const rohit = await client();
    const { days } = await availability(rohit);
    expect(days.find((day) => day.date === "2026-09-23")?.windows.map((window) => window.with)).toEqual([
      null,
      null,
      null,
    ]);
    expect((await hold(rohit, { type: "service", date: "2026-09-23", window: "afternoon" })).status).toBe(409);
  });

  it("prices each day at the price in force on it (OPS-14)", async () => {
    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('service', 'standard', 210000, 0, '2026-09-25')",
    ).run();
    const { days } = await availability(await client());
    expect(days.find((day) => day.date === "2026-09-24")?.price.amount).toBe(200000);
    expect(days.find((day) => day.date === "2026-09-25")?.price.amount).toBe(210000);
  });
});

/**
 * A service of the client's choosing (docs/decisions/0085-services-ops-can-edit.md): each kind's services are ops',
 * each priced, timed and retired from a day in the console, and a booking names the one it is for.
 */
describe("choosing a service", () => {
  /** A service ops added, priced from January. */
  async function service(kind: string, tier: string, name: string, minutes: number, paise: number, retired?: string) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, retired_date, updated_by, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, 'ops@localhost', ?6)`,
      ).bind(kind, tier, name, minutes, retired ?? null, NOW.toISOString()),
      env.DB.prepare(
        "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES (?1, ?2, ?3, 0, '2026-01-01')",
      ).bind(kind, tier, paise),
    ]);
  }

  interface Days {
    service: { tier: string; name: string; minutes: number };
    price: { amount_ex_gst: number };
    days: { date: string; windows: { window: string; with: string | null }[] }[];
  }
  const availabilityOf = async (who: { cookie: string }, query: string) =>
    (await request(app, `/api/availability?${query}`, { headers: { Cookie: who.cookie } })).json<Days>();

  it("lists on Home every service offered of each kind the client may book now, with its price tomorrow", async () => {
    const rohit = await client();
    await service("replacement", "premium", "Premium replacement", 150, 3_000_000);
    await service("first_fit", "premium", "Premium first fit", 240, 4_000_000);
    await service("service", "lace", "Lace service", 90, 250_000, "2026-09-22");

    const me = await (
      await request(app, "/api/me", { headers: { Cookie: rohit.cookie } })
    ).json<{
      booking: { types: string[]; services: { type: string; tier: string; name: string; minutes: number }[] };
    }>();

    // A fitted client books service visits and replacements, and sees every one of either kind: not the first
    // fit, which is not theirs to book, nor the service retired from tomorrow.
    expect(me.booking.types).toEqual(["service", "replacement"]);
    expect(me.booking.services).toEqual([
      expect.objectContaining({ type: "service", tier: "standard", name: "Service visit", minutes: 90 }),
      expect.objectContaining({ type: "replacement", tier: "standard", name: "Replacement", minutes: 135 }),
      expect.objectContaining({ type: "replacement", tier: "premium", name: "Premium replacement", minutes: 150 }),
    ]);
  });

  it("offers a longer service only where its half-slots fit, and holds it for its own length and price", async () => {
    const lead = await client(true);
    // Seven half-slots: from the morning's first two only (src/policy/visit-length.ts).
    await service("first_fit", "premium", "Premium first fit", 300, 4_000_000);

    const offered = await availabilityOf(lead, "type=first_fit&tier=premium");
    expect(offered.service).toEqual({ tier: "premium", name: "Premium first fit", minutes: 300 });
    expect(offered.price.amount_ex_gst).toBe(4_000_000);
    expect(offered.days[0]?.windows.map((window) => window.with)).toEqual(["regular", null, null]);

    const held = await hold(lead, { type: "first_fit", tier: "premium", date: "2026-09-22", window: "morning" });
    expect(held.status).toBe(201);
    expect(await held.json()).toMatchObject({
      service: { tier: "premium", name: "Premium first fit", minutes: 300 },
      price: { amount_ex_gst: 4_000_000 },
      // The late fee is its kind's, one figure a kind.
      late_fee: { amount_ex_gst: 400_000 },
      starts_at: "2026-09-22T03:30:00.000Z",
      ends_at: "2026-09-22T08:30:00.000Z",
    });
    const kept = await env.DB.prepare("SELECT tier, minutes, amount_ex_gst FROM slot_holds").first();
    expect(kept).toEqual({ tier: "premium", minutes: 300, amount_ex_gst: 4_000_000 });
    const claims = await env.DB.prepare("SELECT claim FROM slot_claims ORDER BY claim").all<{ claim: string }>();
    expect(claims.results.map((claim) => claim.claim)).toEqual([
      "unit:0",
      "unit:1",
      "unit:2",
      "unit:3",
      "unit:4",
      "unit:5",
      "unit:6",
      "window:morning",
    ]);
  });

  it("keeps a visit of a longer service from being overlapped, as long as its service is", async () => {
    const rohit = await client();
    await service("first_fit", "premium", "Premium first fit", 300, 4_000_000);
    // Imran fits a premium first fit from 9 am on Wednesday: seven half-slots, into the evening's first.
    const booked = await visit(null, "first_fit", "scheduled", "2026-09-23T03:30:00.000Z", IMRAN);
    await env.DB.prepare("UPDATE appointments SET tier = 'premium' WHERE id = ?1").bind(booked).run();

    const offered = await availabilityOf(rohit, "type=service&from=2026-09-23");
    expect(offered.days[0]?.windows.map((window) => window.with)).toEqual(["another", "another", "another"]);

    // The same visit as the standard first fit, four half-slots, leaves Imran the afternoon and the evening.
    await env.DB.prepare("UPDATE appointments SET tier = NULL WHERE id = ?1").bind(booked).run();
    const standard = await availabilityOf(rohit, "type=service&from=2026-09-23");
    expect(standard.days[0]?.windows.map((window) => window.with)).toEqual(["another", "regular", "regular"]);
  });

  it("books the kind's standard service where the booking names none, as an app from before services does", async () => {
    const held = await (
      await hold(await client(), { type: "service", date: "2026-09-22", window: "afternoon" })
    ).json();
    expect(held).toMatchObject({ service: { tier: "standard", name: "Service visit", minutes: 90 } });
  });

  it("offers no service its kind does not hold, nor one from the day it is retired", async () => {
    const rohit = await client();
    const gold = await hold(rohit, { type: "service", tier: "gold", date: "2026-09-22", window: "afternoon" });
    expect(gold.status).toBe(422);
    await service("service", "premium", "Premium service", 90, 250_000, "2026-09-24");

    const offered = await availabilityOf(rohit, "type=service&tier=premium");
    expect(offered.days.map((day) => day.windows.some((window) => window.with !== null))).toEqual([
      true,
      true,
      ...Array.from({ length: 12 }, () => false),
    ]);
    const onTheDay = { type: "service", tier: "premium", date: "2026-09-24", window: "afternoon" };
    expect((await hold(rohit, onTheDay)).status).toBe(422);
    expect((await hold(rohit, { ...onTheDay, date: "2026-09-23" })).status).toBe(201);
  });

  it("offers a kind's service to nobody who may not book the kind", async () => {
    const lead = await client(true);
    await service("service", "premium", "Premium service", 90, 250_000);
    const answer = await request(app, "/api/availability?type=service&tier=premium", {
      headers: { Cookie: lead.cookie },
    });
    expect(answer.status).toBe(422);
  });
});
