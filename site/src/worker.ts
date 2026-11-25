// mm-site is static assets, with a Worker in front of the pages that need a word from mm-api first
// (run_worker_first in site/wrangler.jsonc). Everything else falls through to the assets.
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
// a minute, on the landing and on /book, which confirms a booking made with an invite. It goes onto <body>
// for the island, and the preview promises the friend's visits from it, only where there are any.
//
// The built films are given a byte range at a time, which the assets cannot do: iOS Safari plays a video only from a
// server that can.
//
// The home page, the Gurgaon page and /areas name the cities ops serve (GET /api/served-cities), kept a minute as the reward is, so a
// launch reaches the site without a rebuild; each sentence that names them is built naming none. A city's page,
// /areas/<city>, lists the areas served there, which it is built without.
//
// Every page goes through the Worker, which gives its content security policy a nonce of the request's own. Cloudflare
// reads it from the policy and puts it on any script it adds to the page at its edge, so one switched back on for the
// zone still runs (docs/decisions/0206-trusted-types-and-a-nonce-per-page.md).
//
// Every answer of mm-api's that cannot be used is one line in the Worker's log, and a failure is remembered for ten
// seconds, so a down mm-api is not asked again by every view. Anything else that goes wrong while a page is answered is
// one line in the log too, and reported as a page's own script error is, to mm-api, which takes it on to Sentry; the
// visitor is given the page as built where the assets can still give it. A throw while a page streams through its
// rewriter comes after the answer, and is not caught.

import { visitorCookieHeader, visitorIn } from "@rules/config/visitor-cookie.ts";
import { legalDays } from "./lib/legal-days.ts";
import { inviteDescription, invitePageTitle, inviteTitle } from "./content/referral.ts";
import type { Invite, ReferralReward } from "./lib/api.ts";
import { partOf } from "./lib/byte-range.ts";
import { citySlug, isServedCities, namingCities, type ServedCities } from "./lib/cities.ts";
import { cardPath, HOUSE_CARD, INVITE_PATH, INVITE_PATH_IN_URL, isInvite } from "./lib/invite.ts";
import { isReferralReward } from "./lib/reward.ts";

export interface SiteEnv {
  readonly ASSETS: Fetcher;
  /** mm-api, bound directly: on staging its host is behind Access, which a request over the internet fails. */
  readonly API: Fetcher;
}

/** The landing with no code, which has no invite to show: the booking page is the same page without one. */
const NO_CODE = /^\/r\/?$/;

/** A built film, /_astro/hero.<hash>.mp4. */
const FILM = /^\/_astro\/[^/]+\.mp4$/;

/** The pages that name the cities we come to. */
const CITY_PAGES = new Set(["/", "/gurgaon", "/areas"]);

/** A city's own page. */
const CITY_PAGE = /^\/areas\/[a-z0-9-]+$/;

/** The page besides the landing that says what a referral earns. */
const REWARD_PAGE = "/book";

/** A campaign link: a society activation's, /s/<slug>, or an offer's, /o/<slug> (docs/tracking.md). */
const CAMPAIGN_LINK = /^\/(s|o)\/([a-z0-9-]{1,40})\/?$/;

/** The terms, which state the fit guarantee in the days ops set (docs/decisions/0256-fit-guarantee-setting.md). */
const TERMS_PAGE = "/terms";

/** How long an answer of mm-api's is kept: the console's own minute (docs/decisions/0061-ops-editable-inputs.md). */
const KEPT_MS = 60_000;

/** How long a failure is remembered before mm-api is asked again. */
const FAILURE_KEPT_MS = 10_000;

/** What the Worker asks mm-api for, as its log line names it. */
type Asked = "invite" | "reward" | "cities" | "guarantee" | "link" | "pay link";

/** A page's policy with a nonce of this request's own for its scripts; anything but a page is passed on as it is. */
export function withNonce(answer: Response): Response {
  const policy = answer.headers.get("Content-Security-Policy");
  const page = (answer.headers.get("Content-Type") ?? "").startsWith("text/html");
  if (policy === null || !page || !/(^|; )script-src /.test(policy)) return answer;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const answered = new Response(answer.body, answer);
  answered.headers.set(
    "Content-Security-Policy",
    policy.replace(/(^|; )script-src /, `$1script-src 'nonce-${nonce}' `),
  );
  return answered;
}

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

/** What a referral earns, or null when mm-api could not say. */
const askForReward = (env: SiteEnv, origin: string): Promise<ReferralReward | null> =>
  fetchJson(env, new Request(`${origin}/api/referral-reward`), "reward", isReferralReward);

/** The cities ops serve, or null when mm-api could not say. */
const askForCities = (env: SiteEnv, origin: string): Promise<ServedCities | null> =>
  fetchJson(env, new Request(`${origin}/api/served-cities`), "cities", isServedCities);

const isFitGuarantee = (body: unknown): body is { readonly days: number } =>
  typeof body === "object" && body !== null && "days" in body && Number.isInteger(body.days);

/** How long the fit guarantee runs, or null when mm-api could not say. */
const askForGuarantee = (env: SiteEnv, origin: string): Promise<{ readonly days: number } | null> =>
  fetchJson(env, new Request(`${origin}/api/fit-guarantee`), "guarantee", isFitGuarantee);

const isLanding = (body: unknown): body is { readonly landing: string } =>
  typeof body === "object" &&
  body !== null &&
  "landing" in body &&
  typeof body.landing === "string" &&
  body.landing.startsWith("/book?");

/** maneman.in/pay/<token>: a payment link's WhatsApp button (docs/decisions/0300-payment-links-on-whatsapp.md). */
const PAY_LINK = /^\/pay\/([A-Za-z0-9_-]{22})\/?$/;

/** Razorpay's own hosts: the only places a payment link's button sends anyone on to. */
const RAZORPAY = /^https:\/\/(?:rzp\.io|(?:[a-z0-9-]+\.)?razorpay\.com)\//;

const isOpenPayLink = (body: unknown): body is { readonly url: string } =>
  typeof body === "object" && body !== null && "url" in body && typeof body.url === "string" && RAZORPAY.test(body.url);

/** A payment link's pages of our own: it has closed, or it could not be looked up just now. Never the token. */
const PAY_CLOSED = "/pay";
const PAY_AGAIN = "/pay-again";

/**
 * On to Razorpay's link while it is open. Otherwise to a page of ours by an address without the token, so no page's
 * tags, history or report ever holds it: that the link has closed where mm-api says it is not open (404, or 429 for an
 * address past its misses), else that it could not be opened just now, since it may still be. The visitor's address
 * goes along, as an invite's does, since mm-api counts tokens that are not open against it.
 */
async function payLink(env: SiteEnv, visit: Request, origin: string, token: string): Promise<Response> {
  const headers = new Headers();
  const address = visit.headers.get("CF-Connecting-IP");
  if (address !== null) headers.set("CF-Connecting-IP", address);
  try {
    const answer = await env.API.fetch(new Request(`${origin}/api/pay/${token}`, { headers }));
    if (answer.status === 404 || answer.status === 429) return Response.redirect(`${origin}${PAY_CLOSED}`, 302);
    const body: unknown = answer.ok ? await answer.json() : null;
    if (isOpenPayLink(body)) return Response.redirect(body.url, 302);
    failed("pay link", answer.status, answer.ok ? "unknown shape" : "refused");
  } catch (error) {
    failed("pay link", null, error instanceof Error ? error.message : "unreachable");
  }
  return Response.redirect(`${origin}${PAY_AGAIN}`, 302);
}

/** A path as a failure's report names it: an invite's without its code, a payment link's without its token. */
const withoutKeys = (path: string): string =>
  PAY_LINK.test(path) ? PAY_CLOSED : path.replace(INVITE_PATH_IN_URL, "/r/");

/**
 * Where a campaign link sends the visitor: /book with its tags and code, or plain /book for a link that is retired, is
 * not ours, or that mm-api cannot say of; with whatever else the link was opened with, an ad's click IDs above all,
 * the link's own tags and code winning where both name one. Never kept: a link retired takes effect at once.
 */
async function campaignLanding(env: SiteEnv, opened: URL, kind: string, slug: string): Promise<string> {
  const found = await fetchJson(env, new Request(`${opened.origin}/api/links/${kind}/${slug}`), "link", isLanding);
  const landing = new URL(found?.landing ?? "/book", opened.origin);
  for (const [key, value] of opened.searchParams) {
    if (!landing.searchParams.has(key)) landing.searchParams.append(key, value);
  }
  return landing.toString();
}

/** A page given its visitor cookie where the browser has none: a page, not a redirect, a film or a file. */
function withVisitor(request: Request, page: Response): Response {
  const host = new URL(request.url).host;
  const html = (page.headers.get("Content-Type") ?? "").startsWith("text/html");
  if (!html || visitorIn(host, request.headers.get("Cookie")) !== null) return page;
  const given = new Response(page.body, page);
  given.headers.append("Set-Cookie", visitorCookieHeader(host, crypto.randomUUID()));
  return given;
}

/** The words an element holds, put in place of the ones it was built with. */
class Filled {
  readonly words: string;

  constructor(words: string) {
    this.words = words;
  }

  element(element: Element): void {
    element.setInnerContent(this.words);
  }
}

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
 * by the file's own ETag, and keep the invite or the cities it was given last week.
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
    if (property === "og:title") element.setAttribute("content", inviteTitle(name, this.invite?.partner ?? null));
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

/** A sentence that names the cities we come to, written from its data-cities over the one it was built with. */
class CitiesNamed {
  private readonly cities: readonly string[];

  constructor(cities: readonly string[]) {
    this.cities = cities;
  }

  element(element: Element): void {
    const sentence = element.getAttribute("data-cities");
    if (sentence !== null) element.setInnerContent(namingCities(sentence, this.cities));
  }
}

/** Text written into a page as HTML, which no area's name can break out of. */
const escaped = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => `&#${String(character.charCodeAt(0))};`);

/**
 * A city's areas, on its page: the list its data-areas-of names filled, and its section, built hidden, shown. A city
 * with none served keeps both as built.
 */
class AreasListed {
  private readonly areas: Readonly<Record<string, readonly string[]>>;

  constructor(areas: Readonly<Record<string, readonly string[]>>) {
    this.areas = areas;
  }

  private of(city: string | null): readonly string[] {
    return city === null ? [] : (this.areas[city] ?? []);
  }

  element(element: Element): void {
    const section = element.getAttribute("data-city-areas");
    if (section !== null) {
      if (this.of(section).length > 0) element.removeAttribute("hidden");
      return;
    }
    // A post office named for the city itself says nothing the page has not.
    const city = element.getAttribute("data-areas-of");
    const areas = this.of(city).filter((area) => area !== city);
    if (areas.length > 0) {
      element.setInnerContent(areas.map((area) => `<li>${escaped(area)}</li>`).join(""), { html: true });
    }
  }
}

/** A city's link, in a list of the cities we come to: left out while no pincode there is served. */
class UnservedLeftOut {
  private readonly served: ReadonlySet<string>;

  constructor(cities: readonly string[]) {
    this.served = new Set(cities);
  }

  element(element: Element): void {
    const city = element.getAttribute("data-city");
    if (city !== null && !this.served.has(city)) element.remove();
  }
}

/** Whether a city's page, by its address, is one of a city with a pincode served. */
const isServedPage = (pathname: string, cities: readonly string[]): boolean =>
  cities.some((city) => pathname === `/areas/${citySlug(city)}`);

/** The longest of each part of a report mm-api takes (src/routes/client-errors.ts). */
const LONGEST = { message: 500, path: 300, stack: 4000 } as const;

/** What a report from the Worker names as where it was thrown, apart from a page's own scripts. */
const WORKER_SOURCE = "mm-site Worker";

/**
 * Something the Worker did not expect: one line in its log, and a report to mm-api as a page's own script error is
 * (packages/web-kit/client-errors.ts), sent after the answer. An invite's code is a person's own, so its landing is
 * named without it. A report that cannot be sent is nobody's concern.
 */
function reportFailure(request: Request, env: SiteEnv, ctx: ExecutionContext | undefined, thrown: unknown): void {
  const url = new URL(request.url);
  const path = withoutKeys(url.pathname);
  const message = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
  const stack = thrown instanceof Error ? thrown.stack : undefined;
  // On the Worker's one console channel, as mm_api_failed is; the line's own level says what it is.
  console.warn(JSON.stringify({ level: "error", event: "site_page_failed", worker: "mm-site", path, message }));
  const report = {
    kind: "error",
    message: message.slice(0, LONGEST.message),
    path: path.slice(0, LONGEST.path),
    source: WORKER_SOURCE,
    ...(stack === undefined ? {} : { stack: stack.slice(0, LONGEST.stack) }),
  };
  const sending = env.API.fetch(
    new Request(`${url.origin}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    }),
  ).catch(() => undefined);
  ctx?.waitUntil(sending);
}

/** The page as built, as the Worker serves it while mm-api cannot say: an invite's landing for its code. */
function asBuilt(request: Request, env: SiteEnv): Promise<Response> {
  const url = new URL(request.url);
  // A payment link the Worker failed on may still be open: never told it has closed.
  if (PAY_LINK.test(url.pathname)) return Promise.resolve(Response.redirect(`${url.origin}${PAY_AGAIN}`, 302));
  const path = INVITE_PATH.test(url.pathname) ? "/r" : url.pathname;
  return env.ASSETS.fetch(builtFile(request, `${url.origin}${path}`));
}

export interface SiteWorkerOptions {
  /** What the reward and the cities are kept a minute on: a test gives it its own. */
  readonly clock?: () => number;
}

export function createSiteWorker({ clock = Date.now }: SiteWorkerOptions = {}) {
  const referralReward = cachedFor(KEPT_MS, clock, askForReward);
  const servedCities = cachedFor(KEPT_MS, clock, askForCities);
  const fitGuarantee = cachedFor(KEPT_MS, clock, askForGuarantee);

  /** A page, as the Worker answers it when nothing goes wrong. */
  async function answer(request: Request, env: SiteEnv): Promise<Response> {
    const url = new URL(request.url);
    if (FILM.test(url.pathname)) return partOf(request, await env.ASSETS.fetch(request));
    if (NO_CODE.test(url.pathname)) return Response.redirect(`${url.origin}/book${url.search}`, 301);
    const token = PAY_LINK.exec(url.pathname)?.[1];
    if (token !== undefined) return payLink(env, request, url.origin, token);
    const link = CAMPAIGN_LINK.exec(url.pathname);
    if (link !== null) {
      const [, kind = "", slug = ""] = link;
      return Response.redirect(await campaignLanding(env, url, kind, slug), 302);
    }
    if (url.pathname === TERMS_PAGE && request.method === "GET") {
      // The terms as built say the days the guarantee began with; while mm-api cannot say, they stand. Either way the
      // page goes without its validators, so a browser never keeps a figure ops have changed since.
      const [page, guarantee] = await Promise.all([
        env.ASSETS.fetch(builtFile(request, `${url.origin}${TERMS_PAGE}`)),
        fitGuarantee(env, url.origin),
      ]);
      if (!page.ok) return withNonce(page);
      if (guarantee === null) return withNonce(withoutValidators(page));
      const filled = new HTMLRewriter().on("[data-guarantee-days]", new Filled(legalDays(guarantee.days)));
      return withNonce(filled.transform(withoutValidators(page)));
    }

    const code = INVITE_PATH.exec(url.pathname)?.[1]?.toUpperCase();
    const cityPage = CITY_PAGE.test(url.pathname);
    const namesCities = CITY_PAGES.has(url.pathname) || cityPage;
    const saysReward = code !== undefined || url.pathname === REWARD_PAGE;
    if (!saysReward && !namesCities) return withNonce(await env.ASSETS.fetch(request));

    // The landing is r.html for every code, which the assets serve at /r (site/astro.config.ts builds files).
    const path = code === undefined ? url.pathname : "/r";
    const page = await env.ASSETS.fetch(builtFile(request, `${url.origin}${path}`));
    if (!page.ok || request.method !== "GET") return withNonce(page);

    const [invite, reward, cities] = await Promise.all([
      code === undefined ? null : lookUp(env, request, url.origin, code),
      saysReward ? referralReward(env, url.origin) : null,
      namesCities ? servedCities(env, url.origin) : null,
    ]);
    // A city's page says a technician comes there: never of a city with no pincode served.
    if (cityPage && cities !== null && cities.cities.length > 0 && !isServedPage(url.pathname, cities.cities)) {
      return Response.redirect(`${url.origin}/areas`, 302);
    }
    const rewriter = new HTMLRewriter();
    if (cities !== null && cities.cities.length > 0) {
      rewriter.on("[data-cities]", new CitiesNamed(cities.cities));
      rewriter.on("[data-city]", new UnservedLeftOut(cities.cities));
    }
    if (cityPage && cities?.areas !== undefined) {
      rewriter.on("[data-city-areas], [data-areas-of]", new AreasListed(cities.areas));
    }
    if (reward !== null) rewriter.on("body", new Written("data-reward", JSON.stringify(reward)));
    if (code !== undefined) {
      rewriter.on("head > title", new Retitled(invitePageTitle(invite)));
      rewriter.on("meta", new Meta(invite, reward, url.origin, code));
      if (invite !== null) rewriter.on("#invite", new Written("data-invite", JSON.stringify({ ...invite, code })));
    }
    return withNonce(rewriter.transform(withoutValidators(page)));
  }

  return {
    async fetch(request: Request, env: SiteEnv, ctx?: ExecutionContext): Promise<Response> {
      try {
        return withVisitor(request, await answer(request, env));
      } catch (thrown) {
        reportFailure(request, env, ctx, thrown);
        return withVisitor(request, withNonce(await asBuilt(request, env)));
      }
    },
  } satisfies ExportedHandler<SiteEnv>;
}

export default createSiteWorker();
