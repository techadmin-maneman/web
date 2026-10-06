// Booking in the app: availability and holds (docs/decisions/0045-self-serve-booking.md),
// over the window-to-slot map (0035) and the clash check (0034). NOW is Monday
// 21 September 2026, 12 noon in India, so the first bookable day is Tuesday the
// 22nd. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, SANDEEP, SANA, technician, client, visit } from "./client-booking-fixtures.ts";

let app: App;

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
  await technician(SANA, "Sana Mirza", "SM");
  await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SANA).run();
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
    days: { date: string; windows: { window: string; open: boolean }[] }[];
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
    // A window it cannot start in is left out, rather than offered as full.
    expect(offered.days[0]?.windows.map(({ window, open }) => ({ window, open }))).toEqual([
      { window: "morning", open: true },
    ]);

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
    // Sandeep took the client's last visit, so only Imran's time is offered.
    const rohit = await client(false, { lastWith: SANDEEP });
    await service("first_fit", "premium", "Premium first fit", 300, 4_000_000);
    // Imran fits a premium first fit from 9 am on Wednesday: seven half-slots, into the evening's first.
    const booked = await visit(null, "first_fit", "scheduled", "2026-09-23T03:30:00.000Z", IMRAN);
    await env.DB.prepare("UPDATE appointments SET tier = 'premium' WHERE id = ?1").bind(booked).run();

    const offered = await availabilityOf(rohit, "type=service&from=2026-09-23");
    expect(offered.days[0]?.windows.map((window) => window.open)).toEqual([false, false, false]);

    // The same visit as the standard first fit, four half-slots, leaves Imran the afternoon and the evening.
    await env.DB.prepare("UPDATE appointments SET tier = NULL WHERE id = ?1").bind(booked).run();
    const standard = await availabilityOf(rohit, "type=service&from=2026-09-23");
    expect(standard.days[0]?.windows.map((window) => window.open)).toEqual([false, true, true]);
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
    expect(offered.days.map((day) => day.windows.some((window) => window.open))).toEqual([
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

  // Only the hair systems ops offer, and no generic first fit in their place.
  describe("a first fit, sold only as a hair system ops offer", () => {
    /** Ops retire the first fit the migrations began with, as they retire any service in the console. */
    const retireTheFirstFit = () =>
      env.DB.prepare(
        "UPDATE services SET retired_date = '2026-09-01' WHERE kind = 'first_fit' AND tier = 'standard'",
      ).run();
    const codeOf = async (answer: Response) => (await answer.json<{ error: { code: string } }>()).error.code;

    it("lists on Home only the hair systems ops offer, by their names and prices", async () => {
      const lead = await client(true);
      await retireTheFirstFit();
      await service("first_fit", "essential", "Mane Man Essential", 180, 3_200_000);

      const me = await (
        await request(app, "/api/me", { headers: { Cookie: lead.cookie } })
      ).json<{
        booking: { services: { type: string; tier: string; name: string }[]; next: { tier: string | null } | null };
      }>();
      expect(me.booking.services).toEqual([
        expect.objectContaining({ type: "first_fit", tier: "essential", name: "Mane Man Essential" }),
      ]);
      expect(me.booking.next).toMatchObject({ tier: "essential" });
    });

    it("gives each hair system on Home the line ops wrote for it, and none where they wrote none", async () => {
      const lead = await client(true);
      await retireTheFirstFit();
      await service("first_fit", "essential", "Mane Man Essential", 180, 3_200_000);
      await service("first_fit", "active", "Mane Man Active", 180, 3_600_000);
      await env.DB.prepare(
        "UPDATE services SET description = 'Built for everyday wear.' WHERE kind = 'first_fit' AND tier = 'essential'",
      ).run();

      const me = await (
        await request(app, "/api/me", { headers: { Cookie: lead.cookie } })
      ).json<{ booking: { services: { tier: string; description: string | null }[] } }>();
      expect(me.booking.services.map(({ tier, description }) => ({ tier, description }))).toEqual([
        { tier: "active", description: null },
        { tier: "essential", description: "Built for everyday wear." },
      ]);
    });

    it("books the hair system named, and refuses a first fit that names none", async () => {
      const lead = await client(true);
      await retireTheFirstFit();
      await service("first_fit", "essential", "Mane Man Essential", 180, 3_200_000);

      const unnamed = await hold(lead, { type: "first_fit", date: "2026-09-24", window: "morning" });
      expect(unnamed.status).toBe(422);
      expect(await codeOf(unnamed)).toBe("not_bookable");

      const named = await hold(lead, { type: "first_fit", tier: "essential", date: "2026-09-24", window: "morning" });
      expect(named.status).toBe(201);
      expect(await named.json()).toMatchObject({
        service: { tier: "essential", name: "Mane Man Essential" },
        price: { amount_ex_gst: 3_200_000 },
      });
    });

    it("refuses a first fit as no_product while ops offer no hair system, and lists none", async () => {
      const lead = await client(true);
      await retireTheFirstFit();

      const days = await request(app, "/api/availability?type=first_fit", { headers: { Cookie: lead.cookie } });
      expect(days.status).toBe(422);
      expect(await codeOf(days)).toBe("no_product");
      const held = await hold(lead, { type: "first_fit", tier: "standard", date: "2026-09-24", window: "morning" });
      expect(held.status).toBe(422);
      expect(await codeOf(held)).toBe("no_product");

      const me = await (
        await request(app, "/api/me", { headers: { Cookie: lead.cookie } })
      ).json<{
        booking: { types: string[]; services: unknown[]; next: unknown };
      }>();
      expect(me.booking.types).toEqual(["first_fit"]);
      expect(me.booking.services).toEqual([]);
      expect(me.booking.next).toMatchObject({ type: "first_fit", tier: null });
    });
  });
});
