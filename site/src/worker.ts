// mm-site is static assets, with one exception: the referral landing at /r/:code
// (docs/decisions/0027-referral-landing.md).
//
// WhatsApp's crawler runs no JavaScript, so the invite's preview has to be in the HTML it receives. This Worker
// serves the built page for every /r/:code and rewrites its Open Graph tags from the invite: the referrer's first
// name if they agreed to be named, and the card's versioned image, which is what makes a revoke reach new shares.
// It also writes the invite into the page, so the island shows it without a second request.
//
// Everything else falls through to the assets, as before.

interface SiteEnv {
  readonly ASSETS: Fetcher;
  /** mm-api, bound directly: on staging its host is behind Access, which a request over the internet fails. */
  readonly API: Fetcher;
}

interface Invite {
  state: "valid" | "unknown";
  referrer_first_name: string | null;
  card: { state: "house" | "personal"; version: number };
}

const CODE = /^\/r\/([A-Za-z0-9]{4,12})\/?$/;
const HOUSE_CARD = "/images/invite-house.jpg";

/** What the preview says, in the design's words (Referral and Waitlist, B1 and B2). */
const TITLE = (name: string | null) =>
  name === null ? "You have a Mane Man invite" : `${name} sent you a Mane Man invite`;
const DESCRIPTION = "Home-fitted hair systems in Gurgaon. 3 service visits free when you're fitted.";

class Meta {
  readonly invite: Invite;
  readonly origin: string;
  readonly code: string;

  constructor(invite: Invite, origin: string, code: string) {
    this.invite = invite;
    this.origin = origin;
    this.code = code;
  }

  element(element: Element): void {
    const property = element.getAttribute("property") ?? element.getAttribute("name");
    const card = this.invite.card;
    const image =
      card.state === "personal"
        ? `${this.origin}/api/og/${this.code}.jpg?v=${String(card.version)}`
        : `${this.origin}${HOUSE_CARD}`;
    if (property === "og:title" || property === "twitter:title") {
      element.setAttribute("content", TITLE(this.invite.referrer_first_name));
    }
    if (property === "og:description" || property === "twitter:description") {
      element.setAttribute("content", DESCRIPTION);
    }
    if (property === "og:image" || property === "twitter:image") element.setAttribute("content", image);
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
    const answer = await env.API.fetch(new Request(`${url.origin}/api/r/${code}`));
    const invite: Invite = answer.ok
      ? await answer.json()
      : { state: "unknown", referrer_first_name: null, card: { state: "house", version: 1 } };

    return new HTMLRewriter()
      .on("meta", new Meta(invite, url.origin, code))
      .on("#invite", new State(JSON.stringify({ ...invite, code })))
      .transform(new Response(page.body, page));
  },
} satisfies ExportedHandler<SiteEnv>;
