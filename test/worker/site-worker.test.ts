// The mm-site Worker (site/src/worker.ts): in front of /r/:code, what the preview says for each invite and the page
// it serves when mm-api cannot answer (docs/decisions/0027-referral-landing.md); and on every page that shows a
// price, the price book's figures written over the ones the page was built with
// (docs/decisions/0073-prices-from-the-price-book.md), a first fit's only from the hair systems ops offer.

import { describe, expect, it } from "vitest";
import { HOUSE_CARD } from "../../src/config/house-card.ts";
import { createSiteWorker, type SiteEnv } from "../../site/src/worker.ts";

/** The landing's head as the build writes it (site/src/layouts/Site.astro): the house card is its image. */
const PAGE = `<!doctype html><html><head>
<meta property="og:title" content="You have a Mane Man invite">
<meta property="og:description" content="Home-fitted hair systems.">
<meta property="og:url" content="https://maneman.in/r">
<meta property="og:image" content="https://maneman.in${HOUSE_CARD}">
<meta property="og:image:secure_url" content="https://maneman.in${HOUSE_CARD}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
</head><body><div id="invite" data-invite=""></div><p>The landing</p></body></html>`;

/**
 * A page as the build writes one that shows prices: each figure's sentence, with the figures it was built with, and
 * a first fit's empty, since a page is built without one.
 */
const PRICED_PAGE = `<!doctype html><html><head>
<script type="application/ld+json" data-structured="business">{"name":"Mane Man"}</script>
<script type="application/ld+json" data-structured="faq">{}</script>
</head><body>
<div class="amount" data-price="From {firstFit}"></div>
<div class="amount" data-price="{service}">Rs. 2,000</div>
<span data-price="Your first year, from {firstYear}: the first fit and twelve service visits at {service}."></span>
<p>Nothing to fill</p>
</body></html>`;

/** The figures of PRICED_PAGE as it was built. */
const AS_BUILT = ["", "Rs. 2,000", ""];

const VALID = { state: "valid", referrer_first_name: "Rohit", card: { state: "personal", version: 3 } };
const UNKNOWN = { state: "unknown", referrer_first_name: null, card: { state: "house", version: 1 } };

const price = (amountExGst: number) => ({ amount_ex_gst: amountExGst, amount: amountExGst, gst_percent: 0 });
const offered = (type: string, tier: string, name: string, amountExGst: number) => ({
  type,
  tier,
  name,
  minutes: 90,
  price: price(amountExGst),
});

/** The book, moved on from the figures the page was built with, and offering two hair systems as first fits. */
const PRICES = {
  on: "2026-09-26",
  tier: "standard",
  service: price(250_000),
  replacement: price(1_600_000),
  services: [
    offered("first_fit", "essential", "Mane Man Essential", 3_500_000),
    offered("first_fit", "natmax", "Mane Man NatMax", 4_500_000),
    offered("service", "standard", "Service visit", 250_000),
    offered("replacement", "standard", "Replacement", 1_600_000),
  ],
};

/** The same book while ops offer no hair system. */
const NO_HAIR_SYSTEM = { ...PRICES, services: PRICES.services.filter((service) => service.type !== "first_fit") };

type Api = (request: Request) => Response | Promise<Response>;

const isPriceRequest = (request: Request) => new URL(request.url).pathname === "/api/published-prices";
const isRewardRequest = (request: Request) => new URL(request.url).pathname === "/api/referral-reward";

/** What a referral earns as the console begins, each side 3 visits for a year. */
const REWARD = { referrer_visits: 3, friend_visits: 3, valid_days: 365 };

/** mm-api answering the book with `book`, and anything else with `other`. */
function withPrices(other: Api = () => Response.json(VALID), book: object = PRICES): Api {
  return (request) => (isPriceRequest(request) ? Response.json(book) : other(request));
}

/** mm-api answering what a referral earns with `reward`, and anything else with `other`. */
function withReward(other: Api = () => Response.json(VALID), reward: object = REWARD): Api {
  return (request) => (isRewardRequest(request) ? Response.json(reward) : other(request));
}

function siteEnv(api: Api, page = PAGE): { env: SiteEnv; asked: Request[]; files: Request[] } {
  const asked: Request[] = [];
  const files: Request[] = [];
  const fetcher = (answer: (request: Request) => Response | Promise<Response>) =>
    ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) => answer(new Request(input, init)),
    }) as unknown as Fetcher;
  const env = {
    ASSETS: fetcher((request) => {
      files.push(request);
      return new Response(page, { headers: { "Content-Type": "text/html", ETag: '"built-file"' } });
    }),
    API: fetcher((request) => {
      asked.push(request);
      return api(request);
    }),
  };
  return { env, asked, files };
}

async function open(api: Api, headers: HeadersInit = {}, origin = "https://maneman.in") {
  const { env, asked } = siteEnv(api);
  const response = await createSiteWorker().fetch(new Request(`${origin}/r/RM4K7P`, { headers }), env);
  const html = await response.text();
  const meta = (property: string) =>
    new RegExp(`<meta property="${property}" content="([^"]*)"`).exec(html)?.[1] ?? "(missing)";
  const invite = /data-invite="([^"]*)"/.exec(html)?.[1]?.replaceAll("&quot;", '"') ?? "(missing)";
  return { response, html, meta, invite, asked };
}

/** A page with prices, read back: its figures, its structured data and what the booking form's island is given. */
function readPriced(html: string) {
  const structured = (name: string): unknown => {
    const json = new RegExp(`<script type="application/ld\\+json" data-structured="${name}">([^<]*)</script>`).exec(
      html,
    )?.[1];
    return json === undefined ? "(missing)" : JSON.parse(json);
  };
  const figures = [...html.matchAll(/data-price="[^"]*">([^<]*)</g)].map(([, text]) => text);
  const written = /<body data-prices="([^"]*)"/.exec(html)?.[1]?.replaceAll("&quot;", '"');
  return {
    structured,
    figures,
    written: written === undefined ? null : (JSON.parse(written) as unknown),
  };
}

describe("the site Worker at /r/:code", () => {
  it("names the referrer and promises the visits for a valid invite", async () => {
    const page = await open(withReward());
    expect(page.meta("og:title")).toBe("Rohit sent you a Mane Man invite");
    expect(page.meta("og:description")).toContain("3 service visits free");
    expect(page.meta("og:image")).toBe("https://maneman.in/api/og/RM4K7P.jpg?v=3");
    expect(JSON.parse(page.invite)).toEqual({ ...VALID, code: "RM4K7P" });
  });

  // The owner's ruling of 1 October 2026: ops set what each side gets (docs/decisions/0107-referral-rewards-in-the-console.md).
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
    const worker = createSiteWorker(() => now);
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

  // FEO-18: a failure is not an unknown code. The page is served as built and the island asks again.
  it.each([
    ["answers 503", () => Response.json({ error: { code: "unavailable" } }, { status: 503 })],
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

  // FEO-25: mm-api counts an open only for a person, so it needs to know who asked.
  it("passes the visitor's user agent on to mm-api", async () => {
    const page = await open(() => Response.json(VALID), { "User-Agent": "WhatsApp/2.23.20.0" });
    const lookUp = page.asked.find((request) => new URL(request.url).pathname === "/api/r/RM4K7P");
    expect(lookUp?.headers.get("User-Agent")).toBe("WhatsApp/2.23.20.0");
  });

  it("gives the landing's island the book's prices beside the invite", async () => {
    const page = await open(withPrices());
    expect(JSON.parse(page.invite)).toEqual({ ...VALID, code: "RM4K7P" });
    expect(readPriced(page.html).written).toEqual(PRICES);
  });
});

describe("the site Worker on a page that shows a price", () => {
  async function visit(path: string, api: Api, worker = createSiteWorker(), headers: HeadersInit = {}) {
    const { env, asked, files } = siteEnv(api, PRICED_PAGE);
    const response = await worker.fetch(new Request(`https://maneman.in${path}`, { headers }), env);
    const html = await response.text();
    return { response, html, asked, files, ...readPriced(html) };
  }

  // FEO-22: the site published ₹25,000 and ₹1,500 while the book held ₹30,000 and ₹2,000.
  it.each(["/", "/book"])("writes the book's figures over the built ones on %s, the totals computed", async (path) => {
    const page = await visit(path, withPrices());

    expect(page.response.status).toBe(200);
    expect(page.figures).toEqual([
      "From Rs. 35,000",
      "Rs. 2,500",
      "Your first year, from Rs. 65,000: the first fit and twelve service visits at Rs. 2,500.",
    ]);
    expect(page.html).toContain("<p>Nothing to fill</p>");
    expect(page.files.map((file) => new URL(file.url).pathname)).toEqual([path]);
  });

  // The owner's decision of 2 October 2026: only the hair systems ops offer, and no generic first fit in their place.
  it("gives no first-fit figure while ops offer no hair system, and tells the booking form so", async () => {
    const page = await visit("/book", withPrices(undefined, NO_HAIR_SYSTEM));

    expect(page.figures).toEqual(["", "Rs. 2,500", ""]);
    expect(page.written).toEqual(NO_HAIR_SYSTEM);
  });

  // The owner took the prices off the site on 1 October 2026 (ADR 0103), the price range search engines read with them.
  it("builds the structured data again, with no price while the site gives none", async () => {
    const page = await visit("/", withPrices());

    expect(page.structured("business")).toMatchObject({ "@type": "LocalBusiness", name: "Mane Man" });
    expect(page.structured("business")).not.toHaveProperty("priceRange");
    const faq = page.structured("faq") as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    const cost = faq.mainEntity.find((question) => question.name === "What does it cost?");
    expect(cost?.acceptedAnswer.text).toBe(
      "It depends on the hair system you choose. Your technician quotes it at the free consultation, before anything is fitted. No deposit, no package.",
    );
    expect(JSON.stringify(faq)).not.toMatch(/Rs\. \d/);
  });

  it("gives the booking form's island the book's answer", async () => {
    const page = await visit("/book", withPrices());
    expect(page.written).toEqual(PRICES);
  });

  // /book confirms a booking made with an invite in the landing's words, so it says what the invite earns too.
  it("gives /book's island what a referral earns, and asks for it nowhere else but the landing", async () => {
    const book = await visit("/book", withPrices(withReward()));
    expect(book.html).toContain(`data-reward="${JSON.stringify(REWARD).replaceAll('"', "&quot;")}"`);
    const home = await visit("/", withPrices(withReward()));
    expect(home.asked.filter(isRewardRequest)).toEqual([]);
    expect(home.html).not.toContain("data-reward");
  });

  it("asks mm-api for the book once a minute, however many pages it serves", async () => {
    let now = 0;
    const worker = createSiteWorker(() => now);
    const asked = async () => (await visit("/", withPrices(), worker)).asked.filter(isPriceRequest).length;

    expect(await asked()).toBe(1);
    now = 59_000;
    expect(await asked()).toBe(0);
    now = 61_000;
    expect(await asked()).toBe(1);
  });

  it.each([
    ["answers 503", () => Response.json({ error: { code: "unavailable" } }, { status: 503 })],
    [
      "throws",
      () => {
        throw new Error("mm-api is down");
      },
    ],
    ["answers a shape it does not know", () => Response.json({ ...PRICES, service: null })],
    [
      "answers with no services, as an mm-api from before them did",
      () => Response.json({ ...PRICES, services: undefined }),
    ],
  ])("serves the page as built when mm-api %s and it has no answer yet", async (_, api: Api) => {
    const page = await visit("/", api);

    expect(page.response.status).toBe(200);
    expect(page.figures).toEqual(AS_BUILT);
    expect(page.structured("business")).toEqual({ name: "Mane Man" });
    expect(page.written).toBeNull();
  });

  it("keeps the last answer it had when mm-api stops answering", async () => {
    let now = 0;
    const worker = createSiteWorker(() => now);
    await visit("/", withPrices(), worker);

    now = 120_000;
    const page = await visit("/", () => Response.json({ error: { code: "unavailable" } }, { status: 503 }), worker);

    expect(page.figures[0]).toBe("From Rs. 35,000");
    expect(page.written).toEqual(PRICES);
  });

  it("asks for the built file whole, and gives the browser nothing to keep old figures by", async () => {
    const page = await visit("/", withPrices(), createSiteWorker(), { "If-None-Match": '"built-file"' });

    expect(page.files[0]?.headers.get("If-None-Match")).toBeNull();
    expect(page.response.headers.get("ETag")).toBeNull();
  });

  it("leaves every other page to the assets, without asking mm-api", async () => {
    const page = await visit("/try", withPrices());

    expect(page.asked).toEqual([]);
    expect(page.figures).toEqual(AS_BUILT);
  });
});
