import { describe, expect, it } from "vitest";
import { validateStaticConfig } from "../../../src/guard.ts";
import { STUBS, SETTINGS, ZOHO_BOOKS, production, stagingBase, problemsOf } from "./guard-fixtures.ts";

/** `env` without the named vars and secrets. */
function without(env: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !names.includes(name)));
}

describe("validateStaticConfig: Cloudflare Access", () => {
  it("reads the team domain, and needs no ops audience where the ops surface is switched off", () => {
    const { ACCESS_OPS_AUD: _omitted, ...withoutAudience } = production;
    const config = validateStaticConfig(withoutAudience);
    expect(config.settings.access).toEqual({ teamDomain: "summer-math-0275.cloudflareaccess.com", opsAudience: null });
  });

  it("refuses the stub in staging as well as production, since staff identity is always verified there", () => {
    expect(problemsOf({ ...stagingBase, ACCESS_PROVIDER: "stub" })).toEqual([
      "ACCESS_PROVIDER is a stub in staging: staff identity is verified everywhere but locally",
    ]);
    expect(problemsOf({ ...production, ACCESS_PROVIDER: "stub" })).toEqual(["ACCESS_PROVIDER is a stub in production"]);
  });

  it("needs a team domain on Access's own domain", () => {
    const { ACCESS_TEAM_DOMAIN: _omitted, ...withoutDomain } = production;
    expect(problemsOf(withoutDomain)).toEqual(["ACCESS_TEAM_DOMAIN is not set"]);
    expect(problemsOf({ ...production, ACCESS_TEAM_DOMAIN: "https://summer-math-0275.cloudflareaccess.com" })).toEqual([
      "ACCESS_TEAM_DOMAIN must be a cloudflareaccess.com hostname, without https://",
    ]);
  });

  it("needs the ops audience wherever the ops surface is switched on, which includes staging", () => {
    const { ACCESS_OPS_AUD: _omitted, ...withoutAudience } = SETTINGS;
    const local = { ENVIRONMENT: "local", ...STUBS, ...withoutAudience, ACCESS_PROVIDER: "cloudflare" };
    expect(problemsOf(local)).toEqual(["ACCESS_OPS_AUD is not set"]);
    const { ACCESS_OPS_AUD: _alsoOmitted, ...productionWithoutAudience } = production;
    expect(problemsOf({ ...productionWithoutAudience, ENVIRONMENT: "staging" })).toContain("ACCESS_OPS_AUD is not set");
    expect(validateStaticConfig({ ...local, ACCESS_OPS_AUD: "aud-tag" }).settings.access?.opsAudience).toBe("aud-tag");
  });
});

describe("validateStaticConfig: Zoho Books", () => {
  it("reads Books' own client, its hosts, its organisation and the refund account in staging", () => {
    expect(validateStaticConfig(stagingBase).settings.zohoBooks).toEqual({
      clientId: "1000.BOOKSCLIENT",
      clientSecret: "books-secret",
      refreshToken: "1000.books-refresh",
      accountsHost: "accounts.zoho.in",
      apiHost: "www.zohoapis.in",
      orgId: "60088931635",
      refundAccountId: null,
      gst: { gstin: null, stateCode: null, sac: null },
    });
    const withAccount = validateStaticConfig({ ...stagingBase, BOOKS_REFUND_ACCOUNT_ID: "bank-7" });
    expect(withAccount.settings.zohoBooks?.refundAccountId).toBe("bank-7");
  });

  it("reads the GST registration Books' invoices and items carry, once the CA has given it", () => {
    const registered = { BOOKS_GSTIN: "06AAACM1234A1Z5", BOOKS_GST_STATE: "HR", BOOKS_SAC: "999721" };
    expect(validateStaticConfig({ ...stagingBase, ...registered }).settings.zohoBooks?.gst).toEqual({
      gstin: "06AAACM1234A1Z5",
      stateCode: "HR",
      sac: "999721",
    });
  });

  it("refuses a GST registration that is malformed, or a GSTIN without the state it is registered in", () => {
    const malformed = { BOOKS_GSTIN: "06AAACM1234A1", BOOKS_GST_STATE: "Haryana", BOOKS_SAC: "9997" };
    expect(problemsOf({ ...stagingBase, ...malformed })).toEqual([
      "BOOKS_GSTIN is not a GSTIN: 15 characters, such as 06AAACM1234A1Z5",
      "BOOKS_GST_STATE must be the two-letter GST code of the state registered in, such as HR",
      "BOOKS_SAC must be a SAC code of six digits, such as 999721",
    ]);
    expect(problemsOf({ ...stagingBase, BOOKS_GSTIN: "06AAACM1234A1Z5" })).toEqual([
      "BOOKS_GST_STATE must be set with BOOKS_GSTIN: it is the place of supply of a client whose city is not known",
    ]);
  });

  it("requires every Books setting while Books is Zoho", () => {
    const booksSettings = Object.keys(ZOHO_BOOKS).filter((name) => name !== "BOOKS_PROVIDER");
    expect(problemsOf(without(stagingBase, booksSettings))).toEqual([
      "ZOHO_BOOKS_CLIENT_ID is not set",
      "ZOHO_BOOKS_CLIENT_SECRET is not set",
      "ZOHO_BOOKS_REFRESH_TOKEN is not set",
      "ZOHO_BOOKS_ACCOUNTS_HOST is not set",
      "ZOHO_BOOKS_API_HOST is not set",
      "ZOHO_BOOKS_ORG_ID is not set",
    ]);
  });

  it("reads Books' client in production too", () => {
    const config = validateStaticConfig({ ...production, ...ZOHO_BOOKS });
    expect(config.settings.zohoBooks?.clientId).toBe("1000.BOOKSCLIENT");
  });

  it("needs nothing from Zoho for the stubs or for none", () => {
    const local = validateStaticConfig({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS });
    expect(local.settings.zohoBooks).toBeNull();
    expect(validateStaticConfig(production).settings.zohoBooks).toBeNull();
  });

  it("refuses Books off where the client surface is on, and allows it where the surface is off", () => {
    expect(problemsOf({ ...stagingBase, BOOKS_PROVIDER: "none" })).toEqual([
      'BOOKS_PROVIDER is "none" while the client surface is on: invoices and receipts come from Zoho Books',
    ]);
    expect(problemsOf(production)).toEqual([]);
  });

  it("refuses a Zoho host given as a URL", () => {
    expect(problemsOf({ ...stagingBase, ZOHO_BOOKS_ACCOUNTS_HOST: "https://accounts.zoho.in" })).toEqual([
      "ZOHO_BOOKS_ACCOUNTS_HOST must be a Zoho hostname, without https://",
    ]);
  });
});

describe("validateStaticConfig: Razorpay", () => {
  const RAZORPAY = { PAYMENTS_PROVIDER: "razorpay", RAZORPAY_KEY_SECRET: "key-secret" };

  it("reads the key, its secret and an optional webhook secret", () => {
    const staging = validateStaticConfig({ ...stagingBase, ...RAZORPAY, RAZORPAY_KEY_ID: "rzp_test_abc" });
    expect(staging.settings.razorpay).toEqual({ keyId: "rzp_test_abc", keySecret: "key-secret", webhookSecret: null });
  });

  it("refuses a live key outside production, where it would take real money", () => {
    expect(problemsOf({ ...stagingBase, ...RAZORPAY, RAZORPAY_KEY_ID: "rzp_live_abc" })).toEqual([
      "RAZORPAY_KEY_ID is a live key outside production: it would take real money",
    ]);
  });

  it("refuses a test key in production", () => {
    expect(problemsOf({ ...production, ...RAZORPAY, RAZORPAY_KEY_ID: "rzp_test_abc" })).toEqual([
      "RAZORPAY_KEY_ID is not a live key in production",
    ]);
  });

  // Self-serve booking started without the webhook secret, and a short one was taken.
  it("requires a webhook secret of at least 32 characters for self-serve booking", () => {
    const selfServe = { ...stagingBase, ...RAZORPAY, RAZORPAY_KEY_ID: "rzp_test_abc", SELF_SERVE_BOOKING: "true" };
    expect(problemsOf(selfServe)).toEqual([
      "RAZORPAY_WEBHOOK_SECRET is not set: self-serve booking would never hear that a client paid",
    ]);
    expect(problemsOf({ ...selfServe, RAZORPAY_WEBHOOK_SECRET: "too-short" })).toEqual([
      "RAZORPAY_WEBHOOK_SECRET must be at least 32 characters",
    ]);
    expect(problemsOf({ ...selfServe, RAZORPAY_WEBHOOK_SECRET: "a-webhook-secret-of-at-least-32-chars" })).toEqual([]);
  });

  it("refuses a short webhook secret without self-serve booking too", () => {
    const staging = { ...stagingBase, ...RAZORPAY, RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_WEBHOOK_SECRET: "short" };
    expect(problemsOf(staging)).toEqual(["RAZORPAY_WEBHOOK_SECRET must be at least 32 characters"]);
  });

  // Locally the webhook answered 404, so nothing past a booking's payment could be run there.
  it("reads the webhook secret for the local stub too, whose payments arrive by the same signed webhook", () => {
    const local = { ENVIRONMENT: "local", ...STUBS, ...SETTINGS, RAZORPAY_WEBHOOK_SECRET: "a-local-placeholder" };
    expect(validateStaticConfig(local).settings.razorpay).toEqual({
      keyId: "",
      keySecret: "",
      webhookSecret: "a-local-placeholder",
    });
    expect(validateStaticConfig({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS }).settings.razorpay?.webhookSecret).toBe(
      null,
    );
  });
});

describe("validateStaticConfig: the local dev routes", () => {
  it("are switched on locally by DEV_ROUTES=on, and off without it", () => {
    const local = { ENVIRONMENT: "local", ...STUBS, ...SETTINGS };
    expect(validateStaticConfig({ ...local, DEV_ROUTES: "on" }).settings.devRoutes).toBe(true);
    expect(validateStaticConfig(local).settings.devRoutes).toBe(false);
  });

  it("stop staging and production from starting, where they would close jobs no technician worked", () => {
    for (const environment of [stagingBase, production]) {
      expect(problemsOf({ ...environment, DEV_ROUTES: "on" })).toContain(
        "DEV_ROUTES is set outside local: its routes would close jobs no technician worked",
      );
    }
  });
});

describe("the address search", () => {
  it("needs the Google key only for the real provider", () => {
    expect(problemsOf({ ...stagingBase, GEOCODE_PROVIDER: "google" })).toEqual(["GOOGLE_MAPS_API_KEY is not set"]);
    expect(validateStaticConfig(stagingBase).settings.geocode.apiKey).toBeNull();
  });

  it("reads the ceiling everywhere, so the stub is capped too", () => {
    expect(validateStaticConfig(stagingBase).settings.geocode.dailyCeiling).toBe(200);
  });

  it("refuses a ceiling that could reach Google's free allowance and start billing the card", () => {
    expect(problemsOf({ ...stagingBase, GEOCODE_DAILY_CEILING: "5000" })).toEqual([
      "GEOCODE_DAILY_CEILING must be at most 1800: a day above that could take a month past Google's free allowance",
    ]);
  });

  it("allows nought, which is the runbook's kill switch", () => {
    expect(problemsOf({ ...stagingBase, GEOCODE_DAILY_CEILING: "0" })).toEqual([]);
  });
});

describe("validateStaticConfig: MSG91", () => {
  const msg91 = {
    MESSAGING_PROVIDER: "msg91",
    MSG91_AUTH_KEY: "msg91-key",
    MSG91_INTEGRATED_NUMBER: "+91 98000 00000",
  };

  it("reads the key and the sending number, digits only, and leaves Evolution unread", () => {
    const config = validateStaticConfig({ ...production, ...msg91 });
    expect(config.settings.messaging.msg91).toEqual({ authKey: "msg91-key", integratedNumber: "919800000000" });
    expect(config.settings.messaging.evolution).toBeNull();
  });

  it("requires both while MSG91 sends, and the number with its country code", () => {
    expect(problemsOf(without({ ...production, ...msg91 }, ["MSG91_AUTH_KEY", "MSG91_INTEGRATED_NUMBER"]))).toEqual([
      "MSG91_AUTH_KEY is not set",
      "MSG91_INTEGRATED_NUMBER is not set",
    ]);
    expect(problemsOf({ ...production, ...msg91, MSG91_INTEGRATED_NUMBER: "98000 00000" })).toEqual([
      "MSG91_INTEGRATED_NUMBER must be the sending number with its country code, as 919810000000",
    ]);
  });
});
