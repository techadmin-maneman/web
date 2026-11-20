// The startup guard on sending conversions (src/config/conversion-settings.ts; ADR 0288): each platform on once all
// its secrets are set and off while none is, refused with some set and others missing or with one it cannot be, and
// staging sending only in test mode. Every ID and key here is made up.

import { describe, expect, it } from "vitest";
import { validateStaticConfig } from "../../../src/guard.ts";
import { problemsOf, production, stagingBase } from "./guard-fixtures.ts";

const ON = { META_CAPI_PROVIDER: "meta", GOOGLE_ADS_PROVIDER: "google" };

/** The day sending began, which a platform that sends needs. */
const FROM = { CONVERSIONS_FROM: "2026-11-21" };

const META = { META_DATASET_ID: "2231091544495701", META_CAPI_TOKEN: "meta-test-token" };

const GOOGLE = {
  GOOGLE_ADS_CUSTOMER_ID: "782-892-1498",
  GOOGLE_SERVICE_ACCOUNT_KEY: JSON.stringify({
    client_email: "conversions@test.iam.gserviceaccount.com",
    private_key: "not-a-key",
  }),
  GOOGLE_ADS_ACTION_CONSULT_BOOKED: "7910236469",
  GOOGLE_ADS_ACTION_CONSULT_DONE: "7910368795",
  GOOGLE_ADS_ACTION_FIRST_FIT_PAID: "7910366635",
  GOOGLE_ADS_ACTION_SERVICE_PAID: "7910237510",
};

const conversionsOf = (env: Record<string, unknown>) => validateStaticConfig(env).settings.conversions;

describe("validateStaticConfig: conversions", () => {
  it("leaves each platform off while none of its secrets is set", () => {
    expect(conversionsOf({ ...production, ...ON })).toEqual({
      testMode: false,
      meta: null,
      google: null,
      sendsFrom: null,
    });
  });

  it("reads each platform whose secrets are all set, an Ads account as its ten digits", () => {
    expect(conversionsOf({ ...production, ...ON, ...META, ...GOOGLE, ...FROM })).toEqual({
      testMode: false,
      sendsFrom: "2026-11-21",
      meta: { datasetId: "2231091544495701", token: "meta-test-token", testEventCode: null },
      google: {
        customerId: "7828921498",
        loginCustomerId: null,
        actions: {
          consult_booked: "7910236469",
          consult_done: "7910368795",
          first_fit_paid: "7910366635",
          service_paid: "7910237510",
        },
        serviceAccount: { clientEmail: "conversions@test.iam.gserviceaccount.com", privateKey: "not-a-key" },
      },
    });
  });

  it("reads nothing for a platform its provider var switches off, whatever is set", () => {
    expect(conversionsOf({ ...production, META_CAPI_PROVIDER: "none", ...META })).toMatchObject({ meta: null });
  });

  it("refuses some of a platform's secrets without the rest, and one that cannot be what it names", () => {
    const { META_CAPI_TOKEN: _token, ...datasetAlone } = META;
    expect(problemsOf({ ...production, ...ON, ...datasetAlone, ...FROM })).toEqual([
      "META_CAPI_TOKEN not set, beside the others it goes with",
    ]);
    expect(
      problemsOf({
        ...production,
        ...ON,
        ...META,
        ...GOOGLE,
        ...FROM,
        META_DATASET_ID: "pixel",
        GOOGLE_ADS_CUSTOMER_ID: "78289",
        GOOGLE_ADS_ACTION_SERVICE_PAID: "paid",
        GOOGLE_SERVICE_ACCOUNT_KEY: "{",
      }),
    ).toEqual([
      "META_DATASET_ID must be the dataset's (Pixel's) number",
      "GOOGLE_ADS_ACTION_SERVICE_PAID must be the conversion action's ID, its digits",
      "GOOGLE_ADS_CUSTOMER_ID must be a Google Ads account's ten digits",
      "GOOGLE_SERVICE_ACCOUNT_KEY must be the service account's JSON key, as Google Cloud gave it",
    ]);
  });

  it("needs the day sending began wherever a platform sends, written as a day", () => {
    expect(problemsOf({ ...production, ...ON, ...GOOGLE })).toEqual([
      "CONVERSIONS_FROM is not set: the day sending began, before which nothing is sent",
    ]);
    expect(problemsOf({ ...production, ...ON, ...GOOGLE, CONVERSIONS_FROM: "21 Nov" })).toEqual([
      "CONVERSIONS_FROM must be a day, 2026-11-21",
    ]);
  });

  it("lets staging send only in test mode, and Meta's then only with its test events code", () => {
    expect(problemsOf({ ...stagingBase, ...ON, ...GOOGLE, ...FROM })).toEqual([
      'CONVERSIONS_TEST_MODE must be "true" on staging: its leads and payments are not real',
    ]);
    expect(problemsOf({ ...stagingBase, ...ON, ...META, ...FROM, CONVERSIONS_TEST_MODE: "true" })).toEqual([
      "META_TEST_EVENT_CODE is not set: in test mode Meta's events go to its Test Events alone",
    ]);
    expect(
      conversionsOf({
        ...stagingBase,
        ...ON,
        ...META,
        ...FROM,
        CONVERSIONS_TEST_MODE: "true",
        META_TEST_EVENT_CODE: "TEST123",
      }),
    ).toMatchObject({ testMode: true, meta: { testEventCode: "TEST123" } });
  });
});
