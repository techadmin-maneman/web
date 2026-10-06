import { describe, expect, it } from "vitest";
import { validateStaticConfig } from "../../../src/guard.ts";
import { STUBS, SETTINGS, production, stagingBase, problemsOf } from "./guard-fixtures.ts";

describe("validateStaticConfig: environment and providers", () => {
  it("accepts local with stubs", () => {
    const config = validateStaticConfig({ ENVIRONMENT: "local", ...STUBS, ...SETTINGS });
    expect(config.environment).toBe("local");
    expect(config.providers).toEqual(STUBS);
    expect(config.settings.zohoCrm).toBeNull();
  });

  it("accepts production with real providers and every secret", () => {
    const config = validateStaticConfig(production);
    expect(config.environment).toBe("production");
    expect(config.settings.zohoCrm?.apiHost).toBe("www.zohoapis.in");
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
    expect(problemsOf({ ...production, ...STUBS })).toHaveLength(8);
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
    expect(problemsOf({ ...local, RESULT_SIGNING_KEY: "short", RESULT_RETENTION_DAYS: "15" })).toEqual([
      "RESULT_SIGNING_KEY must be at least 32 characters",
      "RESULT_RETENTION_DAYS must be 1 to 14: the photo notice promises the look is deleted within fourteen days",
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
