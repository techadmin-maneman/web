// What sending conversions to the ad platforms needs (docs/decisions/0288-attribution-and-conversions.md), every value
// from the Worker's own secrets: Meta's dataset and token, and Google's Ads account, its four conversion actions and
// the service account the Worker signs in as. A platform whose secrets are none of them set is off, and its conversions
// wait; one with only some set is refused at start. In test mode nothing sent counts: Meta's go to its Test Events,
// Google's are validateOnly. Staging is never otherwise.

export interface MetaSettings {
  readonly datasetId: string;
  readonly token: string;
  /** Required in test mode. */
  readonly testEventCode: string | null;
}

/** The events Google is told of: a lead reaches it from GA4 in the browser instead. */
export type GoogleEvent = "consult_booked" | "consult_done" | "first_fit_paid" | "service_paid";

export interface GoogleSettings {
  /** The Ads account, ten digits. */
  readonly customerId: string;
  /** The manager account Google Ads is reached through, where there is one. */
  readonly loginCustomerId: string | null;
  /** Each event's conversion action, by its ID. */
  readonly actions: Readonly<Record<GoogleEvent, string>>;
  readonly serviceAccount: { readonly clientEmail: string; readonly privateKey: string };
}

export interface ConversionSettings {
  readonly testMode: boolean;
  /**
   * India's day sending to Google and Meta began, CONVERSIONS_FROM: what happened before it is history its clients were
   * never told would be shared, and is never sent. Null where no platform sends.
   */
  readonly sendsFrom: string | null;
  readonly meta: MetaSettings | null;
  readonly google: GoogleSettings | null;
}

/** Each Google event's secret, the conversion action's ID. */
export const GOOGLE_ACTION_SECRETS: Readonly<Record<GoogleEvent, string>> = {
  consult_booked: "GOOGLE_ADS_ACTION_CONSULT_BOOKED",
  consult_done: "GOOGLE_ADS_ACTION_CONSULT_DONE",
  first_fit_paid: "GOOGLE_ADS_ACTION_FIRST_FIT_PAID",
  service_paid: "GOOGLE_ADS_ACTION_SERVICE_PAID",
};
