// Booking from the public site (docs/decisions/0051-booking-from-the-site.md): the same path the
// referral landing takes, without an invite. NOW is Monday 21 September 2026, noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, provedNumberCode, request } from "../helpers.ts";
import { ADDRESS, pincode, VISITOR, post, site, BOOKED_MORNING } from "./consultations-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
});

// A consultation and fit in one visit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md):
// the form books the consultation alone, or the consultation and the first fit in one visit, three hours, with
// nothing paid until the client is fitted. It replaces the consultation with the first fit to follow (item 68), whose
// request the form no longer writes, so the tests of that request went with it.
describe("a consultation and fit in one visit", () => {
  let proved = "";
  const book = (body: object, settings = {}) =>
    request(
      site(settings),
      "/api/consultation",
      post({
        ...VISITOR,
        pincode: "122018",
        date: "2026-09-23",
        window: "morning",
        consent: true,
        address: ADDRESS,
        number_code_id: proved,
        ...body,
      }),
      { CRM_QUEUE: fakeQueue() },
    );
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;

  beforeEach(async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    proved = await provedNumberCode("+919810000002");
  });

  // The one visit sends a technician with stock, and recorded a consent and a person, for any number typed.
  it("is refused, and writes nothing, without a code that proved the number in the last 30 minutes", async () => {
    const other = await provedNumberCode("+919810000003");
    const stale = await provedNumberCode("+919810000002", new Date(NOW.getTime() - 31 * 60_000));
    for (const numberCode of [{ number_code_id: undefined }, { number_code_id: other }, { number_code_id: stale }]) {
      const answer = await book({ one_visit: true, ...numberCode });
      expect(answer.status).toBe(403);
      expect(await answer.json()).toMatchObject({ error: { code: "number_not_proved" } });
    }
    for (const table of ["people", "consents", "slot_holds", "leads", "outbound_messages", "appointments"]) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${table}`)).toBe(0);
    }
  });

  it("refuses a number we know the same way, telling its owner nothing", async () => {
    expect((await book({ one_visit: true })).status).toBe(201);
    const answer = await book({ date: "2026-09-24", one_visit: true, number_code_id: undefined });
    expect(answer.status).toBe(403);
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages").all();
    expect(told.results).toEqual([{ kind: "consultation_confirmation" }]);
  });

  it("asks no code of the consultation alone", async () => {
    const answer = await book({ number_code_id: undefined });
    expect(answer.status).toBe(201);
  });

  it("holds the first fit's three hours with nothing paid, sold to cost nothing if missed or moved", async () => {
    const answer = await book({ one_visit: true });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "booked",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
      credits: false,
      invite: "unknown",
      one_visit: true,
      discount_code: null,
    });
    expect(await count("SELECT COUNT(*) AS n FROM appointments")).toBe(1);
    const held = await env.DB.prepare(
      `SELECT type, tier, minutes, amount, one_visit, late_fee_ex_gst, late_change_charge, no_show_charge,
         confirmed_at IS NOT NULL AS confirmed FROM slot_holds`,
    ).all();
    expect(held.results).toEqual([
      {
        type: "first_fit",
        tier: "standard",
        minutes: 180,
        amount: 0,
        one_visit: 1,
        late_fee_ex_gst: null,
        late_change_charge: "nothing",
        no_show_charge: "nothing",
        confirmed: 1,
      },
    ]);
    expect(await count("SELECT COUNT(*) AS n FROM payments")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM first_fit_requests")).toBe(0);
    // The consent recorded is the consultation's own; whether it covers the fit is counsel's to confirm.
    const consent = await env.DB.prepare("SELECT purpose, notice_version, source FROM consents").all();
    expect(consent.results).toEqual([
      { purpose: "whatsapp_visits", notice_version: "site-consultation-v1", source: "site_booking" },
    ]);
  });

  it("is booked for three hours, marked as one visit, and its client told so", async () => {
    await book({ one_visit: true });

    const visit = await env.DB.prepare("SELECT type, one_visit, window_start, window_end FROM appointments").first();
    expect(visit).toEqual({
      type: "first_fit",
      one_visit: "booked",
      window_start: "2026-09-23T03:30:00.000Z",
      window_end: "2026-09-23T06:30:00.000Z",
    });
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages").all();
    expect(told.results).toEqual([{ kind: "consultation_confirmation" }]);
  });

  it("is on the client's Home as their next visit at once", async () => {
    await book({ one_visit: true });
    const personId = await env.DB.prepare("SELECT person_id FROM slot_holds").first<string>("person_id");
    const session = await openSession(env.DB, {
      kind: "client",
      subjectId: personId ?? "",
      deviceLabel: null,
      now: NOW,
    });
    const client = appFor("local", fakeDependencies(), {}, "client");
    const me = await (await request(client, "/api/me", { headers: { Cookie: `mm_app=${session}` } })).json();
    expect(me).toMatchObject({
      consultation: null,
      being_booked: null,
      next_visit: {
        type: "first_fit",
        date: "2026-09-23",
        window_label: "morning",
        one_visit: { amount: 3_000_000, from: false, code: null },
      },
    });
  });

  it("books the consultation alone when the one visit is not asked for", async () => {
    const answer = await book({});
    expect(await answer.json()).toMatchObject({ state: "booked", one_visit: false });
    const held = await env.DB.prepare("SELECT type, one_visit FROM slot_holds").all();
    expect(held.results).toEqual([{ type: "consultation", one_visit: 0 }]);
  });

  it("refuses the evening, which the first fit's three hours do not fit in, and writes nothing", async () => {
    const answer = await book({ one_visit: true, window: "evening" });
    expect(answer.status).toBe(400);
    expect((await answer.json<{ error: { fields: string[] } }>()).error.fields).toEqual(["window"]);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
  });

  it("asks ops for it while self-serve booking is off, holding nothing", async () => {
    const answer = await book({ one_visit: true }, { selfServeBooking: false });
    expect(await answer.json()).toMatchObject({ state: "requested", one_visit: true });
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(0);
    const asked = await env.DB.prepare("SELECT requested_window, one_visit FROM consultation_requests").all();
    expect(asked.results).toEqual([{ requested_window: "morning", one_visit: 1 }]);
    // Asked again for the same day and window as the consultation alone, the plan asked last stands.
    await book({}, { selfServeBooking: false });
    const again = await env.DB.prepare("SELECT one_visit FROM consultation_requests").all();
    expect(again.results).toEqual([{ one_visit: 0 }]);
  });

  it("is the number's consultation still to happen, so neither can be booked again beside it", async () => {
    expect((await book({ one_visit: true })).status).toBe(201);
    for (const oneVisit of [false, true]) {
      const answer = await book({ date: "2026-09-24", one_visit: oneVisit });
      expect(answer.status).toBe(201);
      expect(await answer.json()).toEqual({ ...BOOKED_MORNING, date: "2026-09-24", one_visit: oneVisit });
    }
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(1);
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages ORDER BY created_at, rowid").all();
    expect(told.results).toEqual([
      { kind: "consultation_confirmation" },
      { kind: "consultation_exists" },
      { kind: "consultation_exists" },
    ]);
  });

  it("leaves nothing behind when its three hours are not free", async () => {
    await env.DB.prepare("UPDATE technicians SET active = 0").run();
    expect((await book({ one_visit: true })).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
  });

  // Only the hair systems ops offer, and no generic first fit in their place.
  describe("while ops offer no hair system", () => {
    beforeEach(async () => {
      await env.DB.prepare("UPDATE services SET retired_date = '2026-09-01' WHERE kind = 'first_fit'").run();
    });

    it.each([
      ["while self-serve booking is on", {}],
      ["while self-serve booking is off", { selfServeBooking: false }],
    ])("is refused as no_product %s, and writes nothing", async (_, settings) => {
      const answer = await book({ one_visit: true }, settings);

      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "no_product" } });
      expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(0);
      expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
      expect(await count("SELECT COUNT(*) AS n FROM consultation_requests")).toBe(0);
    });

    it("still books the consultation alone", async () => {
      const answer = await book({});
      expect(answer.status).toBe(201);
      expect(await answer.json()).toMatchObject({ state: "booked", one_visit: false });
    });
  });

  it("holds the first hair system ops offer for its length, the client choosing theirs at the visit", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE services SET retired_date = '2026-09-01' WHERE kind = 'first_fit'"),
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
         VALUES ('first_fit', 'essential', 'Mane Man Essential', 180, 1, 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
         VALUES ('first_fit', 'essential', 3200000, 0, '2026-01-01')`,
      ),
    ]);

    expect((await book({ one_visit: true })).status).toBe(201);
    const held = await env.DB.prepare("SELECT type, tier, minutes, amount FROM slot_holds").first();
    expect(held).toEqual({ type: "first_fit", tier: "essential", minutes: 180, amount: 0 });
  });
});
