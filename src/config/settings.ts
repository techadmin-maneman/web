// Turns the Worker's vars and secrets into typed settings, listing every
// problem instead of stopping at the first. The startup guard (src/guard.ts)
// refuses to run while any problem remains; see
// docs/decisions/0003-environment-identity-guard.md.

import { toE164 } from "../lib/mobile.ts";
import type { EvolutionSettings } from "../providers/evolution.ts";
import { isKnownTemplate } from "./message-templates.ts";
import { ENABLED_SURFACES, type EnvironmentName, type ProviderVar } from "./environments.ts";
import { UNKNOWN_COLOR_ROUTES, type UnknownColorRoute } from "./tryon.ts";

export interface TryonSettings {
  /** Per salted IP hash, per India clock hour. */
  readonly uploadIpHourlyLimit: number;
  readonly generateIpHourlyLimit: number;
  /** Per mobile number, per India day. */
  readonly claimMobileDailyLimit: number;
  readonly resultMessageMobileDailyLimit: number;
  /**
   * Global ceilings per India day. The render ceiling caps AILabTools spend;
   * all three cap R2 use (docs/decisions/0009-stay-inside-cloudflare-free-tier.md).
   */
  readonly renderDailyCeiling: number;
  readonly uploadDailyCeiling: number;
  readonly resultReadDailyCeiling: number;
  /** Days a result is kept once ready: 30 in production, as the photo notice promises; less on staging. */
  readonly resultRetentionDays: number;
  readonly unknownColorRoute: UnknownColorRoute;
  /** Alert when the AILabTools balance falls below this many credits. */
  readonly creditFloor: number;
  /** Signs upload and result links. */
  readonly linkSigningKey: string;
  /** Present when IMAGE_PROVIDER is "ailabtools". */
  readonly ailabApiKey: string | null;
}

export interface MessagingSettings {
  /** Off: every result message is skipped and the gate promises no WhatsApp copy. */
  readonly enabled: boolean;
  /** The approved WhatsApp template that carries a result. */
  readonly resultTemplate: string;
  /** When not empty, only these E.164 numbers receive messages (staging: the founders' handsets). */
  readonly allowlist: readonly string[];
  /** Present when MESSAGING_PROVIDER is "evolution". */
  readonly evolution: EvolutionSettings | null;
}

/** A number messages may go to: every number, unless there is an allowlist and it does not name this one. */
export const onAllowlist = (messaging: MessagingSettings, mobileE164: string): boolean =>
  messaging.allowlist.length === 0 || messaging.allowlist.includes(mobileE164);

export interface ZohoSettings {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** e.g. accounts.zoho.in */
  readonly accountsHost: string;
  /** e.g. www.zohoapis.in */
  readonly apiHost: string;
  /**
   * The lead assignment rule applied to new bookings, where the org has one.
   * Null where it has none: Zoho then leaves the record with the API user, and
   * an org without a rule must not stop the Worker from starting.
   */
  readonly larId: string | null;
}

/** The Zoho client FSM and Books share, in the real org (ADR 0025, item 26). */
export interface ZohoFsmSettings {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** e.g. accounts.zoho.in */
  readonly accountsHost: string;
  /** e.g. www.zohoapis.in, where FSM answers at /fsm/v1 and Books at /books/v3. */
  readonly apiHost: string;
  /** The Books organisation invoices and receipts are in. Present when BOOKS_PROVIDER is "zoho". */
  readonly booksOrgId: string | null;
  /**
   * The Books account refunds are paid from: the one Razorpay settles into. Without it, refunds are not recorded
   * in Books and their vouchers wait (docs/open-points.md).
   */
  readonly booksRefundAccountId: string | null;
  /** The secret in FSM's webhook URL. Without it the webhook answers 404, and the reconciliation alone keeps the mirror. */
  readonly webhookToken: string | null;
}

/** Razorpay (docs/decisions/0044-payments-mirror.md). */
export interface RazorpaySettings {
  /** Public: Checkout takes it in the browser. rzp_test_ on staging, rzp_live_ in production. */
  readonly keyId: string;
  readonly keySecret: string;
  /** Signs the webhook's events. Without it the webhook answers 404. */
  readonly webhookSecret: string | null;
}

export interface GeocodeSettings {
  /**
   * Google Maps Platform, restricted to Places and Geocoding and to this
   * Worker's IPs (docs/runbook.md, section 13). Null unless GEOCODE_PROVIDER is
   * "google".
   */
  readonly apiKey: string | null;
  /**
   * Requests to Google allowed in an India day, counted across every client.
   * It refuses rather than spends: the owner's card is behind this key, and
   * Google's budget alerts are not a spending cap
   * (docs/decisions/0054-address-capture.md). Always read, so the ceiling holds
   * for the stub too and a test cannot pass a build that would not hold.
   */
  readonly dailyCeiling: number;
}

export interface AccessSettings {
  /** The Cloudflare Access team domain, e.g. summer-math-0275.cloudflareaccess.com. */
  readonly teamDomain: string;
  /** The ops console's Access application audience tag. Required once the ops surface is switched on. */
  readonly opsAudience: string | null;
}

export interface LoginSettings {
  /** The HMAC key login codes are hashed under. Required wherever the client surface is switched on. */
  readonly codePepper: string;
  readonly codeMobileDailyLimit: number;
  readonly codeIpHourlyLimit: number;
  /** Codes sent a day across every number: the hard limit on what a flood of requests can send. */
  readonly codeDailyCeiling: number;
  /**
   * Locally only, every code is this one, so the browser tests can log in
   * through the stub messaging provider. The guard refuses it anywhere else.
   */
  readonly fixedCode: string | null;
}

export interface Settings {
  readonly visitLeadDays: number;
  readonly leadMobileDailyLimit: number;
  readonly leadIpDailyLimit: number;
  readonly turnstileSecret: string;
  /**
   * Also accept Cloudflare's dummy test token. Staging only, which is behind
   * Access, so it can be tested before any page renders the real widget.
   */
  readonly acceptTurnstileTestToken: boolean;
  /**
   * Clients book, move and cancel in the app, and pay through Razorpay (docs/decisions/0045-self-serve-booking.md).
   * Off, the booking routes answer 409 ops_assisted and the app opens WhatsApp instead.
   */
  readonly selfServeBooking: boolean;
  /** The referrer's first name on their invite, for those who agreed to it (ADR 0025, item 24). */
  readonly referrerNameOnInvite: boolean;
  readonly ipHashSalt: string;
  /** Where alerts are posted. Optional locally only. */
  readonly alertWebhookUrl: string | null;
  /** Where new-lead notices are posted: LEAD_WEBHOOK_URL, or else the alert webhook. */
  readonly leadWebhookUrl: string | null;
  /** The operators' secret for POST /api/erasure (docs/decisions/0019-erasure.md). */
  readonly erasureSecret: string;
  /** Present when CRM_PROVIDER is "zoho". */
  readonly zoho: ZohoSettings | null;
  /** Present when FSM_PROVIDER or BOOKS_PROVIDER is "zoho". */
  readonly zohoFsm: ZohoFsmSettings | null;
  /** Present when PAYMENTS_PROVIDER is "razorpay". */
  readonly razorpay: RazorpaySettings | null;
  /** Present when ACCESS_PROVIDER is "cloudflare". */
  readonly access: AccessSettings | null;
  /** The address search: its key when there is one, and its daily ceiling always. */
  readonly geocode: GeocodeSettings;
  readonly login: LoginSettings;
  readonly tryon: TryonSettings;
  readonly messaging: MessagingSettings;
}

/**
 * The most GEOCODE_DAILY_CEILING may be set to. Google's India price list gives
 * the Geocoding SKU 70,000 free calls a month; 80% of that over a 31-day month
 * is 1,806 a day, so a ceiling at or below this cannot reach the free
 * allowance however many days run at it. Expected use is about ten a day
 * (docs/decisions/0054-address-capture.md).
 */
export const GEOCODE_CEILING_MAX = 1_800;

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
const ACCESS_TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;

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

  /** "true" or "false"; vars arrive as strings. */
  flag(name: string): boolean {
    const value = this.text(name);
    if (value !== "true" && value !== "false") {
      this.problems.push(`${name} must be "true" or "false"`);
      return false;
    }
    return value === "true";
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

  /** A secret long enough to sign with. */
  key(name: string): string {
    const value = this.text(name);
    if (value !== "" && value.length < 32) this.problems.push(`${name} must be at least 32 characters`);
    return value;
  }

  /** One of `allowed`; the first stands in while a problem is reported. */
  oneOf<T extends string>(name: string, allowed: readonly [T, ...T[]]): T {
    const value = this.text(name);
    const match = allowed.find((option) => option === value);
    if (match !== undefined) return match;
    this.problems.push(`${name} must be one of ${allowed.join(", ")}`);
    return allowed[0];
  }

  /** Comma-separated Indian mobile numbers, as E.164; empty when unset. */
  mobiles(name: string): string[] {
    const entries = (this.optionalText(name) ?? "").split(",").map((entry) => entry.trim());
    const numbers: string[] = [];
    for (const entry of entries.filter((item) => item !== "")) {
      const number = toE164(entry);
      if (number === null) this.problems.push(`${name} has an entry that is not an Indian mobile number`);
      else numbers.push(number);
    }
    return numbers;
  }
}

export function readSettings(
  env: Env,
  environment: EnvironmentName | undefined,
  providers: Partial<Record<ProviderVar, string>>,
): { settings: Settings; problems: string[] } {
  const read = new Reader(env);
  const isRemote = environment === "staging" || environment === "production";
  const crmProvider = providers.CRM_PROVIDER;

  const turnstileSecret = read.text("TURNSTILE_SECRET");
  if (environment === "production" && TURNSTILE_TEST_SECRETS.has(turnstileSecret)) {
    read.problems.push("TURNSTILE_SECRET is a Cloudflare test secret in production");
  }
  const acceptTurnstileTestToken = read.flag("TURNSTILE_ACCEPT_TEST_TOKEN");
  const selfServeBooking = read.flag("SELF_SERVE_BOOKING");
  if (selfServeBooking && providers.PAYMENTS_PROVIDER === "none") {
    read.problems.push("SELF_SERVE_BOOKING needs a PAYMENTS_PROVIDER: clients would book without paying");
  }
  if (environment === "production" && acceptTurnstileTestToken) {
    read.problems.push("TURNSTILE_ACCEPT_TEST_TOKEN is on in production");
  }

  const ipHashSalt = read.text("IP_HASH_SALT");
  if (ipHashSalt !== "" && ipHashSalt.length < 32) read.problems.push("IP_HASH_SALT must be at least 32 characters");

  const alertWebhookUrl = isRemote ? read.text("ALERT_WEBHOOK_URL") : read.optionalText("ALERT_WEBHOOK_URL");
  if (alertWebhookUrl !== null && alertWebhookUrl !== "" && !alertWebhookUrl.startsWith("https://")) {
    read.problems.push("ALERT_WEBHOOK_URL must be an https:// URL");
  }
  const leadWebhookUrl = read.optionalText("LEAD_WEBHOOK_URL");
  if (leadWebhookUrl !== null && !leadWebhookUrl.startsWith("https://")) {
    read.problems.push("LEAD_WEBHOOK_URL must be an https:// URL");
  }

  let zoho: ZohoSettings | null = null;
  if (crmProvider === "zoho") {
    zoho = {
      clientId: read.text("ZOHO_CLIENT_ID"),
      clientSecret: read.text("ZOHO_CLIENT_SECRET"),
      refreshToken: read.text("ZOHO_REFRESH_TOKEN"),
      accountsHost: read.text("ZOHO_ACCOUNTS_HOST"),
      apiHost: read.text("ZOHO_API_HOST"),
      larId: read.optionalText("ZOHO_LAR_ID"),
    };
    for (const [name, host] of [
      ["ZOHO_ACCOUNTS_HOST", zoho.accountsHost],
      ["ZOHO_API_HOST", zoho.apiHost],
    ] as const) {
      if (host !== "" && !ZOHO_HOST.test(host)) read.problems.push(`${name} must be a Zoho hostname, without https://`);
    }
  }

  let zohoFsm: ZohoFsmSettings | null = null;
  if (providers.FSM_PROVIDER === "zoho" || providers.BOOKS_PROVIDER === "zoho") {
    zohoFsm = {
      clientId: read.text("ZOHO_FSM_CLIENT_ID"),
      clientSecret: read.text("ZOHO_FSM_CLIENT_SECRET"),
      refreshToken: read.text("ZOHO_FSM_REFRESH_TOKEN"),
      accountsHost: read.text("ZOHO_FSM_ACCOUNTS_HOST"),
      apiHost: read.text("ZOHO_FSM_API_HOST"),
      booksOrgId: providers.BOOKS_PROVIDER === "zoho" ? read.text("ZOHO_BOOKS_ORG_ID") : null,
      webhookToken: read.optionalText("FSM_WEBHOOK_TOKEN"),
      booksRefundAccountId: read.optionalText("BOOKS_REFUND_ACCOUNT_ID"),
    };
    if (zohoFsm.webhookToken !== null && zohoFsm.webhookToken.length < 32) {
      read.problems.push("FSM_WEBHOOK_TOKEN must be at least 32 characters");
    }
    for (const [name, host] of [
      ["ZOHO_FSM_ACCOUNTS_HOST", zohoFsm.accountsHost],
      ["ZOHO_FSM_API_HOST", zohoFsm.apiHost],
    ] as const) {
      if (host !== "" && !ZOHO_HOST.test(host)) read.problems.push(`${name} must be a Zoho hostname, without https://`);
    }
  }

  let razorpay: RazorpaySettings | null = null;
  if (providers.PAYMENTS_PROVIDER === "razorpay") {
    razorpay = {
      keyId: read.text("RAZORPAY_KEY_ID"),
      keySecret: read.text("RAZORPAY_KEY_SECRET"),
      webhookSecret: read.optionalText("RAZORPAY_WEBHOOK_SECRET"),
    };
    // Test keys move no money; live keys must never be anywhere else.
    if (environment === "production" && !razorpay.keyId.startsWith("rzp_live_") && razorpay.keyId !== "") {
      read.problems.push("RAZORPAY_KEY_ID is not a live key in production");
    }
    if (environment !== "production" && razorpay.keyId.startsWith("rzp_live_")) {
      read.problems.push("RAZORPAY_KEY_ID is a live key outside production: it would take real money");
    }
  }

  const geocode: GeocodeSettings = {
    apiKey: providers.GEOCODE_PROVIDER === "google" ? read.text("GOOGLE_MAPS_API_KEY") : null,
    dailyCeiling: read.count("GEOCODE_DAILY_CEILING"),
  };
  // A ceiling of nought is the runbook's kill switch and is deliberate; a
  // ceiling this high is not, and it is the owner's card that pays for it.
  if (geocode.dailyCeiling > GEOCODE_CEILING_MAX) {
    read.problems.push(
      `GEOCODE_DAILY_CEILING must be at most ${String(GEOCODE_CEILING_MAX)}: ` +
        "a day above that could take a month past Google's free allowance",
    );
  }

  let access: AccessSettings | null = null;
  if (providers.ACCESS_PROVIDER === "cloudflare") {
    const teamDomain = read.text("ACCESS_TEAM_DOMAIN");
    if (teamDomain !== "" && !ACCESS_TEAM_DOMAIN.test(teamDomain)) {
      read.problems.push("ACCESS_TEAM_DOMAIN must be a cloudflareaccess.com hostname, without https://");
    }
    const opsOn = environment !== undefined && ENABLED_SURFACES[environment].includes("ops");
    access = { teamDomain, opsAudience: opsOn ? read.text("ACCESS_OPS_AUD") : read.optionalText("ACCESS_OPS_AUD") };
  } else if (environment === "staging" && providers.ACCESS_PROVIDER === "stub") {
    read.problems.push("ACCESS_PROVIDER is a stub in staging: staff identity is verified everywhere but locally");
  }

  const clientOn = environment !== undefined && ENABLED_SURFACES[environment].includes("client");
  for (const variable of ["FSM_PROVIDER", "BOOKS_PROVIDER"] as const) {
    if (clientOn && providers[variable] === "none") {
      read.problems.push(`${variable} is "none" while the client surface is on: visits and documents come from Zoho`);
    }
  }
  const login: LoginSettings = {
    codePepper: clientOn ? read.key("OTP_PEPPER") : (read.optionalText("OTP_PEPPER") ?? ""),
    codeMobileDailyLimit: read.count("OTP_MOBILE_DAILY_LIMIT"),
    codeIpHourlyLimit: read.count("OTP_IP_HOURLY_LIMIT"),
    codeDailyCeiling: read.count("OTP_DAILY_CEILING"),
    fixedCode: read.optionalText("OTP_FIXED_CODE"),
  };
  if (login.fixedCode !== null && environment !== "local") {
    read.problems.push("OTP_FIXED_CODE is set outside local: every login code would be known");
  } else if (login.fixedCode !== null && !/^\d{6}$/.test(login.fixedCode)) {
    read.problems.push("OTP_FIXED_CODE must be six digits");
  }

  const tryon: TryonSettings = {
    uploadIpHourlyLimit: read.count("TRYON_UPLOAD_IP_HOURLY_LIMIT"),
    generateIpHourlyLimit: read.count("TRYON_GENERATE_IP_HOURLY_LIMIT"),
    claimMobileDailyLimit: read.count("TRYON_CLAIM_MOBILE_DAILY_LIMIT"),
    resultMessageMobileDailyLimit: read.count("RESULT_MESSAGE_MOBILE_DAILY_LIMIT"),
    renderDailyCeiling: read.count("RENDER_DAILY_CEILING"),
    uploadDailyCeiling: read.count("UPLOAD_DAILY_CEILING"),
    resultReadDailyCeiling: read.count("RESULT_READ_DAILY_CEILING"),
    resultRetentionDays: read.count("RESULT_RETENTION_DAYS"),
    unknownColorRoute: read.oneOf("UNKNOWN_COLOR_ROUTE", UNKNOWN_COLOR_ROUTES),
    creditFloor: read.count("AILAB_CREDIT_FLOOR"),
    linkSigningKey: read.key("RESULT_SIGNING_KEY"),
    ailabApiKey: providers.IMAGE_PROVIDER === "ailabtools" ? read.text("AILAB_API_KEY") : null,
  };

  if (tryon.resultRetentionDays < 1 || tryon.resultRetentionDays > 30) {
    read.problems.push("RESULT_RETENTION_DAYS must be 1 to 30: the photo notice promises deletion within thirty days");
  }

  let evolution: EvolutionSettings | null = null;
  if (providers.MESSAGING_PROVIDER === "evolution") {
    evolution = {
      baseUrl: read.text("EVOLUTION_API_URL").replace(/\/+$/, ""),
      apiKey: read.text("EVOLUTION_API_KEY"),
      instance: read.text("EVOLUTION_INSTANCE_NAME"),
      webhookToken: read.optionalText("EVOLUTION_WEBHOOK_TOKEN"),
    };
    if (evolution.webhookToken !== null && evolution.webhookToken.length < 32) {
      read.problems.push("EVOLUTION_WEBHOOK_TOKEN must be at least 32 characters");
    }
    if (evolution.baseUrl !== "" && !evolution.baseUrl.startsWith("https://")) {
      read.problems.push("EVOLUTION_API_URL must be an https:// URL");
    }
  }

  const messaging: MessagingSettings = {
    enabled: read.flag("MESSAGING_ENABLED"),
    resultTemplate: read.text("WA_RESULT_TEMPLATE"),
    allowlist: read.mobiles("MESSAGING_ALLOWLIST"),
    evolution,
  };
  if (messaging.resultTemplate !== "" && !isKnownTemplate(messaging.resultTemplate)) {
    read.problems.push("WA_RESULT_TEMPLATE names no template in src/config/message-templates.ts");
  }
  if (environment === "staging" && messaging.enabled && messaging.allowlist.length === 0) {
    read.problems.push("MESSAGING_ALLOWLIST must name the test handsets while messaging is on in staging");
  }

  const settings: Settings = {
    visitLeadDays: read.count("VISIT_LEAD_DAYS"),
    leadMobileDailyLimit: read.count("LEAD_MOBILE_DAILY_LIMIT"),
    leadIpDailyLimit: read.count("LEAD_IP_DAILY_LIMIT"),
    turnstileSecret,
    acceptTurnstileTestToken,
    selfServeBooking,
    referrerNameOnInvite: read.flag("REFERRER_NAME_ON_INVITE"),
    ipHashSalt,
    alertWebhookUrl: alertWebhookUrl === "" ? null : alertWebhookUrl,
    leadWebhookUrl: leadWebhookUrl ?? (alertWebhookUrl === "" ? null : alertWebhookUrl),
    erasureSecret: read.key("ERASURE_SECRET"),
    zoho,
    zohoFsm,
    razorpay,
    access,
    geocode,
    login,
    tryon,
    messaging,
  };
  return { settings, problems: read.problems };
}
