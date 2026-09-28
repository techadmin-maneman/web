// The photograph consents a booking in the app gives (docs/decisions/0080-consents-given-by-booking.md): the tap
// that starts the booking agrees to the purposes the pay step showed, each only while the client has never decided
// on it. NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { grantCredits } from "../../src/domain/credits.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request, savedAddress } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const BOTH = ["photos_own_record", "photos_referral_cards"];

let cookie: string;
const app = (minutesLater = 0) =>
  appFor("local", fakeDependencies({ now: () => new Date(NOW.getTime() + minutesLater * 60_000) }), {}, "client");

const post = (path: string, body: object, minutesLater = 0) =>
  request(
    app(minutesLater),
    path,
    {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(body),
    },
    { FSM_QUEUE: fakeQueue() },
  );

async function held(body: object = { type: "service", date: "2026-09-24", window: "afternoon" }): Promise<string> {
  const answer = await post("/api/holds", body);
  expect(answer.status).toBe(201);
  return (await answer.json<{ id: string }>()).id;
}

const book = (holdId: string, consents?: string[], minutesLater = 0) =>
  post("/api/bookings", consents === undefined ? { hold_id: holdId } : { hold_id: holdId, consents }, minutesLater);

async function decided(purpose: string, granted: boolean, notice: string) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, '2026-09-01T06:30:00.000Z')`,
  )
    .bind(crypto.randomUUID(), PERSON, purpose, notice, granted ? 1 : 0)
    .run();
}

const ledger = async () =>
  (
    await env.DB.prepare(
      "SELECT purpose, granted, notice_version, created_at, source FROM consents WHERE person_id = ?1 ORDER BY rowid",
    )
      .bind(PERSON)
      .all()
  ).results;

const audited = async () =>
  (
    await env.DB.prepare(
      "SELECT action, subject_kind, subject_id, detail FROM audit_log WHERE action = 'consent.switch' ORDER BY id",
    ).all<{ action: string; subject_kind: string; subject_id: string; detail: string }>()
  ).results.map((row) => ({ ...row, detail: JSON.parse(row.detail) as unknown }));

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'contact-1')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await savedAddress(PERSON);
  // Fitted: a first fit done with Imran, so service visits are what they book.
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end, technician_id,
       fsm_modified_at, synced_at)
     VALUES ('fit', 'fsm-fit', ?1, 'first_fit', 'completed', 'Completed', '2026-08-01T03:30:00.000Z',
       '2026-08-01T06:30:00.000Z', 't1', ?2, ?2)`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

describe("POST /api/bookings with the consents the pay step showed", () => {
  it("records both photograph consents at the tap, on the notice holding the pay step's lines", async () => {
    const answer = await book(await held(), BOTH);
    expect(answer.status).toBe(201);
    expect(await ledger()).toEqual([
      {
        purpose: "photos_own_record",
        granted: 1,
        notice_version: "photos-own-record-booking-v1",
        created_at: NOW.toISOString(),
        source: "app_booking",
      },
      {
        purpose: "photos_referral_cards",
        granted: 1,
        notice_version: "photos-referral-cards-booking-v1",
        created_at: NOW.toISOString(),
        source: "app_booking",
      },
    ]);
    // The profile then shows each as given, with its date.
    const profile = await (
      await request(app(), "/api/profile", { headers: { Cookie: cookie } })
    ).json<{
      consents: { purpose: string; granted: boolean; since: string | null }[];
    }>();
    expect(profile.consents.filter((consent) => BOTH.includes(consent.purpose))).toEqual([
      { purpose: "photos_own_record", granted: true, since: NOW.toISOString() },
      { purpose: "photos_referral_cards", granted: true, since: NOW.toISOString() },
    ]);
  });

  it("writes the audit entry the profile's switch writes, for each consent recorded, naming the hold", async () => {
    const holdId = await held();
    await book(holdId, BOTH);
    expect(await audited()).toEqual(
      BOTH.map((purpose) => ({
        action: "consent.switch",
        subject_kind: "hold",
        subject_id: holdId,
        detail: { purpose, granted: true },
      })),
    );
  });

  it("records a purpose asked alone on that notice", async () => {
    await book(await held(), ["photos_referral_cards"]);
    expect(await ledger()).toMatchObject([
      { purpose: "photos_referral_cards", notice_version: "photos-referral-cards-booking-alone-v1" },
    ]);
  });

  it("never switches back on a purpose the client switched off, and records the other alone", async () => {
    await decided("photos_referral_cards", false, "photos-referral-cards-v2");
    const holdId = await held();
    await book(holdId, BOTH);
    const rows = await ledger();
    expect(rows).toMatchObject([
      { purpose: "photos_referral_cards", granted: 0 },
      { purpose: "photos_own_record", granted: 1, notice_version: "photos-own-record-booking-v1" },
    ]);
    expect(await audited()).toHaveLength(1);
  });

  it("leaves a purpose the client has already agreed to as it stands", async () => {
    await decided("photos_own_record", true, "photos-own-record-v1");
    await book(await held(), ["photos_own_record"]);
    expect(await ledger()).toMatchObject([{ purpose: "photos_own_record", notice_version: "photos-own-record-v1" }]);
    expect(await audited()).toEqual([]);
  });

  it("records nothing the pay step did not show, and nothing twice when the tap is repeated", async () => {
    const holdId = await held();
    await book(holdId);
    expect(await ledger()).toEqual([]);
    await book(holdId, BOTH);
    await book(holdId, BOTH);
    expect(await ledger()).toHaveLength(2);
    expect(await audited()).toHaveLength(2);
  });

  it("records them for a visit a credit covers, which is booked without paying", async () => {
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    const answer = await book(await held(), BOTH);
    expect(await answer.json()).toMatchObject({ checkout: null });
    expect(await ledger()).toHaveLength(2);
  });

  it("records nothing when the hold has lapsed and nothing is booked", async () => {
    const answer = await book(await held(), BOTH, 13);
    expect(answer.status).toBe(409);
    expect(await ledger()).toEqual([]);
  });

  it("refuses a purpose a booking may not agree to", async () => {
    const answer = await book(await held(), ["photos_marketing"]);
    expect(answer.status).toBe(400);
    expect(await ledger()).toEqual([]);
  });
});

describe("moving a visit", () => {
  it("records no consent, however the move is started", async () => {
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
         window_end, technician_id, fsm_modified_at, synced_at)
       VALUES (?1, 'fsm-visit-1', 'fsm-order-1', ?2, 'service', 'scheduled', 'Scheduled', '2026-09-24T06:30:00.000Z',
         '2026-09-24T08:00:00.000Z', 't1', ?3, ?3)`,
    )
      .bind(VISIT, PERSON, NOW.toISOString())
      .run();
    const move = await held({ type: "service", date: "2026-09-25", window: "afternoon", moving: VISIT });
    expect((await book(move, BOTH)).status).toBe(201);
    expect(await ledger()).toEqual([]);
    const withConsents = await post(`/api/appointments/${VISIT}/reschedule`, { hold_id: move, consents: BOTH });
    expect(withConsents.status).toBe(400);
  });
});
