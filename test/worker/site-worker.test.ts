// The mm-site Worker (site/src/worker.ts): in front of /r/:code, what the preview says for each invite and the page
// it serves when mm-api cannot answer (docs/decisions/0027-referral-landing.md); and on every page that shows a
// price, the price book's figures written over the ones the page was built with
// (docs/decisions/0073-prices-from-the-price-book.md).

import { describe, expect, it } from "vitest";
import { createSiteWorker, type SiteEnv } from "../../site/src/worker.ts";

const PAGE = `<!doctype html><html><head>
<meta property="og:title" content="You have a Mane Man invite">
<meta property="og:description" content="Home-fitted hair systems.">
<meta property="og:image" content="https://maneman.in/og.png">
<meta property="og:url" content="https://maneman.in/r">
</head><body><div id="invite" data-invite=""></div><p>The landing</p></body></html>`;

/** A page as the build writes one that shows prices: each figure's sentence, with the figures it was built with. */
const PRICED_PAGE = `<!doctype html><html><head>
<script type="application/ld+json" data-structured="business">{"priceRange":"₹30,000–₹40,000"}</script>
<script type="application/ld+json" data-structured="faq">{}</script>
</head><body>
<div class="amount" data-price="{firstFit}">₹30,000</div>
<div class="amount" data-price="{premiumFirstFit}">₹40,000</div>
<span data-price="A standard base in the first year: {firstFit} plus twelve service visits at {service} — {firstYear}.">A standard base in the first year: ₹30,000 plus twelve service visits at ₹2,000 — ₹54,000.</span>
<p>Nothing to fill</p>
</body></html>`;

const VALID = { state: "valid", referrer_first_name: "Rohit", card: { state: "personal", version: 3 } };
const UNKNOWN = { state: "unknown", referrer_first_name: null, card: { state: "house", version: 1 } };

/** The book, moved on from the figures the page was built with. */
const PRICES = {
  on: "2026-09-26",
  tier: "standard",
  first_fit: { amount_ex_gst: 3_500_000, amount: 3_500_000, gst_percent: 0 },
  service: { amount_ex_gst: 250_000, amount: 250_000, gst_percent: 0 },
  replacement: { amount_ex_gst: 1_600_000, amount: 1_600_000, gst_percent: 0 },
};

type Api = (request: Request) => Response | Promise<Response>;

const isPriceRequest = (request: Request) => new URL(request.url).pathname === "/api/published-prices";

/** mm-api answering the book with PRICES, and anything else with `other`. */
function withPrices(other: Api = () => Response.json(VALID)): Api {
  return (request) => (isPriceRequest(request) ? Response.json(PRICES) : other(request));
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

async function open(api: Api, headers: HeadersInit = {}) {
  const { env, asked } = siteEnv(api);
  const response = await createSiteWorker().fetch(new Request("https://maneman.in/r/RM4K7P", { headers }), env);
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
  return { structured, figures, written: written === undefined ? null : (JSON.parse(written) as unknown) };
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
      "₹35,000",
      "₹40,000",
      "A standard base in the first year: ₹35,000 plus twelve service visits at ₹2,500 — ₹65,000.",
    ]);
    expect(page.html).toContain("<p>Nothing to fill</p>");
    expect(page.files.map((file) => new URL(file.url).pathname)).toEqual([path]);
  });

  it("builds the structured data again from the book's figures", async () => {
    const page = await visit("/", withPrices());

    expect(page.structured("business")).toMatchObject({ "@type": "LocalBusiness", priceRange: "₹35,000–₹40,000" });
    const faq = page.structured("faq") as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    const firstYear = faq.mainEntity.find((question) => question.name === "What does the first year cost in total?");
    expect(firstYear?.acceptedAnswer.text).toContain("₹35,000 for the first fit plus twelve monthly service visits");
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
      "₹30,000",
      "₹40,000",
      "A standard base in the first year: ₹30,000 plus twelve service visits at ₹2,000 — ₹54,000.",
    ]);
    expect(page.structured("business")).toEqual({ priceRange: "₹30,000–₹40,000" });
    expect(page.written).toBeNull();
  });

  it("keeps the last answer it had when mm-api stops answering", async () => {
    let now = 0;
    const worker = createSiteWorker(() => now);
    await visit("/", withPrices(), worker);

    now = 120_000;
    const page = await visit("/", () => Response.json({ error: { code: "unavailable" } }, { status: 503 }), worker);

    expect(page.figures[0]).toBe("₹35,000");
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
    expect(page.figures[0]).toBe("₹30,000");
  });
});
