// The mm-site Worker (site/src/worker.ts): in front of /r/:code, what the preview says for each invite and the page
// it serves when mm-api cannot answer (docs/decisions/0027-referral-landing.md); and on every page that shows a
// price, the price book's figures written over the ones the page was built with
// (docs/decisions/0073-prices-from-the-price-book.md), Premium shown only where the book prices it
// (docs/decisions/0085-services-ops-can-edit.md).

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
 * Premium's hidden and empty, since a page is built without it.
 */
const PRICED_PAGE = `<!doctype html><html><head>
<script type="application/ld+json" data-structured="business">{"priceRange":"Rs. 30,000"}</script>
<script type="application/ld+json" data-structured="faq">{}</script>
</head><body>
<div class="amount" data-price="{firstFit}">Rs. 30,000</div>
<div class="amount" data-premium hidden data-price="{premiumFirstFit}"></div>
<span data-price="A standard base in the first year: {firstFit} plus twelve service visits at {service} — {firstYear}.">A standard base in the first year: Rs. 30,000 plus twelve service visits at Rs. 2,000 — Rs. 54,000.</span>
<p>Nothing to fill</p>
</body></html>`;

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

/** The book, moved on from the figures the page was built with, and pricing no premium first fit. */
const PRICES = {
  on: "2026-09-26",
  tier: "standard",
  first_fit: price(3_500_000),
  service: price(250_000),
  replacement: price(1_600_000),
  services: [
    offered("first_fit", "standard", "First fit", 3_500_000),
    offered("service", "standard", "Service visit", 250_000),
    offered("replacement", "standard", "Replacement", 1_600_000),
  ],
};

/** The same book, once ops have added a first fit coded premium in the console. */
const WITH_PREMIUM = {
  ...PRICES,
  services: [...PRICES.services, offered("first_fit", "premium", "Premium first fit", 4_500_000)],
};

type Api = (request: Request) => Response | Promise<Response>;

const isPriceRequest = (request: Request) => new URL(request.url).pathname === "/api/published-prices";

/** mm-api answering the book with `book`, and anything else with `other`. */
function withPrices(other: Api = () => Response.json(VALID), book: object = PRICES): Api {
  return (request) => (isPriceRequest(request) ? Response.json(book) : other(request));
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
  // Whether Premium's figure is still hidden, as the page was built.
  const premiumHidden = html.includes('<div class="amount" data-premium hidden');
  return {
    structured,
    figures,
    premiumHidden,
    written: written === undefined ? null : (JSON.parse(written) as unknown),
  };
}

describe("the site Worker at /r/:code", () => {
  it("names the referrer and promises the visits for a valid invite", async () => {
    const page = await open(() => Response.json(VALID));
    expect(page.meta("og:title")).toBe("Rohit sent you a Mane Man invite");
    expect(page.meta("og:description")).toContain("3 service visits free");
    expect(page.meta("og:image")).toBe("https://maneman.in/api/og/RM4K7P.jpg?v=3");
    expect(JSON.parse(page.invite)).toEqual({ ...VALID, code: "RM4K7P" });
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
      "Rs. 35,000",
      "",
      "A standard base in the first year: Rs. 35,000 plus twelve service visits at Rs. 2,500 — Rs. 65,000.",
    ]);
    expect(page.premiumHidden).toBe(true);
    expect(page.html).toContain("<p>Nothing to fill</p>");
    expect(page.files.map((file) => new URL(file.url).pathname)).toEqual([path]);
  });

  // The owner's ruling of 27 September 2026 (ADR 0085): premium is a service ops price in the console.
  it("shows Premium, with the book's figure, once the book prices a first fit coded premium", async () => {
    const page = await visit("/", withPrices(undefined, WITH_PREMIUM));

    expect(page.figures).toEqual([
      "Rs. 35,000",
      "Rs. 45,000",
      "A standard base in the first year: Rs. 35,000 plus twelve service visits at Rs. 2,500 — Rs. 65,000.",
    ]);
    expect(page.premiumHidden).toBe(false);
    expect(page.html).toContain('<div class="amount" data-premium data-price="{premiumFirstFit}">Rs. 45,000</div>');
    expect(page.structured("business")).toMatchObject({ priceRange: "Rs. 35,000–Rs. 45,000" });
    const faq = page.structured("faq") as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    const firstYear = faq.mainEntity.find((question) => question.name === "What does the first year cost in total?");
    expect(firstYear?.acceptedAnswer.text).toContain("Premium: Rs. 45,000 plus twelve at Rs. 2,500, so Rs. 75,000.");
  });

  it("builds the structured data again from the book's figures", async () => {
    const page = await visit("/", withPrices());

    expect(page.structured("business")).toMatchObject({ "@type": "LocalBusiness", priceRange: "Rs. 35,000" });
    const faq = page.structured("faq") as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    const firstYear = faq.mainEntity.find((question) => question.name === "What does the first year cost in total?");
    expect(firstYear?.acceptedAnswer.text).toContain("Rs. 35,000 for the first fit plus twelve monthly service visits");
    expect(firstYear?.acceptedAnswer.text).not.toContain("Premium");
  });

  it("gives the booking form's island the book's answer", async () => {
    const page = await visit("/book", withPrices());
    expect(page.written).toEqual(PRICES);
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
  ])("serves the page as built when mm-api %s and it has no answer yet", async (_, api: Api) => {
    const page = await visit("/", api);

    expect(page.response.status).toBe(200);
    expect(page.figures).toEqual([
      "Rs. 30,000",
      "",
      "A standard base in the first year: Rs. 30,000 plus twelve service visits at Rs. 2,000 — Rs. 54,000.",
    ]);
    expect(page.premiumHidden).toBe(true);
    expect(page.structured("business")).toEqual({ priceRange: "Rs. 30,000" });
    expect(page.written).toBeNull();
  });

  it("keeps the last answer it had when mm-api stops answering", async () => {
    let now = 0;
    const worker = createSiteWorker(() => now);
    await visit("/", withPrices(), worker);

    now = 120_000;
    const page = await visit("/", () => Response.json({ error: { code: "unavailable" } }, { status: 503 }), worker);

    expect(page.figures[0]).toBe("Rs. 35,000");
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
    expect(page.figures[0]).toBe("Rs. 30,000");
  });
});
