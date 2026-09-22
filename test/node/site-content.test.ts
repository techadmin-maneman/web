// The site's content file and the publish gate that guards production.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESIGN_PLACEHOLDERS, type PlaceholderBlockName } from "../../site/src/content/design-placeholders.ts";
import * as site from "../../site/src/content/site.ts";
import { bookedHeadline } from "../../site/src/lib/dates.ts";
import { siteEnvironment } from "../../site/src/lib/environment.ts";
import { formatMobile, isCompleteMobile, mobileDigits } from "../../site/src/lib/phone.ts";
import { publishProblems } from "../../site/src/lib/publish-gate.ts";
import { headersFile, robotsFile } from "../../site/src/lib/static-files.ts";
import { fill } from "../../site/src/lib/text.ts";
import { PRESETS } from "../../src/config/presets.ts";

const BLOCKS: Record<PlaceholderBlockName, { publish: boolean }> = {
  whatsapp: site.whatsapp,
  phone: site.phone,
  heroFootage: site.heroFootage,
  whatPlate: site.whatPlate,
  norwoodPhotos: site.norwoodPhotos,
  teaserPair: site.teaserPair,
  stepPhotos: site.stepPhotos,
  basePhotos: site.basePhotos,
  technicians: site.technicians,
  testimonials: site.testimonials,
  founderNote: site.founderNote,
  privacy: site.legalPages.privacy,
  terms: site.legalPages.terms,
};
const APPROVED = Object.fromEntries(
  Object.entries(site.notices).map(([name, notice]) => [name, { ...notice, approved: true }]),
);

/** Every file name mentioned anywhere in the content. */
function filesIn(value: unknown): string[] {
  if (typeof value === "string") return /\.(jpg|mp4)$/.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(filesIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(filesIn);
  return [];
}

describe("content", () => {
  it("refers only to images and footage that exist in design/assets", () => {
    const files = filesIn(site);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) expect(existsSync(`design/assets/${file}`), file).toBe(true);
  });

  it("offers the backend's six presets in its order, split as the design labels them", () => {
    expect(site.looks.map((look) => look.id)).toEqual(PRESETS.map((preset) => preset.id));
    expect(site.looks[0]).toMatchObject({ density: "Full density", detail: "Natural hairline · short" });
  });

  it("builds the consent screen from the backend's photo notice, word for word", () => {
    expect(site.tryOn.consent.title).toBe("What happens to your photograph.");
    expect(site.tryOn.consent.rows.map((row) => row.k)).toEqual([
      "Used for",
      "Kept for",
      "Training",
      "Shared with",
      "To withdraw",
    ]);
    expect(site.tryOn.consent.agreement).toBe("I understand, and I agree to my photograph being used this way.");
    expect(site.tryOn.gate.title).toBe("Where should we send it?");
    expect(site.booking.consent).toBe("I agree to be contacted about this visit. I have read how my details are used.");
  });

  it("holds every placeholder value the gate knows in each unpublished block, so the gate list stays accurate", () => {
    for (const [name, values] of Object.entries(DESIGN_PLACEHOLDERS) as [PlaceholderBlockName, readonly string[]][]) {
      if (BLOCKS[name].publish) continue;
      const text = JSON.stringify(BLOCKS[name]);
      for (const value of values) expect(text, `${name}: ${value}`).toContain(JSON.stringify(value).slice(1, -1));
    }
  });

  it("publishes only blocks whose material is real: the business number, the privacy notice and the terms", () => {
    const published = Object.entries(BLOCKS)
      .filter(([, block]) => block.publish)
      .map(([name]) => name);
    expect(published).toEqual(["whatsapp", "phone", "privacy", "terms"]);
  });
});

describe("the publish gate", () => {
  it("lets production through: every published block is real and every notice approved", () => {
    expect(publishProblems()).toEqual([]);
  });

  it("stops a notice that is not approved", () => {
    const notices = { ...site.notices, photo: { ...site.notices.photo, approved: false } };
    expect(publishProblems(undefined, notices)).toContain("the photo notice (photo-v1) is not approved");
  });

  it("stops a published block that still holds the design's placeholder material", () => {
    const blocks = {
      ...BLOCKS,
      technicians: { ...site.technicians, publish: true },
      privacy: { ...site.legalPages.privacy, publish: true, paragraphs: ["Real text."] },
      terms: { ...site.legalPages.terms, publish: true, paragraphs: ["Real text."] },
    };
    const problems = publishProblems(blocks, APPROVED);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^technicians is published but still holds the design's placeholder material: /);
    expect(problems[0]).toContain("Imran Qureshi");
  });

  it("lets a published block through once its material is replaced", () => {
    const blocks = {
      ...BLOCKS,
      founderNote: { ...site.founderNote, publish: true, paragraphs: ["A real note."] },
      privacy: { ...site.legalPages.privacy, publish: true, paragraphs: ["Real text."] },
      terms: { ...site.legalPages.terms, publish: true, paragraphs: ["Real text."] },
    };
    expect(publishProblems(blocks, APPROVED)).toEqual([]);
  });

  it("ignores unpublished blocks: they do not render in production", () => {
    const blocks = {
      ...BLOCKS,
      privacy: { ...site.legalPages.privacy, publish: true, paragraphs: ["Real text."] },
      terms: { ...site.legalPages.terms, publish: true, paragraphs: ["Real text."] },
    };
    expect(publishProblems(blocks, APPROVED)).toEqual([]);
  });
});

describe("site helpers", () => {
  it("groups a mobile number five and five as it is typed, and keeps ten digits at most", () => {
    expect(formatMobile("98100")).toBe("98100");
    expect(formatMobile("981000")).toBe("98100 0");
    expect(formatMobile("98100 00000 99")).toBe("98100 00000");
    expect(mobileDigits("+91 98100-00000")).toBe("9198100000");
    expect(isCompleteMobile("98100 00000")).toBe(true);
    expect(isCompleteMobile("98100 0000")).toBe(false);
  });

  it("writes the booked headline from the proposed date and the window", () => {
    expect(bookedHeadline("2026-09-24", "before noon")).toBe("Thursday, 24 September, before noon.");
    expect(bookedHeadline("2027-01-02", "after six")).toBe("Saturday, 2 January, after six.");
  });

  it("fills content holes and leaves unknown ones", () => {
    expect(fill("not yet in {city}.", { city: "Mumbai" })).toBe("not yet in Mumbai.");
    expect(fill("{unknown}", {})).toBe("{unknown}");
  });

  it("keeps staging and local out of search engines, and only them", () => {
    expect(headersFile("staging", "default-src 'self'")).toContain("X-Robots-Tag: noindex");
    expect(robotsFile("local")).toContain("Disallow: /");
    expect(headersFile("production", "default-src 'self'")).not.toContain("X-Robots-Tag");
    expect(robotsFile("production")).toContain("Allow: /");
  });

  it("refuses an unknown build environment", () => {
    expect(siteEnvironment("staging")).toBe("staging");
    expect(() => siteEnvironment(undefined)).toThrow(/MM_ENV must be one of local, staging, production/);
  });

  it("keeps the hash-route redirects for links built on v2", () => {
    const home = readFileSync("site/src/pages/index.astro", "utf8");
    expect(home).toContain('location.hash === "#tryon"');
    expect(home).toContain('location.hash === "#book"');
  });
});
