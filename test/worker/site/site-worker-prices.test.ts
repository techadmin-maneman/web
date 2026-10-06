// The mm-site Worker (site/src/worker.ts): in front of /r/:code, what the preview says for each invite and the page
// it serves when mm-api cannot answer (docs/decisions/0027-referral-landing.md); and on every page that shows a
// price, the price book's figures written over the ones the page was built with
// (docs/decisions/0073-prices-from-the-price-book.md), a first fit's only from the hair systems ops offer; and the
// built films, given a byte range at a time.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSiteWorker } from "../../../site/src/worker.ts";
import {
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

/** The same book while ops offer no hair system. */
const NO_HAIR_SYSTEM = { ...PRICES, services: PRICES.services.filter((service) => service.type !== "first_fit") };

afterEach(() => {
  vi.restoreAllMocks();
});

// The dormant price pipeline, switched on as it will be when the site gives prices again (PRICES_SHOWN).
describe("the site Worker on a page that shows a price", () => {
  async function visit(
    path: string,
    api: Api,
    worker = createSiteWorker({ pricesShown: true }),
    headers: HeadersInit = {},
  ) {
    const { env, asked, files } = siteEnv(api, PRICED_PAGE);
    const response = await worker.fetch(new Request(`https://maneman.in${path}`, { headers }), env);
    const html = await response.text();
    return { response, html, asked, files, ...readPriced(html) };
  }

  // The site published ₹25,000 and ₹1,500 while the book held ₹30,000 and ₹2,000.
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

  // Only the hair systems ops offer, and no generic first fit in their place.
  it("gives no first-fit figure while ops offer no hair system, and tells the booking form so", async () => {
    const page = await visit("/book", withPrices(undefined, NO_HAIR_SYSTEM));

    expect(page.figures).toEqual(["", "Rs. 2,500", ""]);
    expect(page.written).toEqual(NO_HAIR_SYSTEM);
  });

  // The site gives no prices (ADR 0103), nor the price range search engines read with them.
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
    const worker = createSiteWorker({ clock: () => now, pricesShown: true });
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
    const worker = createSiteWorker({ clock: () => now, pricesShown: true });
    await visit("/", withPrices(), worker);

    now = 120_000;
    const page = await visit("/", () => Response.json({ error: { code: "unavailable" } }, { status: 503 }), worker);

    expect(page.figures[0]).toBe("From Rs. 35,000");
    expect(page.written).toEqual(PRICES);
  });

  it("logs each answer it cannot use, and asks again only once the failure is ten seconds old", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let now = 0;
    const worker = createSiteWorker({ clock: () => now, pricesShown: true });
    const down: Api = () => Response.json({ error: { code: "unavailable" } }, { status: 503 });
    const asked = async () => (await visit("/", down, worker)).asked.filter(isPriceRequest).length;

    expect(await asked()).toBe(1);
    expect(logged(warn)).toEqual([
      { level: "warn", event: "mm_api_failed", worker: "mm-site", asked: "prices", status: 503, reason: "refused" },
    ]);
    now = 9_000;
    expect(await asked()).toBe(0);
    now = 11_000;
    expect(await asked()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("asks for the built file whole, and gives the browser nothing to keep old figures by", async () => {
    const page = await visit("/", withPrices(), undefined, { "If-None-Match": '"built-file"' });

    expect(page.files[0]?.headers.get("If-None-Match")).toBeNull();
    expect(page.response.headers.get("ETag")).toBeNull();
  });

  it("leaves every other page to the assets, without asking mm-api", async () => {
    const page = await visit("/try", withPrices());

    expect(page.asked).toEqual([]);
    expect(page.figures).toEqual(AS_BUILT);
  });
});
