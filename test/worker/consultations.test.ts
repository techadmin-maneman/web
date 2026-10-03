// Booking from the public site (docs/decisions/0051-booking-from-the-site.md): the same path the
// referral landing takes, without an invite. NOW is Monday 21 September 2026, noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking } from "../../src/domain/bookings.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
import { createStubPayments } from "../../src/providers/payments.ts";
import { consultationBody, lastBookableDay } from "../../scripts/lib/test-booking.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, provedNumberCode, request } from "./helpers.ts";

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

/** What every number is answered for 23 September's morning, whether we know it or not (PS-06). */
const BOOKED_MORNING = {
  state: "booked",
  date: "2026-09-23",
  window: "morning",
  area: "Gurgaon South City II",
  credits: false,
  invite: "unknown",
  one_visit: false,
  discount_code: null,
};

const site = (settings = {}) => appFor("local", fakeDependencies(), settings, "public");
const post = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** A pincode whose area ops have named, unless `named` is false: its name is then still the post offices'. */
async function pincode(pin: string, area: string, city: string, served: boolean, named = true) {
  await env.DB.prepare(
    `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at, area_named_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(pin, area, city, served ? 1 : 0, served ? "2026-09-01T18:30:00.000Z" : null, named ? "ops@localhost" : null)
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
      credits: false,
      invite: "unknown",
      one_visit: false,
      discount_code: null,
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
      notice_version: "site-consultation-v1",
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

  // The staging check and the load test book this way (scripts/staging-lead.ts, scripts/load-test-leads.ts).
  it("takes the booking a script sends on staging, with Cloudflare's dummy token", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const body = consultationBody({
      name: "Staging test",
      mobile: "9810000009",
      pincode: "122018",
      city: "Gurgaon",
      date: lastBookableDay(NOW),
      window: "evening",
    });
    const staging = site({ turnstileSecret: "0x4AAAAAAA-the-real-widget-secret", acceptTurnstileTestToken: true });

    const answer = await request(staging, "/api/consultation", post(body), {
      FSM_QUEUE: fakeQueue(),
      CRM_QUEUE: fakeQueue(),
    });

    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked", date: "2026-10-05", window: "evening" });
  });

  // As the landing answers them, and as the form words them: "That day is no longer open" (open point 105).
  it("refuses a pincode we do not serve, and a day outside the fortnight, as not bookable", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const body = { ...VISITOR, date: "2026-09-23", window: "morning", consent: true, address: ADDRESS };

    for (const refused of [
      { ...body, pincode: "400050" },
      { ...body, pincode: "122018", date: "2026-09-21" },
      { ...body, pincode: "122018", date: "2026-10-31" },
    ]) {
      const answer = await request(site(), "/api/consultation", post(refused));
      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "not_bookable" } });
    }
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
      credits: false,
      invite: "unknown",
      one_visit: false,
      discount_code: null,
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
    // No slot, no confirmation: the load test (scripts/load-test-leads.ts) runs with self-serve booking off
    // precisely so its random test numbers are never messaged (docs/decisions/0025-phase-2-conflicts-register.md,
    // item 84's refinement).
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_messages").first()).toEqual({ n: 0 });
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
  // PS-06: the page answers as it would for a new number, and only the number's owner is told, on WhatsApp.
  it("never replaces the address a person already has: the visit goes to it, and only WhatsApp says so", async () => {
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
    const messages = fakeQueue();
    const answer = await book({ address: ADDRESS }, { FSM_QUEUE: fsm, CRM_QUEUE: crm, MESSAGE_QUEUE: messages });

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual(BOOKED_MORNING);
    const addresses = await env.DB.prepare(
      "SELECT id, line1, replaced_at FROM addresses WHERE person_id = 'p-known'",
    ).all();
    expect(addresses.results).toEqual([{ id: "old", line1: "House 12", replaced_at: null }]);
    // Nothing about them changed, so nothing is sent on to FSM or the CRM but the booking and its lead.
    expect(fsm.sent).not.toContainEqual(expect.objectContaining({ update_contact_person_id: "p-known" }));
    expect(crm.sent).not.toContainEqual(expect.objectContaining({ update_person_id: "p-known" }));
    const told = await env.DB.prepare("SELECT id, person_id, kind FROM outbound_messages").all<{ id: string }>();
    expect(told.results).toEqual([
      { id: expect.any(String) as string, person_id: "p-known", kind: "address_on_account" },
    ]);
    expect(messages.sent).toEqual([{ message_id: told.results[0]?.id, request_id: expect.any(String) as string }]);
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

    expect(await answer.json()).toEqual(BOOKED_MORNING);
    expect(await count("SELECT COUNT(*) AS n FROM addresses WHERE person_id = 'p-known'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM outbound_messages")).toBe(0);
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
          address: {
            street1: "Flat 402, Floor 4, Tower C, Palm Grove Society",
            street2: "Sector 65, Landmark: Opposite the park",
            city: "Gurgaon",
            pincode: "122018",
          },
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
      {
        city: "Gurgaon",
        pincode: "122018",
        street: {
          street1: "Flat 402, Floor 4, Tower C, Palm Grove Society",
          street2: "Sector 65, Landmark: Opposite the park",
        },
      },
    ]);
  });
});

// BK-27 and CP-25 of the audit, 2 October 2026: an area nobody had named was called by its post office's name.
describe("an area ops have not named yet", () => {
  it("is booked as its city", async () => {
    await pincode("110048", "Masjid Moth", "Delhi", true, false);
    const answer = await request(
      site(),
      "/api/consultation",
      post({
        ...VISITOR,
        pincode: "110048",
        date: "2026-09-23",
        window: "morning",
        consent: true,
        address: { ...ADDRESS, locality: "Greater Kailash II", city: "Delhi", pincode: "110048" },
      }),
      { FSM_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue() },
    );
    expect(await answer.json()).toMatchObject({ state: "booked", area: "Delhi" });
  });

  it("is not named to someone joining its waitlist", async () => {
    await pincode("110048", "Masjid Moth", "Delhi", false, false);
    const answer = await request(
      site(),
      "/api/waitlist",
      post({ ...VISITOR, pincode: "110048", contact_consent: true, launch_alert: false }),
      { CRM_QUEUE: fakeQueue() },
    );
    expect(await answer.json()).toEqual({ area: null, credits: false, invite: "unknown" });
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
    expect(await answer.json()).toEqual({ area: "Bandra", credits: false, invite: "unknown" });
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
      `SELECT purpose, source FROM consents c JOIN people p ON p.id = c.person_id
       WHERE p.mobile_e164 = '+919810000002' ORDER BY purpose`,
    ).all();
    expect(consents.results).toEqual([
      { purpose: "contact", source: "site_waitlist" },
      { purpose: "whatsapp_launches", source: "site_waitlist" },
    ]);
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
    expect(await answer.json()).toMatchObject({ error: { code: "not_bookable" } });
  });
});

// A friend who opened an invite, left, and booked later on /book: the site remembers the invite's code for 30 days,
// says who is told of the fit beside it, and sends it, and the booking is attributed as the landing's is
// (docs/decisions/0089-an-invite-is-not-lost.md).
describe("an invite the browser remembered", () => {
  const REFERRER = "11111111-1111-4111-8111-111111111111";
  const bindings = () => ({ FSM_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() });
  const book = (inviteCode: string, told: object = { invite_told: true }) =>
    request(
      site(),
      "/api/consultation",
      post({
        ...VISITOR,
        pincode: "122018",
        date: "2026-09-23",
        window: "morning",
        consent: true,
        address: ADDRESS,
        invite_code: inviteCode,
        ...told,
      }),
      bindings(),
    );
  const attributions = () =>
    env.DB.prepare("SELECT code, via, pincode, grant_state, told_notice FROM referral_attributions").all();

  beforeEach(async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
    )
      .bind(REFERRER, NOW.toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('RM4K7P', ?1, ?2, ?2)",
    )
      .bind(REFERRER, NOW.toISOString())
      .run();
  });

  it("attributes the consultation to the invite, whose credits then apply", async () => {
    const answer = await book("rm4k7p");
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "booked",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
      credits: true,
      invite: "valid",
      one_visit: false,
      discount_code: null,
    });
    expect((await attributions()).results).toEqual([
      {
        code: "RM4K7P",
        via: "consultation",
        pincode: "122018",
        grant_state: "pending",
        told_notice: "invite-told-book-v1",
      },
    ]);
  });

  // PS-24: the friend is told who hears of their fit before /book sends the invite, or the invite is not sent.
  it("books without the invite when the form did not say who is told of the fit", async () => {
    const answer = await book("RM4K7P", {});
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked", credits: false, invite: "unknown" });
    expect((await attributions()).results).toEqual([]);
  });

  it.each([
    ["a code we do not have", "ZZ9999"],
    ["something not shaped like a code", "not a code!"],
  ])("books without an invite for %s, never refusing the booking", async (_, inviteCode) => {
    const answer = await book(inviteCode);
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked", credits: false, invite: "unknown" });
    expect((await attributions()).results).toEqual([]);
  });

  it("holds the invite for someone who joins a waitlist instead", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    const answer = await request(
      site(),
      "/api/waitlist",
      post({
        ...VISITOR,
        pincode: "400050",
        contact_consent: true,
        launch_alert: false,
        invite_code: "RM4K7P",
        invite_told: true,
      }),
      bindings(),
    );
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({ area: "Bandra", credits: true, invite: "valid" });
    expect((await attributions()).results).toEqual([
      {
        code: "RM4K7P",
        via: "waitlist",
        pincode: "400050",
        grant_state: "pending",
        told_notice: "invite-told-book-v1",
      },
    ]);
    const entry = await env.DB.prepare("SELECT referral_code FROM waitlist_entries").first();
    expect(entry).toEqual({ referral_code: "RM4K7P" });
  });

  it("gives the referrer no credits for their own invite", async () => {
    const answer = await request(
      site(),
      "/api/consultation",
      post({
        ...VISITOR,
        mobile: "9810000001",
        pincode: "122018",
        date: "2026-09-23",
        window: "morning",
        consent: true,
        address: ADDRESS,
        invite_code: "RM4K7P",
        invite_told: true,
      }),
      bindings(),
    );
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ credits: false, invite: "valid" });
    expect((await attributions()).results).toEqual([]);
  });
});

// A form anyone can fill in with a number (docs/decisions/0068-a-paid-hold-is-kept.md).
// The page answers it as it would a new number, so it never says whose a number is; its owner is told the rest on
// WhatsApp (PS-06, BK-31).
describe("a number the site already knows", () => {
  const book = (body: object, queue = fakeQueue(), settings = {}) =>
    request(
      site(settings),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", consent: true, address: ADDRESS, ...body }),
      {
        FSM_QUEUE: queue,
        CRM_QUEUE: fakeQueue(),
      },
    );
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;
  const karans = "(SELECT id FROM people WHERE mobile_e164 = '+919810000002')";
  /** What the number's owner was told on WhatsApp, oldest first. */
  const told = async () => {
    const rows = await env.DB.prepare(
      `SELECT kind FROM outbound_messages WHERE person_id = ${karans} ORDER BY created_at, rowid`,
    ).all<{ kind: string }>();
    return rows.results.map((row) => row.kind);
  };

  async function fittedClient() {
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
  }

  beforeEach(async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
  });

  it("with a consultation to come gets a new number's answer, books nothing, and is told on WhatsApp", async () => {
    expect((await book({ date: "2026-09-23", window: "morning" })).status).toBe(201);
    const again = await book({ name: "Somebody Else", date: "2026-09-24", window: "evening" });
    const stranger = await book({ mobile: "9810000003", date: "2026-09-24", window: "evening" });

    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(await stranger.json());
    expect(await count(`SELECT COUNT(*) AS n FROM slot_holds WHERE person_id = ${karans}`)).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM consents WHERE person_id = ${karans}`)).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM leads WHERE person_id = ${karans}`)).toBe(1);
    expect(await told()).toEqual(["consultation_exists"]);
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

  it("books no consultation for a client past them, and tells them on WhatsApp to book in the app (BK-31)", async () => {
    await fittedClient();
    const answer = await book({ date: "2026-09-23", window: "morning" });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual(BOOKED_MORNING);
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM consents")).toBe(0);
    expect(await told()).toEqual(["book_in_app"]);
  });

  it("is answered taken when nobody is free, as a new number is, and told nothing", async () => {
    await fittedClient();
    await env.DB.prepare("UPDATE technicians SET active = 0").run();
    const answer = await book({ date: "2026-09-23", window: "morning" });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "taken" } });
    expect(await told()).toEqual([]);
  });

  it("is answered requested while self-serve booking is off, as a new number is, and leaves ops nothing", async () => {
    await fittedClient();
    const answer = await book({ date: "2026-09-23", window: "morning" }, fakeQueue(), { selfServeBooking: false });
    expect(await answer.json()).toEqual({ ...BOOKED_MORNING, state: "requested" });
    expect(await count("SELECT COUNT(*) AS n FROM consultation_requests")).toBe(0);
    expect(await told()).toEqual(["book_in_app"]);
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

// The owner's ruling D2 of 1 October 2026 (ADR 0025, item 89; docs/decisions/0105-a-consultation-and-fit-in-one-visit.md):
// the form books the consultation alone, or the consultation and the first fit in one visit, three hours, with
// nothing paid until the client is fitted. It replaces the consultation with the first fit to follow (item 68), whose
// request the form no longer writes, so the tests of that request went with it.
describe("a consultation and fit in one visit", () => {
  let proved = "";
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
        number_code_id: proved,
        ...body,
      }),
      { FSM_QUEUE: queue, CRM_QUEUE: fakeQueue() },
    );
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;

  beforeEach(async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    proved = await provedNumberCode("+919810000002");
  });

  // PS-10: the one visit sends a technician with stock, and recorded a consent and a person, for any number typed.
  it("is refused, and writes nothing, without a code that proved the number in the last 30 minutes", async () => {
    const other = await provedNumberCode("+919810000003");
    const stale = await provedNumberCode("+919810000002", new Date(NOW.getTime() - 31 * 60_000));
    const queue = fakeQueue();
    for (const numberCode of [{ number_code_id: undefined }, { number_code_id: other }, { number_code_id: stale }]) {
      const answer = await book({ one_visit: true, ...numberCode }, {}, queue);
      expect(answer.status).toBe(403);
      expect(await answer.json()).toMatchObject({ error: { code: "number_not_proved" } });
    }
    expect(queue.sent).toEqual([]);
    for (const table of ["people", "consents", "slot_holds", "leads", "outbound_messages"]) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${table}`)).toBe(0);
    }
  });

  it("refuses a number we know the same way, telling its owner nothing", async () => {
    expect((await book({ one_visit: true })).status).toBe(201);
    const answer = await book({ date: "2026-09-24", one_visit: true, number_code_id: undefined });
    expect(answer.status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM outbound_messages")).toBe(0);
  });

  it("asks no code of the consultation alone", async () => {
    const answer = await book({ number_code_id: undefined });
    expect(answer.status).toBe(201);
  });

  it("holds the first fit's three hours with nothing paid, sold to cost nothing if missed or moved", async () => {
    const fsm = fakeQueue();
    const answer = await book({ one_visit: true }, {}, fsm);
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
    expect(fsm.sent).toHaveLength(1);
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

  it("is booked in FSM on the first fit's item for three hours, marked as one visit, and its client told so", async () => {
    const queue = fakeQueue();
    await book({ one_visit: true }, {}, queue);
    const [queued] = queue.sent as { hold_id: string }[];
    const fsm = createStubFsm({
      ...EMPTY_FSM,
      items: [{ id: "item-fit", name: "First fit", type: "Service", price: null }],
    });
    const messages = fakeQueue();
    const booked = await confirmBooking(env.DB, fsm, createStubPayments(), queued?.hold_id ?? "", NOW, {
      labelAsTest: false,
      notify: (messageId) => messages.send({ message_id: messageId, request_id: "r" }),
    });

    expect(booked).toBe("booked");
    expect(fsm.made.visits).toMatchObject([
      { serviceId: "item-fit", start: "2026-09-23T09:00:00+05:30", end: "2026-09-23T12:00:00+05:30" },
    ]);
    const visit = await env.DB.prepare("SELECT type, one_visit, window_start, window_end FROM appointments").first();
    expect(visit).toEqual({
      type: "first_fit",
      one_visit: "booked",
      window_start: "2026-09-23T03:30:00.000Z",
      window_end: "2026-09-23T06:30:00.000Z",
    });
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages").all();
    expect(told.results).toEqual([{ kind: "consultation_confirmation" }]);
    expect(messages.sent).toHaveLength(1);
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
    const queue = fakeQueue();
    const answer = await book({ one_visit: true }, { selfServeBooking: false }, queue);
    expect(await answer.json()).toMatchObject({ state: "requested", one_visit: true });
    expect(queue.sent).toEqual([]);
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
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages").all();
    expect(told.results).toEqual([{ kind: "consultation_exists" }, { kind: "consultation_exists" }]);
  });

  it("leaves nothing behind when its three hours are not free", async () => {
    await env.DB.prepare("UPDATE technicians SET active = 0").run();
    expect((await book({ one_visit: true })).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
  });

  // The owner's decision of 2 October 2026: only the hair systems ops offer, and no generic first fit in their place.
  describe("while ops offer no hair system", () => {
    beforeEach(async () => {
      await env.DB.prepare("UPDATE services SET retired_date = '2026-09-01' WHERE kind = 'first_fit'").run();
    });

    it.each([
      ["while self-serve booking is on", {}],
      ["while self-serve booking is off", { selfServeBooking: false }],
    ])("is refused as no_product %s, and writes nothing", async (_, settings) => {
      const queue = fakeQueue();
      const answer = await book({ one_visit: true }, settings, queue);

      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "no_product" } });
      expect(queue.sent).toEqual([]);
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

// BK-26: the form drew every day and window, so a full one failed only after the whole form was filled.
describe("GET /api/availability/public", () => {
  type Open = { plan: string; days: { date: string; windows: Record<string, boolean> }[] };
  const ALL_OPEN = { morning: true, afternoon: true, evening: true };
  const NONE_OPEN = { morning: false, afternoon: false, evening: false };

  const open = (query: string, settings = {}) => request(site(settings), `/api/availability/public?${query}`);
  const daysOf = async (query: string, settings = {}) => {
    const answer = await open(query, settings);
    expect(answer.status).toBe(200);
    return (await answer.json<Open>()).days;
  };
  const windowsOn = (days: Open["days"], date: string) => days.find((day) => day.date === date)?.windows;
  const book = (body: object) =>
    request(
      site(),
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
      { FSM_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue() },
    );

  beforeEach(async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
  });

  it("answers the fortnight from tomorrow, open where someone is free, for a minute's cache, naming nobody", async () => {
    const answer = await open("pincode=122018&plan=consultation");

    expect(answer.status).toBe(200);
    expect(answer.headers.get("Cache-Control")).toBe("public, max-age=60");
    const text = await answer.text();
    expect(text).not.toContain("Imran");
    const { plan, days } = JSON.parse(text) as Open;
    expect(plan).toBe("consultation");
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ date: "2026-09-22", windows: ALL_OPEN });
    expect(days.at(-1)?.date).toBe("2026-10-05");
  });

  it("closes a window once it is full, as booking it would be refused, and a day ops blacked out", async () => {
    expect((await book({ window: "afternoon" })).status).toBe(201);
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-09-24', 'Dussehra')").run();

    const days = await daysOf("pincode=122018&plan=consultation");

    expect(windowsOn(days, "2026-09-23")).toEqual({ morning: true, afternoon: false, evening: true });
    expect(windowsOn(days, "2026-09-24")).toEqual(NONE_OPEN);
    const second = await book({ mobile: "9810000003", window: "afternoon" });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "taken" } });
  });

  it("offers one visit the morning and the afternoon only, where its three hours fit", async () => {
    // The technician's afternoon consultation leaves the morning's first hours, too few for a fit.
    expect((await book({ window: "afternoon" })).status).toBe(201);

    const days = await daysOf("pincode=122018&plan=one_visit");

    expect(days[0]).toEqual({ date: "2026-09-22", windows: { morning: true, afternoon: true, evening: false } });
    expect(windowsOn(days, "2026-09-23")).toEqual(NONE_OPEN);
    const proved = await provedNumberCode("+919810000003");
    const refused = await book({ mobile: "9810000003", one_visit: true, window: "morning", number_code_id: proved });
    expect(refused.status).toBe(409);
  });

  it("closes every window while nobody works, and one visit while ops offer no hair system", async () => {
    await env.DB.prepare("UPDATE technicians SET active = 0").run();
    for (const day of await daysOf("pincode=122018&plan=consultation")) expect(day.windows).toEqual(NONE_OPEN);

    await env.DB.batch([
      env.DB.prepare("UPDATE technicians SET active = 1"),
      env.DB.prepare("UPDATE services SET retired_date = '2026-09-01' WHERE kind = 'first_fit'"),
    ]);
    for (const day of await daysOf("pincode=122018&plan=one_visit")) expect(day.windows).toEqual(NONE_OPEN);
  });

  it("opens every window the plan starts in while self-serve booking is off: the request waits for ops", async () => {
    await env.DB.prepare("UPDATE technicians SET active = 0").run();
    const off = { selfServeBooking: false };

    for (const day of await daysOf("pincode=122018&plan=consultation", off)) expect(day.windows).toEqual(ALL_OPEN);
    for (const day of await daysOf("pincode=122018&plan=one_visit", off)) {
      expect(day.windows).toEqual({ morning: true, afternoon: true, evening: false });
    }
  });

  it("opens every window on a day the price book charges for a consultation, which ops are asked for", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE technicians SET active = 0"),
      env.DB.prepare(
        "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('consultation', 'standard', 50000, 0, '2026-09-23')",
      ),
    ]);

    const days = await daysOf("pincode=122018&plan=consultation");

    expect(windowsOn(days, "2026-09-22")).toEqual(NONE_OPEN);
    expect(windowsOn(days, "2026-09-23")).toEqual(ALL_OPEN);
  });

  it("refuses a pincode we do not serve, or do not know, and a plan or pincode not shaped as one", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    for (const pin of ["400050", "110001"]) {
      const answer = await open(`pincode=${pin}&plan=consultation`);
      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "not_bookable" } });
    }
    for (const query of ["pincode=122018&plan=fit", "pincode=12201&plan=consultation", "pincode=122018"]) {
      expect((await open(query)).status).toBe(400);
    }
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
    expect(await again.json()).toEqual({ area: "Bandra", credits: false, invite: "unknown" });
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
    expect(await again.json()).toMatchObject({ error: { code: "not_bookable" } });
  });
});
