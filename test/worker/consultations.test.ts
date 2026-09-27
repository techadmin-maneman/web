// Booking from the public site (docs/decisions/0051-booking-from-the-site.md): the same path the
// referral landing takes, without an invite. NOW is Monday 21 September 2026, noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking } from "../../src/domain/bookings.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
import { createStubPayments } from "../../src/providers/payments.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const VISITOR = {
  name: "Karan Bhatia",
  mobile: "9810000002",
  loss_extent: "crown",
  turnstile_token: "token",
};

/** Where the consultation is, typed in full as the form takes it (ADR 0081). */
const ADDRESS = {
  flat: "Flat 402",
  floor: "4",
  tower: "Tower C",
  line1: "Palm Grove Society",
  line2: null,
  landmark: "Opposite the park",
  locality: "Sector 65",
  city: "Gurgaon",
  pincode: "122018",
  access_notes: "Gate 2, visitor parking",
};

const site = (settings = {}) => appFor("local", fakeDependencies(), settings, "public");
const post = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function pincode(pin: string, area: string, city: string, served: boolean) {
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(pin, area, city, served ? 1 : 0, served ? "2026-09-01T18:30:00.000Z" : null)
    .run();
}

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
});

describe("POST /api/consultation", () => {
  it("holds the slot, tells FSM, and leaves the lead the CRM syncs", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const fsm = fakeQueue();
    const crm = fakeQueue();
    const answer = await request(
      site(),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
      { FSM_QUEUE: fsm, CRM_QUEUE: crm },
    );

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "booked",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
      address: "saved",
      first_fit: false,
    });
    expect(fsm.sent).toEqual([{ hold_id: expect.any(String) as string, request_id: expect.any(String) as string }]);
    expect(crm.sent).toEqual([{ lead_id: expect.any(String) as string, request_id: expect.any(String) as string }]);

    const booked = await env.DB.prepare(
      `SELECT p.name, c.purpose, c.notice_version, h.type, h.amount, l.source, l.loss_extent,
         l.proposed_visit_date, l.first_choice_window, l.city
       FROM people p
       JOIN consents c ON c.person_id = p.id
       JOIN slot_holds h ON h.person_id = p.id
       JOIN leads l ON l.person_id = p.id
       WHERE p.mobile_e164 = '+919810000002'`,
    ).first();
    expect(booked).toEqual({
      name: "Karan Bhatia",
      purpose: "whatsapp_visits",
      notice_version: "referral-consultation-v1",
      type: "consultation",
      amount: 0,
      source: "form",
      loss_extent: "crown",
      // The date they chose, not a guess, and no rough window: the booking has a real one.
      proposed_visit_date: "2026-09-23",
      first_choice_window: null,
      city: "Gurgaon",
    });
  });

  it("refuses a pincode we do not serve, and a day outside the fortnight", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const body = { ...VISITOR, date: "2026-09-23", window: "morning", consent: true, address: ADDRESS };

    expect((await request(site(), "/api/consultation", post({ ...body, pincode: "400050" }))).status).toBe(422);
    expect(
      (await request(site(), "/api/consultation", post({ ...body, pincode: "122018", date: "2026-09-21" }))).status,
    ).toBe(422);
    expect(
      (await request(site(), "/api/consultation", post({ ...body, pincode: "122018", date: "2026-10-31" }))).status,
    ).toBe(422);
  });

  // Ops fix the hour on WhatsApp while the flag is off, so the day the visitor
  // asked for is recorded for them instead of being refused
  // (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
  it("records a request for ops while self-serve booking is off, holding no slot", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const fsm = fakeQueue();
    const crm = fakeQueue();
    const answer = await request(
      site({ selfServeBooking: false }),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
      { FSM_QUEUE: fsm, CRM_QUEUE: crm },
    );

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "requested",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
      address: "saved",
      first_fit: false,
    });
    expect(fsm.sent).toEqual([]);
    expect(crm.sent).toHaveLength(1);
    const asked = await env.DB.prepare(
      `SELECT r.pincode, r.requested_date, r.requested_window, r.referral_code
       FROM consultation_requests r JOIN people p ON p.id = r.person_id WHERE p.mobile_e164 = '+919810000002'`,
    ).first();
    expect(asked).toEqual({
      pincode: "122018",
      requested_date: "2026-09-23",
      requested_window: "morning",
      referral_code: null,
    });
  });
});

// The owner's ruling of 27 September 2026: the full address before a slot is confirmed, on the site too (ADR 0081).
describe("the address the consultation is at", () => {
  const book = (body: object, bindings = {}) =>
    request(
      site(),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, ...body }),
      { FSM_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue(), ...bindings },
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

  it("is refused in a pincode other than the one checked, naming it, and nothing is booked", async () => {
    const answer = await book({ address: { ...ADDRESS, pincode: "122017" } });
    expect(answer.status).toBe(422);
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
      { FSM_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue() },
    );
    expect(await answer.json()).toMatchObject({ state: "requested" });
    const saved = await env.DB.prepare(
      `SELECT a.line1, a.pincode FROM addresses a JOIN people p ON p.id = a.person_id
       WHERE p.mobile_e164 = '+919810000002' AND a.replaced_at IS NULL`,
    ).first();
    expect(saved).toEqual({ line1: "Palm Grove Society", pincode: "122018" });
  });

  // The form needs no login, only a number: whoever types one must not move where that person's visits go.
  it("never replaces the address a person already has: it is kept, the visit goes to it, and the answer says so", async () => {
    await env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id, zoho_lead_id)
       VALUES ('p-known', ?1, '+919810000002', 'Karan Bhatia', 'contact-7', 'lead-7')`,
    )
      .bind(NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
       VALUES ('old', 'p-known', '2026-09-01T00:00:00.000Z', 'House 12', 'Sector 45', 'Gurgaon', '122018')`,
    ).run();
    const fsm = fakeQueue();
    const crm = fakeQueue();
    const answer = await book({ address: ADDRESS }, { FSM_QUEUE: fsm, CRM_QUEUE: crm });

    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked", address: "on_account" });
    const addresses = await env.DB.prepare(
      "SELECT id, line1, replaced_at FROM addresses WHERE person_id = 'p-known'",
    ).all();
    expect(addresses.results).toEqual([{ id: "old", line1: "House 12", replaced_at: null }]);
    // Nothing about them changed, so nothing is sent on to FSM or the CRM but the booking and its lead.
    expect(fsm.sent).not.toContainEqual(expect.objectContaining({ update_contact_person_id: "p-known" }));
    expect(crm.sent).not.toContainEqual(expect.objectContaining({ update_person_id: "p-known" }));
  });

  it("leaves the first address untouched when the same number books again with another", async () => {
    const first = await book({ address: ADDRESS });
    expect(await first.json()).toMatchObject({ state: "booked", address: "saved" });
    // Ops cancel the first, so the number may book a consultation again.
    await env.DB.prepare("UPDATE slot_holds SET state = 'released'").run();

    const elsewhere = { ...ADDRESS, flat: "House 9", line1: "Rose Lane", locality: "Sector 45" };
    const second = await book({ date: "2026-09-24", address: elsewhere });
    expect(second.status).toBe(201);
    expect(await second.json()).toMatchObject({ state: "booked", address: "on_account" });
    const addresses = await env.DB.prepare(
      `SELECT a.flat, a.line1, a.locality, a.replaced_at FROM addresses a JOIN people p ON p.id = a.person_id
       WHERE p.mobile_e164 = '+919810000002'`,
    ).all();
    expect(addresses.results).toEqual([
      { flat: "Flat 402", line1: "Palm Grove Society", locality: "Sector 65", replaced_at: null },
    ]);
  });

  it("is saved for a person we know who has none, and goes on to their FSM contact and CRM lead", async () => {
    await env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id, zoho_lead_id)
       VALUES ('p-known', ?1, '+919810000002', 'Karan Bhatia', 'contact-7', 'lead-7')`,
    )
      .bind(NOW.toISOString())
      .run();
    const fsm = fakeQueue();
    const crm = fakeQueue();
    const answer = await book({ address: ADDRESS }, { FSM_QUEUE: fsm, CRM_QUEUE: crm });

    expect(await answer.json()).toMatchObject({ address: "saved" });
    expect(await count("SELECT COUNT(*) AS n FROM addresses WHERE person_id = 'p-known'")).toBe(1);
    expect(fsm.sent).toContainEqual({ update_contact_person_id: "p-known", request_id: expect.any(String) as string });
    expect(crm.sent).toContainEqual({ update_person_id: "p-known", request_id: expect.any(String) as string });
  });

  // A contact FSM already holds for the number is linked, not added; the address saved before it was linked had no
  // contact to go to (src/queues/fsm-sync.ts), so it goes as the link is made.
  describe("with a contact FSM already holds for the number", () => {
    const world = () => ({
      ...EMPTY_FSM,
      contacts: [{ id: "fsm-contact-9", name: "Karan Bhatia", mobile: "+919810000002", email: null }],
      items: [{ id: "item-consult", name: "Consultation", type: "Service" as const, price: null }],
    });
    async function heldAndConfirmed(fsm: ReturnType<typeof createStubFsm>) {
      const queue = fakeQueue();
      expect((await book({ address: ADDRESS }, { FSM_QUEUE: queue })).status).toBe(201);
      const [queued] = queue.sent as { hold_id: string }[];
      return confirmBooking(env.DB, fsm, createStubPayments(), queued?.hold_id ?? "", NOW, { labelAsTest: true });
    }

    it("writes the address over it as it is linked", async () => {
      const fsm = createStubFsm(world());
      expect(await heldAndConfirmed(fsm)).toBe("booked");
      expect(fsm.made.contacts).toEqual([]);
      expect(fsm.made.contactUpdates).toEqual([
        {
          contactId: "fsm-contact-9",
          mobile: "+919810000002",
          address: { street1: "Palm Grove Society", street2: "Sector 65", city: "Gurgaon", pincode: "122018" },
        },
      ]);
      const linked = await env.DB.prepare(
        "SELECT fsm_contact_id FROM people WHERE mobile_e164 = '+919810000002'",
      ).first();
      expect(linked).toEqual({ fsm_contact_id: "fsm-contact-9" });
    });

    it("still books when FSM will not take the address, leaving the contact as it was", async () => {
      const fsm = createStubFsm(world());
      fsm.failNext("updateContact", "FSM answered 500");
      expect(await heldAndConfirmed(fsm)).toBe("booked");
      expect(fsm.made.contactUpdates).toEqual([]);
      expect(fsm.made.visits).toHaveLength(1);
    });
  });

  it("reaches the contact FSM is given, with its street, however the city was typed", async () => {
    const queue = fakeQueue();
    expect((await book({ address: { ...ADDRESS, city: "Gurugram" } }, { FSM_QUEUE: queue })).status).toBe(201);
    const [queued] = queue.sent as { hold_id: string }[];
    const fsm = createStubFsm({
      ...EMPTY_FSM,
      items: [{ id: "item-consult", name: "Consultation", type: "Service", price: null }],
    });
    const booked = await confirmBooking(env.DB, fsm, createStubPayments(), queued?.hold_id ?? "", NOW, {
      labelAsTest: true,
    });
    expect(booked).toBe("booked");
    expect(fsm.made.contacts).toMatchObject([
      { city: "Gurgaon", pincode: "122018", street: { street1: "Palm Grove Society", street2: "Sector 65" } },
    ]);
  });
});

describe("POST /api/waitlist", () => {
  it("takes the number for a pincode we do not serve, with the launch alert asked for", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    const crm = fakeQueue();
    const answer = await request(
      site(),
      "/api/waitlist",
      post({ ...VISITOR, pincode: "400050", contact_consent: true, launch_alert: true }),
      { CRM_QUEUE: crm },
    );

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({ area: "Bandra" });
    const listed = await env.DB.prepare(
      `SELECT w.pincode, w.launch_alert, w.referral_code, l.source, l.proposed_visit_date
       FROM waitlist_entries w JOIN people p ON p.id = w.person_id JOIN leads l ON l.person_id = p.id
       WHERE p.mobile_e164 = '+919810000002'`,
    ).first();
    expect(listed).toEqual({
      pincode: "400050",
      launch_alert: 1,
      referral_code: null,
      source: "waitlist",
      proposed_visit_date: null,
    });
    const consents = await env.DB.prepare(
      `SELECT purpose FROM consents c JOIN people p ON p.id = c.person_id
       WHERE p.mobile_e164 = '+919810000002' ORDER BY purpose`,
    ).all<{ purpose: string }>();
    expect(consents.results.map((row) => row.purpose)).toEqual(["contact", "whatsapp_launches"]);
  });

  // ADR 0041 lists the waitlist confirmation among Phase 2's messages; nothing wrote one (REQ-03).
  it("queues one WhatsApp confirming the place on the list, however often the number joins", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    const messages = fakeQueue();
    const join = () =>
      request(
        site(),
        "/api/waitlist",
        post({ ...VISITOR, pincode: "400050", contact_consent: true, launch_alert: false }),
        {
          CRM_QUEUE: fakeQueue(),
          MESSAGE_QUEUE: messages,
        },
      );

    expect((await join()).status).toBe(201);
    expect((await join()).status).toBe(201);

    const queued = await env.DB.prepare(
      `SELECT m.id, m.kind, m.subject_kind, m.state, m.subject_id = w.id AS about_the_entry
       FROM outbound_messages m JOIN waitlist_entries w ON w.person_id = m.person_id`,
    ).all();
    expect(queued.results).toEqual([
      {
        id: expect.any(String) as string,
        kind: "waitlist_confirmation",
        subject_kind: "waitlist_entry",
        state: "queued",
        about_the_entry: 1,
      },
    ]);
    expect(messages.sent).toEqual([{ message_id: queued.results[0]?.id, request_id: expect.any(String) as string }]);
  });

  it("refuses a pincode we do serve: that one books instead", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const answer = await request(
      site(),
      "/api/waitlist",
      post({ ...VISITOR, pincode: "122018", contact_consent: true, launch_alert: false }),
    );
    expect(answer.status).toBe(422);
  });
});

// A form anyone can fill in with a number (docs/decisions/0068-a-paid-hold-is-kept.md).
describe("a number the site already knows", () => {
  const book = (body: object, queue = fakeQueue()) =>
    request(
      site(),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", consent: true, address: ADDRESS, ...body }),
      {
        FSM_QUEUE: queue,
        CRM_QUEUE: fakeQueue(),
      },
    );
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;

  beforeEach(async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
  });

  it("is answered already_booked, with the day and window it has, rather than booked twice (CLI-02)", async () => {
    expect((await book({ date: "2026-09-23", window: "morning" })).status).toBe(201);
    const again = await book({ name: "Karan B. again", date: "2026-09-24", window: "evening" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: { code: "already_booked", request_id: expect.any(String) as string },
      booked: { date: "2026-09-23", window: "morning" },
    });
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(1);
  });

  it("is never renamed by the form (BIZ-03)", async () => {
    await book({ date: "2026-09-23", window: "morning" });
    await request(
      site(),
      "/api/waitlist",
      post({ ...VISITOR, name: "Somebody Else", pincode: "400050", contact_consent: true, launch_alert: false }),
    );
    expect(await env.DB.prepare("SELECT name FROM people").all()).toMatchObject({
      results: [{ name: "Karan Bhatia" }],
    });
  });

  it("books no consultation for a client past them, who books in the app (BIZ-03)", async () => {
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p-fitted', ?1, '+919810000002', 'Karan Bhatia')",
    )
      .bind(NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         fsm_modified_at, synced_at)
       VALUES ('fit', 'fsm-fit', 'p-fitted', 'first_fit', 'completed', 'Completed', '2026-08-01T03:30:00.000Z',
         '2026-08-01T06:30:00.000Z', ?1, ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    const answer = await book({ date: "2026-09-23", window: "morning" });
    expect(answer.status).toBe(422);
    expect((await answer.json<{ error: { code: string } }>()).error.code).toBe("not_bookable");
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(0);
  });

  it("leaves no person, consent or address behind when the window has gone (ARCH-05)", async () => {
    await env.DB.prepare("UPDATE technicians SET active = 0").run();
    const answer = await book({ date: "2026-09-23", window: "morning" });
    expect(answer.status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM consents")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM addresses")).toBe(0);
  });

  it("asks ops instead, holding nothing, on a day the price book charges for a consultation (BIZ-10)", async () => {
    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('consultation', 'standard', 50000, 0, '2026-09-23')",
    ).run();
    const queue = fakeQueue();
    const answer = await book({ date: "2026-09-23", window: "morning" }, queue);
    expect(await answer.json()).toMatchObject({ state: "requested" });
    expect(queue.sent).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM consultation_requests")).toBe(1);
  });

  it("holds nothing on a day ops blacked out (BIZ-25)", async () => {
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-09-23', 'Dussehra')").run();
    const answer = await book({ date: "2026-09-23", window: "morning" });
    expect(answer.status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(0);
  });
});

// The owner's ruling of 27 September 2026 (ADR 0025, item 68; docs/decisions/0086-the-next-visit-is-offered.md): the
// form offers the consultation alone, or with the first fit to follow, which is a request written with the booking.
describe("the consultation, then the first fit", () => {
  const book = (body: object, settings = {}, queue = fakeQueue()) =>
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
        ...body,
      }),
      { FSM_QUEUE: queue, CRM_QUEUE: fakeQueue() },
    );
  const requests = () =>
    env.DB.prepare(
      "SELECT r.preferred_window, p.mobile_e164 FROM first_fit_requests r JOIN people p ON p.id = r.person_id",
    ).all();
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;

  beforeEach(async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
  });

  it("books the consultation as ever, and records the fit asked for, in its window, with it", async () => {
    const fsm = fakeQueue();
    const answer = await book({ first_fit: { window: "afternoon" } }, {}, fsm);
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "booked",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
      address: "saved",
      first_fit: true,
    });
    // Nothing more is held or paid for: the consultation's slot is the one held, and it is free.
    expect(fsm.sent).toHaveLength(1);
    const held = await env.DB.prepare("SELECT type, amount FROM slot_holds").all();
    expect(held.results).toEqual([{ type: "consultation", amount: 0 }]);
    expect(await count("SELECT COUNT(*) AS n FROM payments")).toBe(0);
    expect((await requests()).results).toEqual([{ preferred_window: "afternoon", mobile_e164: "+919810000002" }]);
    // The consent recorded is the consultation's own, which counsel is asked to confirm covers the fit.
    const consent = await env.DB.prepare("SELECT purpose, notice_version FROM consents").all();
    expect(consent.results).toEqual([{ purpose: "whatsapp_visits", notice_version: "referral-consultation-v1" }]);
  });

  it("takes either window for the fit", async () => {
    await book({ first_fit: { window: null } });
    expect((await requests()).results).toEqual([{ preferred_window: null, mobile_e164: "+919810000002" }]);
  });

  it("records nothing of a fit for the consultation alone", async () => {
    const answer = await book({});
    expect(await answer.json()).toMatchObject({ state: "booked", first_fit: false });
    expect((await requests()).results).toEqual([]);
  });

  it("refuses an evening for the fit, which a first fit cannot start in", async () => {
    const answer = await book({ first_fit: { window: "evening" } });
    expect(answer.status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
  });

  it("records the fit with the request for ops, in the same write, while self-serve booking is off", async () => {
    const answer = await book({ first_fit: { window: "morning" } }, { selfServeBooking: false });
    expect(await answer.json()).toMatchObject({ state: "requested", first_fit: true });
    expect(await count("SELECT COUNT(*) AS n FROM consultation_requests")).toBe(1);
    expect((await requests()).results).toEqual([{ preferred_window: "morning", mobile_e164: "+919810000002" }]);
  });

  it("leaves no request behind when the booking is refused: the window gone, or a consultation already booked", async () => {
    await env.DB.prepare("UPDATE technicians SET active = 0").run();
    expect((await book({ first_fit: { window: "morning" } })).status).toBe(409);
    expect((await requests()).results).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);

    await env.DB.prepare("UPDATE technicians SET active = 1").run();
    expect((await book({})).status).toBe(201);
    const again = await book({ date: "2026-09-24", first_fit: { window: "afternoon" } });
    expect(again.status).toBe(409);
    expect((await requests()).results).toEqual([]);
  });

  it("keeps the latest request a person made", async () => {
    await book({ first_fit: { window: "morning" } }, { selfServeBooking: false });
    await book({ date: "2026-09-24", first_fit: { window: "afternoon" } }, { selfServeBooking: false });
    expect((await requests()).results).toEqual([{ preferred_window: "afternoon", mobile_e164: "+919810000002" }]);
  });
});

// The site sends one Idempotency-Key per submission, so pressing again after the answer was lost on the way gets the
// first answer back rather than a second booking (FEO-21; docs/decisions/0011-lead-api.md).
describe("the Idempotency-Key", () => {
  const keyed = (body: object, key: string) => ({
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  const bindings = () => ({ FSM_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() });
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;

  it("answers a consultation sent again with its first answer, and books it once", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const body = {
      ...VISITOR,
      pincode: "122018",
      date: "2026-09-23",
      window: "morning",
      consent: true,
      address: ADDRESS,
    };

    const first = await request(site(), "/api/consultation", keyed(body, "key-consult-0001"), bindings());
    const again = await request(site(), "/api/consultation", keyed(body, "key-consult-0001"), bindings());

    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(await first.json());
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM leads")).toBe(1);
  });

  it("answers a waitlist entry sent again with its first answer, and records one lead", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    const body = { ...VISITOR, pincode: "400050", contact_consent: true, launch_alert: true };

    const first = await request(site(), "/api/waitlist", keyed(body, "key-waitlist-0001"), bindings());
    const again = await request(site(), "/api/waitlist", keyed(body, "key-waitlist-0001"), bindings());

    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ area: "Bandra" });
    expect(await count("SELECT COUNT(*) AS n FROM leads")).toBe(1);
  });

  it("refuses the key with a different submission, and frees it when the submission is refused", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const body = {
      ...VISITOR,
      pincode: "122018",
      date: "2026-09-23",
      window: "morning",
      consent: true,
      address: ADDRESS,
    };
    await request(site(), "/api/consultation", keyed(body, "key-consult-0002"), bindings());

    const changed = { ...body, window: "evening" };
    const reused = await request(site(), "/api/consultation", keyed(changed, "key-consult-0002"), bindings());
    expect(reused.status).toBe(422);
    expect(await reused.json()).toMatchObject({ error: { code: "idempotency_key_reused" } });

    // A day outside the fortnight is refused, and the same submission is refused for itself again, not replayed.
    const outside = { ...body, date: "2026-10-31" };
    await request(site(), "/api/consultation", keyed(outside, "key-consult-0003"), bindings());
    const again = await request(site(), "/api/consultation", keyed(outside, "key-consult-0003"), bindings());
    expect(again.status).toBe(422);
    expect(await again.json()).toMatchObject({ error: { code: "invalid_request" } });
  });
});
