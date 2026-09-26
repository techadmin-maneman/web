// mm-site is static assets, with a Worker in front of the pages that need a word from mm-api first
// (run_worker_first in site/wrangler.jsonc). Everything else falls through to the assets.
//
// Every page that shows a price, /, /book and /r/:code, has its figures written from the price book
// (docs/decisions/0073-prices-from-the-price-book.md). Each figure's element carries its sentence with holes,
// data-price="{firstFit}, then {service} a month", and the Worker fills it from the book; the structured data is
// built again from the same figures; and the book's answer goes onto <body> for the booking form's island, which
// draws its own. The answer is kept a minute. When mm-api has never answered, the page is served with the figures
// it was built with.
//
// The referral landing at /r/:code (docs/decisions/0027-referral-landing.md). WhatsApp's crawler runs no
// JavaScript, so the invite's preview has to be in the HTML it receives. The Worker serves the built page for every
// code and rewrites its Open Graph tags from the invite: the referrer's first name if they agreed to be named, and
// the card's versioned image, which is what makes a revoke reach new shares. It also writes the invite into the
// page, so the island shows it without a second request. When mm-api cannot say what the invite is, the page is
// served as built and the island asks for it itself: a failure is never shown as a code we do not know.

import { inviteDescription, inviteTitle } from "./content/referral.ts";
import type { Invite, PublishedPrices } from "./lib/api.ts";
import { cardPath, HOUSE_CARD, isInvite } from "./lib/invite.ts";
import { isPublishedPrices, priceWords, standardOf, type PriceWords } from "./lib/prices.ts";
import { faqPage, jsonLd, localBusiness } from "./lib/structured-data.ts";
import { fill } from "./lib/text.ts";

export interface SiteEnv {
  readonly ASSETS: Fetcher;
  /** mm-api, bound directly: on staging its host is behind Access, which a request over the internet fails. */
  readonly API: Fetcher;
}

const CODE = /^\/r\/([A-Za-z0-9]{4,12})\/?$/;

/** The pages besides the landing that show a price. */
const PRICED_PAGES = new Set(["/", "/book"]);

/** How long the book's answer is kept: the console's own minute (docs/decisions/0061-ops-editable-inputs.md). */
const PRICES_KEPT_MS = 60_000;

/** The invite, or null when mm-api could not say: down, refusing, or answering a shape we do not know. */
async function lookUp(env: SiteEnv, visit: Request, origin: string, code: string): Promise<Invite | null> {
  // The visitor's user agent goes along, so mm-api does not count a link preview's fetch as an open.
  const headers = new Headers();
  const agent = visit.headers.get("User-Agent");
  if (agent !== null) headers.set("User-Agent", agent);
  try {
    const answer = await env.API.fetch(new Request(`${origin}/api/r/${code}`, { headers }));
    if (!answer.ok) return null;
    const body: unknown = await answer.json();
    return isInvite(body) ? body : null;
  } catch {
    return null;
  }
}

/** The price book's figures, or null when mm-api could not give them. */
async function askForPrices(env: SiteEnv, origin: string): Promise<PublishedPrices | null> {
  try {
    const answer = await env.API.fetch(new Request(`${origin}/api/published-prices`));
    if (!answer.ok) return null;
    const body: unknown = await answer.json();
    return isPublishedPrices(body) ? body : null;
  } catch {
    return null;
  }
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
  readonly origin: string;
  readonly code: string;

  constructor(invite: Invite | null, origin: string, code: string) {
    this.invite = invite;
    this.origin = origin;
    this.code = code;
  }

  element(element: Element): void {
    // The page's X card reads these Open Graph tags; it carries none of its own (site/src/layouts/Site.astro).
    const property = element.getAttribute("property");
    const name = this.invite?.referrer_first_name ?? null;
    const image = this.invite === null ? HOUSE_CARD : cardPath(this.invite, this.code);
    if (property === "og:title") element.setAttribute("content", inviteTitle(name));
    if (property === "og:description") element.setAttribute("content", inviteDescription(this.invite));
    if (property === "og:image") element.setAttribute("content", this.origin + image);
    if (property === "og:url") element.setAttribute("content", `${this.origin}/r/${this.code}`);
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
    if (sentence !== null) element.setInnerContent(fill(sentence, this.words));
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
  const words = priceWords(standardOf(prices));
  rewriter.on("[data-price]", new Figure(words));
  rewriter.on('script[data-structured="business"]', new Structured(localBusiness(words)));
  rewriter.on('script[data-structured="faq"]', new Structured(faqPage(words)));
  rewriter.on("body", new Written("data-prices", JSON.stringify(prices)));
}

/** The Worker, keeping the book's answer for a minute on `clock`: a test gives it its own. */
export function createSiteWorker(clock: () => number = Date.now) {
  let kept: { prices: PublishedPrices; at: number } | null = null;

  /** The book's figures: kept a minute, then asked again; the last good answer if mm-api stops answering. */
  async function publishedPrices(env: SiteEnv, origin: string): Promise<PublishedPrices | null> {
    const now = clock();
    if (kept !== null && now - kept.at < PRICES_KEPT_MS) return kept.prices;
    const prices = await askForPrices(env, origin);
    if (prices === null) return kept?.prices ?? null;
    kept = { prices, at: now };
    return prices;
  }

  return {
    async fetch(request: Request, env: SiteEnv): Promise<Response> {
      const url = new URL(request.url);
      const code = CODE.exec(url.pathname)?.[1]?.toUpperCase();
      if (code === undefined && !PRICED_PAGES.has(url.pathname)) return env.ASSETS.fetch(request);

      // The landing is r.html for every code, which the assets serve at /r (site/astro.config.ts builds files).
      const path = code === undefined ? url.pathname : "/r";
      const page = await env.ASSETS.fetch(builtFile(request, `${url.origin}${path}`));
      if (!page.ok || request.method !== "GET") return page;

      const [prices, invite] = await Promise.all([
        publishedPrices(env, url.origin),
        code === undefined ? null : lookUp(env, request, url.origin, code),
      ]);
      const rewriter = new HTMLRewriter();
      if (prices !== null) writePrices(rewriter, prices);
      if (code !== undefined) {
        rewriter.on("meta", new Meta(invite, url.origin, code));
        if (invite !== null) rewriter.on("#invite", new Written("data-invite", JSON.stringify({ ...invite, code })));
      }
      return rewriter.transform(withoutValidators(page));
    },
  } satisfies ExportedHandler<SiteEnv>;
}

export default createSiteWorker();
