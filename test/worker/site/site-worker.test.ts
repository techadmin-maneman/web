// The mm-site Worker (site/src/worker.ts): in front of /r/:code, what the preview says for each invite and the page
// it serves when mm-api cannot answer (docs/decisions/0027-referral-landing.md); and on every page that shows a
// price, the price book's figures written over the ones the page was built with
// (docs/decisions/0073-prices-from-the-price-book.md), a first fit's only from the hair systems ops offer; and the
// built films, given a byte range at a time.

import { afterEach, describe, expect, it, vi } from "vitest";
import { HOUSE_CARD } from "../../../src/config/house-card.ts";
import { createSiteWorker, type SiteEnv } from "../../../site/src/worker.ts";
import {
  VALID,
  PRICES,
  type Api,
  isPriceRequest,
  isRewardRequest,
  REWARD,
  withPrices,
  withReward,
  siteEnv,
  logged,
  readPriced,
} from "./site-worker-fixtures.ts";

const UNKNOWN = { state: "unknown", referrer_first_name: null, card: { state: "house", version: 1 } };

async function open(api: Api, headers: HeadersInit = {}, origin = "https://maneman.in", worker = createSiteWorker()) {
  const { env, asked } = siteEnv(api);
  const response = await worker.fetch(new Request(`${origin}/r/RM4K7P`, { headers }), env);
  const html = await response.text();
  const meta = (property: string) =>
    new RegExp(`<meta property="${property}" content="([^"]*)"`).exec(html)?.[1] ?? "(missing)";
  const invite = /data-invite="([^"]*)"/.exec(html)?.[1]?.replaceAll("&quot;", '"') ?? "(missing)";
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "(missing)";
  const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "(missing)";
  return { response, html, meta, invite, title, description, asked };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the site Worker at /r/:code", () => {
  it("names the referrer and promises the visits for a valid invite", async () => {
    const page = await open(withReward());
    expect(page.meta("og:title")).toBe("Rohit sent you a Mane Man invite");
    expect(page.meta("og:description")).toContain("3 service visits free");
    expect(page.meta("og:image")).toBe("https://maneman.in/api/og/RM4K7P.jpg?v=3");
    expect(JSON.parse(page.invite)).toEqual({ ...VALID, code: "RM4K7P" });
  });

  // Ops set what each side gets (docs/decisions/0107-referral-rewards-in-the-console.md).
  it("promises the friend the visits ops set, and none where ops set the friend none", async () => {
    const unequal = await open(withReward(undefined, { referrer_visits: 3, friend_visits: 2, valid_days: 90 }));
    expect(unequal.meta("og:description")).toContain("2 service visits free");
    const none = await open(withReward(undefined, { referrer_visits: 3, friend_visits: 0, valid_days: 90 }));
    expect(none.meta("og:description")).not.toContain("service visit");
  });

  it.each([
    ["answers 503", () => Response.json({ error: { code: "unavailable" } }, { status: 503 })],
    ["answers a shape it does not know", () => Response.json({ referrer_visits: 3, friend_visits: "3" })],
  ])("promises no count when mm-api %s for the reward", async (_, failed: Api) => {
    const page = await open((request) => (isRewardRequest(request) ? failed(request) : Response.json(VALID)));
    expect(page.meta("og:description")).not.toContain("service visit");
    expect(page.html).not.toContain("data-reward");
  });

  it("gives the landing's island what a referral earns, and asks for it once a minute", async () => {
    let now = 0;
    const worker = createSiteWorker({ clock: () => now });
    const visit = async () => {
      const { env, asked } = siteEnv(withReward());
      const html = await (await worker.fetch(new Request("https://maneman.in/r/RM4K7P"), env)).text();
      const written = /data-reward="([^"]*)"/.exec(html)?.[1]?.replaceAll("&quot;", '"');
      return { written: written === undefined ? null : (JSON.parse(written) as unknown), asked };
    };
    const first = await visit();
    expect(first.written).toEqual(REWARD);
    expect(first.asked.filter(isRewardRequest)).toHaveLength(1);
    now = 59_000;
    expect((await visit()).asked.filter(isRewardRequest)).toHaveLength(0);
    now = 61_000;
    expect((await visit()).asked.filter(isRewardRequest)).toHaveLength(1);
  });

  // The tab and search results read "You have a Mane Man invite" whatever the invite.
  it("titles and describes the page as its preview, by the referrer's name", async () => {
    const page = await open(withReward());
    expect(page.title).toBe("Rohit sent you a Mane Man invite");
    expect(page.description).toBe(page.meta("og:description"));
    expect(page.description).toContain("3 service visits free");
  });

  // A code we do not know is headed as /book is, so its tab does not say there is an invite.
  it("titles a code we do not know as the booking page", async () => {
    const page = await open(() => Response.json(UNKNOWN));
    expect(page.title).toBe("Book a free consultation — Mane Man");
    expect(page.description).not.toContain("service visits");
  });

  it("leaves the page's own title when mm-api cannot say what the invite is, and logs why, without the code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const page = await open(() => Response.json({ error: { code: "unavailable" } }, { status: 503 }));
    expect(page.title).toBe("You have a Mane Man invite");
    expect(logged(warn)).toContainEqual(
      expect.objectContaining({ event: "mm_api_failed", asked: "invite", status: 503 }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("RM4K7P");
  });

  // /r with no code answered 200 with a form that would post to /api/r//consultation.
  it.each(["/r", "/r/"])("sends %s, which has no code, to /book", async (path) => {
    const { env, asked, files } = siteEnv(withReward());
    const response = await createSiteWorker().fetch(new Request(`https://maneman.in${path}?utm_source=wa`), env);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://maneman.in/book?utm_source=wa");
    expect(asked).toEqual([]);
    expect(files).toEqual([]);
  });

  // REQ-S8-01: a code the API does not know books without credits, so its preview must not promise them.
  it("promises no visits for an invite that is not valid, and versions the house card", async () => {
    const page = await open(() => Response.json(UNKNOWN));
    expect(page.meta("og:title")).toBe("You have a Mane Man invite");
    expect(page.meta("og:description")).not.toContain("service visits");
    expect(page.meta("og:image")).toMatch(/^https:\/\/maneman\.in\/images\/invite-house\.jpg\?v=\d+$/);
  });

  // WhatsApp draws a preview only from an image it can fetch by its full address, and an invite opened on staging is
  // staging's: the card is on the host the link was opened on, and keeps the type and size the page was built with.
  it.each([
    ["https://maneman.in", VALID, "/api/og/RM4K7P.jpg?v=3"],
    ["https://staging.maneman.in", VALID, "/api/og/RM4K7P.jpg?v=3"],
    ["https://staging.maneman.in", UNKNOWN, HOUSE_CARD],
  ])("on %s, names the card by its absolute address, and keeps its type and size", async (origin, invite, card) => {
    const page = await open(() => Response.json(invite), {}, origin);
    expect(page.meta("og:image")).toBe(`${origin}${card}`);
    expect(page.meta("og:image:secure_url")).toBe(`${origin}${card}`);
    expect(page.meta("og:image:type")).toBe("image/jpeg");
    expect(page.meta("og:image:width")).toBe("1200");
    expect(page.meta("og:image:height")).toBe("630");
    expect(page.meta("og:url")).toBe(`${origin}/r/RM4K7P`);
  });

  // A failure is not an unknown code. The page is served as built and the island asks again.
  it.each([
    ["answers 503", () => Response.json({ error: { code: "unavailable" } }, { status: 503 })],
    ["refuses an address past its misses", () => Response.json({ error: { code: "rate_limited" } }, { status: 429 })],
    [
      "throws",
      () => {
        throw new Error("mm-api is down");
      },
    ],
    ["answers a shape it does not know", () => Response.json({ state: "valid" })],
    ["answers something that is not JSON", () => new Response("<html>oops</html>")],
  ])("leaves the invite for the page to fetch when mm-api %s", async (_, api: Api) => {
    const page = await open(api);
    expect(page.response.status).toBe(200);
    expect(page.html).toContain("<p>The landing</p>");
    expect(page.invite).toBe("");
    expect(page.meta("og:description")).not.toContain("service visits");
    expect(page.meta("og:image")).toBe(`https://maneman.in${HOUSE_CARD}`);
  });

  // Mm-api counts an open only for a person, so it needs to know who asked.
  it("passes the visitor's user agent and address on to mm-api", async () => {
    const page = await open(() => Response.json(VALID), {
      "User-Agent": "WhatsApp/2.23.20.0",
      "CF-Connecting-IP": "203.0.113.7",
    });
    const lookUp = page.asked.find((request) => new URL(request.url).pathname === "/api/r/RM4K7P");
    expect(lookUp?.headers.get("User-Agent")).toBe("WhatsApp/2.23.20.0");
    expect(lookUp?.headers.get("CF-Connecting-IP")).toBe("203.0.113.7");
  });

  it("gives the landing's island the book's prices beside the invite, while the site gives prices", async () => {
    const page = await open(withPrices(), {}, undefined, createSiteWorker({ pricesShown: true }));
    expect(JSON.parse(page.invite)).toEqual({ ...VALID, code: "RM4K7P" });
    expect(readPriced(page.html).written).toEqual(PRICES);
  });

  it("asks for no price book while the site gives none", async () => {
    const page = await open(withPrices());
    expect(page.asked.filter(isPriceRequest)).toEqual([]);
    expect(readPriced(page.html).written).toBeNull();
  });
});

describe("the site Worker on a built film", () => {
  const PATH = "/_astro/hero.bJkdvSLL.mp4";

  /** 1,000 bytes, each its own position: the part a range gives can be read back. */
  const FILM = Uint8Array.from({ length: 1000 }, (_, position) => position % 256);

  /** The assets as Cloudflare runs them: the whole film whatever is asked, or `status` with no body. */
  function filmEnv(status: number) {
    const asked: Request[] = [];
    const fetcher = (answer: (request: Request) => Response) =>
      ({
        fetch: (input: RequestInfo | URL, init?: RequestInit) => answer(new Request(input, init)),
      }) as unknown as Fetcher;
    const headers = {
      "Content-Type": "video/mp4",
      ETag: '"film"',
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    const env: SiteEnv = {
      ASSETS: fetcher(() => new Response(status === 200 ? FILM : null, { status, headers })),
      API: fetcher((request) => {
        asked.push(request);
        return new Response(null, { status: 500 });
      }),
    };
    return { env, asked };
  }

  async function fetchFilm(headers: HeadersInit = {}, status = 200) {
    const { env, asked } = filmEnv(status);
    const response = await createSiteWorker().fetch(new Request(`https://maneman.in${PATH}`, { headers }), env);
    const body = new Uint8Array(await response.arrayBuffer());
    return { response, body, asked };
  }

  // A Range of bytes=0-1023 got 200 and all 2,343,106 bytes, so iOS Safari never played the film.
  it("gives the part a range asks for, as iOS Safari needs", async () => {
    const { response, body, asked } = await fetchFilm({ Range: "bytes=0-1" });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-1/1000");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect([...body]).toEqual([0, 1]);
    expect(asked).toEqual([]);
  });

  it("gives the rest of the film from where a range starts", async () => {
    const { response, body } = await fetchFilm({ Range: "bytes=600-" });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 600-999/1000");
    expect(body.length).toBe(400);
    expect(body[0]).toBe(600 % 256);
  });

  it("gives the whole film, saying parts may be asked for, when no range is asked", async () => {
    const { response, body } = await fetchFilm();

    expect(response.status).toBe(200);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Range")).toBeNull();
    expect(body.length).toBe(1000);
  });

  it("answers 416 for a range past the end", async () => {
    const { response, body } = await fetchFilm({ Range: "bytes=1000-" });

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */1000");
    expect(body.length).toBe(0);
  });

  it("passes on what the assets say of a film the browser already has", async () => {
    const { response } = await fetchFilm({ Range: "bytes=0-1", "If-None-Match": '"film"' }, 304);

    expect(response.status).toBe(304);
  });
});
