import { describe, expect, it } from "vitest";
import { ConfigError, validateStaticConfig } from "../../src/guard.ts";
import { FSM_CATALOGUE_PUSH } from "../../src/config/environments.ts";

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

/** FSM on Zoho, as staging has it: the client surface is on there. */
const ZOHO_FSM = {
  FSM_PROVIDER: "zoho",
  ZOHO_FSM_CLIENT_ID: "1000.FSMCLIENT",
  ZOHO_FSM_CLIENT_SECRET: "fsm-secret",
  ZOHO_FSM_REFRESH_TOKEN: "1000.fsm-refresh",
  ZOHO_FSM_ACCOUNTS_HOST: "accounts.zoho.in",
  ZOHO_FSM_API_HOST: "www.zohoapis.in",
};

/** Books on Zoho, on a client of its own. */
const ZOHO_BOOKS = {
  BOOKS_PROVIDER: "zoho",
  ZOHO_BOOKS_CLIENT_ID: "1000.BOOKSCLIENT",
  ZOHO_BOOKS_CLIENT_SECRET: "books-secret",
  ZOHO_BOOKS_REFRESH_TOKEN: "1000.books-refresh",
  ZOHO_BOOKS_ACCOUNTS_HOST: "accounts.zoho.in",
  ZOHO_BOOKS_API_HOST: "www.zohoapis.in",
  ZOHO_BOOKS_ORG_ID: "60088931635",
};

const production = { ENVIRONMENT: "production", ...REAL, ...SETTINGS, ...ALERTS, ...ZOHO, ...IMAGE, ...EVOLUTION };
/** Staging has the client surface on, so FSM and Books are connected there. */
const stagingBase = { ...production, ENVIRONMENT: "staging", ...ZOHO_FSM, ...ZOHO_BOOKS };

/** `env` without the named vars and secrets. */
function without(env: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !names.includes(name)));
}

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
    expect(config.settings.leadMobileDailyLimit).toBe(5);
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

  it("pings the cron's heartbeat only where HEARTBEAT_URL is set, and only over https", () => {
    expect(validateStaticConfig(production).settings.heartbeatUrl).toBeNull();
    const check = validateStaticConfig({ ...production, HEARTBEAT_URL: "https://hc-ping.com/check" });
    expect(check.settings.heartbeatUrl).toBe("https://hc-ping.com/check");
    expect(problemsOf({ ...production, HEARTBEAT_URL: "http://hc-ping.com/check" })).toEqual([
      "HEARTBEAT_URL must be an https:// URL",
    ]);
  });

  it("watches the daily allowances only where CLOUDFLARE_ANALYTICS_TOKEN is set", () => {
    expect(validateStaticConfig(production).settings.analyticsToken).toBeNull();
    const watching = validateStaticConfig({ ...production, CLOUDFLARE_ANALYTICS_TOKEN: " analytics-token " });
    expect(watching.settings.analyticsToken).toBe("analytics-token");
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
    expect(problemsOf({ ...production, RENDER_DAILY_CEILING: "five", UPLOAD_DAILY_CEILING: "-1" })).toEqual([
      "RENDER_DAILY_CEILING must be a whole number",
      "UPLOAD_DAILY_CEILING must be a whole number",
    ]);
  });
});

// docs/decisions/0009-stay-inside-cloudflare-free-tier.md, rule 6: a limit that is the same in every environment is
// a constant, not one of the 64 vars and secrets a Worker may hold.
describe("validateStaticConfig: the limits fixed in src/config", () => {
  const local = { ENVIRONMENT: "local", ...STUBS, ...SETTINGS };

  it("reads each limit from src/config/limits.ts, not from a var", () => {
    const { settings } = validateStaticConfig(production);
    expect(settings.login).toMatchObject({
      codeMobileDailyLimit: 5,
      codeIpHourlyLimit: 10,
      codeDailyCeiling: 300,
      techCodeDailyCeiling: 100,
    });
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

describe("validateStaticConfig: staging's code for its test records", () => {
  const OUTSIDE = "STAGING_TEST_RECORD_CODE is set outside staging: test records' codes would be known";

  it("is taken on staging", () => {
    const staging = { ...stagingBase, STAGING_TEST_RECORD_CODE: "424242" };
    expect(validateStaticConfig(staging).settings.login.testRecordCode).toBe("424242");
  });

  it("is refused in production and locally, and must be six digits", () => {
    expect(problemsOf({ ...production, STAGING_TEST_RECORD_CODE: "424242" })).toContain(OUTSIDE);
    expect(problemsOf({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS, STAGING_TEST_RECORD_CODE: "424242" })).toEqual([
      OUTSIDE,
    ]);
    expect(problemsOf({ ...stagingBase, STAGING_TEST_RECORD_CODE: "4242" })).toContain(
      "STAGING_TEST_RECORD_CODE must be six digits",
    );
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
  it("reads the FSM client and its hosts in staging", () => {
    expect(validateStaticConfig(stagingBase).settings.zohoFsm).toEqual({
      clientId: "1000.FSMCLIENT",
      clientSecret: "fsm-secret",
      refreshToken: "1000.fsm-refresh",
      accountsHost: "accounts.zoho.in",
      apiHost: "www.zohoapis.in",
      webhookToken: null,
    });
  });

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

  it("requires every FSM setting while FSM is Zoho", () => {
    const fsmSettings = Object.keys(ZOHO_FSM).filter((name) => name !== "FSM_PROVIDER");
    expect(problemsOf(without(stagingBase, fsmSettings))).toEqual([
      "ZOHO_FSM_CLIENT_ID is not set",
      "ZOHO_FSM_CLIENT_SECRET is not set",
      "ZOHO_FSM_REFRESH_TOKEN is not set",
      "ZOHO_FSM_ACCOUNTS_HOST is not set",
      "ZOHO_FSM_API_HOST is not set",
    ]);
  });

  it("reads Books without FSM's client where FSM is off, as production has it", () => {
    const config = validateStaticConfig({ ...production, ...ZOHO_BOOKS });
    expect(config.settings.zohoBooks?.clientId).toBe("1000.BOOKSCLIENT");
    expect(config.settings.zohoFsm).toBeNull();
  });

  it("reads FSM without Books' client where Books is not Zoho", () => {
    const booksSettings = Object.keys(ZOHO_BOOKS);
    const config = validateStaticConfig({ ...without(stagingBase, booksSettings), BOOKS_PROVIDER: "stub" });
    expect(config.settings.zohoFsm?.clientId).toBe("1000.FSMCLIENT");
    expect(config.settings.zohoBooks).toBeNull();
  });

  it("needs nothing from Zoho for the stubs or for none", () => {
    const local = validateStaticConfig({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS });
    expect(local.settings.zohoFsm).toBeNull();
    expect(local.settings.zohoBooks).toBeNull();
    expect(validateStaticConfig(production).settings.zohoFsm).toBeNull();
    expect(validateStaticConfig(production).settings.zohoBooks).toBeNull();
  });

  it("refuses Books off where the client surface is on, and allows it where the surface is off", () => {
    expect(problemsOf({ ...stagingBase, BOOKS_PROVIDER: "none" })).toEqual([
      'BOOKS_PROVIDER is "none" while the client surface is on: invoices and receipts come from Zoho Books',
    ]);
    expect(problemsOf(production)).toEqual([]);
  });

  it("allows FSM off where the client surface is on, since our own database then holds the visits", () => {
    expect(problemsOf({ ...without(stagingBase, Object.keys(ZOHO_FSM)), FSM_PROVIDER: "none" })).toEqual([]);
  });

  it("refuses a Zoho host given as a URL", () => {
    expect(problemsOf({ ...stagingBase, ZOHO_FSM_API_HOST: "https://www.zohoapis.in" })).toEqual([
      "ZOHO_FSM_API_HOST must be a Zoho hostname, without https://",
    ]);
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

  // MON-46, PS-50: self-serve booking started without the webhook secret, and a short one was taken.
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

  // LIFE-17: locally the webhook answered 404, so nothing past a booking's payment could be run there.
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

  it("stop staging and production from starting, where they would close FSM jobs no technician worked", () => {
    for (const environment of [stagingBase, production]) {
      expect(problemsOf({ ...environment, DEV_ROUTES: "on" })).toContain(
        "DEV_ROUTES is set outside local: its routes stand in for FSM and would close jobs no technician worked",
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
