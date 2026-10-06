// Each section of the settings, read from the Worker's vars and secrets (./settings.ts): Zoho and Books, the GST
// registration, Razorpay, geocoding, Access, the sign-in, the try-on, WhatsApp and the watchers.

import type { Reader } from "./env-reader.ts";
import { ENABLED_SURFACES, type EnvironmentName, type ProviderVar } from "./environments.ts";
import { MAX_RESULT_RETENTION_DAYS } from "./tryon.ts";
import type {
  Settings,
  ZohoSettings,
  ZohoBooksSettings,
  RazorpaySettings,
  GeocodeSettings,
  AccessSettings,
  LoginSettings,
  TryonSettings,
  MessagingSettings,
} from "./settings.ts";
import { type GstRegistration, GSTIN_FORMAT, STATE_CODE_FORMAT, SAC_FORMAT } from "./gst.ts";
import type { EvolutionSettings } from "./evolution.ts";

/**
 * The most GEOCODE_DAILY_CEILING may be set to. Google's India price list gives
 * the Geocoding SKU 70,000 free calls a month; 80% of that over a 31-day month
 * is 1,806 a day, so a ceiling at or below this cannot reach the free
 * allowance however many days run at it. Expected use is about ten a day
 * (docs/decisions/0054-address-capture.md).
 */
const GEOCODE_CEILING_MAX = 1800;

/**
 * Cloudflare's published Turnstile test secrets. Any of them in production
 * would accept every token, or none.
 */
export const TURNSTILE_TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

const ZOHO_HOST = /^[a-z0-9.-]+\.(zoho|zohoapis)\.[a-z.]+$/;
const ACCESS_TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;

/** The provider vars as the guard read them, before it has refused any: one that failed its check is missing. */
export type ProvidersRead = Partial<Record<ProviderVar, string>>;

/** What watches mm-api from outside it: the cron's heartbeat. */
export function readWatchers(read: Reader): Pick<Settings, "heartbeatUrl"> {
  const heartbeatUrl = read.optionalText("HEARTBEAT_URL");
  if (heartbeatUrl !== null && !heartbeatUrl.startsWith("https://")) {
    read.problems.push("HEARTBEAT_URL must be an https:// URL");
  }
  return { heartbeatUrl };
}

/** Each Zoho host named, which must be a hostname without https://. */
function checkZohoHosts(read: Reader, hosts: readonly (readonly [name: string, host: string])[]): void {
  for (const [name, host] of hosts) {
    if (host !== "" && !ZOHO_HOST.test(host)) read.problems.push(`${name} must be a Zoho hostname, without https://`);
  }
}

/** The CRM's and Books' Zoho clients, each only where its provider is zoho. */
export function readZohoClients(read: Reader, providers: ProvidersRead): Pick<Settings, "zohoCrm" | "zohoBooks"> {
  return {
    zohoCrm: readZoho(read, providers),
    zohoBooks: readZohoBooks(read, providers),
  };
}

/** The CRM's Zoho client, when CRM_PROVIDER is zoho. */
function readZoho(read: Reader, providers: ProvidersRead): ZohoSettings | null {
  if (providers.CRM_PROVIDER !== "zoho") return null;
  const zoho: ZohoSettings = {
    clientId: read.text("ZOHO_CLIENT_ID"),
    clientSecret: read.text("ZOHO_CLIENT_SECRET"),
    refreshToken: read.text("ZOHO_REFRESH_TOKEN"),
    accountsHost: read.text("ZOHO_ACCOUNTS_HOST"),
    apiHost: read.text("ZOHO_API_HOST"),
    larId: read.optionalText("ZOHO_LAR_ID"),
  };
  checkZohoHosts(read, [
    ["ZOHO_ACCOUNTS_HOST", zoho.accountsHost],
    ["ZOHO_API_HOST", zoho.apiHost],
  ]);
  return zoho;
}

/** Books' own Zoho client, its organisation and refund account, when BOOKS_PROVIDER is zoho. */
function readZohoBooks(read: Reader, providers: ProvidersRead): ZohoBooksSettings | null {
  if (providers.BOOKS_PROVIDER !== "zoho") return null;
  const zohoBooks: ZohoBooksSettings = {
    clientId: read.text("ZOHO_BOOKS_CLIENT_ID"),
    clientSecret: read.text("ZOHO_BOOKS_CLIENT_SECRET"),
    refreshToken: read.text("ZOHO_BOOKS_REFRESH_TOKEN"),
    accountsHost: read.text("ZOHO_BOOKS_ACCOUNTS_HOST"),
    apiHost: read.text("ZOHO_BOOKS_API_HOST"),
    orgId: read.text("ZOHO_BOOKS_ORG_ID"),
    refundAccountId: read.optionalText("BOOKS_REFUND_ACCOUNT_ID"),
    gst: readGstRegistration(read),
  };
  checkZohoHosts(read, [
    ["ZOHO_BOOKS_ACCOUNTS_HOST", zohoBooks.accountsHost],
    ["ZOHO_BOOKS_API_HOST", zohoBooks.apiHost],
  ]);
  return zohoBooks;
}

/** The GST registration, each part empty until the CA gives it. */
function readGstRegistration(read: Reader): GstRegistration {
  const gstin = read.optionalText("BOOKS_GSTIN");
  const stateCode = read.optionalText("BOOKS_GST_STATE");
  const sac = read.optionalText("BOOKS_SAC");
  if (gstin !== null && !GSTIN_FORMAT.test(gstin)) {
    read.problems.push("BOOKS_GSTIN is not a GSTIN: 15 characters, such as 06AAACM1234A1Z5");
  }
  if (stateCode !== null && !STATE_CODE_FORMAT.test(stateCode)) {
    read.problems.push("BOOKS_GST_STATE must be the two-letter GST code of the state registered in, such as HR");
  }
  if (gstin !== null && stateCode === null) {
    read.problems.push(
      "BOOKS_GST_STATE must be set with BOOKS_GSTIN: it is the place of supply of a client whose city is not known",
    );
  }
  if (sac !== null && !SAC_FORMAT.test(sac)) {
    read.problems.push("BOOKS_SAC must be a SAC code of six digits, such as 999721");
  }
  return { gstin, stateCode, sac };
}

/** Razorpay's keys, when PAYMENTS_PROVIDER is razorpay; the stub's webhook secret, when it is the stub. */
export function readRazorpay(
  read: Reader,
  providers: ProvidersRead,
  environment: EnvironmentName | undefined,
  selfServeBooking: boolean,
): RazorpaySettings | null {
  if (providers.PAYMENTS_PROVIDER === "stub") {
    return { keyId: "", keySecret: "", webhookSecret: read.optionalText("RAZORPAY_WEBHOOK_SECRET") };
  }
  if (providers.PAYMENTS_PROVIDER !== "razorpay") return null;
  const razorpay: RazorpaySettings = {
    keyId: read.text("RAZORPAY_KEY_ID"),
    keySecret: read.text("RAZORPAY_KEY_SECRET"),
    webhookSecret: readWebhookSecret(read, selfServeBooking),
  };
  // Test keys move no money; live keys must never be anywhere else.
  if (environment === "production" && !razorpay.keyId.startsWith("rzp_live_") && razorpay.keyId !== "") {
    read.problems.push("RAZORPAY_KEY_ID is not a live key in production");
  }
  if (environment !== "production" && razorpay.keyId.startsWith("rzp_live_")) {
    read.problems.push("RAZORPAY_KEY_ID is a live key outside production: it would take real money");
  }
  return razorpay;
}

/**
 * The only proof a payment event is Razorpay's. Self-serve booking hears of every payment through it, so it must be
 * set then; set, it must be long enough to sign with.
 */
function readWebhookSecret(read: Reader, selfServeBooking: boolean): string | null {
  const secret = read.optionalText("RAZORPAY_WEBHOOK_SECRET");
  if (secret === null) {
    if (selfServeBooking) {
      read.problems.push("RAZORPAY_WEBHOOK_SECRET is not set: self-serve booking would never hear that a client paid");
    }
    return null;
  }
  if (secret.length < 32) read.problems.push("RAZORPAY_WEBHOOK_SECRET must be at least 32 characters");
  return secret;
}

/** The address search: its key when there is one, and its daily ceiling always. */
export function readGeocode(read: Reader, providers: ProvidersRead): GeocodeSettings {
  const geocode: GeocodeSettings = {
    apiKey: providers.GEOCODE_PROVIDER === "google" ? read.text("GOOGLE_MAPS_API_KEY") : null,
    dailyCeiling: read.count("GEOCODE_DAILY_CEILING"),
  };
  // A ceiling of nought is the runbook's kill switch and is deliberate; a
  // ceiling this high is not, and a card pays for it.
  if (geocode.dailyCeiling > GEOCODE_CEILING_MAX) {
    read.problems.push(
      `GEOCODE_DAILY_CEILING must be at most ${String(GEOCODE_CEILING_MAX)}: ` +
        "a day above that could take a month past Google's free allowance",
    );
  }
  return geocode;
}

/** Cloudflare Access, when ACCESS_PROVIDER is cloudflare. A stub is refused in staging. */
export function readAccess(
  read: Reader,
  providers: ProvidersRead,
  environment: EnvironmentName | undefined,
): AccessSettings | null {
  if (providers.ACCESS_PROVIDER !== "cloudflare") {
    if (environment === "staging" && providers.ACCESS_PROVIDER === "stub") {
      read.problems.push("ACCESS_PROVIDER is a stub in staging: staff identity is verified everywhere but locally");
    }
    return null;
  }
  const teamDomain = read.text("ACCESS_TEAM_DOMAIN");
  if (teamDomain !== "" && !ACCESS_TEAM_DOMAIN.test(teamDomain)) {
    read.problems.push("ACCESS_TEAM_DOMAIN must be a cloudflareaccess.com hostname, without https://");
  }
  const opsOn = environment !== undefined && ENABLED_SURFACES[environment].includes("ops");
  return { teamDomain, opsAudience: opsOn ? read.text("ACCESS_OPS_AUD") : read.optionalText("ACCESS_OPS_AUD") };
}

/** The login codes: their pepper, their limits, and locally a fixed code. */
export function readLogin(read: Reader, environment: EnvironmentName | undefined, clientOn: boolean): LoginSettings {
  const isLocal = environment === "local";
  const login: LoginSettings = {
    codePepper: clientOn ? read.key("OTP_PEPPER") : (read.optionalText("OTP_PEPPER") ?? ""),
    codeMobileDailyLimit: read.fixedLimit("OTP_MOBILE_DAILY_LIMIT", isLocal),
    codeIpHourlyLimit: read.fixedLimit("OTP_IP_HOURLY_LIMIT", isLocal),
    codeDailyCeiling: read.fixedLimit("OTP_DAILY_CEILING", isLocal),
    techCodeDailyCeiling: read.fixedLimit("OTP_TECH_DAILY_CEILING", isLocal),
    fixedCode: read.optionalText("OTP_FIXED_CODE"),
    testRecordCode: read.optionalText("STAGING_TEST_RECORD_CODE"),
  };
  if (login.fixedCode !== null && !isLocal) {
    read.problems.push("OTP_FIXED_CODE is set outside local: every login code would be known");
  } else if (login.fixedCode !== null && !/^\d{6}$/.test(login.fixedCode)) {
    read.problems.push("OTP_FIXED_CODE must be six digits");
  }
  if (login.testRecordCode !== null && environment !== "staging") {
    read.problems.push("STAGING_TEST_RECORD_CODE is set outside staging: test records' codes would be known");
  } else if (login.testRecordCode !== null && !/^\d{6}$/.test(login.testRecordCode)) {
    read.problems.push("STAGING_TEST_RECORD_CODE must be six digits");
  }
  return login;
}

/** The try-on's limits, ceilings, retention and keys. */
export function readTryon(read: Reader, providers: ProvidersRead, isLocal: boolean): TryonSettings {
  const tryon: TryonSettings = {
    uploadIpHourlyLimit: read.fixedLimit("TRYON_UPLOAD_IP_HOURLY_LIMIT", isLocal),
    generateIpHourlyLimit: read.fixedLimit("TRYON_GENERATE_IP_HOURLY_LIMIT", isLocal),
    claimMobileDailyLimit: read.fixedLimit("TRYON_CLAIM_MOBILE_DAILY_LIMIT", isLocal),
    resultMessageMobileDailyLimit: read.fixedLimit("RESULT_MESSAGE_MOBILE_DAILY_LIMIT", isLocal),
    renderDailyCeiling: read.count("RENDER_DAILY_CEILING"),
    uploadDailyCeiling: read.count("UPLOAD_DAILY_CEILING"),
    resultReadDailyCeiling: read.count("RESULT_READ_DAILY_CEILING"),
    resultRetentionDays: read.count("RESULT_RETENTION_DAYS"),
    creditFloor: read.count("AILAB_CREDIT_FLOOR"),
    linkSigningKey: read.key("RESULT_SIGNING_KEY"),
    ailabApiKey: providers.IMAGE_PROVIDER === "ailabtools" ? read.text("AILAB_API_KEY") : null,
  };
  if (tryon.resultRetentionDays < 1 || tryon.resultRetentionDays > MAX_RESULT_RETENTION_DAYS) {
    read.problems.push(
      `RESULT_RETENTION_DAYS must be 1 to ${String(MAX_RESULT_RETENTION_DAYS)}: the photo notice promises the look is deleted within fourteen days`,
    );
  }
  return tryon;
}

/** Evolution's bridge, when MESSAGING_PROVIDER is evolution. */
function readEvolution(read: Reader, providers: ProvidersRead): EvolutionSettings | null {
  if (providers.MESSAGING_PROVIDER !== "evolution") return null;
  const evolution: EvolutionSettings = {
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
  return evolution;
}

/** WhatsApp: whether it is on, the allowlist, and the bridge. */
export function readMessaging(
  read: Reader,
  providers: ProvidersRead,
  environment: EnvironmentName | undefined,
): MessagingSettings {
  const evolution = readEvolution(read, providers);
  const messaging: MessagingSettings = {
    enabled: read.flag("MESSAGING_ENABLED"),
    allowlist: read.mobiles("MESSAGING_ALLOWLIST"),
    evolution,
  };
  if (environment === "staging" && messaging.enabled && messaging.allowlist.length === 0) {
    read.problems.push("MESSAGING_ALLOWLIST must name the test handsets while messaging is on in staging");
  }
  return messaging;
}
