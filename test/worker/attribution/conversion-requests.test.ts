// Each platform's request as it leaves (ADR 0288): Meta's event and Google's, built from what the cron hands each
// sender, with nothing a client lacks sent empty; and each platform's answers read as sent, tried again, held or
// refused. Every name and number here is made up.

import { describe, expect, it } from "vitest";
import { createLogger } from "../../../src/log.ts";
import { createGoogleConversions } from "../../../src/providers/conversions/google.ts";
import type { ConversionToSend } from "../../../src/providers/conversions/index.ts";
import { createMetaConversions, metaEvent } from "../../../src/providers/conversions/meta.ts";
import { NOW, fakeFetch, json } from "../helpers.ts";

const log = createLogger();

/** What each platform's sender is given: a first fit's payment, after a click from a Google ad. */
const PAID: ConversionToSend = {
  eventId: "4d3c2b1a-0000-4000-8000-000000000001",
  event: "first_fit_paid",
  occurredAt: NOW,
  value: 30_000,
  sourceUrl: null,
  bookedVia: null,
  phone: { meta: "a".repeat(64), google: "b".repeat(64) },
  firstName: "c".repeat(64),
  place: {
    meta: { ct: "e".repeat(64), st: "f".repeat(64), zp: "1".repeat(64), country: "2".repeat(64) },
    google: { givenName: "3".repeat(64), familyName: "4".repeat(64), regionCode: "IN", postalCode: "122002" },
  },
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
      user_data: {
        ph: [PAID.phone.meta],
        fbc: PAID.browser.fbc,
        client_ip_address: "203.0.113.7",
        ct: ["e".repeat(64)],
        st: ["f".repeat(64)],
        zp: ["1".repeat(64)],
        country: ["2".repeat(64)],
      },
      custom_data: { currency: "INR", value: 30_000 },
    });
  });

  it("leaves out each part of a place the client has none of, the country always there", () => {
    const placeless = {
      ...PAID,
      place: { meta: { ct: null, st: null, zp: null, country: "2".repeat(64) }, google: null },
    };
    const userData = metaEvent(placeless).user_data as Record<string, unknown>;

    expect(["ct", "st", "zp"].filter((field) => field in userData)).toEqual([]);
    expect(userData.country).toEqual(["2".repeat(64)]);
  });

  it("never keeps a token Meta quotes back in its refusal", async () => {
    const quoting = fakeFetch({
      "https://graph.facebook.com/": () =>
        json({ error: { message: "Malformed access token meta-test-token and EAAGm0PX4ZCpsBAtest", code: 190 } }, 400),
    });
    const said = await createMetaConversions(settings, false, { fetch: quoting.fetch, log }).send(PAID);

    expect(said).toEqual({ kind: "held", error: "400 190 Malformed access token [token] and [token]" });
  });

  it("is held when Meta refuses our account: a lapsed token, or a dataset it cannot find", async () => {
    const lapsed = fakeFetch({
      "https://graph.facebook.com/": () => json({ error: { message: "Session has expired", code: 190 } }, 400),
    });
    const unknown = fakeFetch({
      "https://graph.facebook.com/": () =>
        json({ error: { message: "Unsupported post request", code: 100, error_subcode: 33 } }, 400),
    });

    expect((await createMetaConversions(settings, false, { fetch: lapsed.fetch, log }).send(PAID)).kind).toBe("held");
    expect((await createMetaConversions(settings, false, { fetch: unknown.fetch, log }).send(PAID)).kind).toBe("held");
  });

  it("tells a booking by how it was made, a website's only with its page and browser", () => {
    const booked = { ...PAID, event: "consult_booked" as const, value: null };
    const sources = [
      { ...booked, bookedVia: "website" as const, sourceUrl: "https://maneman.in/book" },
      {
        ...booked,
        bookedVia: "website" as const,
        sourceUrl: "https://maneman.in/book",
        browser: { ...PAID.browser, userAgent: null },
      },
      { ...booked, bookedVia: "chat" as const },
      { ...booked, bookedVia: "phone_call" as const },
      { ...booked, bookedVia: "system" as const },
    ].map((conversion) => metaEvent(conversion).action_source);

    expect(sources).toEqual(["website", "system_generated", "chat", "phone_call", "system_generated"]);
    expect(metaEvent({ ...booked, bookedVia: "website", sourceUrl: "https://maneman.in/book" })).toMatchObject({
      event_source_url: "https://maneman.in/book",
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

  it("is tried again when Meta says it is busy or the trouble will pass, whatever the status", async () => {
    const errors = [
      { message: "Application request limit reached", code: 4 },
      { message: "User request limit reached", code: 17 },
      { message: "Calls to this api have exceeded the rate limit", code: 613 },
      { message: "An unexpected error has occurred", code: 100, is_transient: true },
    ];
    for (const status of [400, 403]) {
      for (const error of errors) {
        const busy = fakeFetch({ "https://graph.facebook.com/": () => json({ error }, status) });
        const said = await createMetaConversions(settings, false, { fetch: busy.fetch, log }).send(PAID);
        expect(said.kind, `${String(status)} ${String(error.code)}`).toBe("retry");
      }
    }
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
          userData: {
            userIdentifiers: [{ phoneNumber: PAID.phone.google }, { address: PAID.place.google }],
          },
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
    await google.send({ ...PAID, event: "consult_booked", value: null, bookedVia: "chat" });
    expect(JSON.parse(calls.at(-1)?.body ?? "{}")).toMatchObject({ events: [{ eventSource: "MESSAGE" }] });
    // One click ID an event, gclid first.
    const sentClicks = async (clicks: typeof PAID.clicks) => {
      await google.send({ ...PAID, clicks });
      const body = JSON.parse(calls.at(-1)?.body ?? "{}") as { events: { adIdentifiers?: unknown }[] };
      return body.events[0]?.adIdentifiers;
    };
    expect(await sentClicks({ gclid: "Cj0KCQ_test", gbraid: "0AAAAA_g", wbraid: null })).toEqual({
      gclid: "Cj0KCQ_test",
    });
    expect(await sentClicks({ gclid: null, gbraid: "0AAAAA_g", wbraid: "Cl0KCQ_w" })).toEqual({ gbraid: "0AAAAA_g" });
    expect(await sentClicks({ gclid: null, gbraid: null, wbraid: null })).toBeUndefined();
  });

  it("names the client by their number alone where Google cannot have their address whole", async () => {
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

    await google.send({ ...PAID, place: { ...PAID.place, google: null } });
    const body = JSON.parse(calls.at(-1)?.body ?? "{}") as { events: { userData: { userIdentifiers: unknown[] } }[] };
    expect(body.events[0]?.userData.userIdentifiers).toEqual([{ phoneNumber: PAID.phone.google }]);
  });

  it("is held when Google refuses our account, and tried again when Google is down", async () => {
    const answers = [
      json({ error: { message: "The caller does not have permission", status: "PERMISSION_DENIED" } }, 403),
      json({}, 503),
    ];
    const { fetch } = fakeFetch({
      "https://oauth2.googleapis.com/token": () => json({ access_token: "token-1", expires_in: 3600 }),
      "https://datamanager.googleapis.com/": () => answers.shift() ?? json({}, 500),
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

    expect(await google.send(PAID)).toEqual({
      kind: "held",
      error: "403 PERMISSION_DENIED The caller does not have permission",
    });
    expect((await google.send(PAID)).kind).toBe("retry");
  });

  it("is held when Google refuses our sign-in, a key deleted or an account removed", async () => {
    const { fetch } = fakeFetch({
      "https://oauth2.googleapis.com/token": () => json({ error: "invalid_grant" }, 400),
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

    expect(await google.send(PAID)).toEqual({ kind: "held", error: "token 400 invalid_grant" });
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
