// What Google and Meta are told (ADR 0288): a first fit's booking, visit and payment recorded as conversions beside
// the writes; each sent by the cron, tried again with a longer wait when a platform is down and given up after the
// last, never for a test record or a client who asked us to stop; and Razorpay's webhook answered while Meta is down
// (each platform's request as it leaves is in conversion-requests.test.ts). Every name and number here is made up.

import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conversionUpkeep } from "../../../src/domain/attribution/conversion-upkeep.ts";
import { sendConversions } from "../../../src/domain/attribution/conversion-sends.ts";
import { metaPlaceHash } from "../../../src/lib/ad-match.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import type { ConversionPlatform, ConversionToSend, SendOutcome } from "../../../src/providers/conversions/index.ts";
import { STUB_ANSWER, STUB_SENT, createStubConversions } from "../../../src/providers/conversions/stub.ts";
import { aHold, anAddress, aPayment, aPerson, aTechnician, aVisit } from "../fixtures/index.ts";
import { NOW, deliverRazorpay, markDatabase } from "../helpers.ts";

const MINUTE = 60_000;
const log = createLogger();
const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

const stubs = () => ({ meta: createStubConversions("meta", log), google: createStubConversions("google", log) });

/** The alerts a run raised and let go, by key. */
let alerts: { raised: string[]; resolved: string[] };

const run = (
  platforms: { meta: ConversionPlatform | null; google: ConversionPlatform | null },
  now = NOW,
  sendsFrom: string | null = null,
) =>
  sendConversions(env.DB, platforms, {
    now,
    budget: createCallBudget(100),
    log,
    bookingPage: "https://maneman.test/book",
    sendsFrom,
    alerts: {
      alertOnce: (raised) => {
        alerts.raised.push(raised.key);
        return Promise.resolve();
      },
      resolveAlert: (key) => {
        alerts.resolved.push(key);
        return Promise.resolve();
      },
    },
  });

const rows = async (sql: string, ...values: string[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...values)
      .all()
  ).results;

async function client(mobile: string, extra: { testRecord?: boolean } = {}) {
  const { id } = await aPerson({ mobile_e164: mobile, test_record: extra.testRecord === true ? 1 : 0 });
  return id ?? "";
}

const upkeep = (personId: string) =>
  env.DB.batch(
    conversionUpkeep(env.DB, "SELECT value FROM json_each(?1)", JSON.stringify([personId]), NOW.toISOString()),
  );

/** A first fit booked a week before NOW, done two days before, and paid: Rs. 35,400, Rs. 30,000 before GST. */
async function firstFitPaid(personId: string) {
  const booked = later(-7 * 24 * 60).toISOString();
  const start = later(-2 * 24 * 60).toISOString();
  const { id: visit = "" } = await aVisit({
    person_id: personId,
    type: "first_fit",
    status: "completed",
    window_start: start,
    first_seen_at: booked,
  });
  await aPayment({
    person_id: personId,
    appointment_id: visit,
    amount: 3_540_000,
    amount_ex_gst: 3_000_000,
    captured_at: start,
  });
  await upkeep(personId);
  return visit;
}

/** A platform that answers each send with what it is given, in turn, and keeps what it was sent. */
function scripted(...answers: SendOutcome[]) {
  const sent: ConversionToSend[] = [];
  const platform: ConversionPlatform = {
    send(conversion) {
      sent.push(conversion);
      return Promise.resolve(answers.shift() ?? { kind: "sent" });
    },
  };
  return { sent, platform };
}

beforeEach(async () => {
  alerts = { raised: [], resolved: [] };
  await markDatabase();
});

afterEach(() => {
  STUB_ANSWER.meta = null;
  STUB_ANSWER.google = null;
  STUB_SENT.length = 0;
});

describe("a first fit's conversions", () => {
  it("are its booking, its visit and its payment, the payment's value before GST", async () => {
    const visit = await firstFitPaid(await client("+919810000011"));

    expect(
      await rows(
        `SELECT event, subject_id = ?1 AS of_visit, value_paise, attributed_channel, meta_state, google_state
         FROM conversions ORDER BY occurred_at, event`,
        visit,
      ),
    ).toEqual([
      {
        event: "consult_booked",
        of_visit: 1,
        value_paise: null,
        attributed_channel: "direct",
        meta_state: "pending",
        google_state: "pending",
      },
      {
        event: "consult_done",
        of_visit: 1,
        value_paise: null,
        attributed_channel: "direct",
        meta_state: "pending",
        google_state: "pending",
      },
      {
        event: "first_fit_paid",
        of_visit: 0,
        value_paise: 3_000_000,
        attributed_channel: "direct",
        meta_state: "pending",
        google_state: "pending",
      },
    ]);
  });

  it("are recorded once, however often the visit is written", async () => {
    const id = await client("+919810000012");
    await firstFitPaid(id);
    await upkeep(id);

    expect(await rows("SELECT COUNT(*) AS n FROM conversions")).toEqual([{ n: 3 }]);
  });

  it("go to each platform hashed, the payment's in rupees", async () => {
    await firstFitPaid(await client("+919810000013"));
    await run(stubs());

    const paid = STUB_SENT.find((each) => each.platform === "meta" && each.conversion.event === "first_fit_paid");
    expect(paid?.conversion.value).toBe(30_000);
    expect(paid?.conversion.phone.meta).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(STUB_SENT)).not.toContain("9810000013");
    expect(await rows("SELECT DISTINCT meta_state, google_state FROM conversions")).toEqual([
      { meta_state: "sent", google_state: "sent" },
    ]);
  });

  it("are never sent for a test record, nor for a client who asked us to stop", async () => {
    await firstFitPaid(await client("+919810000014", { testRecord: true }));
    const stopped = await client("+919810000015");
    await env.DB.prepare(
      `INSERT INTO person_attribution (person_id, sharing_stopped_at, sharing_stopped_by, updated_at)
       VALUES (?1, ?2, 'care@maneman.in', ?2)`,
    )
      .bind(stopped, NOW.toISOString())
      .run();
    await firstFitPaid(stopped);
    await run(stubs());

    expect(STUB_SENT).toEqual([]);
    expect(
      await rows("SELECT DISTINCT meta_state, meta_error, google_error FROM conversions ORDER BY meta_error"),
    ).toEqual([
      { meta_state: "skipped", meta_error: "sharing_stopped", google_error: "sharing_stopped" },
      { meta_state: "skipped", meta_error: "test_record", google_error: "test_record" },
    ]);
  });
});

describe("a consultation done that kept no start", () => {
  it("is booked but never done, and the write it follows goes through", async () => {
    const personId = await client("+919811115555");
    const { id: visit = "" } = await aVisit({
      person_id: personId,
      type: "consultation",
      status: "scheduled",
      window_start: later(-3 * 24 * 60).toISOString(),
      first_seen_at: later(-4 * 24 * 60).toISOString(),
    });
    // Done and kept without a start, as before migration 0169 required one: its trigger set aside, and put back.
    const trigger = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE name = 'appointments_kept_whole'").first<{
      sql: string;
    }>();
    await env.DB.prepare("DROP TRIGGER appointments_kept_whole").run();
    await env.DB.prepare(
      "UPDATE appointments SET status = 'completed', window_start = NULL, window_end = NULL WHERE id = ?1",
    )
      .bind(visit)
      .run();
    await env.DB.prepare(trigger?.sql ?? "").run();

    await upkeep(personId);

    expect(await rows("SELECT event FROM conversions WHERE person_id = ?1", personId)).toEqual([
      { event: "consult_booked" },
    ]);
  });
});

describe("a payment's conversion", () => {
  it("is never a late fee's, and a cancelled first fit leaves first_fit_paid to the one rebooked", async () => {
    const id = await client("+919810000020");
    const start = later(-3 * 24 * 60).toISOString();
    const { id: cancelled = "" } = await aVisit({
      person_id: id,
      type: "first_fit",
      status: "cancelled",
      window_start: start,
    });
    await aPayment({ person_id: id, appointment_id: cancelled, kind: "late_fee", amount: 50_000, captured_at: start });
    const { id: rebooked = "" } = await aVisit({
      person_id: id,
      type: "first_fit",
      status: "completed",
      window_start: later(-1 * 24 * 60).toISOString(),
    });
    const { id: paid = "" } = await aPayment({
      person_id: id,
      appointment_id: rebooked,
      amount: 3_540_000,
      amount_ex_gst: 3_000_000,
    });
    await upkeep(id);

    expect(
      await rows("SELECT event, subject_id FROM conversions WHERE event IN ('first_fit_paid', 'service_paid')"),
    ).toEqual([{ event: "first_fit_paid", subject_id: paid }]);
  });

  it("is sent with the payment's value before GST as it stands when sent", async () => {
    const id = await client("+919810000021");
    const { id: visit = "" } = await aVisit({
      person_id: id,
      type: "first_fit",
      status: "completed",
      window_start: NOW.toISOString(),
    });
    const { id: paid = "" } = await aPayment({
      person_id: id,
      appointment_id: visit,
      amount: 3_540_000,
      captured_at: NOW.toISOString(),
    });
    await upkeep(id);
    await env.DB.prepare("UPDATE payments SET amount_ex_gst = 3000000 WHERE id = ?1").bind(paid).run();
    await run(stubs());

    expect(STUB_SENT.find((each) => each.conversion.event === "first_fit_paid")?.conversion.value).toBe(30_000);
  });

  it("is not sent when it happened before sending began, however soon after it was recorded", async () => {
    await firstFitPaid(await client("+919810000026"));
    await run(stubs(), NOW, later(-24 * 60).toISOString());

    expect(STUB_SENT.map((each) => each.conversion.event)).not.toContain("consult_booked");
    expect(await rows("SELECT event, meta_error FROM conversions WHERE meta_state = 'skipped' ORDER BY event")).toEqual(
      [
        { event: "consult_booked", meta_error: "before_release" },
        { event: "consult_done", meta_error: "before_release" },
        { event: "first_fit_paid", meta_error: "before_release" },
      ],
    );
  });

  it("is not sent when it was recorded long after it happened, as history a release finds", async () => {
    await firstFitPaid(await client("+919810000022"));
    await env.DB.prepare("UPDATE conversions SET created_at = ?1")
      .bind(later(30 * 24 * 60).toISOString())
      .run();
    await run(stubs(), later(30 * 24 * 60 + 1));

    expect(STUB_SENT).toEqual([]);
    expect(await rows("SELECT DISTINCT meta_state, meta_error FROM conversions")).toEqual([
      { meta_state: "skipped", meta_error: "recorded_late" },
    ]);
  });
});

describe("a booking", () => {
  /** A consultation booked a day before NOW, its conversion sent to the stubs, and how it was told it was made. */
  async function bookedAndSent(id: string, held: "site" | "ops" | null) {
    const { id: visit = "" } = await aVisit({
      person_id: id,
      type: "consultation",
      first_seen_at: later(-24 * 60).toISOString(),
      window_start: later(2 * 24 * 60).toISOString(),
    });
    if (held !== null) {
      await aTechnician({ id: "t-booking" });
      await aHold({
        person_id: id,
        technician_id: "t-booking",
        appointment_id: visit,
        booked_from: held,
        state: "booked",
      });
    }
    await upkeep(id);
    await run(stubs());
    const sent = STUB_SENT.find((each) => each.platform === "meta" && each.conversion.event === "consult_booked");
    return { bookedVia: sent?.conversion.bookedVia, sourceUrl: sent?.conversion.sourceUrl };
  }

  it("made on the site is told as the website's, on its booking page", async () => {
    expect(await bookedAndSent(await client("+919810000024"), "site")).toEqual({
      bookedVia: "website",
      sourceUrl: "https://maneman.test/book",
    });
  });

  it("made by ops after a WhatsApp chat is told as the chat's", async () => {
    const id = await client("+919810000025");
    await env.DB.prepare(
      `INSERT INTO touches (id, at, via, person_id, channel, campaign_signal) VALUES ('chat', ?1, 'whatsapp', ?2, 'whatsapp', 0)`,
    )
      .bind(later(-2 * 24 * 60).toISOString(), id)
      .run();
    expect(await bookedAndSent(id, "ops")).toEqual({ bookedVia: "chat", sourceUrl: null });
  });
});

describe("a client who declined the cookie bar", () => {
  it("has none of Meta's cookies, address or browser sent, though an earlier touch kept them", async () => {
    const id = await client("+919810000019");
    const touch = (touchId: string, at: string, consent: "granted" | "denied", kept: boolean) =>
      env.DB.prepare(
        `INSERT INTO touches (id, at, via, person_id, channel, campaign_signal, ad_consent, fbc, client_ip, user_agent)
         VALUES (?1, ?2, 'site', ?3, 'meta_ads', 1, ?4, ?5, ?6, ?7)`,
      )
        .bind(
          touchId,
          at,
          id,
          consent,
          kept ? "fb.1.1790000000000.IwAR_test" : null,
          kept ? "203.0.113.7" : null,
          kept ? "Mozilla/5.0" : null,
        )
        .run();
    await touch("landed", later(-9 * 24 * 60).toISOString(), "granted", true);
    await touch("declined", later(-8 * 24 * 60).toISOString(), "denied", false);
    await firstFitPaid(id);
    await run(stubs());

    const sent = STUB_SENT.filter((each) => each.platform === "meta").map((each) => each.conversion.browser);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((browser) => browser.fbc === null && browser.ip === null && browser.userAgent === null)).toBe(
      true,
    );
  });
});

describe("a client's place", () => {
  it("goes from their current address: hashed city, state and pincode to Meta, and a whole address to Google", async () => {
    const personId = await client("+919811116666");
    await env.DB.prepare("UPDATE people SET name = 'Rohit Malhotra' WHERE id = ?1").bind(personId).run();
    await env.DB.prepare(
      `INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Sector 65', 'Gurgaon', 1)
       ON CONFLICT (pincode) DO NOTHING`,
    ).run();
    await anAddress(personId, { city: "Gurgaon", pincode: "122002", replaced_at: later(-60).toISOString() });
    // As the client typed it: the city is the one its pincode is served from, so Meta still has the state.
    await anAddress(personId, { city: "Gurugram", pincode: "122018" });
    await firstFitPaid(personId);
    const meta = scripted();
    const google = scripted();

    await run({ meta: meta.platform, google: google.platform });

    const [paidForMeta] = meta.sent.filter((sent) => sent.event === "first_fit_paid");
    expect(paidForMeta?.place.meta).toEqual(
      await metaPlaceHash({ city: "Gurgaon", state: "Haryana", pincode: "122018" }),
    );
    const [paidForGoogle] = google.sent.filter((sent) => sent.event === "first_fit_paid");
    expect(paidForGoogle?.place.google).toMatchObject({ regionCode: "IN", postalCode: "122018" });
  });

  it("is the city as the client typed it where we do not serve its pincode", async () => {
    const personId = await client("+919811118888");
    await anAddress(personId, { city: "Noida", pincode: "201301" });
    await firstFitPaid(personId);
    const meta = scripted();

    await run({ meta: meta.platform, google: scripted().platform });

    expect(meta.sent[0]?.place.meta).toEqual(
      await metaPlaceHash({ city: "Noida", state: "Uttar Pradesh", pincode: "201301" }),
    );
  });

  it("is the country alone, and no address for Google, for a client with none", async () => {
    const personId = await client("+919811117777");
    await firstFitPaid(personId);
    const meta = scripted();
    const google = scripted();

    await run({ meta: meta.platform, google: google.platform });

    expect(meta.sent[0]?.place.meta).toEqual(await metaPlaceHash({ city: null, state: null, pincode: null }));
    expect(google.sent[0]?.place.google).toBeNull();
  });
});

describe("a platform that is down", () => {
  it("is tried again after 1, 5, 30, 120 and 720 minutes, then given up, its words kept", async () => {
    await firstFitPaid(await client("+919810000016"));
    await env.DB.prepare("DELETE FROM conversions WHERE event <> 'first_fit_paid'").run();
    const down = scripted(...Array.from({ length: 6 }, () => ({ kind: "retry" as const, error: "503 down" })));
    let now = NOW;
    const waits: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await run({ meta: down.platform, google: null }, now);
      const row = await env.DB.prepare("SELECT meta_next_at FROM conversions").first<{ meta_next_at: string | null }>();
      const next = row?.meta_next_at ?? null;
      if (next === null) break;
      waits.push((Date.parse(next) - now.getTime()) / MINUTE);
      now = new Date(next);
    }

    expect(waits).toEqual([1, 5, 30, 120, 720]);
    expect(await rows("SELECT meta_state, meta_tries, meta_error, google_state FROM conversions")).toEqual([
      { meta_state: "failed", meta_tries: 6, meta_error: "503 down", google_state: "pending" },
    ]);
  });

  it("refusing our account holds every conversion an hour, a try not spent, and tells ops once until one goes", async () => {
    await firstFitPaid(await client("+919810000023"));
    const refusing = scripted({ kind: "held", error: "403 PERMISSION_DENIED" });
    await run({ meta: null, google: refusing.platform });

    expect(refusing.sent).toHaveLength(1);
    expect(alerts.raised).toEqual(["conversions_held:google"]);
    expect(await rows("SELECT DISTINCT google_state, google_tries FROM conversions")).toEqual([
      { google_state: "pending", google_tries: 0 },
    ]);

    await run({ meta: null, google: scripted().platform }, later(61));
    expect(await rows("SELECT DISTINCT google_state FROM conversions")).toEqual([{ google_state: "sent" }]);
    expect(alerts.resolved).toEqual(["conversions_held:google"]);
  });

  it("refusing our account puts off every conversion of that platform due, so none is tried before the hour", async () => {
    await firstFitPaid(await client("+919810000027"));
    const refusing = scripted({ kind: "held", error: "403 PERMISSION_DENIED" });
    await run({ meta: null, google: refusing.platform });
    await run({ meta: null, google: refusing.platform }, later(5));

    expect(refusing.sent).toHaveLength(1);
    expect(await rows("SELECT DISTINCT google_next_at FROM conversions")).toEqual([
      { google_next_at: later(60).toISOString() },
    ]);
  });

  it("is not tried again before its wait is over", async () => {
    await firstFitPaid(await client("+919810000017"));
    const down = scripted(
      { kind: "retry", error: "503" },
      { kind: "retry", error: "503" },
      { kind: "retry", error: "503" },
    );
    await run({ meta: down.platform, google: null });
    await run({ meta: down.platform, google: null }, later(0.5));

    expect(down.sent).toHaveLength(3);
  });

  it("refusing an event for good fails it at once", async () => {
    await firstFitPaid(await client("+919810000018"));
    await env.DB.prepare("DELETE FROM conversions WHERE event <> 'consult_booked'").run();
    await run({ meta: scripted({ kind: "refused", error: "400 100 Invalid parameter" }).platform, google: null });

    expect(await rows("SELECT meta_state, meta_error, meta_next_at FROM conversions")).toEqual([
      { meta_state: "failed", meta_error: "400 100 Invalid parameter", meta_next_at: null },
    ]);
  });
});

describe("Razorpay's webhook", () => {
  it("answers 200 while Meta is down; the payment's conversion waits and goes on a later run", async () => {
    await client("+919810000001");
    STUB_ANSWER.meta = { kind: "retry", error: "unreachable" };
    const event = {
      entity: "event",
      event: "payment.captured",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: "pay_1",
            entity: "payment",
            amount: 354000,
            currency: "INR",
            status: "captured",
            order_id: "order_1",
            method: "upi",
            vpa: "rohit@okaxis",
            contact: "+919810000001",
            notes: [],
            created_at: 1790058600,
          },
        },
      },
      created_at: 1790058601,
    };

    expect((await deliverRazorpay(event, { eventId: "evt_attr" })).status).toBe(200);
    await run(stubs(), later(10));
    expect(await rows("SELECT event, meta_state, meta_tries, google_state FROM conversions")).toEqual([
      { event: "service_paid", meta_state: "pending", meta_tries: 1, google_state: "sent" },
    ]);

    STUB_ANSWER.meta = null;
    await run(stubs(), later(12));
    expect(await rows("SELECT meta_state FROM conversions")).toEqual([{ meta_state: "sent" }]);
  });
});
