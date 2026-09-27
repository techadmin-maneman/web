import { describe, expect, it } from "vitest";
import { ConfigError, validateStaticConfig } from "../../src/guard.ts";
import { FSM_CATALOGUE_PUSH } from "../../src/config/environments.ts";
import { isKnownTemplate } from "../../src/config/message-templates.ts";

const REAL = {
  IMAGE_PROVIDER: "ailabtools",
  CRM_PROVIDER: "zoho",
  MESSAGING_PROVIDER: "evolution",
  ACCESS_PROVIDER: "cloudflare",
  SMS_PROVIDER: "none",
  FSM_PROVIDER: "none",
  BOOKS_PROVIDER: "none",
  PAYMENTS_PROVIDER: "none",
  GEOCODE_PROVIDER: "none",
};
const STUBS = {
  IMAGE_PROVIDER: "stub",
  CRM_PROVIDER: "stub",
  MESSAGING_PROVIDER: "stub",
  ACCESS_PROVIDER: "stub",
  SMS_PROVIDER: "stub",
  FSM_PROVIDER: "stub",
  BOOKS_PROVIDER: "stub",
  PAYMENTS_PROVIDER: "stub",
  GEOCODE_PROVIDER: "stub",
};

/** Vars and secrets every environment needs, with valid values. */
const SETTINGS = {
  VISIT_LEAD_DAYS: "2",
  TURNSTILE_SECRET: "0x4AAAAAAAreal-looking-secret",
  TURNSTILE_ACCEPT_TEST_TOKEN: "false",
  SELF_SERVE_BOOKING: "false",
  REFERRER_NAME_ON_INVITE: "true",
  IP_HASH_SALT: "a-salt-of-at-least-thirty-two-characters",
  RENDER_DAILY_CEILING: "20",
  UPLOAD_DAILY_CEILING: "40",
  RESULT_READ_DAILY_CEILING: "400",
  GEOCODE_DAILY_CEILING: "200",
  RESULT_RETENTION_DAYS: "30",
  AILAB_CREDIT_FLOOR: "200",
  RESULT_SIGNING_KEY: "a-signing-key-of-at-least-thirty-two-characters",
  ERASURE_SECRET: "an-erasure-secret-of-at-least-thirty-two-characters",
  MESSAGING_ENABLED: "false",
  ACCESS_TEAM_DOMAIN: "summer-math-0275.cloudflareaccess.com",
  ACCESS_OPS_AUD: "ops-audience-tag",
  OTP_PEPPER: "a-login-code-pepper-of-at-least-thirty-two-chars",
};
const IMAGE = { AILAB_API_KEY: "ailab-key" };
const EVOLUTION = {
  EVOLUTION_API_URL: "https://bridge.example/",
  EVOLUTION_API_KEY: "evolution-key",
  EVOLUTION_INSTANCE_NAME: "maneman",
};
const ALERTS = { ALERT_WEBHOOK_URL: "https://chat.example/hook" };
const ZOHO = {
  ZOHO_CLIENT_ID: "1000.CLIENT",
  ZOHO_CLIENT_SECRET: "secret",
  ZOHO_REFRESH_TOKEN: "1000.refresh",
  ZOHO_ACCOUNTS_HOST: "accounts.zoho.in",
  ZOHO_API_HOST: "www.zohoapis.in",
  ZOHO_LAR_ID: "4876876000000123",
};

/** FSM and Books on Zoho, as staging has them: the client surface is on there. */
const ZOHO_FSM = {
  FSM_PROVIDER: "zoho",
  BOOKS_PROVIDER: "zoho",
  ZOHO_FSM_CLIENT_ID: "1000.FSMCLIENT",
  ZOHO_FSM_CLIENT_SECRET: "fsm-secret",
  ZOHO_FSM_REFRESH_TOKEN: "1000.fsm-refresh",
  ZOHO_FSM_ACCOUNTS_HOST: "accounts.zoho.in",
  ZOHO_FSM_API_HOST: "www.zohoapis.in",
  ZOHO_BOOKS_ORG_ID: "60088931635",
};

const production = { ENVIRONMENT: "production", ...REAL, ...SETTINGS, ...ALERTS, ...ZOHO, ...IMAGE, ...EVOLUTION };
/** Staging has the client surface on, so FSM and Books are connected there. */
const stagingBase = { ...production, ENVIRONMENT: "staging", ...ZOHO_FSM };

function problemsOf(env: Record<string, unknown>): readonly string[] {
  try {
    validateStaticConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe("validateStaticConfig: environment and providers", () => {
  it("accepts local with stubs", () => {
    const config = validateStaticConfig({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS });
    expect(config.environment).toBe("local");
    expect(config.providers).toEqual(STUBS);
    expect(config.settings.zoho).toBeNull();
  });

  it("accepts production with real providers and every secret", () => {
    const config = validateStaticConfig(production);
    expect(config.environment).toBe("production");
    expect(config.settings.zoho?.apiHost).toBe("www.zohoapis.in");
    expect(config.settings.visitLeadDays).toBe(2);
  });

  it("allows staging to hold a stub, for a provider not yet chosen", () => {
    const staging = { ...stagingBase, MESSAGING_PROVIDER: "stub" };
    expect(validateStaticConfig(staging).environment).toBe("staging");
  });

  it.each([
    [{ ...STUBS, ...SETTINGS }, "ENVIRONMENT is not set"],
    [{ ENVIRONMENT: "", ...STUBS, ...SETTINGS }, "ENVIRONMENT is not set"],
    [{ ENVIRONMENT: "prod", ...STUBS, ...SETTINGS }, 'ENVIRONMENT has unknown value "prod"'],
  ])("refuses a missing or unknown ENVIRONMENT (%o)", (env, problem) => {
    expect(problemsOf(env)).toContain(problem);
  });

  it("refuses a production Worker holding any stub provider, naming each one", () => {
    expect(problemsOf({ ...production, IMAGE_PROVIDER: "stub" })).toEqual(["IMAGE_PROVIDER is a stub in production"]);
    expect(problemsOf({ ...production, ...STUBS })).toHaveLength(9);
  });

  it("refuses a missing or unknown provider", () => {
    const { IMAGE_PROVIDER: _omitted, ...withoutImage } = STUBS;
    expect(problemsOf({ ENVIRONMENT: "local", ...withoutImage, ...SETTINGS })).toEqual([
      "IMAGE_PROVIDER must be one of ailabtools, stub",
    ]);
    expect(problemsOf({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS, CRM_PROVIDER: "salesforce" })).toEqual([
      "CRM_PROVIDER must be one of zoho, stub",
    ]);
  });

  it("reports every problem at once in the error message", () => {
    expect(() => validateStaticConfig({ ...production, ...STUBS })).toThrow(
      /refuses to start: IMAGE_PROVIDER is a stub in production; CRM_PROVIDER/,
    );
  });
});

describe("validateStaticConfig: settings and secrets", () => {
  it("refuses a missing Turnstile secret or IP salt in any environment", () => {
    const { TURNSTILE_SECRET: _t, IP_HASH_SALT: _s, ...rest } = SETTINGS;
    expect(problemsOf({ ENVIRONMENT: "local", ...STUBS, ...rest })).toEqual([
      "TURNSTILE_SECRET is not set",
      "IP_HASH_SALT is not set",
    ]);
  });

  it("requires an erasure secret of at least 32 characters in every environment", () => {
    const { ERASURE_SECRET: _e, ...rest } = SETTINGS;
    expect(problemsOf({ ENVIRONMENT: "local", ...STUBS, ...rest })).toEqual(["ERASURE_SECRET is not set"]);
    expect(problemsOf({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS, ERASURE_SECRET: "short" })).toEqual([
      "ERASURE_SECRET must be at least 32 characters",
    ]);
  });

  it("refuses a short IP salt", () => {
    expect(problemsOf({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS, IP_HASH_SALT: "short" })).toEqual([
      "IP_HASH_SALT must be at least 32 characters",
    ]);
  });

  it.each(["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA"])(
    "refuses a Turnstile test secret in production (%s)",
    (secret) => {
      expect(problemsOf({ ...production, TURNSTILE_SECRET: secret })).toEqual([
        "TURNSTILE_SECRET is a Cloudflare test secret in production",
      ]);
    },
  );

  it("refuses the Turnstile test-token switch in production, and any value but true or false", () => {
    expect(problemsOf({ ...production, TURNSTILE_ACCEPT_TEST_TOKEN: "true" })).toEqual([
      "TURNSTILE_ACCEPT_TEST_TOKEN is on in production",
    ]);
    expect(problemsOf({ ...production, TURNSTILE_ACCEPT_TEST_TOKEN: "yes" })).toEqual([
      'TURNSTILE_ACCEPT_TEST_TOKEN must be "true" or "false"',
    ]);
    const staging = { ...stagingBase, TURNSTILE_ACCEPT_TEST_TOKEN: "true" };
    expect(validateStaticConfig(staging).settings.acceptTurnstileTestToken).toBe(true);
  });

  it("refuses self-serve booking without a way to take payment", () => {
    expect(problemsOf({ ...production, SELF_SERVE_BOOKING: "true" })).toEqual([
      "SELF_SERVE_BOOKING needs a PAYMENTS_PROVIDER: clients would book without paying",
    ]);
  });

  it("requires an https alert webhook in remote environments, and not locally", () => {
    const { ALERT_WEBHOOK_URL: _omitted, ...withoutAlerts } = production;
    expect(problemsOf(withoutAlerts)).toEqual(["ALERT_WEBHOOK_URL is not set"]);
    expect(problemsOf({ ...production, ALERT_WEBHOOK_URL: "http://chat.example/hook" })).toEqual([
      "ALERT_WEBHOOK_URL must be an https:// URL",
    ]);
    expect(validateStaticConfig({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS }).settings.alertWebhookUrl).toBeNull();
  });

  it("posts lead notices to LEAD_WEBHOOK_URL if set, else to the alert space, and only over https", () => {
    expect(validateStaticConfig(production).settings.leadWebhookUrl).toBe("https://chat.example/hook");
    const own = validateStaticConfig({ ...production, LEAD_WEBHOOK_URL: "https://chat.example/leads" });
    expect(own.settings.leadWebhookUrl).toBe("https://chat.example/leads");
    expect(problemsOf({ ...production, LEAD_WEBHOOK_URL: "http://chat.example/leads" })).toEqual([
      "LEAD_WEBHOOK_URL must be an https:// URL",
    ]);
  });

  it("requires every Zoho secret when the CRM is Zoho, and none when it is the stub", () => {
    const { ZOHO_REFRESH_TOKEN: _refresh, ...partialZoho } = production;
    expect(problemsOf(partialZoho)).toEqual(["ZOHO_REFRESH_TOKEN is not set"]);
    expect(problemsOf({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS })).toEqual([]);
  });

  // An org with no assignment rule is a working org: Zoho leaves the record with the API user.
  it("accepts an empty ZOHO_LAR_ID", () => {
    expect(problemsOf({ ...production, ZOHO_LAR_ID: "" })).toEqual([]);
  });

  it("refuses a Zoho host given as a URL", () => {
    expect(problemsOf({ ...production, ZOHO_API_HOST: "https://www.zohoapis.in" })).toEqual([
      "ZOHO_API_HOST must be a Zoho hostname, without https://",
    ]);
  });

  it("refuses limits that are not whole numbers", () => {
    expect(problemsOf({ ...production, RENDER_DAILY_CEILING: "five", VISIT_LEAD_DAYS: "-1" })).toEqual([
      "RENDER_DAILY_CEILING must be a whole number",
      "VISIT_LEAD_DAYS must be a whole number",
    ]);
  });
});

// docs/decisions/0009-stay-inside-cloudflare-free-tier.md, rule 6: a limit that is the same in every environment is
// a constant, not one of the 64 vars and secrets a Worker may hold.
describe("validateStaticConfig: the limits fixed in src/config", () => {
  const local = { ENVIRONMENT: "local", ...STUBS, ...SETTINGS };

  it("reads each limit from src/config/limits.ts, not from a var", () => {
    const { settings } = validateStaticConfig(production);
    expect(settings.login).toMatchObject({ codeMobileDailyLimit: 5, codeIpHourlyLimit: 10, codeDailyCeiling: 300 });
    expect(settings).toMatchObject({ leadMobileDailyLimit: 5, leadIpDailyLimit: 20 });
    expect(settings.tryon).toMatchObject({
      uploadIpHourlyLimit: 5,
      generateIpHourlyLimit: 5,
      claimMobileDailyLimit: 3,
      resultMessageMobileDailyLimit: 3,
    });
  });

  it("lets a local run raise one, as the browser tests do", () => {
    const raised = validateStaticConfig({ ...local, OTP_IP_HOURLY_LIMIT: "10000", LEAD_IP_DAILY_LIMIT: "10000" });
    expect(raised.settings.login.codeIpHourlyLimit).toBe(10_000);
    expect(raised.settings.leadIpDailyLimit).toBe(10_000);
    expect(problemsOf({ ...local, OTP_IP_HOURLY_LIMIT: "many" })).toEqual([
      "OTP_IP_HOURLY_LIMIT must be a whole number",
    ]);
  });

  it("refuses one set as a var anywhere but locally", () => {
    expect(problemsOf({ ...production, OTP_DAILY_CEILING: "10000" })).toEqual([
      "OTP_DAILY_CEILING is fixed in src/config/limits.ts: only a local run may set it",
    ]);
    expect(problemsOf({ ...stagingBase, TRYON_CLAIM_MOBILE_DAILY_LIMIT: "3" })).toEqual([
      "TRYON_CLAIM_MOBILE_DAILY_LIMIT is fixed in src/config/limits.ts: only a local run may set it",
    ]);
  });
});

describe("validateStaticConfig: try-on and messaging", () => {
  const local = { ENVIRONMENT: "local", ...STUBS, ...SETTINGS };

  it("needs the AILabTools key only for the real image provider", () => {
    const { AILAB_API_KEY: _omitted, ...withoutKey } = production;
    expect(problemsOf(withoutKey)).toEqual(["AILAB_API_KEY is not set"]);
    expect(validateStaticConfig(production).settings.tryon.ailabApiKey).toBe("ailab-key");
    expect(validateStaticConfig(local).settings.tryon.ailabApiKey).toBeNull();
  });

  it("needs every Evolution setting for Evolution, over https, and trims the URL", () => {
    const { EVOLUTION_INSTANCE_NAME: _omitted, ...withoutInstance } = production;
    expect(problemsOf(withoutInstance)).toEqual(["EVOLUTION_INSTANCE_NAME is not set"]);
    expect(problemsOf({ ...production, EVOLUTION_API_URL: "http://bridge.example" })).toEqual([
      "EVOLUTION_API_URL must be an https:// URL",
    ]);
    expect(validateStaticConfig(production).settings.messaging.evolution).toEqual({
      baseUrl: "https://bridge.example",
      apiKey: "evolution-key",
      instance: "maneman",
      webhookToken: null,
    });
  });

  it("takes an optional webhook token for Evolution's delivery receipts, long enough to be a secret", () => {
    const token = "a-webhook-token-of-at-least-thirty-two-chars";
    expect(
      validateStaticConfig({ ...production, EVOLUTION_WEBHOOK_TOKEN: token }).settings.messaging.evolution,
    ).toMatchObject({ webhookToken: token });
    expect(problemsOf({ ...production, EVOLUTION_WEBHOOK_TOKEN: "short" })).toEqual([
      "EVOLUTION_WEBHOOK_TOKEN must be at least 32 characters",
    ]);
  });

  it("refuses a short signing key or retention", () => {
    expect(problemsOf({ ...local, RESULT_SIGNING_KEY: "short", RESULT_RETENTION_DAYS: "45" })).toEqual([
      "RESULT_SIGNING_KEY must be at least 32 characters",
      "RESULT_RETENTION_DAYS must be 1 to 30: the photo notice promises deletion within thirty days",
    ]);
  });

  it("sends the try-on result with a template that exists, and routes an unknown colour as the owner chose", () => {
    const { settings } = validateStaticConfig(production);
    expect(isKnownTemplate(settings.messaging.resultTemplate)).toBe(true);
    expect(settings.tryon.unknownColorRoute).toBe("pro_black");
  });

  it("insists on an allowlist while staging messaging is on, and reads it as E.164", () => {
    const staging = { ...stagingBase, MESSAGING_ENABLED: "true" };
    expect(problemsOf(staging)).toEqual([
      "MESSAGING_ALLOWLIST must name the test handsets while messaging is on in staging",
    ]);
    const allowed = validateStaticConfig({ ...staging, MESSAGING_ALLOWLIST: "98100 00001, +91 98100-00002" });
    expect(allowed.settings.messaging.allowlist).toEqual(["+919810000001", "+919810000002"]);
    expect(problemsOf({ ...staging, MESSAGING_ALLOWLIST: "12345" })).toEqual([
      "MESSAGING_ALLOWLIST has an entry that is not an Indian mobile number",
      "MESSAGING_ALLOWLIST must name the test handsets while messaging is on in staging",
    ]);
  });
});

// docs/decisions/0073-prices-from-the-price-book.md: staging's FSM is the owner's real org and its price book holds
// placeholders, so a price typed into staging's console must never reprice the real catalogue.
describe("the catalogue push", () => {
  it("is never on in staging, which shares the owner's real FSM org", () => {
    expect(FSM_CATALOGUE_PUSH.staging).toBe(false);
  });

  it("is each environment's own, as the settings read it", () => {
    expect(validateStaticConfig(production).settings.fsmCataloguePush).toBe(FSM_CATALOGUE_PUSH.production);
    expect(validateStaticConfig(stagingBase).settings.fsmCataloguePush).toBe(false);
  });
});

describe("validateStaticConfig: the local fixed login code", () => {
  it("is taken locally, for the browser tests", () => {
    const local = { ENVIRONMENT: "local", ...STUBS, ...SETTINGS, OTP_FIXED_CODE: "123456" };
    expect(validateStaticConfig(local).settings.login.fixedCode).toBe("123456");
  });

  it("is refused in staging and production, where every code would be known", () => {
    for (const environment of ["staging", "production"]) {
      expect(problemsOf({ ...production, ENVIRONMENT: environment, OTP_FIXED_CODE: "123456" })).toContain(
        "OTP_FIXED_CODE is set outside local: every login code would be known",
      );
    }
    expect(problemsOf({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS, OTP_FIXED_CODE: "1234" })).toEqual([
      "OTP_FIXED_CODE must be six digits",
    ]);
  });
});

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

describe("validateStaticConfig: Zoho FSM and Books", () => {
  it("reads the FSM client, its hosts and the Books organisation in staging", () => {
    const fsm = validateStaticConfig(stagingBase).settings.zohoFsm;
    expect(fsm).toEqual({
      clientId: "1000.FSMCLIENT",
      clientSecret: "fsm-secret",
      refreshToken: "1000.fsm-refresh",
      accountsHost: "accounts.zoho.in",
      apiHost: "www.zohoapis.in",
      booksOrgId: "60088931635",
      booksRefundAccountId: null,
      webhookToken: null,
    });
    const withAccount = validateStaticConfig({ ...stagingBase, BOOKS_REFUND_ACCOUNT_ID: "bank-7" });
    expect(withAccount.settings.zohoFsm?.booksRefundAccountId).toBe("bank-7");
  });

  it("requires every FSM secret when either is Zoho, and the Books organisation only for Books", () => {
    const { ZOHO_FSM_CLIENT_SECRET: _secret, ZOHO_BOOKS_ORG_ID: _org, ...partial } = stagingBase;
    expect(problemsOf(partial)).toEqual(["ZOHO_FSM_CLIENT_SECRET is not set", "ZOHO_BOOKS_ORG_ID is not set"]);
    const fsmOnly = validateStaticConfig({ ...partial, ZOHO_FSM_CLIENT_SECRET: "s", BOOKS_PROVIDER: "stub" });
    expect(fsmOnly.settings.zohoFsm?.booksOrgId).toBeNull();
  });

  it("needs nothing from Zoho for the stubs or for none", () => {
    expect(validateStaticConfig({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS }).settings.zohoFsm).toBeNull();
    expect(validateStaticConfig(production).settings.zohoFsm).toBeNull();
  });

  it("refuses none where the client surface is on, and allows it where the surface is off", () => {
    expect(problemsOf({ ...stagingBase, FSM_PROVIDER: "none", BOOKS_PROVIDER: "none" })).toEqual([
      'FSM_PROVIDER is "none" while the client surface is on: visits and documents come from Zoho',
      'BOOKS_PROVIDER is "none" while the client surface is on: visits and documents come from Zoho',
    ]);
    expect(problemsOf(production)).toEqual([]);
  });

  it("refuses a Zoho host given as a URL", () => {
    expect(problemsOf({ ...stagingBase, ZOHO_FSM_API_HOST: "https://www.zohoapis.in" })).toEqual([
      "ZOHO_FSM_API_HOST must be a Zoho hostname, without https://",
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
