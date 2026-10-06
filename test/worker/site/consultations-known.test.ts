// Booking from the public site (docs/decisions/0051-booking-from-the-site.md): the same path the
// referral landing takes, without an invite. NOW is Monday 21 September 2026, noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeQueue, leaseRefused, markDatabase, NOW, request } from "../helpers.ts";
import { ADDRESS, pincode, VISITOR, post, site, BOOKED_MORNING } from "./consultations-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
});

// A friend who opened an invite, left, and booked later on /book: the site remembers the invite's code for 30 days,
// says who is told of the fit beside it, and sends it, and the booking is attributed as the landing's is
// (docs/decisions/0089-an-invite-is-not-lost.md).
describe("an invite the browser remembered", () => {
  const REFERRER = "11111111-1111-4111-8111-111111111111";
  const bindings = () => ({ CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() });
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

  // A booking that failed after the hold was written answered 500, and the invite
  // and the lead were never recorded. The cron books the hold half an hour on.
  it("attributes the invite and leaves the lead when the booking fails after the hold is written", async () => {
    const crm = fakeQueue();
    const answer = await request(
      site(),
      "/api/consultation",
      post({
        ...VISITOR,
        pincode: "122018",
        date: "2026-09-23",
        window: "morning",
        consent: true,
        address: ADDRESS,
        invite_code: "RM4K7P",
        invite_told: true,
      }),
      { DB: leaseRefused(env.DB), CRM_QUEUE: crm, MESSAGE_QUEUE: fakeQueue() },
    );

    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked", credits: true, invite: "valid" });
    expect((await attributions()).results).toEqual([expect.objectContaining({ code: "RM4K7P", via: "consultation" })]);
    expect(crm.sent).toEqual([{ lead_id: expect.any(String) as string, request_id: expect.any(String) as string }]);
    // Held and confirmed: what the cron books once the half hour has passed.
    const hold = await env.DB.prepare("SELECT state, confirmed_at IS NOT NULL AS confirmed FROM slot_holds").first();
    expect(hold).toEqual({ state: "held", confirmed: 1 });
  });

  // The friend is told who hears of their fit before /book sends the invite, or the invite is not sent.
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
// WhatsApp.
describe("a number the site already knows", () => {
  const book = (body: object, settings = {}) =>
    request(
      site(settings),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", consent: true, address: ADDRESS, ...body }),
      { CRM_QUEUE: fakeQueue() },
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
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, synced_at)
       VALUES ('fit', 'fit', 'p-fitted', 'first_fit', 'completed', '2026-08-01T03:30:00.000Z',
         '2026-08-01T06:30:00.000Z', ?1)`,
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
    expect(await told()).toEqual(["consultation_confirmation", "consultation_exists"]);
  });

  it("is never renamed by the form", async () => {
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

  it("books no consultation for a client past them, and tells them on WhatsApp to book in the app", async () => {
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
    const answer = await book({ date: "2026-09-23", window: "morning" }, { selfServeBooking: false });
    expect(await answer.json()).toEqual({ ...BOOKED_MORNING, state: "requested" });
    expect(await count("SELECT COUNT(*) AS n FROM consultation_requests")).toBe(0);
    expect(await told()).toEqual(["book_in_app"]);
  });

  it("leaves no person, consent or address behind when the window has gone", async () => {
    await env.DB.prepare("UPDATE technicians SET active = 0").run();
    const answer = await book({ date: "2026-09-23", window: "morning" });
    expect(answer.status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM consents")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM addresses")).toBe(0);
  });

  it("asks ops instead, holding nothing, on a day the price book charges for a consultation", async () => {
    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('consultation', 'standard', 50000, 0, '2026-09-23')",
    ).run();
    const answer = await book({ date: "2026-09-23", window: "morning" });
    expect(await answer.json()).toMatchObject({ state: "requested" });
    expect(await count("SELECT COUNT(*) AS n FROM appointments")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM consultation_requests")).toBe(1);
  });

  it("holds nothing on a day ops blacked out", async () => {
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-09-23', 'Dussehra')").run();
    const answer = await book({ date: "2026-09-23", window: "morning" });
    expect(answer.status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(0);
  });
});
