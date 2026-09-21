// Turns the Worker's vars and secrets into typed settings, listing every
// problem instead of stopping at the first. The startup guard (src/guard.ts)
// refuses to run while any problem remains; see
// docs/decisions/0003-environment-identity-guard.md.

import type { EnvironmentName } from "./environments.ts";

export interface ZohoSettings {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** e.g. accounts.zoho.in */
  readonly accountsHost: string;
  /** e.g. www.zohoapis.in */
  readonly apiHost: string;
  /** The lead assignment rule applied to new bookings. */
  readonly larId: string;
}

export interface Settings {
  readonly visitLeadDays: number;
  readonly leadMobileDailyLimit: number;
  readonly leadIpDailyLimit: number;
  readonly turnstileSecret: string;
  readonly ipHashSalt: string;
  /** Where alerts are posted. Optional locally only. */
  readonly alertWebhookUrl: string | null;
  /** Present when CRM_PROVIDER is "zoho". */
  readonly zoho: ZohoSettings | null;
}

/**
 * Cloudflare's published Turnstile test secrets. Any of them in production
 * would accept every token, or none.
 */
const TURNSTILE_TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

const ZOHO_HOST = /^[a-z0-9.-]+\.(zoho|zohoapis)\.[a-z.]+$/;

type Env = Readonly<Record<string, unknown>>;

class Reader {
  readonly problems: string[] = [];
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  text(name: string): string {
    const value = this.env[name];
    if (typeof value !== "string" || value.trim() === "") {
      this.problems.push(`${name} is not set`);
      return "";
    }
    return value.trim();
  }

  optionalText(name: string): string | null {
    const value = this.env[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  }

  /** A whole number from 0 up; vars arrive as strings. */
  count(name: string): number {
    const value = Number(this.text(name));
    if (!Number.isInteger(value) || value < 0) {
      this.problems.push(`${name} must be a whole number`);
      return 0;
    }
    return value;
  }
}

export function readSettings(
  env: Env,
  environment: EnvironmentName | undefined,
  crmProvider: string | undefined,
): { settings: Settings; problems: string[] } {
  const read = new Reader(env);
  const isRemote = environment === "staging" || environment === "production";

  const turnstileSecret = read.text("TURNSTILE_SECRET");
  if (environment === "production" && TURNSTILE_TEST_SECRETS.has(turnstileSecret)) {
    read.problems.push("TURNSTILE_SECRET is a Cloudflare test secret in production");
  }

  const ipHashSalt = read.text("IP_HASH_SALT");
  if (ipHashSalt !== "" && ipHashSalt.length < 32) read.problems.push("IP_HASH_SALT must be at least 32 characters");

  const alertWebhookUrl = isRemote ? read.text("ALERT_WEBHOOK_URL") : read.optionalText("ALERT_WEBHOOK_URL");
  if (alertWebhookUrl !== null && alertWebhookUrl !== "" && !alertWebhookUrl.startsWith("https://")) {
    read.problems.push("ALERT_WEBHOOK_URL must be an https:// URL");
  }

  let zoho: ZohoSettings | null = null;
  if (crmProvider === "zoho") {
    zoho = {
      clientId: read.text("ZOHO_CLIENT_ID"),
      clientSecret: read.text("ZOHO_CLIENT_SECRET"),
      refreshToken: read.text("ZOHO_REFRESH_TOKEN"),
      accountsHost: read.text("ZOHO_ACCOUNTS_HOST"),
      apiHost: read.text("ZOHO_API_HOST"),
      larId: read.text("ZOHO_LAR_ID"),
    };
    for (const [name, host] of [
      ["ZOHO_ACCOUNTS_HOST", zoho.accountsHost],
      ["ZOHO_API_HOST", zoho.apiHost],
    ] as const) {
      if (host !== "" && !ZOHO_HOST.test(host)) read.problems.push(`${name} must be a Zoho hostname, without https://`);
    }
  }

  const settings: Settings = {
    visitLeadDays: read.count("VISIT_LEAD_DAYS"),
    leadMobileDailyLimit: read.count("LEAD_MOBILE_DAILY_LIMIT"),
    leadIpDailyLimit: read.count("LEAD_IP_DAILY_LIMIT"),
    turnstileSecret,
    ipHashSalt,
    alertWebhookUrl: alertWebhookUrl === "" ? null : alertWebhookUrl,
    zoho,
  };
  return { settings, problems: read.problems };
}
