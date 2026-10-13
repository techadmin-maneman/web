// The site's analytics: GA4, the Google Ads conversion tag and the Meta Pixel,
// each loaded only when its ID is set for this environment (analytics-ids.ts).
//
// Every event goes onto GA's dataLayer queue whether or not a tag is loaded,
// so the browser tests can read exactly what would be sent. No event carries a
// name, a number or an image: the types below allow nothing else.
//
// The referral landing's address holds a person's invite code, so no tag reads
// it: Google's tags are given the address without the code, and the Meta Pixel,
// which reports the address as it stands, is not loaded there. No tag is given
// an address's fragment, where /stop keeps its token, and none loads on /stop.
//
// What a booking says of the person, how far their hair loss has gone and the
// area they live in, reaches no tag: each event goes without them.
//
// Google's tags start with every kind of consent denied, so they set no cookie,
// and the Meta Pixel loads only once the visitor has agreed (CONSENT_KEY).

import type { LossExtent } from "@rules/config/booking.ts";
import type { BookingWindow } from "@rules/config/scheduling.ts";
import { ANALYTICS_IDS } from "./analytics-ids.ts";
import { ENVIRONMENT } from "./build.ts";
import { INVITE_PATH_IN_URL } from "./invite.ts";

/** Which booking page: the site's own /book, or a friend's invite at /r/:code. */
type BookingPage = "book" | "invite";

type AnalyticsEvent =
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

/** The address as the tags are told it: its fragment and an invite's code taken out. */
function reportedAddress(address: string): string {
  return (address.split("#")[0] ?? "").replace(INVITE_PATH_IN_URL, "/r/");
}

/** Where the visitor's answer to the site's ad and measurement cookies is kept, "granted" once they agree. */
const CONSENT_KEY = "mm-ad-consent";

/** The visitor's answer to the ad tags: granted, denied, or null while they have not answered. */
export function consentAnswer(): "granted" | "denied" | null {
  try {
    const kept = localStorage.getItem(CONSENT_KEY);
    return kept === "granted" || kept === "denied" ? kept : null;
  } catch {
    // Storage refused, as in a private window: no answer kept.
    return null;
  }
}

const consented = (): boolean => consentAnswer() === "granted";

/**
 * The visitor's answer, kept, and the tags told: Google's consent updated, and the Meta Pixel started once they agree.
 * Nothing is kept where storage is refused, and the bar asks again on the next page.
 */
export function answerConsent(answer: "granted" | "denied"): void {
  try {
    localStorage.setItem(CONSENT_KEY, answer);
  } catch {
    // Not kept; the tags are told for this page alone.
  }
  gtag("consent", "update", {
    ad_storage: answer,
    ad_user_data: answer,
    ad_personalization: answer,
    analytics_storage: answer,
  });
  const ids = ANALYTICS_IDS[ENVIRONMENT];
  const onInvite = INVITE_PATH_IN_URL.test(location.pathname);
  if (answer === "granted" && ids.metaPixel !== null && !onInvite && window.fbq === undefined) {
    startMetaPixel(ids.metaPixel);
  }
}

/** The page whose address carries the token that stops a person's messages. */
const STOP_PATH = "/stop";

/** What a booking event says of the person, which no tag is given. */
const PERSONAL_PARAMETERS = new Set(["area", "loss_extent"]);

const withoutPersonal = (parameters: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(parameters).filter(([key]) => !PERSONAL_PARAMETERS.has(key)));

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
  if (location.pathname === STOP_PATH) return;
  const ids = ANALYTICS_IDS[ENVIRONMENT];
  const agreed = consented() ? "granted" : "denied";
  gtag("consent", "default", {
    ad_storage: agreed,
    ad_user_data: agreed,
    ad_personalization: agreed,
    analytics_storage: agreed,
  });
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
  if (ids.metaPixel !== null && !onInvite && agreed === "granted") startMetaPixel(ids.metaPixel);
}

export function track(event: AnalyticsEvent): void {
  const { name, ...all } = event;
  const parameters = withoutPersonal(all);
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
