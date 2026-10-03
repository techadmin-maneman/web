// The site's prices, from the price book (docs/decisions/0073-prices-from-the-price-book.md): the sentences that
// give one, the figures a page is built with, and the production gate that stops a price typed by hand. A first fit
// is priced only as the hair systems ops offer in the console, so a page is built without one.

import { describe, expect, it } from "vitest";
import { rupees } from "../../packages/web-kit/money.ts";
import { BUILT_PRICES } from "../../site/src/content/prices.ts";
import { referral } from "../../site/src/content/referral.ts";
import * as site from "../../site/src/content/site.ts";
import type { PublishedPrices } from "../../site/src/lib/api.ts";
import {
  BUILT_WORDS,
  fillPrices,
  hairSystemsIn,
  holdsAPrice,
  isPublishedPrices,
  pricesOf,
  priceWords,
} from "../../site/src/lib/prices.ts";
import { publishProblems } from "../../site/src/lib/publish-gate.ts";

/** A book that has moved on from the figures the site was built with, and offers two hair systems. */
const MOVED = { firstFits: [3_500_000, 4_000_000], service: 250_000, replacement: 1_600_000 };

/** The same book while ops offer no hair system at all. */
const NO_HAIR_SYSTEM = { ...MOVED, firstFits: [] };

const price = (amountExGst: number) => ({ amount_ex_gst: amountExGst, amount: amountExGst, gst_percent: 0 });
const offered = (type: "first_fit" | "service" | "replacement", tier: string, name: string, amountExGst: number) => ({
  type,
  tier,
  name,
  minutes: 90,
  price: price(amountExGst),
});

const ANSWER: PublishedPrices = {
  on: "2026-09-26",
  tier: "standard",
  service: { amount_ex_gst: 250_000, amount: 295_000, gst_percent: 18 },
  replacement: { amount_ex_gst: 1_600_000, amount: 1_888_000, gst_percent: 18 },
  services: [
    offered("first_fit", "essential", "Mane Man Essential", 3_500_000),
    offered("first_fit", "natmax", "Mane Man NatMax", 4_000_000),
    offered("service", "standard", "Service visit", 250_000),
    offered("replacement", "standard", "Replacement", 1_600_000),
  ],
};

describe("the site's prices", () => {
  // FEO-22: the site typed its figures, its first-year totals and the search engines' price range.
  it("fills every sentence that gives a price from the book's figures, and computes the totals", () => {
    const words = priceWords(MOVED);

    expect(site.prices.rows.map((row) => [row.label, fillPrices(row.amount, words)])).toEqual([
      ["First fit", "From Rs. 35,000"],
      ["Monthly service visit", "Rs. 2,500"],
      ["Replacement hair system", "Rs. 16,000"],
    ]);
    expect(fillPrices(site.prices.example, words)).toBe(
      "Your first year, from Rs. 65,000: the first fit and twelve service visits at Rs. 2,500.",
    );
    expect(fillPrices(site.business.priceRange, words)).toBe("Rs. 35,000–Rs. 40,000");
    expect(referral.prices.rows.map((row) => fillPrices(row.amount, words))).toEqual(["Rs. 35,000", "Rs. 2,500"]);
  });

  // The owner's decision of 2 October 2026: only the hair systems ops offer, and no generic first fit in their place.
  it("gives no first-fit price while ops offer no hair system", () => {
    const words = priceWords(NO_HAIR_SYSTEM);

    expect(site.prices.rows.map((row) => fillPrices(row.amount, words))).toEqual(["", "Rs. 2,500", "Rs. 16,000"]);
    expect(fillPrices(site.prices.example, words)).toBe("");
    expect(fillPrices(site.business.priceRange, words)).toBe("");
    expect(referral.prices.rows.map((row) => fillPrices(row.amount, words))).toEqual(["", "Rs. 2,500"]);
  });

  it("is built with the price book's own figures, and no first fit, which has none of its own", () => {
    // Migration 0018, in force since 22 September 2026: Rs. 2,000 and Rs. 15,000 before GST.
    expect(BUILT_PRICES).toEqual({ firstFits: [], service: 200_000, replacement: 1_500_000 });
    expect(BUILT_WORDS).not.toHaveProperty("firstFit");
    expect(fillPrices(site.prices.example, BUILT_WORDS)).toBe("");
  });

  // The owner took the prices off the site on 1 October 2026 (ADR 0103). The prices section, the invite's list and the
  // price range search engines read wait on PRICES_SHOWN; nothing else gives a price.
  it("gives a price only in what waits on PRICES_SHOWN, which is off", () => {
    expect(site.PRICES_SHOWN).toBe(false);
    const home = { ...site, prices: null, business: { ...site.business, priceRange: null } };
    const landing = { ...referral, prices: null };
    for (const text of [JSON.stringify(home), JSON.stringify(landing)]) {
      expect(text.match(/\{(?:firstFit|service|replacement|firstYear|firstFitRange)\}/g)).toBeNull();
    }
  });

  it("gives one hair system's price alone as the range, and starts a range at the cheapest", () => {
    expect(fillPrices(site.business.priceRange, priceWords({ ...MOVED, firstFits: [4_500_000] }))).toBe("Rs. 45,000");
    expect(fillPrices(site.business.priceRange, priceWords({ ...MOVED, firstFits: [4_500_000, 3_200_000] }))).toBe(
      "Rs. 32,000–Rs. 45,000",
    );
  });

  it("takes a first fit's figures only from the hair systems the book's answer offers", () => {
    expect(pricesOf(ANSWER)).toEqual(MOVED);
    expect(hairSystemsIn(ANSWER).map((service) => service.name)).toEqual(["Mane Man Essential", "Mane Man NatMax"]);

    const without = { ...ANSWER, services: ANSWER.services.filter((service) => service.type !== "first_fit") };
    expect(pricesOf(without)).toEqual(NO_HAIR_SYSTEM);
    expect(hairSystemsIn(without)).toEqual([]);
  });

  it("leaves out a clause whose price is not known, and keeps the rest of the sentence", () => {
    const sentence = "{service}.[ From {firstFit}.] Then {replacement}.";
    expect(fillPrices(sentence, priceWords(NO_HAIR_SYSTEM))).toBe("Rs. 2,500. Then Rs. 16,000.");
    expect(fillPrices(sentence, priceWords(MOVED))).toBe("Rs. 2,500. From Rs. 35,000. Then Rs. 16,000.");
    expect(fillPrices("{firstFit}", priceWords(NO_HAIR_SYSTEM))).toBe("");
  });

  // "Rs." as the apps write it, from the one formatter the front ends share (packages/web-kit/money.ts): the owner's
  // ruling of 27 September 2026 (ADR 0025, item 51).
  it("writes rupees as the apps do, as India groups them", () => {
    expect(rupees(3_000_000)).toBe("Rs. 30,000");
    expect(rupees(10_000_000)).toBe("Rs. 1,00,000");
    expect(rupees(250_050)).toBe("Rs. 2,500.50");
    expect(priceWords(MOVED).firstFit).toBe(rupees(3_500_000));
  });

  it("reads only an answer it recognises", () => {
    expect(isPublishedPrices(ANSWER)).toBe(true);
    expect(isPublishedPrices({ ...ANSWER, service: null })).toBe(false);
    expect(isPublishedPrices({ ...ANSWER, replacement: { amount_ex_gst: "1600000", amount: 1, gst_percent: 0 } })).toBe(
      false,
    );
    expect(isPublishedPrices({ ...ANSWER, tier: "premium" })).toBe(false);
    expect(isPublishedPrices({ ...ANSWER, services: [{ type: "first_fit", tier: "premium" }] })).toBe(false);
    expect(isPublishedPrices({ ...ANSWER, services: null })).toBe(false);
    const { services: _, ...withoutServices } = ANSWER;
    expect(isPublishedPrices(withoutServices)).toBe(false);
    expect(isPublishedPrices(null)).toBe(false);
  });

  // The Worker reads each sentence back from its data-price attribute as written, and an attribute escapes these.
  it("gives prices only in sentences an attribute carries unchanged", () => {
    const sentences = [JSON.stringify(site), JSON.stringify(referral)]
      .flatMap((text) => text.match(/"[^"]*\{(?:firstFit|service|replacement|firstYear)\}[^"]*"/g) ?? [])
      .map((quoted) => JSON.parse(quoted) as string);
    expect(sentences.length).toBeGreaterThanOrEqual(6);
    for (const text of sentences) expect(text, text).not.toMatch(/[&"'<>]/);
  });

  it("tells a sentence that gives a price from one that does not", () => {
    expect(holdsAPrice("{firstFit}, then {service} a month")).toBe(true);
    expect(holdsAPrice("Fifteen minutes · free")).toBe(false);
    expect(holdsAPrice("We are not in {area} yet")).toBe(false);
  });
});

describe("the publish gate, on prices", () => {
  // The try-on's notices await counsel (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md), which the gate also
  // refuses (test/node/site-content.test.ts); here every notice is counted approved, so the prices are read alone.
  const approved = Object.fromEntries(
    Object.entries(site.notices).map(([name, notice]) => [name, { ...notice, approved: true }]),
  );
  const legalApproved = { privacy: { approved: true }, terms: { approved: true } };

  // FEO-22: the landing's prices were typed, and the gate never read referral.ts.
  it("stops a price typed into the landing", () => {
    const [first, second] = referral.prices.rows;
    if (first === undefined || second === undefined) throw new Error("the landing has lost a price row");
    const landing = { ...referral, prices: { rows: [{ ...first, amount: "Rs. 25,000" }, second] } };

    expect(publishProblems(undefined, approved, [site, landing], legalApproved)).toEqual([
      'a price is typed by hand, "Rs. 25,000": every price comes from the price book (docs/decisions/0073-prices-from-the-price-book.md)',
    ]);
  });

  it("stops a price typed into the site, with the sign the site wrote before as well", () => {
    for (const typed of ["Rs. 43,000", "₹43,000"]) {
      const home = { ...site, prices: { ...site.prices, example: `A standard base in the first year: ${typed}.` } };
      expect(publishProblems(undefined, approved, [home, referral], legalApproved), typed).toHaveLength(1);
    }
  });

  it("lets through what a transplant and medication cost, which are not our prices", () => {
    expect(publishProblems(undefined, approved, [site, referral], legalApproved)).toEqual([]);
  });
});
