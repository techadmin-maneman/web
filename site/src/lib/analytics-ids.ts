// The analytics tags, per environment (docs/site.md, "Adding the analytics
// IDs"). A tag with no ID is not loaded, and the content security policy
// allows only the hosts of the tags that are. The IDs are public: they appear
// in every page. Staging's must be debug or test streams, never production's.

import type { SiteEnvironment } from "./environment.ts";

export interface AnalyticsIds {
  /** GA4 measurement ID, G-… */
  readonly ga4: string | null;
  /** Google Ads: the account's AW-… ID and a conversion label for each kind of lead. */
  readonly googleAds: { readonly id: string; readonly bookingLabel: string; readonly tryOnLabel: string } | null;
  /** Meta Pixel ID. */
  readonly metaPixel: string | null;
}

const NONE: AnalyticsIds = { ga4: null, googleAds: null, metaPixel: null };

export const ANALYTICS_IDS: Readonly<Record<SiteEnvironment, AnalyticsIds>> = {
  local: NONE,
  // Staging's own GA4 stream; no Pixel, so staging's browsing never reaches the dataset production's ads learn from.
  staging: { ga4: "G-4FDVTM1EHH", googleAds: null, metaPixel: null },
  // The Pixel is the Mane Man dataset the Conversions API sends to, so Meta counts a lead sent by both once.
  production: { ga4: "G-SYKFYCBTQE", googleAds: null, metaPixel: "4633949850213113" },
};
