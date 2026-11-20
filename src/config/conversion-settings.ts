// Reading what sending conversions needs from the Worker's secrets (./conversions.ts; docs/decisions/0288-attribution-
// and-conversions.md): a platform is on once each of its secrets is set, off while none is, and refused at start with
// some set and others missing, or set to something it cannot be. Staging may only send in test mode.

import {
  GOOGLE_ACTION_SECRETS,
  type ConversionSettings,
  type GoogleEvent,
  type GoogleSettings,
  type MetaSettings,
} from "./conversions.ts";
import type { EnvironmentName } from "./environments.ts";
import type { Reader } from "./env-reader.ts";
import type { ProvidersRead } from "./settings-sections.ts";

const META_SECRETS = ["META_DATASET_ID", "META_CAPI_TOKEN"] as const;
const GOOGLE_SECRETS = [
  "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
  ...Object.values(GOOGLE_ACTION_SECRETS),
];

/** Whether all, none or only some of these secrets are set; some set is a problem named for the first missing. */
function setOf(read: Reader, names: readonly string[]): "all" | "none" {
  const missing = names.filter((name) => read.optionalText(name) === null);
  if (missing.length === 0) return "all";
  if (missing.length < names.length)
    read.problems.push(`${missing.join(", ")} not set, beside the others it goes with`);
  return "none";
}

function readMeta(read: Reader, testMode: boolean): MetaSettings | null {
  if (setOf(read, META_SECRETS) === "none") return null;
  const datasetId = read.text("META_DATASET_ID");
  if (!/^\d{10,20}$/.test(datasetId)) read.problems.push("META_DATASET_ID must be the dataset's (Pixel's) number");
  const testEventCode = read.optionalText("META_TEST_EVENT_CODE");
  if (testMode && testEventCode === null) {
    read.problems.push("META_TEST_EVENT_CODE is not set: in test mode Meta's events go to its Test Events alone");
  }
  return { datasetId, token: read.text("META_CAPI_TOKEN"), testEventCode };
}

/** An Ads account's ID as Google Ads shows it, "782-892-1498", as the ten digits the API takes. */
function accountId(read: Reader, name: string): string | null {
  const given = read.optionalText(name);
  if (given === null) return null;
  const digits = given.replace(/-/g, "");
  if (!/^\d{10}$/.test(digits)) read.problems.push(`${name} must be a Google Ads account's ten digits`);
  return digits;
}

/** The service account's JSON key, as Google gave it: its e-mail and its private key. */
function serviceAccountOf(read: Reader): GoogleSettings["serviceAccount"] {
  try {
    const key = JSON.parse(read.text("GOOGLE_SERVICE_ACCOUNT_KEY")) as {
      client_email?: unknown;
      private_key?: unknown;
    };
    if (typeof key.client_email === "string" && typeof key.private_key === "string") {
      return { clientEmail: key.client_email, privateKey: key.private_key };
    }
  } catch {
    // Named below.
  }
  read.problems.push("GOOGLE_SERVICE_ACCOUNT_KEY must be the service account's JSON key, as Google Cloud gave it");
  return { clientEmail: "", privateKey: "" };
}

function readGoogle(read: Reader): GoogleSettings | null {
  if (setOf(read, GOOGLE_SECRETS) === "none") return null;
  const actions = Object.fromEntries(
    Object.entries(GOOGLE_ACTION_SECRETS).map(([event, name]) => {
      const id = read.text(name);
      if (!/^\d{5,20}$/.test(id)) read.problems.push(`${name} must be the conversion action's ID, its digits`);
      return [event, id];
    }),
  ) as Record<GoogleEvent, string>;
  return {
    customerId: accountId(read, "GOOGLE_ADS_CUSTOMER_ID") ?? "",
    loginCustomerId: accountId(read, "GOOGLE_ADS_LOGIN_CUSTOMER_ID"),
    actions,
    serviceAccount: serviceAccountOf(read),
  };
}

export function readConversions(
  read: Reader,
  providers: ProvidersRead,
  environment: EnvironmentName | undefined,
): ConversionSettings {
  const testMode = read.optionalFlag("CONVERSIONS_TEST_MODE");
  const meta = providers.META_CAPI_PROVIDER === "meta" ? readMeta(read, testMode) : null;
  const google = providers.GOOGLE_ADS_PROVIDER === "google" ? readGoogle(read) : null;
  if (environment === "staging" && !testMode && (meta !== null || google !== null)) {
    read.problems.push('CONVERSIONS_TEST_MODE must be "true" on staging: its leads and payments are not real');
  }
  return { testMode, meta, google };
}
