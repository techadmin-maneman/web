// What the startup guard's tests share (guard*.test.ts): the real and stubbed providers, the settings each vendor
// needs, production's and staging's vars, and the problems a config is refused for.

import { ConfigError, validateStaticConfig } from "../../../src/guard.ts";

export const REAL = {
  IMAGE_PROVIDER: "ailabtools",
  CRM_PROVIDER: "zoho",
  MESSAGING_PROVIDER: "evolution",
  ACCESS_PROVIDER: "cloudflare",
  SMS_PROVIDER: "none",
  BOOKS_PROVIDER: "none",
  PAYMENTS_PROVIDER: "none",
  GEOCODE_PROVIDER: "none",
};

export const STUBS = {
  IMAGE_PROVIDER: "stub",
  CRM_PROVIDER: "stub",
  MESSAGING_PROVIDER: "stub",
  ACCESS_PROVIDER: "stub",
  SMS_PROVIDER: "stub",
  BOOKS_PROVIDER: "stub",
  PAYMENTS_PROVIDER: "stub",
  GEOCODE_PROVIDER: "stub",
};

/** Vars and secrets every environment needs, with valid values. */
export const SETTINGS = {
  TURNSTILE_SECRET: "0x4AAAAAAAreal-looking-secret",
  TURNSTILE_ACCEPT_TEST_TOKEN: "false",
  SELF_SERVE_BOOKING: "false",
  REFERRER_NAME_ON_INVITE: "true",
  IP_HASH_SALT: "a-salt-of-at-least-thirty-two-characters",
  RENDER_DAILY_CEILING: "20",
  UPLOAD_DAILY_CEILING: "40",
  RESULT_READ_DAILY_CEILING: "400",
  GEOCODE_DAILY_CEILING: "200",
  RESULT_RETENTION_DAYS: "14",
  AILAB_CREDIT_FLOOR: "200",
  RESULT_SIGNING_KEY: "a-signing-key-of-at-least-thirty-two-characters",
  MESSAGING_ENABLED: "false",
  ACCESS_TEAM_DOMAIN: "summer-math-0275.cloudflareaccess.com",
  ACCESS_OPS_AUD: "ops-audience-tag",
  OTP_PEPPER: "a-login-code-pepper-of-at-least-thirty-two-chars",
};

export const IMAGE = { AILAB_API_KEY: "ailab-key" };

export const EVOLUTION = {
  EVOLUTION_API_URL: "https://bridge.example/",
  EVOLUTION_API_KEY: "evolution-key",
  EVOLUTION_INSTANCE_NAME: "maneman",
};

export const ALERTS = { ALERT_WEBHOOK_URL: "https://chat.example/hook" };

export const ZOHO = {
  ZOHO_CLIENT_ID: "1000.CLIENT",
  ZOHO_CLIENT_SECRET: "secret",
  ZOHO_REFRESH_TOKEN: "1000.refresh",
  ZOHO_ACCOUNTS_HOST: "accounts.zoho.in",
  ZOHO_API_HOST: "www.zohoapis.in",
  ZOHO_LAR_ID: "4876876000000123",
};

/** Books on Zoho, on a client of its own. */
export const ZOHO_BOOKS = {
  BOOKS_PROVIDER: "zoho",
  ZOHO_BOOKS_CLIENT_ID: "1000.BOOKSCLIENT",
  ZOHO_BOOKS_CLIENT_SECRET: "books-secret",
  ZOHO_BOOKS_REFRESH_TOKEN: "1000.books-refresh",
  ZOHO_BOOKS_ACCOUNTS_HOST: "accounts.zoho.in",
  ZOHO_BOOKS_API_HOST: "www.zohoapis.in",
  ZOHO_BOOKS_ORG_ID: "60088931635",
};

export const production = {
  ENVIRONMENT: "production",
  ...REAL,
  ...SETTINGS,
  ...ALERTS,
  ...ZOHO,
  ...IMAGE,
  ...EVOLUTION,
};

/** Staging has the client surface on, so Books is connected there. */
export const stagingBase = { ...production, ENVIRONMENT: "staging", ...ZOHO_BOOKS };

export function problemsOf(env: Record<string, unknown>): readonly string[] {
  try {
    validateStaticConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}
