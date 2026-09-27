// The site's prices, from the price book (docs/decisions/0073-prices-from-the-price-book.md): the sentences that
// give one, the figures a page is built with, and the production gate that stops a price typed by hand. Premium is
// the book's too, the services ops code premium (docs/decisions/0085-services-ops-can-edit.md), so a page is built
// without it.

import { describe, expect, it } from "vitest";
import { rupeeSign } from "../../packages/web-kit/money.ts";
import { BUILT_STANDARD } from "../../site/src/content/prices.ts";
import { referral } from "../../site/src/content/referral.ts";
import * as site from "../../site/src/content/site.ts";
import type { PublishedPrices } from "../../site/src/lib/api.ts";
import {
  BUILT_WORDS,
  fillPrices,
  holdsAPrice,
  isPublishedPrices,
  premiumOf,
  priceWords,
  standardOf,
} from "../../site/src/lib/prices.ts";
import { publishProblems } from "../../site/src/lib/publish-gate.ts";

/** A book that has moved on from the figures the site was built with. */
const MOVED = { first_fit: 3_500_000, service: 250_000, replacement: 1_600_000 };

/** Premium, once ops price it in the book: the figures the site published for it before the book held them. */
const PREMIUM = { first_fit: 4_000_000, service: 200_000, replacement: 3_000_000 };

const price = (amountExGst: number) => ({ amount_ex_gst: amountExGst, amount: amountExGst, gst_percent: 0 });
const offered = (type: "first_fit" | "service" | "replacement", tier: string, amountExGst: number) => ({
  type,
  tier,
  name: `${tier} ${type}`,
  minutes: 90,
  price: price(amountExGst),
});

const ANSWER: PublishedPrices = {
  on: "2026-09-26",
  tier: "standard",
  first_fit: { amount_ex_gst: 3_500_000, amount: 4_130_000, gst_percent: 18 },
  service: { amount_ex_gst: 250_000, amount: 295_000, gst_percent: 18 },
  replacement: { amount_ex_gst: 1_600_000, amount: 1_888_000, gst_percent: 18 },
  services: [
    offered("first_fit", "standard", 3_500_000),
    offered("service", "standard", 250_000),
    offered("replacement", "standard", 1_600_000),
  ],
};

function sentence(text: string | undefined): string {
  if (text === undefined) throw new Error("the content has lost a sentence this test reads");
  return text;
}

const firstYearAnswer = sentence(
  site.faq.items.find((item) => item.q === "What does the first year cost in total?")?.a,
);
const ourCost = site.comparison.rows.find((row) => row.label === "Cost")?.cells[2];
const serviceStep = sentence(site.howItWorks.steps[3]?.meta);

describe("the site's prices", () => {
  // FEO-22: the site typed its figures, its first-year totals and the search engines' price range.
  it("fills every sentence that gives a price from the book's figures, and computes the totals", () => {
    const words = priceWords(MOVED, PREMIUM);

    expect(
      site.prices.rows.map((row) => [row.label, fillPrices(row.standard, words), fillPrices(row.premium, words)]),
    ).toEqual([
      ["First fit", "₹35,000", "₹40,000"],
      ["Monthly service visit", "₹2,500", "₹2,000"],
      ["Replacement piece", "₹16,000", "₹30,000"],
    ]);
    expect(fillPrices(site.prices.example, words)).toBe(
      "A standard base in the first year: ₹35,000 plus twelve service visits at ₹2,500 — ₹65,000.",
    );
    expect(fillPrices(firstYearAnswer, words)).toBe(
      "A standard base: ₹35,000 for the first fit plus twelve monthly service visits at ₹2,500, so ₹65,000. " +
        "Premium: ₹40,000 plus twelve at ₹2,000, so ₹64,000. A replacement piece at six months is separate.",
    );
    expect(fillPrices(site.business.priceRange, words)).toBe("₹35,000–₹40,000");
    expect(site.bases.kinds.map((kind) => fillPrices(kind.price, words))).toEqual(["₹35,000", "₹40,000"]);
    expect(fillPrices(serviceStep, words)).toBe("₹2,500 a visit · ninety minutes");
    expect(typeof ourCost === "string" ? fillPrices(ourCost, words) : ourCost).toBe("₹35,000, then ₹2,500 a month");
    expect(referral.prices.rows.map((row) => fillPrices(row.amount, words))).toEqual(["₹35,000", "₹2,500"]);
  });

  // The owner's ruling of 27 September 2026 (ADR 0085): premium is a service in the console, priced in the book.
  it("says nothing of Premium while the book prices no premium first fit", () => {
    const words = priceWords(MOVED);

    expect(site.prices.rows.map((row) => fillPrices(row.premium, words))).toEqual(["", "", ""]);
    expect(fillPrices(firstYearAnswer, words)).toBe(
      "A standard base: ₹35,000 for the first fit plus twelve monthly service visits at ₹2,500, so ₹65,000. " +
        "A replacement piece at six months is separate.",
    );
    expect(fillPrices(site.business.priceRange, words)).toBe("₹35,000");
    expect(site.bases.kinds.map((kind) => fillPrices(kind.price, words))).toEqual(["₹35,000", ""]);
  });

  it("is built with the price book's own figures, and no Premium, which has none of its own", () => {
    // Migration 0018, in force since 22 September 2026: ₹30,000, ₹2,000 and ₹15,000 before GST.
    expect(BUILT_STANDARD).toEqual({ first_fit: 3_000_000, service: 200_000, replacement: 1_500_000 });
    expect(fillPrices(site.prices.example, BUILT_WORDS)).toBe(
      "A standard base in the first year: ₹30,000 plus twelve service visits at ₹2,000 — ₹54,000.",
    );
    expect(BUILT_WORDS).not.toHaveProperty("premiumFirstFit");
    expect(fillPrices(firstYearAnswer, BUILT_WORDS)).not.toContain("Premium");
  });

  it("starts the range at the cheaper first fit, whichever tier that is", () => {
    expect(fillPrices(site.business.priceRange, priceWords({ ...MOVED, first_fit: 4_500_000 }, PREMIUM))).toBe(
      "₹40,000–₹45,000",
    );
  });

  it("takes Premium from the services coded premium, and a kind without one at its standard price", () => {
    expect(premiumOf(ANSWER)).toBeNull();
    expect(
      premiumOf({ ...ANSWER, services: [...ANSWER.services, offered("first_fit", "lace", 4_500_000)] }),
    ).toBeNull();
    // A premium service visit or replacement alone is no premium tier: its base is what the first fit fits.
    expect(
      premiumOf({ ...ANSWER, services: [...ANSWER.services, offered("replacement", "premium", 3_000_000)] }),
    ).toBeNull();

    const firstFitOnly = { ...ANSWER, services: [...ANSWER.services, offered("first_fit", "premium", 4_000_000)] };
    expect(premiumOf(firstFitOnly)).toEqual({ first_fit: 4_000_000, service: 250_000, replacement: 1_600_000 });
    const all = {
      ...firstFitOnly,
      services: [
        ...firstFitOnly.services,
        offered("service", "premium", 300_000),
        offered("replacement", "premium", 3_000_000),
      ],
    };
    expect(premiumOf(all)).toEqual({ first_fit: 4_000_000, service: 300_000, replacement: 3_000_000 });
  });

  it("reads an answer from an mm-api that lists no services yet as one with no Premium", () => {
    const { services: _, ...before } = ANSWER;
    expect(isPublishedPrices(before)).toBe(true);
    expect(premiumOf(before as PublishedPrices)).toBeNull();
  });

  it("leaves out a clause whose price is not known, and keeps the rest of the sentence", () => {
    const words = priceWords(MOVED);
    expect(fillPrices("{firstFit}.[ Premium: {premiumFirstFit}.] Then {service}.", words)).toBe(
      "₹35,000. Then ₹2,500.",
    );
    expect(fillPrices("{firstFit}.[ Premium: {premiumFirstFit}.] Then {service}.", priceWords(MOVED, PREMIUM))).toBe(
      "₹35,000. Premium: ₹40,000. Then ₹2,500.",
    );
    expect(fillPrices("{premiumFirstFit}", words)).toBe("");
  });

  // With the sign the site's design writes, from the one formatter the front ends share (packages/web-kit/money.ts).
  it("writes rupees as India groups them", () => {
    expect(rupeeSign(3_000_000)).toBe("₹30,000");
    expect(rupeeSign(10_000_000)).toBe("₹1,00,000");
    expect(rupeeSign(250_050)).toBe("₹2,500.50");
  });

  // src/policy/prices.ts: "Shown ex-GST as the main figure".
  it("shows each price before GST, from the book's answer", () => {
    expect(standardOf(ANSWER)).toEqual(MOVED);
  });

  it("reads only an answer it recognises", () => {
    expect(isPublishedPrices(ANSWER)).toBe(true);
    expect(isPublishedPrices({ ...ANSWER, service: null })).toBe(false);
    expect(isPublishedPrices({ ...ANSWER, first_fit: { amount_ex_gst: "3500000", amount: 1, gst_percent: 0 } })).toBe(
      false,
    );
    expect(isPublishedPrices({ ...ANSWER, tier: "premium" })).toBe(false);
    expect(isPublishedPrices({ ...ANSWER, services: [{ type: "first_fit", tier: "premium" }] })).toBe(false);
    expect(isPublishedPrices({ ...ANSWER, services: null })).toBe(false);
    expect(isPublishedPrices(null)).toBe(false);
  });

  // The Worker reads each sentence back from its data-price attribute as written, and an attribute escapes these.
  it("gives prices only in sentences an attribute carries unchanged", () => {
    const sentences = [JSON.stringify(site), JSON.stringify(referral)]
      .flatMap((text) => text.match(/"[^"]*\{(?:firstFit|service|replacement|premium\w+|firstYear)\}[^"]*"/g) ?? [])
      .map((quoted) => JSON.parse(quoted) as string);
    expect(sentences.length).toBeGreaterThan(10);
    for (const text of sentences) expect(text, text).not.toMatch(/[&"'<>]/);
  });

  it("tells a sentence that gives a price from one that does not", () => {
    expect(holdsAPrice("{firstFit}, then {service} a month")).toBe(true);
    expect(holdsAPrice("Fifteen minutes · free")).toBe(false);
    expect(holdsAPrice("We are not in {area} yet")).toBe(false);
  });
});

describe("the publish gate, on prices", () => {
  // FEO-22: the landing's prices were typed, and the gate never read referral.ts.
  it("stops a price typed into the landing", () => {
    const [first, second] = referral.prices.rows;
    if (first === undefined || second === undefined) throw new Error("the landing has lost a price row");
    const landing = { ...referral, prices: { rows: [{ ...first, amount: "₹25,000" }, second] } };

    expect(publishProblems(undefined, undefined, [site, landing])).toEqual([
      'a price is typed by hand, "₹25,000": every price comes from the price book (docs/decisions/0073-prices-from-the-price-book.md)',
    ]);
  });

  it("stops a price typed into the site", () => {
    const home = { ...site, prices: { ...site.prices, example: "A standard base in the first year: ₹43,000." } };

    expect(publishProblems(undefined, undefined, [home, referral])).toHaveLength(1);
  });

  it("lets through what a transplant and medication cost, which are not our prices", () => {
    expect(publishProblems(undefined, undefined, [site, referral])).toEqual([]);
  });
});
