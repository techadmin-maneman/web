// Turns the Worker's vars and secrets into typed settings, listing every
// problem instead of stopping at the first. The startup guard (src/guard.ts)
// refuses to run while any problem remains; see
// docs/decisions/0003-environment-identity-guard.md. Each var is read through ./env-reader.ts, and each section of
// the settings in ./settings-sections.ts.

import type { EvolutionSettings } from "./evolution.ts";
import type { SentryDsn } from "../lib/sentry-dsn.ts";
import { ENABLED_SURFACES, type EnvironmentName } from "./environments.ts";
import { type GstRegistration } from "./gst.ts";
import { Reader, type Env } from "./env-reader.ts";
import {
  type ProvidersRead,
  readAccess,
  readGeocode,
  readLogin,
  readMessaging,
  readRazorpay,
  readTryon,
  readWatchers,
  readZohoClients,
  TURNSTILE_TEST_SECRETS,
} from "./settings-sections.ts";

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
  /** Days a result is kept once ready: 14 in production, the photo notice's limit; less on staging. */
  readonly resultRetentionDays: number;
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
  /**
   * When not empty, an automatic message (a reminder, or one to someone other than who acted) goes only to these
   * E.164 numbers (staging: the founders' handsets); a login code and a message that answers the person who just
   * acted go anywhere regardless (`MESSAGE_CLASSES`, src/config/message-templates.ts; ADR 0097).
   */
  readonly allowlist: readonly string[];
  /** Present when MESSAGING_PROVIDER is "evolution". */
  readonly evolution: EvolutionSettings | null;
}

/** A number an automatic message may go to: every number, unless there is an allowlist and it does not name this one. */
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

/** Books' own Zoho client, in the real org. */
export interface ZohoBooksSettings {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** e.g. accounts.zoho.in */
  readonly accountsHost: string;
  /** e.g. www.zohoapis.in, where Books answers at /books/v3. */
  readonly apiHost: string;
  /** The Books organisation invoices and receipts are in. */
  readonly orgId: string;
  /**
   * The Books account refunds are paid from: the one Razorpay settles into. Without it, refunds are not recorded
   * in Books and their vouchers wait (docs/open-points.md).
   */
  readonly refundAccountId: string | null;
  /** Empty while GST is off in Books; the CA's figures once it is on. */
  readonly gst: GstRegistration;
}

/** Razorpay (docs/decisions/0044-payments-mirror.md). */
export interface RazorpaySettings {
  /** Public: Checkout takes it in the browser. rzp_test_ on staging, rzp_live_ in production. */
  readonly keyId: string;
  readonly keySecret: string;
  /**
   * Signs the webhook's events: at least 32 characters, and required for self-serve booking. Without it the webhook
   * answers 404.
   */
  readonly webhookSecret: string | null;
}

export interface GeocodeSettings {
  /**
   * Google Maps Platform, restricted to Places and Geocoding and to this
   * Worker's IPs (docs/provisioning.md, step 13). Null unless GEOCODE_PROVIDER is
   * "google".
   */
  readonly apiKey: string | null;
  /**
   * Requests to Google allowed in an India day, counted across every client.
   * It refuses rather than spends: a card is behind this key, and
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
  /** The same limit for the technician app's codes, which only an active technician's number is sent. */
  readonly techCodeDailyCeiling: number;
  /**
   * Locally only, every code is this one, so the browser tests can log in
   * through the stub messaging provider. The guard refuses it anywhere else.
   */
  readonly fixedCode: string | null;
  /**
   * On staging only, the code our own test records ("Staging test …") sign in with, so a test can walk the real
   * login screens without reading a WhatsApp nobody owns. The guard refuses it anywhere else.
   */
  readonly testRecordCode: string | null;
}

export interface Settings {
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
  /** HEARTBEAT_URL: the outside monitor the cron pings after each run (src/providers/heartbeat.ts). Optional. */
  readonly heartbeatUrl: string | null;
  /** SENTRY_DSN: where each error line is reported (src/providers/error-tracking.ts). Optional: unset, none is. */
  readonly sentryDsn: SentryDsn | null;
  /** Present when CRM_PROVIDER is "zoho". */
  readonly zohoCrm: ZohoSettings | null;
  /** Present when BOOKS_PROVIDER is "zoho". */
  readonly zohoBooks: ZohoBooksSettings | null;
  /**
   * Present when PAYMENTS_PROVIDER is "razorpay", and for the stub, with no keys: locally its payments arrive by the
   * same signed webhook, with a placeholder secret (docs/getting-started.md).
   */
  readonly razorpay: RazorpaySettings | null;
  /** Present when ACCESS_PROVIDER is "cloudflare". */
  readonly access: AccessSettings | null;
  /** The address search: its key when there is one, and its daily ceiling always. */
  readonly geocode: GeocodeSettings;
  readonly login: LoginSettings;
  readonly tryon: TryonSettings;
  readonly messaging: MessagingSettings;
  /**
   * DEV_ROUTES=on, locally only: the routes that stand in on a laptop for what a technician's phone does, such as
   * closing a job (src/routes/dev-visits.ts). The guard refuses it anywhere else, and no other environment's app has
   * the routes.
   */
  readonly devRoutes: boolean;
}

export function readSettings(
  env: Env,
  environment: EnvironmentName | undefined,
  providers: ProvidersRead,
): { settings: Settings; problems: string[] } {
  const read = new Reader(env);
  const isRemote = environment === "staging" || environment === "production";
  const isLocal = environment === "local";

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
  const watchers = readWatchers(read);

  const zohoClients = readZohoClients(read, providers);
  const razorpay = readRazorpay(read, providers, environment, selfServeBooking);
  const geocode = readGeocode(read, providers);
  const access = readAccess(read, providers, environment);

  const clientOn = environment !== undefined && ENABLED_SURFACES[environment].includes("client");
  if (clientOn && providers.BOOKS_PROVIDER === "none") {
    read.problems.push(
      'BOOKS_PROVIDER is "none" while the client surface is on: invoices and receipts come from Zoho Books',
    );
  }
  const login = readLogin(read, environment, clientOn);

  const devRoutes = read.optionalText("DEV_ROUTES");
  if (devRoutes !== null && environment !== "local") {
    read.problems.push("DEV_ROUTES is set outside local: its routes would close jobs no technician worked");
  }

  const tryon = readTryon(read, providers, isLocal);
  const messaging = readMessaging(read, providers, environment);

  const settings: Settings = {
    leadMobileDailyLimit: read.fixedLimit("LEAD_MOBILE_DAILY_LIMIT", isLocal),
    leadIpDailyLimit: read.fixedLimit("LEAD_IP_DAILY_LIMIT", isLocal),
    turnstileSecret,
    acceptTurnstileTestToken,
    selfServeBooking,
    referrerNameOnInvite: read.flag("REFERRER_NAME_ON_INVITE"),
    ipHashSalt,
    alertWebhookUrl: alertWebhookUrl === "" ? null : alertWebhookUrl,
    leadWebhookUrl: leadWebhookUrl ?? (alertWebhookUrl === "" ? null : alertWebhookUrl),
    ...watchers,
    ...zohoClients,
    razorpay,
    access,
    geocode,
    login,
    tryon,
    messaging,
    devRoutes: environment === "local" && devRoutes === "on",
  };
  return { settings, problems: read.problems };
}
