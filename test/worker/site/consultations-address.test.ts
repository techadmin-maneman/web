// Booking from the public site (docs/decisions/0051-booking-from-the-site.md): the same path the
// referral landing takes, without an invite. NOW is Monday 21 September 2026, noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import { ADDRESS, pincode, VISITOR, post, site, BOOKED_MORNING } from "./consultations-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
});

// The full address before a slot is confirmed, on the site too (ADR 0081).
describe("the address the consultation is at", () => {
  const book = (body: object, bindings = {}) =>
    request(
      site(),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, ...body }),
      { CRM_QUEUE: fakeQueue(), ...bindings },
    );
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;

  beforeEach(async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
  });

  it("is asked for: a booking without one is refused, naming it, and nothing is booked", async () => {
    const answer = await book({});
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["address"] } });
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
  });

  it("is refused without the flat or house number, naming it, and nothing is booked", async () => {
    const answer = await book({ address: { ...ADDRESS, flat: null } });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["address.flat"] } });
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(0);
  });

  it("is refused in a pincode other than the one checked, naming it, and nothing is booked", async () => {
    const answer = await book({ address: { ...ADDRESS, pincode: "122017" } });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["address.pincode"] } });
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(0);
  });

  it("becomes the person's address, which the app then shows them", async () => {
    expect((await book({ address: ADDRESS })).status).toBe(201);
    const person = await env.DB.prepare("SELECT id FROM people WHERE mobile_e164 = '+919810000002'").first<{
      id: string;
    }>();
    const session = await openSession(env.DB, {
      kind: "client",
      subjectId: person?.id ?? "",
      deviceLabel: null,
      now: NOW,
    });
    const app = appFor("local", fakeDependencies(), {}, "client");
    const profile = await request(app, "/api/profile", { headers: { Cookie: `mm_app=${session}` } });
    expect((await profile.json<{ address: unknown }>()).address).toEqual({
      ...ADDRESS,
      building: null,
      place_id: null,
    });
  });

  it("is kept with the day asked for, while self-serve booking is off", async () => {
    const answer = await request(
      site({ selfServeBooking: false }),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
      { CRM_QUEUE: fakeQueue() },
    );
    expect(await answer.json()).toMatchObject({ state: "requested" });
    const saved = await env.DB.prepare(
      `SELECT a.line1, a.pincode FROM addresses a JOIN people p ON p.id = a.person_id
       WHERE p.mobile_e164 = '+919810000002' AND a.replaced_at IS NULL`,
    ).first();
    expect(saved).toEqual({ line1: "Palm Grove Society", pincode: "122018" });
  });

  // The form needs no login, only a number: whoever types one must not move where that person's visits go.
  // The page answers as it would for a new number, and only the number's owner is told, on WhatsApp.
  it("never replaces the address a person already has: the visit goes to it, and only WhatsApp says so", async () => {
    await env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name, zoho_lead_id)
       VALUES ('p-known', ?1, '+919810000002', 'Karan Bhatia', 'lead-7')`,
    )
      .bind(NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
       VALUES ('old', 'p-known', '2026-09-01T00:00:00.000Z', 'House 12', 'Sector 45', 'Gurgaon', '122018')`,
    ).run();
    const crm = fakeQueue();
    const messages = fakeQueue();
    const answer = await book({ address: ADDRESS }, { CRM_QUEUE: crm, MESSAGE_QUEUE: messages });

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual(BOOKED_MORNING);
    const addresses = await env.DB.prepare(
      "SELECT id, line1, replaced_at FROM addresses WHERE person_id = 'p-known'",
    ).all();
    expect(addresses.results).toEqual([{ id: "old", line1: "House 12", replaced_at: null }]);
    // Nothing about them changed, so nothing is sent on to Books or the CRM but the booking and its lead.
    const marked = await env.DB.prepare("SELECT books_details_changed_at FROM people WHERE id = 'p-known'").first();
    expect(marked).toEqual({ books_details_changed_at: null });
    expect(crm.sent).not.toContainEqual(expect.objectContaining({ update_person_id: "p-known" }));
    // Only the number's owner hears of it: where the visit goes, and that it is booked.
    const told = await env.DB.prepare("SELECT person_id, kind FROM outbound_messages ORDER BY created_at, rowid").all();
    expect(told.results).toEqual([
      { person_id: "p-known", kind: "address_on_account" },
      { person_id: "p-known", kind: "consultation_confirmation" },
    ]);
    expect(messages.sent).toHaveLength(2);
  });

  describe("on the account of a number we know", () => {
    beforeEach(async () => {
      await env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p-known', ?1, '+919810000002', 'Karan Bhatia')",
      )
        .bind(NOW.toISOString())
        .run();
    });
    const onAccount = (pin: string) =>
      env.DB.prepare(
        `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
         VALUES ('old', 'p-known', '2026-09-01T00:00:00.000Z', 'House 12', 'Sushant Lok', 'Gurgaon', ?1)`,
      )
        .bind(pin)
        .run();
    const told = async () =>
      (await env.DB.prepare("SELECT kind FROM outbound_messages ORDER BY rowid").all<{ kind: string }>()).results.map(
        (row) => row.kind,
      );

    it("is the one checked and booked, while the page names the place typed, as for a new number", async () => {
      await pincode("122011", "Sushant Lok", "Gurgaon", true);
      await onAccount("122011");
      const answer = await book({ address: ADDRESS });

      expect(answer.status).toBe(201);
      expect(await answer.json()).toEqual(BOOKED_MORNING);
      const held = await env.DB.prepare("SELECT pincode FROM slot_holds WHERE person_id = 'p-known'").first();
      expect(held).toEqual({ pincode: "122011" });
      expect(await told()).toEqual(["address_on_account", "consultation_confirmation"]);
    });

    it("keeps the pincode on the account on the request ops book from, while self-serve booking is off", async () => {
      await pincode("122011", "Sushant Lok", "Gurgaon", true);
      await onAccount("122011");
      const answer = await request(
        site({ selfServeBooking: false }),
        "/api/consultation",
        post({ ...VISITOR, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
        { CRM_QUEUE: fakeQueue() },
      );
      expect(await answer.json()).toMatchObject({ state: "requested" });
      const asked = await env.DB.prepare("SELECT pincode FROM consultation_requests").first();
      expect(asked).toEqual({ pincode: "122011" });
    });

    it.each([
      ["we hold but do not serve", "400050", true],
      ["we do not hold", "411001", false],
    ])(
      "books nothing in a pincode %s, answers as for a new number, and tells its owner on WhatsApp",
      async (_, pin, held) => {
        if (held) await pincode(pin, "Bandra", "Mumbai", false);
        await onAccount(pin);
        const messages = fakeQueue();
        const answer = await book({ address: ADDRESS }, { MESSAGE_QUEUE: messages });

        expect(answer.status).toBe(201);
        expect(await answer.json()).toEqual(BOOKED_MORNING);
        expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(0);
        expect(await count("SELECT COUNT(*) AS n FROM consultation_requests")).toBe(0);
        expect(await count("SELECT COUNT(*) AS n FROM addresses WHERE person_id = 'p-known'")).toBe(1);
        expect(await told()).toEqual(["address_not_served"]);
        expect(messages.sent).toHaveLength(1);
      },
    );
  });

  it("leaves the first address untouched when the same number books again with another", async () => {
    const first = await book({ address: ADDRESS });
    expect(await first.json()).toEqual(BOOKED_MORNING);
    // Ops cancel the first, so the number may book a consultation again.
    await env.DB.prepare("UPDATE slot_holds SET state = 'released'").run();

    const elsewhere = { ...ADDRESS, flat: "House 9", line1: "Rose Lane", locality: "Sector 45" };
    const second = await book({ date: "2026-09-24", address: elsewhere });
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ ...BOOKED_MORNING, date: "2026-09-24" });
    const addresses = await env.DB.prepare(
      `SELECT a.flat, a.line1, a.locality, a.replaced_at FROM addresses a JOIN people p ON p.id = a.person_id
       WHERE p.mobile_e164 = '+919810000002'`,
    ).all();
    expect(addresses.results).toEqual([
      { flat: "Flat 402", line1: "Palm Grove Society", locality: "Sector 65", replaced_at: null },
    ]);
  });

  it("is saved for a person we know who has none, and goes on to their Books customer and CRM lead", async () => {
    await env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name, zoho_lead_id)
       VALUES ('p-known', ?1, '+919810000002', 'Karan Bhatia', 'lead-7')`,
    )
      .bind(NOW.toISOString())
      .run();
    const crm = fakeQueue();
    const answer = await book({ address: ADDRESS }, { CRM_QUEUE: crm });

    expect(await answer.json()).toEqual(BOOKED_MORNING);
    expect(await count("SELECT COUNT(*) AS n FROM addresses WHERE person_id = 'p-known'")).toBe(1);
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages").all();
    expect(told.results).toEqual([{ kind: "consultation_confirmation" }]);
    const marked = await env.DB.prepare("SELECT books_details_changed_at FROM people WHERE id = 'p-known'").first();
    expect(marked).toEqual({ books_details_changed_at: NOW.toISOString() });
    expect(crm.sent).toContainEqual({ update_person_id: "p-known", request_id: expect.any(String) as string });
  });
});
