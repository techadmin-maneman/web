// Booking in the app: availability and holds (docs/decisions/0045-self-serve-booking.md). NOW is Monday
// 21 September 2026, 12 noon in India, so the first bookable day is Tuesday the
// 22nd. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { DEFAULT_SLOT_TIMES, unitAt, windowAt } from "../../../src/policy/slot-times.ts";
import { appFor, fakeDependencies, LOCAL_SETTINGS, markDatabase, NOW, request } from "../helpers.ts";
import {
  IMRAN,
  SANDEEP,
  SANA,
  technician,
  essential,
  client,
  visit,
  later,
  theFirstFit,
} from "./client-booking-fixtures.ts";

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
  await theFirstFit();
});

describe("the working day", () => {
  it("reads a time of day as its half-slot and window", () => {
    const unit = (time: string) => unitAt(time, DEFAULT_SLOT_TIMES);
    const window = (time: string) => windowAt(time, DEFAULT_SLOT_TIMES);
    expect([unit("09:00"), unit("11:15"), unit("12:00"), unit("18:30")]).toEqual([0, 1, 2, 7]);
    expect([window("09:30"), window("12:00"), window("16:00")]).toEqual(["morning", "afternoon", "evening"]);
  });
});

describe("GET /api/availability", () => {
  it("offers 14 days from tomorrow, each window open where a technician is free", async () => {
    const rohit = await client();
    const answer = await request(app, "/api/availability?type=service", { headers: { Cookie: rohit.cookie } });
    expect(answer.status).toBe(200);
    const body = await answer.json<{
      price: object;
      days: { date: string; windows: { window: string; open: boolean }[] }[];
    }>();
    expect(body.price).toEqual({ amount_ex_gst: 200000, amount: 200000, gst_percent: 0 });
    // Who would come is never promised.
    expect(body).not.toHaveProperty("regular");
    expect(body.days).toHaveLength(14);
    expect(body.days[0]).toMatchObject({
      date: "2026-09-22",
      price: { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 },
      // Each window with its hours that day (docs/decisions/0102-window-times.md). At noon on Monday, Tuesday's
      // morning and noon windows are already inside the 24 hours, so a service visit booked in them is charged to change.
      windows: [
        { window: "morning", start: "09:00", end: "12:00", open: true, change_charged: true },
        { window: "afternoon", start: "12:00", end: "16:00", open: true, change_charged: true },
        { window: "evening", start: "16:00", end: "20:00", open: true, change_charged: false },
      ],
    });
  });

  // A window inside the notice is still sold, and marked.
  it("marks only the windows inside the notice ops set, and none where the kind costs nothing to change late", async () => {
    type Marks = { change_notice_hours: number; days: { windows: { change_charged: boolean }[] }[] };
    const opsSet = (name: string, value: unknown) =>
      env.DB.prepare("INSERT OR REPLACE INTO ops_settings (name, value, set_by, set_at) VALUES (?1, ?2, 'ops', ?3)")
        .bind(name, JSON.stringify(value), NOW.toISOString())
        .run();
    const rohit = await client();
    // A new isolate each time, so the settings are read afresh rather than from the minute's cache.
    const marks = async () => {
      const answer = await request(later(0), "/api/availability?type=service", { headers: { Cookie: rohit.cookie } });
      const body = await answer.json<Marks>();
      return { hours: body.change_notice_hours, firstTwoDays: body.days.slice(0, 2).map((day) => day.windows) };
    };

    await opsSet("change_notice_hours", 48);
    const inside48 = await marks();
    expect(inside48.hours).toBe(48);
    expect(inside48.firstTwoDays.map((windows) => windows.map((each) => each.change_charged))).toEqual([
      [true, true, true],
      [true, true, false],
    ]);

    await opsSet("late_change_charge", {
      consultation: "nothing",
      first_fit: "late_fee",
      service: "nothing",
      replacement: "visit",
    });
    const neverCharged = await marks();
    expect(neverCharged.firstTwoDays.flat().map((each) => each.change_charged)).not.toContain(true);
  });

  it("leaves the evening off a first fit, which cannot start that late, and names the last day to ask for", async () => {
    const lead = await client(true);
    await essential();
    const ask = async (from: string) =>
      (
        await request(app, `/api/availability?type=first_fit&tier=essential&from=${from}`, {
          headers: { Cookie: lead.cookie },
        })
      ).json<{ last: string; days: { date: string; windows: { window: string }[] }[] }>();
    const first = await ask("2026-09-22");
    expect(first.days[0]?.windows.map((each) => each.window)).toEqual(["morning", "afternoon"]);
    // Forty-five days from tomorrow.
    expect(first.last).toBe("2026-11-05");

    // "Later dates" asks from the day after the last shown; the strip still ends on the last day.
    const later = await ask("2026-11-01");
    expect(later.days[0]?.date).toBe("2026-10-23");
    expect(later.days.at(-1)?.date).toBe("2026-11-05");
  });

  // A technician never takes two of a client's visits in a row (docs/decisions/0111).
  // Never the same technician twice in a row, unless nobody else in the city is free (ADR 0117).
  it("keeps a window open with the technician of the client's last visit where nobody else is free", async () => {
    const rohit = await client(false, { lastWith: IMRAN });
    const strip = async () =>
      (
        await request(app, "/api/availability?type=service&from=2026-09-23", { headers: { Cookie: rohit.cookie } })
      ).json<{ days: { windows: { window: string; open: boolean }[] }[] }>();
    expect((await strip()).days[0]?.windows[1]).toMatchObject({ window: "afternoon", open: true });

    await visit(null, "first_fit", "dispatched", "2026-09-23T07:30:00.000Z", SANDEEP); // Wednesday, 1 pm
    expect((await strip()).days[0]?.windows[1]).toMatchObject({ window: "afternoon", open: true });
  });

  it("keeps a window open with the technician of the client's next visit where nobody else is free", async () => {
    const rohit = await client();
    await visit(rohit.id, "service", "scheduled", "2026-09-28T06:30:00.000Z", IMRAN); // next Monday, with Imran
    await visit(null, "first_fit", "dispatched", "2026-09-23T07:30:00.000Z", SANDEEP); // Wednesday, 1 pm
    const strip = await (
      await request(app, "/api/availability?type=service&from=2026-09-23", { headers: { Cookie: rohit.cookie } })
    ).json<{ days: { windows: { window: string; open: boolean }[] }[] }>();
    expect(strip.days[0]?.windows[1]).toMatchObject({ window: "afternoon", open: true });
  });

  it("will not offer a kind of visit the client may not book, and is off where self-serve booking is", async () => {
    const lead = await client(true);
    const service = await request(app, "/api/availability?type=service", { headers: { Cookie: lead.cookie } });
    expect(service.status).toBe(422);
    const firstFit = await request(app, "/api/availability?type=first_fit&tier=standard", {
      headers: { Cookie: lead.cookie },
    });
    expect(firstFit.status).toBe(200);

    const off = appFor(
      "local",
      fakeDependencies(),
      { ...LOCAL_SETTINGS, selfServeBooking: false, selfServeConsultations: false },
      "client",
    );
    const answer = await request(off, "/api/availability?type=first_fit", { headers: { Cookie: lead.cookie } });
    expect(answer.status).toBe(409);
    expect((await answer.json<{ error: { code: string } }>()).error.code).toBe("ops_assisted");
  });

  // At launch with no online payment: a consultation costs nothing, so the client books it; a paid visit goes to ops.
  it("books a consultation itself while online payment is off, and sends a paid visit to ops", async () => {
    const lead = await client(true);
    const free = appFor("local", fakeDependencies(), { ...LOCAL_SETTINGS, selfServeBooking: false }, "client");
    const ask = (path: string) => request(free, path, { headers: { Cookie: lead.cookie } });

    // This lead has had their consultation, so none is offered again; but the app asked, and was not sent to ops.
    expect((await ask("/api/availability?type=consultation")).status).not.toBe(409);
    const firstFit = await ask("/api/availability?type=first_fit&tier=standard");
    expect(firstFit.status).toBe(409);
    expect((await firstFit.json<{ error: { code: string } }>()).error.code).toBe("ops_assisted");
    const me = await (await ask("/api/me")).json<{ booking: { self_serve: boolean; self_serve_kinds: string[] } }>();
    expect(me.booking).toMatchObject({ self_serve: false, self_serve_kinds: ["consultation"] });
  });
});

describe("what a client may book, and when (docs/decisions/0068-a-paid-hold-is-kept.md)", () => {
  const availability = async (who: { cookie: string }, type = "service") =>
    (await request(app, `/api/availability?type=${type}`, { headers: { Cookie: who.cookie } })).json<{
      days: { date: string; price: { amount: number }; windows: { open: boolean }[] }[];
    }>();

  it("offers no second first fit while one is still to happen, nor starts paying for one", async () => {
    const lead = await client(true);
    const first = await (
      await hold(lead, { type: "first_fit", tier: "standard", date: "2026-09-24", window: "morning" })
    ).json<{
      id: string;
    }>();
    // Ops booked the first fit in FSM meanwhile.
    await visit(lead.id, "first_fit", "scheduled", "2026-09-25T03:30:00.000Z", SANDEEP);
    const second = await hold(lead, { type: "first_fit", tier: "standard", date: "2026-09-26", window: "morning" });
    expect(second.status).toBe(422);
    const paying = await request(app, "/api/bookings", {
      method: "POST",
      headers: { Cookie: lead.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ hold_id: first.id }),
    });
    expect(paying.status).toBe(409);
  });

  it("offers nothing, and holds nothing, on a day ops blacked out", async () => {
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-09-23', 'Dussehra')").run();
    const rohit = await client();
    const { days } = await availability(rohit);
    expect(days.find((day) => day.date === "2026-09-23")?.windows.map((window) => window.open)).toEqual([
      false,
      false,
      false,
    ]);
    expect((await hold(rohit, { type: "service", date: "2026-09-23", window: "afternoon" })).status).toBe(409);
  });

  it("prices each day at the price in force on it", async () => {
    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('service', 'standard', 210000, 0, '2026-09-25')",
    ).run();
    const { days } = await availability(await client());
    expect(days.find((day) => day.date === "2026-09-24")?.price.amount).toBe(200000);
    expect(days.find((day) => day.date === "2026-09-25")?.price.amount).toBe(210000);
  });
});
