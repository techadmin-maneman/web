// mm-site is static assets, with one exception: the referral landing at /r/:code
// (docs/decisions/0027-referral-landing.md).
//
// WhatsApp's crawler runs no JavaScript, so the invite's preview has to be in the HTML it receives. This Worker
// serves the built page for every /r/:code and rewrites its Open Graph tags from the invite: the referrer's first
// name if they agreed to be named, and the card's versioned image, which is what makes a revoke reach new shares.
// It also writes the invite into the page, so the island shows it without a second request.
//
// When mm-api cannot say what the invite is, the page is served as built and the island asks for it itself: a
// failure is never shown as a code we do not know.
//
// Everything else falls through to the assets, as before.

import { inviteDescription, inviteTitle } from "./content/referral.ts";
import type { Invite } from "./lib/api.ts";
import { cardPath, HOUSE_CARD, isInvite } from "./lib/invite.ts";

export interface SiteEnv {
  readonly ASSETS: Fetcher;
  /** mm-api, bound directly: on staging its host is behind Access, which a request over the internet fails. */
  readonly API: Fetcher;
}

const CODE = /^\/r\/([A-Za-z0-9]{4,12})\/?$/;

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
    const property = element.getAttribute("property") ?? element.getAttribute("name");
    const name = this.invite?.referrer_first_name ?? null;
    const image = this.invite === null ? HOUSE_CARD : cardPath(this.invite, this.code);
    if (property === "og:title" || property === "twitter:title") element.setAttribute("content", inviteTitle(name));
    if (property === "og:description" || property === "twitter:description") {
      element.setAttribute("content", inviteDescription(this.invite));
    }
    if (property === "og:image" || property === "twitter:image") element.setAttribute("content", this.origin + image);
    if (property === "og:url") element.setAttribute("content", `${this.origin}/r/${this.code}`);
  }
}

/** The invite itself, for the island: written as JSON so the page needs no second request. */
class State {
  readonly json: string;

  constructor(json: string) {
    this.json = json;
  }

  element(element: Element): void {
    element.setAttribute("data-invite", this.json);
  }
}

export default {
  async fetch(request: Request, env: SiteEnv): Promise<Response> {
    const url = new URL(request.url);
    const code = CODE.exec(url.pathname)?.[1]?.toUpperCase();
    if (code === undefined) return env.ASSETS.fetch(request);

    // The built page is r.html, which the assets serve at /r (site/astro.config.ts builds files, not folders).
    const page = await env.ASSETS.fetch(new Request(`${url.origin}/r`, request));
    if (!page.ok || request.method !== "GET") return page;
    const invite = await lookUp(env, request, url.origin, code);

    const rewriter = new HTMLRewriter().on("meta", new Meta(invite, url.origin, code));
    if (invite !== null) rewriter.on("#invite", new State(JSON.stringify({ ...invite, code })));
    return rewriter.transform(new Response(page.body, page));
  },
} satisfies ExportedHandler<SiteEnv>;
