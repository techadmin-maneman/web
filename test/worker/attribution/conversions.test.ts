// What Google and Meta are told (ADR 0288): a first fit's booking, visit and payment recorded as conversions beside
// the writes; each sent by the cron, tried again with a longer wait when a platform is down and given up after the
// last, never for a test record or a client who asked us to stop; Razorpay's webhook answered while Meta is down; and
// each platform's request as it leaves. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conversionUpkeep } from "../../../src/domain/attribution/conversion-upkeep.ts";
import { sendConversions } from "../../../src/domain/attribution/conversion-sends.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { createGoogleConversions } from "../../../src/providers/conversions/google.ts";
import type { ConversionPlatform, ConversionToSend, SendOutcome } from "../../../src/providers/conversions/index.ts";
import { createMetaConversions } from "../../../src/providers/conversions/meta.ts";
import { STUB_ANSWER, STUB_SENT, createStubConversions } from "../../../src/providers/conversions/stub.ts";
import { aPayment, aPerson, aVisit } from "../fixtures/index.ts";
import { NOW, deliverRazorpay, fakeFetch, json, markDatabase } from "../helpers.ts";

const MINUTE = 60_000;
const log = createLogger();
const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

const stubs = () => ({ meta: createStubConversions("meta", log), google: createStubConversions("google", log) });

const run = (platforms: { meta: ConversionPlatform | null; google: ConversionPlatform | null }, now = NOW) =>
  sendConversions(env.DB, platforms, { now, budget: createCallBudget(100), log });

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

/** What each platform's sender is given: a first fit's payment, after a click from a Google ad. */
const PAID: ConversionToSend = {
  eventId: "4d3c2b1a-0000-4000-8000-000000000001",
  event: "first_fit_paid",
  occurredAt: NOW,
  value: 30_000,
  sourceUrl: null,
  phone: { meta: "a".repeat(64), google: "b".repeat(64) },
  firstName: "c".repeat(64),
  externalId: "d".repeat(64),
  browser: { fbc: "fb.1.1790000000000.IwAR_test", fbp: null, ip: "203.0.113.7", userAgent: "Mozilla/5.0" },
  clicks: { gclid: "Cj0KCQ_test", gbraid: null, wbraid: null },
};

describe("Meta's request", () => {
  const settings = { datasetId: "1234567890", token: "meta-test-token", testEventCode: "TEST123" };

  it("is a home visit's purchase, to the dataset's Test Events in test mode", async () => {
    const { fetch, calls } = fakeFetch({ "https://graph.facebook.com/": () => json({ events_received: 1 }) });
    const meta = createMetaConversions(settings, true, { fetch, log });

    expect(await meta.send(PAID)).toEqual({ kind: "sent" });
    expect(calls[0]?.url).toBe("https://graph.facebook.com/v26.0/1234567890/events");
    const body = JSON.parse(calls[0]?.body ?? "{}") as { data: Record<string, unknown>[]; test_event_code: string };
    expect(body.test_event_code).toBe("TEST123");
    expect(body.data[0]).toMatchObject({
      event_name: "Purchase",
      event_id: PAID.eventId,
      action_source: "physical_store",
      user_data: { ph: [PAID.phone.meta], fbc: PAID.browser.fbc, client_ip_address: "203.0.113.7" },
      custom_data: { currency: "INR", value: 30_000 },
    });
  });

  it("is tried again when Meta is down, and failed when Meta refuses the event", async () => {
    const down = fakeFetch({ "https://graph.facebook.com/": () => json({ error: { message: "down" } }, 503) });
    const refuses = fakeFetch({
      "https://graph.facebook.com/": () => json({ error: { message: "Invalid parameter", code: 100 } }, 400),
    });

    expect((await createMetaConversions(settings, false, { fetch: down.fetch, log }).send(PAID)).kind).toBe("retry");
    expect(await createMetaConversions(settings, false, { fetch: refuses.fetch, log }).send(PAID)).toEqual({
      kind: "refused",
      error: "400 100 Invalid parameter",
    });
    expect(refuses.calls[0]?.body).not.toContain("TEST123");
  });
});

describe("Google's request", () => {
  const ACTIONS = { consult_booked: "11", consult_done: "12", first_fit_paid: "13", service_paid: "14" };

  /** A key made for the test, as the service account's JSON key gives it, without its PEM lines (the signer drops them). */
  async function throwawayKey() {
    const pair = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    return btoa(String.fromCharCode(...der));
  }

  it("goes to the event's conversion action, validate-only in test mode, its token asked for once", async () => {
    const { fetch, calls } = fakeFetch({
      "https://oauth2.googleapis.com/token": () => json({ access_token: "token-1", expires_in: 3600 }),
      "https://datamanager.googleapis.com/": () => json({ requestId: "v-1" }),
    });
    const google = createGoogleConversions(
      {
        customerId: "1234567890",
        loginCustomerId: null,
        actions: ACTIONS,
        serviceAccount: { clientEmail: "conversions@test.iam.gserviceaccount.com", privateKey: await throwawayKey() },
      },
      true,
      { fetch, log, now: () => NOW },
    );

    expect(await google.send(PAID)).toEqual({ kind: "sent" });
    expect(await google.send({ ...PAID, event: "consult_booked", value: null })).toEqual({ kind: "sent" });
    const ingests = calls.filter((call) => call.url.startsWith("https://datamanager"));
    expect(calls.filter((call) => call.url.startsWith("https://oauth2"))).toHaveLength(1);
    expect(ingests[0]?.headers.get("Authorization")).toBe("Bearer token-1");
    expect(JSON.parse(ingests[0]?.body ?? "{}")).toEqual({
      destinations: [
        { operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" }, productDestinationId: "13" },
      ],
      encoding: "HEX",
      events: [
        {
          transactionId: PAID.eventId,
          eventTimestamp: NOW.toISOString(),
          eventSource: "IN_STORE",
          adIdentifiers: { gclid: "Cj0KCQ_test" },
          userData: { userIdentifiers: [{ phoneNumber: PAID.phone.google }] },
          conversionValue: 30_000,
          currency: "INR",
        },
      ],
      validateOnly: true,
    });
    expect(JSON.parse(ingests[1]?.body ?? "{}")).toMatchObject({
      destinations: [{ productDestinationId: "11" }],
      events: [{ eventSource: "OTHER" }],
    });
  });

  it("refuses a lead without a call, as a lead reaches Google from GA4", async () => {
    const { fetch, calls } = fakeFetch({});
    const google = createGoogleConversions(
      {
        customerId: "1234567890",
        loginCustomerId: null,
        actions: ACTIONS,
        serviceAccount: { clientEmail: "x", privateKey: "x" },
      },
      true,
      { fetch, log, now: () => NOW },
    );

    expect((await google.send({ ...PAID, event: "lead_submit" })).kind).toBe("refused");
    expect(calls).toEqual([]);
  });
});
