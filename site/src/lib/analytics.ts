// The site's analytics: GA4, the Google Ads conversion tag and the Meta Pixel,
// each loaded only when its ID is set for this environment (analytics-ids.ts).
// Cloudflare Web Analytics needs nothing here: Cloudflare adds it at the edge.
//
// Every event goes onto GA's dataLayer queue whether or not a tag is loaded,
// so the browser tests can read exactly what would be sent. No event carries a
// name, a number or an image: the types below allow nothing else.
//
// The referral landing's address holds a person's invite code, so no tag reads
// it: Google's tags are given the address without the code, and the Meta Pixel,
// which reports the address as it stands, is not loaded there.

import type { LossExtent } from "../../../src/config/booking.ts";
import type { BookingWindow } from "../../../src/config/scheduling.ts";
import { ANALYTICS_IDS } from "./analytics-ids.ts";
import { ENVIRONMENT } from "./build.ts";
import { INVITE_PATH_IN_URL } from "../../../src/config/invite-codes.ts";

/** Which booking page: the site's own /book, or a friend's invite at /r/:code. */
type BookingPage = "book" | "invite";

export type AnalyticsEvent =
  | { readonly name: "try_on_started" | "try_on_gate_shown" | "try_on_claimed" | "try_on_completed" }
  | { readonly name: "try_on_failed"; readonly failure_code: string }
  | {
      readonly name: "lead_submitted";
      readonly page: BookingPage;
      readonly served: boolean;
      /** The pincode's area, "Sector 65"; null until ops have named it, and for a pincode we do not know. */
      readonly area: string | null;
      /** Null on the waitlist, which asks for no window. */
      readonly window: BookingWindow | null;
      /** Null on an invite, which does not ask. */
      readonly loss_extent: LossExtent | null;
    }
  | {
      readonly name: "booking_confirmed";
      readonly page: BookingPage;
      readonly area: string;
      readonly window: BookingWindow;
      /** "requested" while self-serve booking is off and ops fix the hour. */
      readonly state: "booked" | "requested";
    }
  | { readonly name: "waitlist_submitted"; readonly page: BookingPage; readonly area: string | null };

type Command = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    fbq?: Command & {
      callMethod?: Command;
      queue?: unknown[];
      push?: Command;
      loaded?: boolean;
      version?: string;
      disablePushState?: boolean;
    };
    _fbq?: Window["fbq"];
  }
}

/** Query parameters a page address may keep: the campaign tags, and outside production the preview switches. */
const CAMPAIGN_TAGS = /^(utm_[a-z]+|gclid|fbclid)$/;
const PREVIEW_SWITCHES = new Set(["state", "kind"]);
const kept = (key: string) => CAMPAIGN_TAGS.test(key) || (ENVIRONMENT !== "production" && PREVIEW_SWITCHES.has(key));

// gtag.js reads each command as an `arguments` object, not an array.
function gtag(..._args: unknown[]): void {
  // eslint-disable-next-line prefer-rest-params
  (window.dataLayer ??= []).push(arguments);
}

function loadScript(src: string): void {
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  document.head.append(script);
}

/** Meta's loader, as its snippet defines it: commands queue until fbevents.js arrives. */
function startMetaPixel(pixelId: string): void {
  const fbq: NonNullable<Window["fbq"]> = function (this: unknown) {
    // eslint-disable-next-line prefer-rest-params
    if (fbq.callMethod) fbq.callMethod(...arguments);
    // eslint-disable-next-line prefer-rest-params
    else fbq.queue?.push(arguments);
  };
  // The booking page writes each of its steps into the history; the pixel would count each as a page view.
  Object.assign(fbq, { push: fbq, loaded: true, version: "2.0", queue: [], disablePushState: true });
  window.fbq = fbq;
  window._fbq ??= fbq;
  loadScript("https://connect.facebook.net/en_US/fbevents.js");
  // Automatic collection reads the page's buttons and meta tags, a referrer's first name among them.
  fbq("set", "autoConfig", false, pixelId);
  fbq("init", pixelId);
  fbq("track", "PageView");
}

/** The address as the tags are told it: an invite's code taken out. */
function reportedAddress(address: string): string {
  return address.replace(INVITE_PATH_IN_URL, "/r/");
}

/**
 * Removes any query parameter that is not a campaign tag from the address, so
 * no tag reads a name or number someone put in a link. Runs before the tags load.
 */
function clearUnknownParameters(): void {
  const url = new URL(location.href);
  const unknown = [...url.searchParams.keys()].filter((key) => !kept(key));
  if (unknown.length === 0) return;
  for (const key of unknown) url.searchParams.delete(key);
  history.replaceState(history.state, "", url);
}

export function startAnalytics(): void {
  clearUnknownParameters();
  window.dataLayer ??= [];
  const ids = ANALYTICS_IDS[ENVIRONMENT];
  const googleTag = ids.ga4 ?? ids.googleAds?.id;
  if (googleTag !== undefined) {
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${googleTag}`);
    gtag("js", new Date());
  }
  gtag("set", { page_location: reportedAddress(location.href) });
  // Outside production, GA4 marks every hit as debug traffic.
  if (ids.ga4 !== null) gtag("config", ids.ga4, ENVIRONMENT === "production" ? {} : { debug_mode: true });
  if (ids.googleAds !== null) gtag("config", ids.googleAds.id);
  const onInvite = INVITE_PATH_IN_URL.test(location.pathname);
  if (ids.metaPixel !== null && !onInvite) startMetaPixel(ids.metaPixel);
}

export function track(event: AnalyticsEvent): void {
  const { name, ...parameters } = event;
  gtag("event", name, parameters);

  // A booking or a try-on claim is a lead: the conversion the ads are bought for.
  const lead = name === "lead_submitted" || name === "try_on_claimed";
  const ads = ANALYTICS_IDS[ENVIRONMENT].googleAds;
  if (lead && ads !== null) {
    const label = name === "try_on_claimed" ? ads.tryOnLabel : ads.bookingLabel;
    gtag("event", "conversion", { send_to: `${ads.id}/${label}` });
  }
  if (window.fbq !== undefined) {
    if (lead) window.fbq("track", "Lead", { content_name: name });
    window.fbq("trackCustom", name, parameters);
  }
}
