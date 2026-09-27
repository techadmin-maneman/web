// The site's content file and the publish gate that guards production.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESIGN_PLACEHOLDERS, type PlaceholderBlockName } from "../../site/src/content/design-placeholders.ts";
import { referral } from "../../site/src/content/referral.ts";
import * as site from "../../site/src/content/site.ts";
import { bookedHeadline } from "../../site/src/lib/dates.ts";
import { siteEnvironment } from "../../site/src/lib/environment.ts";
import { HOUSE_CARD, HOUSE_CARD_VERSION } from "../../site/src/lib/invite.ts";
import { formatMobile, isCompleteMobile, mobileDigits } from "../../site/src/lib/phone.ts";
import { publishProblems } from "../../site/src/lib/publish-gate.ts";
import { headersFile, robotsFile } from "../../site/src/lib/static-files.ts";
import { fill } from "../../site/src/lib/text.ts";
import { PRESETS } from "../../src/config/presets.ts";
import { COPY_LONG_EDGE_PX, MAX_COPY_BYTES } from "../../src/config/tryon.ts";
import { VISIT_BLOCKS } from "../../src/config/scheduling.ts";

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

  it("builds the consent screen and the gate from the backend's notices, word for word, in either promise", () => {
    for (const promise of Object.values(site.tryOnPromises)) {
      const consent = site.consentCopy(promise.photo);
      expect(consent.title).toBe("What happens to your photograph.");
      expect(consent.rows.map((row) => row.k)).toEqual([
        "Used for",
        "Kept for",
        "Training",
        "Shared with",
        "To withdraw",
      ]);
      expect(consent.agreement).toBe("I understand, and I agree to my photograph being used this way.");
      expect(site.gateCopy(promise.gate).title).toBe("Where should we send it?");
    }
  });

  // ADR 0084: the notices that keep a client's try-on await counsel, so production keeps the approved pair, and
  // today's rules, and sends no copy.
  it("makes production the approved promise, and every other build the one awaiting counsel, which sends the copy", () => {
    const { approved, awaitingCounsel } = site.tryOnPromises;
    expect(approved.photo).toEqual(site.notices.photo);
    expect(approved.gate).toEqual(site.notices.gate);
    expect([approved.photo.approved, approved.gate.approved, approved.sendsCopy]).toEqual([true, true, false]);
    expect([awaitingCounsel.photo.version, awaitingCounsel.gate.version]).toEqual(["photo-v2", "gate-v2"]);
    expect([awaitingCounsel.photo.approved, awaitingCounsel.sendsCopy]).toEqual([false, true]);
    expect(site.privacyPage(awaitingCounsel.privacy).paragraphs[0]).toContain(
      "we keep a small copy of your photograph in your Mane Man account as your before photo",
    );
    expect(readFileSync("site/src/lib/build.ts", "utf8")).toContain(
      `TRY_ON_PROMISE: TryOnPromiseName = IS_PRODUCTION ? "approved" : "awaitingCounsel"`,
    );
  });

  it("makes the small copy the size the API keeps, as the technician's camera makes a visit photograph", () => {
    const encoder = readFileSync("packages/web-kit/small-jpeg.ts", "utf8");
    expect(MAX_COPY_BYTES).toBe(250 * 1024);
    expect(encoder).toContain("SMALL_JPEG_BYTES = 250 * 1024");
    expect(encoder).toContain(`SMALL_JPEG_LONG_EDGE = ${String(COPY_LONG_EDGE_PX)}`);
  });

  it("holds every placeholder value the gate knows in each unpublished block, so the gate list stays accurate", () => {
    for (const [name, values] of Object.entries(DESIGN_PLACEHOLDERS) as [PlaceholderBlockName, readonly string[]][]) {
      if (BLOCKS[name].publish) continue;
      const text = JSON.stringify(BLOCKS[name]);
      for (const value of values) expect(text, `${name}: ${value}`).toContain(JSON.stringify(value).slice(1, -1));
    }
  });

  // CLI-15, LIFE-16, FEO-23: the owner kept the design's lengths on 24 September 2026 (docs/open-points.md, item 122):
  // "consultation 60 minutes, service 90, replacement 135, first fit 180".
  it("says each visit is as long as the backend books it", () => {
    expect(VISIT_BLOCKS.consultation.minutes).toBe(60);
    expect(VISIT_BLOCKS.service.minutes).toBe(90);
    expect(VISIT_BLOCKS.first_fit.minutes).toBe(180);
    const published = JSON.stringify({ ...site, ...BLOCKS, testimonials: null }) + JSON.stringify(referral);
    expect(published).not.toMatch(/forty minutes|about an hour|one hour|ninety minutes · at your table/i);
    expect(site.hero.body).toContain("in about three hours");
    expect(site.howItWorks.steps.map((step) => step.meta)).toEqual([
      "Fifteen minutes · free",
      "An hour · free",
      "Three hours · at your table",
      "{service} a visit · ninety minutes",
    ]);
    expect(site.faq.items[2]?.a).toMatch(/About ninety minutes, at your home\.$/);
    expect(site.closing.title).toBe("The consultation takes an hour and costs nothing.");
    expect(referral.consultation.body).toBe("An hour. Nothing fitted, nothing to pay.");
    expect(referral.howItWorks.steps.map((step) => step.body)).toEqual([
      "An hour. A scalp template and a colour match.",
      "Three hours. You leave the house wearing it.",
      "Lifted, cleaned, re-bonded, trimmed. Ninety minutes.",
    ]);
  });

  // CLI-16: the site serves Delhi NCR, and the landing said Gurgaon. The owner's ruling on the wording is open
  // (ADR 0025, item 14); until then every page says what the home page does.
  it("names one service area on every page", () => {
    const pages = JSON.stringify(site) + JSON.stringify(referral);
    expect(pages).not.toContain("Gurgaon only");
    expect(referral.arrival.title).toBe("Hair, fitted at your home across Delhi NCR.");
    expect(site.hero.title).toBe(referral.arrival.title);
    expect(referral.waitlist.body).toBe("Delhi NCR only, for now.");
    expect(referral.preview.description).toMatch(/^Home-fitted hair systems across Delhi NCR\./);
  });

  // CLI-19: production keeps a result fourteen days (ADR 0039), as the privacy notice says.
  it("keeps the try-on's result for as long as the privacy notice says", () => {
    expect(site.legalPages.privacy.paragraphs[0]).toContain("the simulation itself is kept for fourteen days");
    expect(site.tryOn.result.copy.after).toBe(". Deleted after fourteen days.");
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

  it("writes the booked headline as board C4 does, from the date and the window's hours", () => {
    expect(bookedHeadline("2026-09-21", "9 am to 12 pm")).toBe("Monday 21 Sep, 9 am to 12 pm");
    expect(bookedHeadline("2027-01-02", "4 to 8 pm")).toBe("Saturday 2 Jan, 4 to 8 pm");
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

  // REQ-S3-05: every word a visitor or a screen reader meets is in the content files.
  it("leaves no label, alternative text or site name written in a component", () => {
    const components = [
      "site/src/components",
      "site/src/components/home",
      "site/src/layouts",
      "site/src/islands",
      "site/src/islands/tryon",
      "site/src/islands/invite",
      "site/src/pages",
    ].flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => /\.(astro|tsx)$/.test(name))
        .map((name) => `${dir}/${name}`),
    );
    for (const path of components) {
      const text = readFileSync(path, "utf8");
      expect(text, path).not.toMatch(/\b(aria-label|alt|title|placeholder)="[A-Za-z]/);
      expect(text, path).not.toMatch(/property="og:(site_name|image:alt)" content="[A-Za-z]/);
    }
  });

  it("keeps the hash-route redirects for links built on v2", () => {
    const home = readFileSync("site/src/pages/index.astro", "utf8");
    expect(home).toContain('location.hash === "#tryon"');
    expect(home).toContain('location.hash === "#book"');
  });

  // REQ-S8-03: chats cache a preview by its address, so the house card replaced at the same path needs a new version.
  it("gives the house card a new version whenever its file changes", () => {
    const CARDS: Record<number, string> = {
      1: "3becedf10d96f13d6bb0c144ed904f4d81b5ffb835523e5c9e7f43609a2d6302",
      // Board A1's gilt rule and lockup (scripts/make-house-card.ts, 25 September 2026).
      2: "d40596cbd613caf7083f6bee3ecf8f399b932fb3f4088ab4d8a91e485d89aa5a",
    };
    const file = createHash("sha256").update(readFileSync("site/public/images/invite-house.jpg")).digest("hex");
    expect(file, "invite-house.jpg changed: raise HOUSE_CARD_VERSION and record the new file here").toBe(
      CARDS[HOUSE_CARD_VERSION],
    );
    expect(HOUSE_CARD).toBe(`/images/invite-house.jpg?v=${String(HOUSE_CARD_VERSION)}`);
  });
});
