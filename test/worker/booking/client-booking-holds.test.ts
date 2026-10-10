// Booking in the app: availability and holds (docs/decisions/0045-self-serve-booking.md),
// over the window-to-slot map (0035) and the clash check (0034). NOW is Monday
// 21 September 2026, 12 noon in India, so the first bookable day is Tuesday the
// 22nd. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, d1TripsOf, fakeDependencies, markDatabase, NOW, request, savedAddress } from "../helpers.ts";
import { IMRAN, SANDEEP, SANA, technician, essential, client, visit, later } from "./client-booking-fixtures.ts";

/** The most round trips to D1 a hold may wait on in turn. It waited on 17 when each read waited for the one before. */
const HOLD_TRIPS = 9;

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

describe("POST /api/holds", () => {
  const TUESDAY_AFTERNOON = { type: "service", date: "2026-09-22", window: "afternoon" };

  it("holds the window for ten minutes, at the price book's price", async () => {
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
      // Moving is free until 24 hours before the window opens, and a service visit moved later is charged.
      free_until: "2026-09-21T06:30:00.000Z",
      change_notice_hours: 24,
      late_change_charge: "visit",
      expires_at: "2026-09-21T06:40:00.000Z",
      // A payment still counts for the two minutes' grace after the ten.
      pay_by: "2026-09-21T06:42:00.000Z",
      state: "held",
    });
  });

  // Each D1 read is a round trip to the database's region, so the hold's reads that need nothing from each
  // other go together.
  it("waits on few round trips to D1", async () => {
    const rohit = await client();
    const answer = await hold(rohit, TUESDAY_AFTERNOON);
    expect(answer.status).toBe(201);
    expect(d1TripsOf(answer)).toBeLessThanOrEqual(HOLD_TRIPS);
  });

  it("never holds a client's visit with the technician of the visit before it, nor the one after", async () => {
    const rohit = await client(false, { lastWith: IMRAN });
    expect(await (await hold(rohit, TUESDAY_AFTERNOON)).json()).toMatchObject({
      technician: { name: "Sandeep Rawat" },
    });

    const vikram = await client(false, { lastWith: IMRAN });
    await visit(vikram.id, "service", "scheduled", "2026-09-28T06:30:00.000Z", SANDEEP);
    const between = await hold(vikram, { ...TUESDAY_AFTERNOON, date: "2026-09-24" });
    expect(between.status).toBe(409);
    expect((await between.json<{ error: { code: string } }>()).error.code).toBe("taken");
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

  // A client whose app closed before they paid, and who comes back inside the hold's life: the hold they are asking
  // for lets their unpaid one go, so it stands in nobody's way, theirs least of all.
  it("offers a client their own unpaid window, and holds it again with the same technician", async () => {
    const rohit = await client();
    expect(await (await hold(rohit, TUESDAY_AFTERNOON)).json()).toMatchObject({
      technician: { name: "Imran Qureshi" },
    });
    const other = await client();
    expect(await (await hold(other, TUESDAY_AFTERNOON)).json()).toMatchObject({
      technician: { name: "Sandeep Rawat" },
    });

    const offered = await (
      await request(app, "/api/availability?type=service&from=2026-09-22", { headers: { Cookie: rohit.cookie } })
    ).json<{ days: { windows: { window: string; open: boolean }[] }[] }>();
    expect(offered.days[0]?.windows[1]).toMatchObject({ window: "afternoon", open: true });
    const again = await hold(rohit, TUESDAY_AFTERNOON);
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ technician: { name: "Imran Qureshi" } });
  });

  it("keeps the time of a client's hold already at Checkout through its grace, which a payment may yet land on", async () => {
    const rohit = await client();
    await hold(rohit, TUESDAY_AFTERNOON);
    await env.DB.prepare("UPDATE slot_holds SET razorpay_order_id = 'order_e2e' WHERE person_id = ?1")
      .bind(rohit.id)
      .run();
    // Eleven minutes on, its countdown is over but its two minutes' grace are not.
    expect(await (await hold(rohit, TUESDAY_AFTERNOON, later(11))).json()).toMatchObject({
      technician: { name: "Sandeep Rawat" },
    });
  });

  describe("a client back from Checkout without paying", () => {
    const startPaying = (who: { cookie: string }, holdId: string) =>
      request(app, "/api/bookings", {
        method: "POST",
        headers: { Cookie: who.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ hold_id: holdId }),
      });
    const afternoonOf = async (who: { cookie: string }) => {
      const offered = await (
        await request(app, "/api/availability?type=service&from=2026-09-22", { headers: { Cookie: who.cookie } })
      ).json<{ days: { windows: { window: string; open: boolean }[] }[] }>();
      return offered.days[0]?.windows.find((each) => each.window === "afternoon");
    };

    beforeEach(async () => {
      // One technician, so a window held by one hold is full to everyone else.
      await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SANDEEP).run();
    });

    it("sees the window they were paying for still open, and gets their hold back on its order", async () => {
      const rohit = await client();
      const first = await (await hold(rohit, TUESDAY_AFTERNOON)).json<{ id: string }>();
      const paying = await (await startPaying(rohit, first.id)).json<{ checkout: { order_id: string } }>();

      expect(await afternoonOf(rohit)).toMatchObject({ open: true });
      expect(await afternoonOf(await client())).toMatchObject({ open: false });
      const again = await hold(rohit, TUESDAY_AFTERNOON);
      expect(again.status).toBe(201);
      expect(await again.json()).toMatchObject({ id: first.id, expires_at: "2026-09-21T06:40:00.000Z" });
      const repaying = await (await startPaying(rohit, first.id)).json<{ checkout: { order_id: string } }>();
      expect(repaying.checkout.order_id).toBe(paying.checkout.order_id);
    });

    it("finds the window taken once the hold's countdown is over and only its grace is left", async () => {
      const rohit = await client();
      const first = await (await hold(rohit, TUESDAY_AFTERNOON)).json<{ id: string }>();
      await startPaying(rohit, first.id);
      const again = await hold(rohit, TUESDAY_AFTERNOON, later(11));
      expect(again.status).toBe(409);
      expect((await again.json<{ error: { code: string } }>()).error.code).toBe("taken");
    });
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
    expect(await held.json()).toMatchObject({
      expires_at: "2026-09-21T06:45:00.000Z",
      pay_by: "2026-09-21T06:50:00.000Z",
    });
    await hold(second, TUESDAY_AFTERNOON);
    const third = await client();
    expect((await hold(third, TUESDAY_AFTERNOON, later(19))).status).toBe(409);
    expect((await hold(third, TUESDAY_AFTERNOON, later(21))).status).toBe(201);
  });

  it("sells a hold under the terms ops set, and keeps them on it", async () => {
    const opsSet = (name: string, value: unknown) =>
      env.DB.prepare("INSERT INTO ops_settings (name, value, set_by, set_at) VALUES (?1, ?2, 'ops', ?3)")
        .bind(name, JSON.stringify(value), NOW.toISOString())
        .run();
    await opsSet("change_notice_hours", 12);
    await opsSet("late_change_charge", {
      consultation: "nothing",
      first_fit: "late_fee",
      service: "nothing",
      replacement: "visit",
    });
    await opsSet("no_show_charge", {
      consultation: "nothing",
      first_fit: "visit",
      service: "visit",
      replacement: "visit",
    });
    const rohit = await client();
    const held = await (await hold(rohit, TUESDAY_AFTERNOON)).json<{ id: string }>();
    expect(held).toMatchObject({
      free_until: "2026-09-21T18:30:00.000Z",
      change_notice_hours: 12,
      late_change_charge: "nothing",
    });
    const kept = await env.DB.prepare(
      "SELECT change_notice_hours, late_change_charge, no_show_charge FROM slot_holds WHERE id = ?1",
    )
      .bind(held.id)
      .first();
    expect(kept).toEqual({ change_notice_hours: 12, late_change_charge: "nothing", no_show_charge: "visit" });
  });

  // What the pay step says a late change costs is what the hold was sold under (docs/decisions/0088-every-policy-in-the-console.md).
  it("answers a late fee only where the hold was sold to charge one", async () => {
    const lead = await client(true);
    const byFee = await (
      await hold(lead, { type: "first_fit", tier: "standard", date: "2026-09-24", window: "morning" })
    ).json();
    expect(byFee).toMatchObject({ late_change_charge: "late_fee", late_fee: { amount_ex_gst: 400000 } });

    await env.DB.prepare(
      "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('late_change_charge', ?1, 'ops', ?2)",
    )
      .bind(
        JSON.stringify({ consultation: "nothing", first_fit: "visit", service: "visit", replacement: "late_fee" }),
        NOW.toISOString(),
      )
      .run();
    const other = await client(true);
    // A new isolate, so the setting is read afresh rather than from the minute's cache.
    const afresh = later(0);
    const byVisit = await (
      await hold(other, { type: "first_fit", tier: "standard", date: "2026-09-25", window: "morning" }, afresh)
    ).json();
    expect(byVisit).toMatchObject({ late_change_charge: "visit", late_fee: null });
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
    await essential();
    const answer = await hold(lead, { type: "first_fit", tier: "essential", date: "2026-09-24", window: "morning" });
    expect(await answer.json()).toMatchObject({
      price: { amount_ex_gst: 3000000, amount: 3000000 },
      late_fee: { amount_ex_gst: 400000, amount: 400000 },
      ends_at: "2026-09-24T06:30:00.000Z",
    });
    expect(
      (await hold(lead, { type: "first_fit", tier: "essential", date: "2026-11-06", window: "morning" })).status,
    ).toBe(422);
    expect(
      (await hold(lead, { type: "first_fit", tier: "essential", date: "2026-09-21", window: "evening" })).status,
    ).toBe(422);
    expect(
      (await hold(lead, { type: "first_fit", tier: "essential", date: "2026-11-05", window: "morning" })).status,
    ).toBe(201);
  });

  it("holds the visit at the pincode of the client's saved address", async () => {
    const rohit = await client(false, { withoutAddress: true });
    await savedAddress(rohit.id, "122011");
    const { id } = await (await hold(rohit, TUESDAY_AFTERNOON)).json<{ id: string }>();
    const held = await env.DB.prepare("SELECT pincode FROM slot_holds WHERE id = ?1").bind(id).first();
    expect(held).toEqual({ pincode: "122011" });
  });

  // An address before any slot (src/policy/booking.ts; ADR 0079).
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

  // No route in the app read the service area, so a client whose address was out of it held, paid and booked.
  describe("for an address in a pincode we do not come to", () => {
    const addressAt = (personId: string, pincode: string) =>
      env.DB.prepare(
        `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
         VALUES (?1, ?2, ?3, 'House 9', 'Bandra West', 'Mumbai', ?4)`,
      )
        .bind(crypto.randomUUID(), personId, NOW.toISOString(), pincode)
        .run();
    const days = (who: { cookie: string }, query = "type=service") =>
      request(app, `/api/availability?${query}`, { headers: { Cookie: who.cookie } });
    const codeOf = async (answer: Response) => (await answer.json<{ error: { code: string } }>()).error.code;

    it.each([
      ["ops switched off", "400050", true],
      ["we do not hold", "411001", false],
    ])("offers no days and holds nothing in a pincode %s", async (_, pincode, held) => {
      if (held) {
        await env.DB.prepare(
          "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES (?1, 'Bandra', 'Mumbai', 0)",
        )
          .bind(pincode)
          .run();
      }
      const rohit = await client(false, { withoutAddress: true });
      await addressAt(rohit.id, pincode);

      const offered = await days(rohit);
      expect(offered.status).toBe(422);
      expect(await codeOf(offered)).toBe("not_served");
      const refused = await hold(rohit, TUESDAY_AFTERNOON);
      expect(refused.status).toBe(422);
      expect(await codeOf(refused)).toBe("not_served");
      expect(await env.DB.prepare("SELECT COUNT(*) AS holds FROM slot_holds").first()).toEqual({ holds: 0 });
    });

    it("moves no visit once ops stop serving the address's pincode", async () => {
      const rohit = await client();
      const booked = await visit(rohit.id, "service", "scheduled", "2026-09-24T06:30:00.000Z", IMRAN);
      await env.DB.prepare("UPDATE appointments SET fsm_work_order_id = 'fsm-order-1' WHERE id = ?1")
        .bind(booked)
        .run();
      await env.DB.prepare("UPDATE serviceable_pincodes SET served = 0 WHERE pincode = '122018'").run();

      const offered = await days(rohit, `type=service&moving=${booked}`);
      expect(await codeOf(offered)).toBe("not_served");
      const moved = await hold(rohit, { ...TUESDAY_AFTERNOON, date: "2026-09-25", moving: booked });
      expect(moved.status).toBe(422);
      expect(await codeOf(moved)).toBe("not_served");
    });
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
