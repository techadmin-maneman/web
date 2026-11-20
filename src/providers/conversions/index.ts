// The ad platforms our conversions are sent to (docs/decisions/0288-attribution-and-conversions.md), each behind one
// interface: Meta's Conversions API and Google's Data Manager API. Only this file knows which implementation runs;
// only meta.ts knows Meta and google.ts Google. A platform with no credentials, or switched off, is null, and its
// conversions wait.

import type { VendorFetchDependencies } from "../vendor-fetch.ts";
import type { ConversionSettings } from "../../config/conversions.ts";
import { createGoogleConversions } from "./google.ts";
import { createMetaConversions } from "./meta.ts";
import { createStubConversions } from "./stub.ts";

/** What each platform is told of a conversion, hashed already where it is a person's. */
export interface ConversionToSend {
  readonly eventId: string;
  readonly event: "lead_submit" | "consult_booked" | "consult_done" | "first_fit_paid" | "service_paid";
  readonly occurredAt: Date;
  /** Rupees before GST, for a payment. */
  readonly value: number | null;
  /** The page a lead was left on. */
  readonly sourceUrl: string | null;
  /** The number, hashed in each platform's own form (src/lib/ad-match.ts). */
  readonly phone: { readonly meta: string; readonly google: string };
  readonly firstName: string | null;
  /** Our person's ID, hashed, so Meta can tell one client's events apart. */
  readonly externalId: string;
  /** What the browser gave, where the visitor did not decline the cookie bar. */
  readonly browser: {
    readonly fbc: string | null;
    readonly fbp: string | null;
    readonly ip: string | null;
    readonly userAgent: string | null;
  };
  /** Google's click IDs, the most recent touch's that carried one. */
  readonly clicks: { readonly gclid: string | null; readonly gbraid: string | null; readonly wbraid: string | null };
}

/**
 * What became of one send: taken; to try again later; refused for good, with the platform's words; or held, the
 * account refused, until someone puts it right.
 */
export type SendOutcome =
  | { readonly kind: "sent" }
  | { readonly kind: "retry"; readonly error: string }
  | { readonly kind: "refused"; readonly error: string }
  /** The platform refuses our account, not the event: its token, its access or its IDs. Every send would fail. */
  | { readonly kind: "held"; readonly error: string };

export interface ConversionPlatform {
  /** Sends one conversion; in test mode, to Meta's Test Events or as Google's validateOnly, so nothing counts. */
  send(conversion: ConversionToSend): Promise<SendOutcome>;
}

export interface ConversionPlatforms {
  readonly meta: ConversionPlatform | null;
  readonly google: ConversionPlatform | null;
}

/** A platform as its provider var names it: the stub, none, or the real one where its settings are there. */
function platformOf(
  provider: string,
  platform: "meta" | "google",
  real: () => ConversionPlatform | null,
  deps: VendorFetchDependencies,
): ConversionPlatform | null {
  if (provider === "stub") return createStubConversions(platform, deps.log);
  return provider === "none" ? null : real();
}

/** Each platform as its provider var names it; null for "none", or where its settings are missing. */
export function createConversionPlatforms(
  providers: { readonly META_CAPI_PROVIDER: string; readonly GOOGLE_ADS_PROVIDER: string },
  settings: ConversionSettings,
  deps: VendorFetchDependencies & { readonly now: () => Date },
): ConversionPlatforms {
  const { meta, google, testMode } = settings;
  return {
    meta: platformOf(
      providers.META_CAPI_PROVIDER,
      "meta",
      () => (meta === null ? null : createMetaConversions(meta, testMode, deps)),
      deps,
    ),
    google: platformOf(
      providers.GOOGLE_ADS_PROVIDER,
      "google",
      () => (google === null ? null : createGoogleConversions(google, testMode, deps)),
      deps,
    ),
  };
}
