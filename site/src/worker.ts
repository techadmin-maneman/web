// mm-site is static assets, with a Worker in front of the pages that need a word from mm-api first
// (run_worker_first in site/wrangler.jsonc). Everything else falls through to the assets.
//
// Every page that shows a price, /, /book and /r/:code, has its figures written from the price book
// (docs/decisions/0073-prices-from-the-price-book.md). Each figure's element carries its sentence with holes,
// data-price="{firstFit}, then {service} a month", and the Worker fills it from the book; the structured data is
// built again from the same figures; and the book's answer goes onto <body> for the booking form's island, which
// draws its own. The answer is kept a minute. When mm-api has never answered, the page is served with the figures
// it was built with. A first fit's figure is the cheapest hair system ops offer in the console, which a page is built
// without.
//
// The referral landing at /r/:code (docs/decisions/0027-referral-landing.md). WhatsApp's crawler runs no
// JavaScript, so the invite's preview has to be in the HTML it receives. The Worker serves the built page for every
// code and rewrites its title, description and Open Graph tags from the invite: the referrer's first name if they
// agreed to be named, and the card's versioned image, which is what makes a revoke reach new shares. It also writes
// the invite into the page, so the island shows it without a second request. When mm-api cannot say what the invite
// is, the page is served as built and the island asks for it itself: a failure is never shown as a code we do not
// know. /r with no code goes to /book.
//
// What a referral earns, as ops set it (docs/decisions/0107-referral-rewards-in-the-console.md), is asked for and kept
// as the prices are, on the landing and on /book, which confirms a booking made with an invite. It goes onto <body>
// for the island, and the preview promises the friend's visits from it, only where there are any.
//
// The built films are given a byte range at a time, which the assets cannot do: iOS Safari plays a video only from a
// server that can.
//
// While the site gives no prices (PRICES_SHOWN), the Worker asks for no price book, and / is left to the assets.
// Every answer of mm-api's that cannot be used is one line in the Worker's log, and a failure is remembered for ten
// seconds, so a down mm-api is not asked again by every view.

import { inviteDescription, invitePageTitle, inviteTitle } from "./content/referral.ts";
import type { Invite, PublishedPrices, ReferralReward } from "./lib/api.ts";
import { partOf } from "./lib/byte-range.ts";
import { cardPath, HOUSE_CARD, isInvite } from "./lib/invite.ts";
import { fillPrices, isPublishedPrices, pricesOf, priceWords, type PriceWords } from "./lib/prices.ts";
import { isReferralReward } from "./lib/reward.ts";
import { PRICES_SHOWN } from "./lib/flags.ts";
import { faqPage, jsonLd, localBusiness } from "./lib/structured-data.ts";
import { INVITE_PATH } from "../../src/config/invite-codes.ts";

export interface SiteEnv {
  readonly ASSETS: Fetcher;
  /** mm-api, bound directly: on staging its host is behind Access, which a request over the internet fails. */
  readonly API: Fetcher;
}

/** The landing with no code, which has no invite to show: the booking page is the same page without one. */
const NO_CODE = /^\/r\/?$/;

/** A built film, /_astro/hero.<hash>.mp4. */
const FILM = /^\/_astro\/[^/]+\.mp4$/;

/** The pages besides the landing that show a price. */
const PRICED_PAGES = new Set(["/", "/book"]);

/** The page besides the landing that says what a referral earns. */
const REWARD_PAGE = "/book";

/** How long an answer of mm-api's is kept: the console's own minute (docs/decisions/0061-ops-editable-inputs.md). */
const KEPT_MS = 60_000;

/** How long a failure is remembered before mm-api is asked again. */
const FAILURE_KEPT_MS = 10_000;

/** What the Worker asks mm-api for, as its log line names it. */
type Asked = "invite" | "prices" | "reward";

/** One line in the Worker's log for an answer it cannot use, and null in its place. */
function failed(asked: Asked, status: number | null, reason: string): null {
  console.warn(JSON.stringify({ level: "warn", event: "mm_api_failed", worker: "mm-site", asked, status, reason }));
  return null;
}

/** mm-api's answer, or null when it is down, refuses, or answers a shape `is` does not accept. */
async function fetchJson<T>(
  env: SiteEnv,
  request: Request,
  asked: Asked,
  is: (body: unknown) => body is T,
): Promise<T | null> {
  try {
    const answer = await env.API.fetch(request);
    if (!answer.ok) return failed(asked, answer.status, "refused");
    const body: unknown = await answer.json();
    return is(body) ? body : failed(asked, answer.status, "unknown shape");
  } catch (error) {
    return failed(asked, null, error instanceof Error ? error.message : "unreachable");
  }
}

/** The invite, or null when mm-api could not say. */
async function lookUp(env: SiteEnv, visit: Request, origin: string, code: string): Promise<Invite | null> {
  // The visitor's user agent goes along, so mm-api does not count a link preview's fetch as an open; and their
  // address, which mm-api counts opens and misses by. A request through the binding carries only what is set here.
  const headers = new Headers();
  for (const name of ["User-Agent", "CF-Connecting-IP"]) {
    const value = visit.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return fetchJson(env, new Request(`${origin}/api/r/${code}`, { headers }), "invite", isInvite);
}

/** The price book's figures, or null when mm-api could not give them. */
const askForPrices = (env: SiteEnv, origin: string): Promise<PublishedPrices | null> =>
  fetchJson(env, new Request(`${origin}/api/published-prices`), "prices", isPublishedPrices);

/** What a referral earns, or null when mm-api could not say. */
const askForReward = (env: SiteEnv, origin: string): Promise<ReferralReward | null> =>
  fetchJson(env, new Request(`${origin}/api/referral-reward`), "reward", isReferralReward);

type Ask<T> = (env: SiteEnv, origin: string) => Promise<T | null>;

/**
 * An answer kept `keptMs` on `clock`, then asked again. While mm-api stops answering, the last good one, and mm-api
 * is asked again only once the failure is ten seconds old.
 */
function cachedFor<T>(keptMs: number, clock: () => number, ask: Ask<T>): Ask<T> {
  let kept: { value: T; at: number } | null = null;
  let failedAt: number | null = null;
  return async (env, origin) => {
    const now = clock();
    if (kept !== null && now - kept.at < keptMs) return kept.value;
    if (failedAt !== null && now - failedAt < FAILURE_KEPT_MS) return kept?.value ?? null;
    const value = await ask(env, origin);
    if (value === null) {
      failedAt = now;
      return kept?.value ?? null;
    }
    kept = { value, at: now };
    failedAt = null;
    return value;
  };
}

/**
 * The built file, asked for whole. A browser revalidating a rewritten page would otherwise be told "not modified"
 * by the file's own ETag, and keep the figures it was given last week.
 */
function builtFile(visit: Request, url: string): Request {
  const headers = new Headers(visit.headers);
  headers.delete("If-None-Match");
  headers.delete("If-Modified-Since");
  return new Request(url, { method: visit.method, headers });
}

/** The page to rewrite, carrying nothing a browser could revalidate it by: the file's ETag is not this page's. */
function withoutValidators(page: Response): Response {
  const response = new Response(page.body, page);
  response.headers.delete("ETag");
  response.headers.delete("Last-Modified");
  return response;
}

class Meta {
  readonly invite: Invite | null;
  readonly reward: ReferralReward | null;
  readonly origin: string;
  readonly code: string;

  constructor(invite: Invite | null, reward: ReferralReward | null, origin: string, code: string) {
    this.invite = invite;
    this.reward = reward;
    this.origin = origin;
    this.code = code;
  }

  element(element: Element): void {
    // The page's X card reads these Open Graph tags; it carries none of its own (site/src/layouts/Site.astro). The
    // card's type and size stay as the page was built with them: the house card and a referrer's own are both
    // 1200 x 630 JPEGs, so only its address changes, and it is absolute, on the host the link was opened on.
    const property = element.getAttribute("property");
    const name = this.invite?.referrer_first_name ?? null;
    const image = this.invite === null ? HOUSE_CARD : cardPath(this.invite, this.code);
    const description = inviteDescription(this.invite, this.reward);
    if (element.getAttribute("name") === "description") element.setAttribute("content", description);
    if (property === "og:title") element.setAttribute("content", inviteTitle(name));
    if (property === "og:description") element.setAttribute("content", description);
    if (property === "og:image" || property === "og:image:secure_url") {
      element.setAttribute("content", this.origin + image);
    }
    if (property === "og:url") element.setAttribute("content", `${this.origin}/r/${this.code}`);
  }
}

/** The landing's <title>, replaced whole. Not named `text`, which HTMLRewriter takes for a handler. */
class Retitled {
  readonly title: string;

  constructor(title: string) {
    this.title = title;
  }

  element(element: Element): void {
    element.setInnerContent(this.title);
  }
}

/** JSON for an island, written onto an element so the page needs no second request. */
class Written {
  readonly attribute: string;
  readonly json: string;

  constructor(attribute: string, json: string) {
    this.attribute = attribute;
    this.json = json;
  }

  element(element: Element): void {
    element.setAttribute(this.attribute, this.json);
  }
}

/** Each figure, its sentence filled from the book: data-price="{firstFit}, then {service} a month". */
class Figure {
  readonly words: PriceWords;

  constructor(words: PriceWords) {
    this.words = words;
  }

  element(element: Element): void {
    const sentence = element.getAttribute("data-price");
    if (sentence !== null) element.setInnerContent(fillPrices(sentence, this.words));
  }
}

/** A block of structured data, built again with the book's figures. */
class Structured {
  readonly json: string;

  constructor(data: object) {
    this.json = jsonLd(data);
  }

  element(element: Element): void {
    element.setInnerContent(this.json, { html: true });
  }
}

function writePrices(rewriter: HTMLRewriter, prices: PublishedPrices): void {
  const words = priceWords(pricesOf(prices));
  rewriter.on("[data-price]", new Figure(words));
  rewriter.on('script[data-structured="business"]', new Structured(localBusiness(words)));
  rewriter.on('script[data-structured="faq"]', new Structured(faqPage(words)));
  rewriter.on("body", new Written("data-prices", JSON.stringify(prices)));
}

export interface SiteWorkerOptions {
  /** What the book's answer and the reward are kept a minute on: a test gives it its own. */
  readonly clock?: () => number;
  /** Whether the site gives prices; a test of the dormant price pipeline switches them on. */
  readonly pricesShown?: boolean;
}

export function createSiteWorker({ clock = Date.now, pricesShown = PRICES_SHOWN }: SiteWorkerOptions = {}) {
  const publishedPrices = cachedFor(KEPT_MS, clock, askForPrices);
  const referralReward = cachedFor(KEPT_MS, clock, askForReward);

  return {
    async fetch(request: Request, env: SiteEnv): Promise<Response> {
      const url = new URL(request.url);
      if (FILM.test(url.pathname)) return partOf(request, await env.ASSETS.fetch(request));
      if (NO_CODE.test(url.pathname)) return Response.redirect(`${url.origin}/book${url.search}`, 301);

      const code = INVITE_PATH.exec(url.pathname)?.[1]?.toUpperCase();
      if (code === undefined && !PRICED_PAGES.has(url.pathname)) return env.ASSETS.fetch(request);

      // The landing is r.html for every code, which the assets serve at /r (site/astro.config.ts builds files).
      const path = code === undefined ? url.pathname : "/r";
      const page = await env.ASSETS.fetch(builtFile(request, `${url.origin}${path}`));
      if (!page.ok || request.method !== "GET") return page;

      const saysReward = code !== undefined || url.pathname === REWARD_PAGE;
      const [prices, invite, reward] = await Promise.all([
        pricesShown ? publishedPrices(env, url.origin) : null,
        code === undefined ? null : lookUp(env, request, url.origin, code),
        saysReward ? referralReward(env, url.origin) : null,
      ]);
      const rewriter = new HTMLRewriter();
      if (prices !== null) writePrices(rewriter, prices);
      if (reward !== null) rewriter.on("body", new Written("data-reward", JSON.stringify(reward)));
      if (code !== undefined) {
        rewriter.on("head > title", new Retitled(invitePageTitle(invite)));
        rewriter.on("meta", new Meta(invite, reward, url.origin, code));
        if (invite !== null) rewriter.on("#invite", new Written("data-invite", JSON.stringify({ ...invite, code })));
      }
      return rewriter.transform(withoutValidators(page));
    },
  } satisfies ExportedHandler<SiteEnv>;
}

export default createSiteWorker();
