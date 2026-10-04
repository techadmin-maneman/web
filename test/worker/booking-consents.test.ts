// The photograph consents a booking in the app gives (docs/decisions/0080-consents-given-by-booking.md): the purposes
// the pay step showed, each only while the client has never decided on it, recorded once the booking is confirmed:
// paid for, or free. NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { HOLD_SECONDS, PAYMENT_GRACE_SECONDS } from "../../src/config/scheduling.ts";
import { grantCredits } from "../../src/domain/credits.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { saltedHash } from "../../src/lib/hash.ts";
import {
  appFor,
  fakeDependencies,
  fakeQueue,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
  savedAddress,
} from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const BOTH = ["photos_own_record", "photos_referral_cards"];
const WEBHOOK_SECRET = "a-razorpay-webhook-secret-for-booking-consents";
const CLIENT_IP = "203.0.113.7";
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);

let cookie: string;
const app = (minutesLater = 0) => appFor("local", fakeDependencies({ now: () => minutes(minutesLater) }), {}, "client");

const post = (path: string, body: object, minutesLater = 0) =>
  request(app(minutesLater), path, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Origin: "https://maneman.test",
      "CF-Connecting-IP": CLIENT_IP,
    },
    body: JSON.stringify(body),
  });

async function held(body: object = { type: "service", date: "2026-09-24", window: "afternoon" }): Promise<string> {
  const answer = await post("/api/holds", body);
  expect(answer.status).toBe(201);
  return (await answer.json<{ id: string }>()).id;
}

const book = (holdId: string, consents?: string[], minutesLater = 0) =>
  post("/api/bookings", consents === undefined ? { hold_id: holdId } : { hold_id: holdId, consents }, minutesLater);

interface Ordered {
  readonly holdId: string;
  readonly orderId: string;
  readonly amount: number;
}

/** A service visit held and tapped to pay with what the pay step showed, and the order Checkout opens with. */
async function tappedToPay(consents: string[] = BOTH): Promise<Ordered> {
  const holdId = await held();
  const answer = await book(holdId, consents);
  expect(answer.status).toBe(201);
  const checkout = (await answer.json<{ checkout: { order_id: string; amount: number } | null }>()).checkout;
  if (checkout === null) throw new Error("a service visit is paid for");
  return { holdId, orderId: checkout.order_id, amount: checkout.amount };
}

/** The webhook's app, which books a paid visit in its request. */
function webhookApp(now: Date) {
  const settings = {
    ...LOCAL_SETTINGS,
    razorpay: { keyId: "rzp_test_consents", keySecret: "s", webhookSecret: WEBHOOK_SECRET },
  };
  return appFor("local", fakeDependencies({ now: () => now }), settings, "public");
}

/** Razorpay's signed webhook: the payment for the order, made at `paidAt`, reaching us a minute later. */
async function paid(ordered: Ordered, paidAt: Date, event = "payment.captured") {
  const payment = {
    id: `pay_${ordered.holdId.slice(0, 8)}`,
    amount: ordered.amount,
    currency: "INR",
    status: "captured",
    order_id: ordered.orderId,
    method: "upi",
    notes: { hold_id: ordered.holdId, person_id: PERSON },
    created_at: Math.floor(paidAt.getTime() / 1000),
  };
  const body = JSON.stringify({ entity: "event", event, payload: { payment: { entity: payment } } });
  const answer = await request(
    webhookApp(new Date(paidAt.getTime() + 60_000)),
    "/api/hooks/razorpay",
    {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": await saltedHash(WEBHOOK_SECRET, body),
        "X-Razorpay-Event-Id": `evt_${event}_${ordered.holdId}`,
      },
    },
    { MESSAGE_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue() },
  );
  expect(answer.status).toBe(200);
}

async function decided(purpose: string, granted: boolean, notice: string, at = "2026-09-01T06:30:00.000Z") {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(crypto.randomUUID(), PERSON, purpose, notice, granted ? 1 : 0, at)
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

const holdState = async (holdId: string) =>
  (await env.DB.prepare("SELECT state FROM slot_holds WHERE id = ?1").bind(holdId).first<{ state: string }>())?.state;

const audited = async () =>
  (
    await env.DB.prepare(
      "SELECT action, subject_kind, subject_id, detail FROM audit_log WHERE action = 'consent.switch' ORDER BY id",
    ).all<{ action: string; subject_kind: string; subject_id: string; detail: string }>()
  ).results.map((row) => ({ ...row, detail: JSON.parse(row.detail) as unknown }));

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await savedAddress(PERSON);
  // Fitted: a first fit done with Imran, so service visits are what they book.
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
     VALUES ('fit', 'fit', ?1, 'first_fit', 'completed', '2026-08-01T03:30:00.000Z', '2026-08-01T06:30:00.000Z', 't1',
       ?2)`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

describe("a paid visit's consents", () => {
  it("are not recorded at the tap that opens Checkout, nor when Checkout is closed unpaid", async () => {
    await tappedToPay();
    expect(await ledger()).toEqual([]);
    expect(await audited()).toEqual([]);
  });

  it("are recorded once Razorpay says it is paid, as given when it was paid, on the pay step's own notices", async () => {
    const ordered = await tappedToPay();
    await paid(ordered, minutes(3));
    expect(await ledger()).toEqual([
      {
        purpose: "photos_own_record",
        granted: 1,
        notice_version: "photos-own-record-booking-v2",
        created_at: minutes(3).toISOString(),
        source: "app_booking",
      },
      {
        purpose: "photos_referral_cards",
        granted: 1,
        notice_version: "photos-referral-cards-booking-v2",
        created_at: minutes(3).toISOString(),
        source: "app_booking",
      },
    ]);
    // The profile then shows each as given, with its date.
    const profile = await (
      await request(app(5), "/api/profile", { headers: { Cookie: cookie } })
    ).json<{
      consents: { purpose: string; granted: boolean; since: string | null }[];
    }>();
    expect(profile.consents.filter((consent) => BOTH.includes(consent.purpose))).toEqual([
      { purpose: "photos_own_record", granted: true, since: minutes(3).toISOString() },
      { purpose: "photos_referral_cards", granted: true, since: minutes(3).toISOString() },
    ]);
  });

  it("carry the hashed address of the client who tapped, not Razorpay's", async () => {
    await paid(await tappedToPay(), minutes(3));
    const hashes = await env.DB.prepare("SELECT DISTINCT ip_hash FROM consents").all();
    expect(hashes.results).toEqual([{ ip_hash: await saltedHash(LOCAL_SETTINGS.ipHashSalt, CLIENT_IP) }]);
  });

  it("each write the audit entry the profile's switch writes, naming the hold", async () => {
    const ordered = await tappedToPay();
    await paid(ordered, minutes(3));
    expect(await audited()).toEqual(
      BOTH.map((purpose) => ({
        action: "consent.switch",
        subject_kind: "hold",
        subject_id: ordered.holdId,
        detail: { purpose, granted: true },
      })),
    );
  });

  it("are recorded once however often Razorpay tells of the payment", async () => {
    const ordered = await tappedToPay();
    await paid(ordered, minutes(3));
    await paid(ordered, minutes(3), "order.paid");
    expect(await ledger()).toHaveLength(2);
    expect(await audited()).toHaveLength(2);
  });

  it("are recorded as the webhook's request books the visit", async () => {
    const ordered = await tappedToPay();
    await paid(ordered, minutes(3));
    expect(await holdState(ordered.holdId)).toBe("booked");
    expect(await ledger()).toMatchObject([
      { purpose: "photos_own_record", granted: 1, created_at: minutes(3).toISOString() },
      { purpose: "photos_referral_cards", granted: 1, created_at: minutes(3).toISOString() },
    ]);
  });

  it("are not recorded for a payment made after the hold and its grace ran out, which is refunded", async () => {
    const ordered = await tappedToPay();
    const tooLate = new Date(NOW.getTime() + (HOLD_SECONDS + PAYMENT_GRACE_SECONDS + 5) * 1000);
    await paid(ordered, tooLate);
    expect(await holdState(ordered.holdId)).toBe("released");
    expect(await ledger()).toEqual([]);
    expect(await audited()).toEqual([]);
  });

  it("are recorded for a payment made in the hold's last moment of grace", async () => {
    const ordered = await tappedToPay();
    const lastMoment = new Date(NOW.getTime() + (HOLD_SECONDS + PAYMENT_GRACE_SECONDS) * 1000);
    await paid(ordered, lastMoment);
    expect(await ledger()).toHaveLength(2);
  });

  it("leave a purpose the client switched between the tap and the payment as they left it", async () => {
    const ordered = await tappedToPay();
    await decided("photos_referral_cards", false, "photos-referral-cards-v2", minutes(1).toISOString());
    await paid(ordered, minutes(3));
    expect(await ledger()).toMatchObject([
      { purpose: "photos_referral_cards", granted: 0 },
      { purpose: "photos_own_record", granted: 1, notice_version: "photos-own-record-booking-v2" },
    ]);
  });
});

describe("POST /api/bookings with the consents the pay step showed", () => {
  it("records a purpose asked alone on that notice", async () => {
    await paid(await tappedToPay(["photos_referral_cards"]), minutes(3));
    expect(await ledger()).toMatchObject([
      { purpose: "photos_referral_cards", notice_version: "photos-referral-cards-booking-alone-v1" },
    ]);
  });

  it("records the photographs for the visit record asked alone on that notice", async () => {
    await paid(await tappedToPay(["photos_own_record"]), minutes(3));
    expect(await ledger()).toMatchObject([
      { purpose: "photos_own_record", notice_version: "photos-own-record-booking-alone-v2" },
    ]);
  });

  it("never switches back on a purpose the client switched off, and records the other alone", async () => {
    await decided("photos_referral_cards", false, "photos-referral-cards-v2");
    await paid(await tappedToPay(), minutes(3));
    expect(await ledger()).toMatchObject([
      { purpose: "photos_referral_cards", granted: 0 },
      { purpose: "photos_own_record", granted: 1, notice_version: "photos-own-record-booking-v2" },
    ]);
    expect(await audited()).toHaveLength(1);
  });

  it("leaves a purpose the client has already agreed to as it stands", async () => {
    await decided("photos_own_record", true, "photos-own-record-v1");
    await paid(await tappedToPay(["photos_own_record"]), minutes(3));
    expect(await ledger()).toMatchObject([{ purpose: "photos_own_record", notice_version: "photos-own-record-v1" }]);
    expect(await audited()).toEqual([]);
  });

  it("records nothing the pay step did not show", async () => {
    await paid(await tappedToPay([]), minutes(3));
    expect(await ledger()).toEqual([]);
  });

  it("records them at once for a visit a credit covers, which is confirmed without paying, and once on a repeated tap", async () => {
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    const holdId = await held();
    const answer = await book(holdId, BOTH);
    expect(await answer.json()).toMatchObject({ checkout: null });
    expect(await ledger()).toMatchObject([
      { purpose: "photos_own_record", created_at: NOW.toISOString() },
      { purpose: "photos_referral_cards", created_at: NOW.toISOString() },
    ]);
    await book(holdId, BOTH);
    expect(await ledger()).toHaveLength(2);
    expect(await audited()).toHaveLength(2);
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
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
       VALUES (?1, ?1, ?2, 'service', 'scheduled', '2026-09-24T06:30:00.000Z', '2026-09-24T08:00:00.000Z', 't1', ?3)`,
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
