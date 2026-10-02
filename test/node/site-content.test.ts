// The site's content file and the publish gate that guards production.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { GUARANTEE } from "@maneman/web-kit/guarantee";
import { describe, expect, it } from "vitest";
import { booking as appBooking, change as appChange } from "../../apps/app/src/content.ts";
import { DESIGN_PLACEHOLDERS, type PlaceholderBlockName } from "../../site/src/content/design-placeholders.ts";
import { referral } from "../../site/src/content/referral.ts";
import * as site from "../../site/src/content/site.ts";
import { bookedHeadline } from "../../site/src/lib/dates.ts";
import { siteEnvironment } from "../../site/src/lib/environment.ts";
import { HOUSE_CARD, HOUSE_CARD_VERSION } from "../../site/src/lib/invite.ts";
import { publishProblems } from "../../site/src/lib/publish-gate.ts";
import { headersFile, robotsFile } from "../../site/src/lib/static-files.ts";
import { fill } from "../../site/src/lib/text.ts";
import { PRESETS } from "../../src/config/presets.ts";
import { COPY_LONG_EDGE_PX, MAX_COPY_BYTES } from "../../src/config/tryon.ts";
import { VISIT_BLOCKS } from "../../src/config/scheduling.ts";
import { DELETION_DECIDED_WITHIN_DAYS } from "../../src/policy/account-deletion.ts";

const BLOCKS: Record<PlaceholderBlockName, { publish: boolean }> = {
  whatsapp: site.whatsapp,
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
const LEGAL_APPROVED = { privacy: { approved: true }, terms: { approved: true } };

/** Every paragraph of a legal page, as one text. */
function textOf(page: site.LegalPage): string {
  return page.sections.flatMap((section) => section.paragraphs).join(" ");
}

/** A legal page whose text is real, as counsel would hand it over. */
function realPage(page: site.LegalPage): site.LegalPage {
  return { ...page, publish: true, sections: [{ heading: "Real", paragraphs: ["Real text."] }] };
}

/** Every file name mentioned anywhere in the content. */
function filesIn(value: unknown): string[] {
  if (typeof value === "string") return /\.(jpg|mp4)$/.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(filesIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(filesIn);
  return [];
}

/** Where a file named in the content is, as site/src/lib/images.ts finds it, or null. */
function assetPath(file: string): string | null {
  for (const folder of ["site/src/assets", "design/assets"]) {
    if (existsSync(`${folder}/${file}`)) return `${folder}/${file}`;
  }
  return null;
}

describe("content", () => {
  it("refers only to images and footage that exist in site/src/assets or design/assets", () => {
    const files = filesIn(site);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) expect(assetPath(file), file).not.toBeNull();
  });

  // UX-20, PLAT-65: every phone downloaded the 2.3 MB film.
  it("gives phones a film under 800 KB", () => {
    const path = assetPath(site.heroFootage.phoneVideo);
    expect(path).not.toBeNull();
    expect(statSync(path ?? "").size).toBeLessThan(800 * 1024);
  });

  it("offers the backend's six presets in its order, split as the design labels them", () => {
    expect(site.looks.map((look) => look.id)).toEqual(PRESETS.map((preset) => preset.id));
    expect(site.looks[0]).toMatchObject({ density: "Full density", detail: "Natural hairline · short" });
  });

  it("builds the consent screen and the gate from the backend's notices, word for word", () => {
    const consent = site.consentCopy(site.notices.photo);
    expect(consent.title).toBe("What happens to your photograph.");
    expect(consent.rows.map((row) => row.k)).toEqual([
      "Used for",
      "Kept for",
      "Training",
      "Shared with",
      "To withdraw",
    ]);
    expect(consent.agreement).toBe("I understand, and I agree to my photograph being used this way.");
    expect(site.gateCopy(site.notices.gate).title).toBe("Where should we send it?");
  });

  // ADR 0104: the look goes to WhatsApp only, never to the site, so every build shows the notices that say so, which
  // await counsel and still keep a client's try-on (ADR 0084).
  it("says on every page of the try-on that the look goes to WhatsApp only, and never promises it on screen", () => {
    expect([site.notices.photo.version, site.notices.gate.version]).toEqual(["photo-v3", "gate-v3"]);
    expect([site.notices.photo.approved, site.notices.gate.approved]).toEqual([false, false]);
    expect(site.tryOnSendsCopy).toBe(true);
    const privacy = textOf(site.legalPages.privacy);
    expect(privacy).toContain("we send the simulation to that number on WhatsApp, and it is never shown on this site");
    expect(privacy).toContain("we keep a small copy of your photograph in your Mane Man account as your before photo");
    expect(privacy).not.toMatch(/show it to you again|optional/);
    expect(site.tryOnTeaser.body).toContain("sent privately to your WhatsApp");
    expect(textOf(site.legalPages.terms)).toContain("never shown on this site");
    const words = JSON.stringify({ tryOn: site.tryOn, notices: [site.notices.photo, site.notices.gate] });
    expect(words).not.toMatch(/next screen|Download|Drag the handle|hair patch/i);
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
    expect(site.discretionBand.text).toMatch(/^Three hours at your own table/);
    expect(site.howItWorks.steps.map((step) => step.meta)).toEqual([
      "An hour · free",
      "Three hours · at your home",
      "Every month · ninety minutes",
    ]);
    expect(site.faq.items[2]?.a).toMatch(/About ninety minutes, at your home\.$/);
    expect(site.closing.title).toBe("The consultation takes an hour and costs nothing.");
    expect(referral.consultation.body).toBe("An hour, and free. Or have your fit in the same visit.");
    expect(referral.howItWorks.steps.map((step) => step.body)).toEqual([
      "An hour. A scalp template and a colour match.",
      "Three hours. You're wearing it by the end.",
      "Lifted, cleaned, re-bonded, trimmed. Ninety minutes.",
    ]);
  });

  // The owner's copy of 1 October 2026 (ADR 0103): "hair system, not hair patch", and "100% real human hair".
  it("says hair system, never hair patch, and calls the hair 100% real human hair", () => {
    const pages = JSON.stringify(site) + JSON.stringify(referral);
    expect(pages).not.toMatch(/hair patch/i);
    expect(site.whatItIs.body).toContain("100% real human hair");
    expect(site.range.intro).toContain("100% real human hair");
    expect(site.whatItIs.body).toMatch(/bonded to the skin\. It is not a wig\.$/);
  });

  it("names the four hair systems as the owner named them, each with its line", () => {
    expect(site.range.products.map((product) => product.name)).toEqual([
      "Mane Man Essential",
      "Mane Man Active",
      "Mane Man Natural",
      "Mane Man NatMax",
    ]);
    for (const product of site.range.products) expect(product.tagline, product.name).not.toBe("");
  });

  // The product guide marks the multi-layer base "Test before promising" and measures no life of its own: the site
  // promises no life in months for any base we fit.
  it("promises no life in months for a base we fit", () => {
    const fitted = site.materials.groups.filter((group) => group.title !== "What we do not fit, and why");
    const said = JSON.stringify({ fitted, faq: site.faq, range: site.range });
    expect(said).not.toMatch(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b[^.]*\bmonths?\b/i);
  });

  it("gives every rated material one rating for each quality its group rates", () => {
    for (const group of site.materials.groups) {
      for (const item of group.items) {
        expect(item.ratings?.length, item.name).toBe(group.rated?.length);
      }
    }
  });

  // CLI-16: the site serves Delhi NCR, and the landing said Gurgaon. The owner's ruling on the wording is open
  // (ADR 0025, item 14); until then every page says what the home page does.
  it("names one service area on every page", () => {
    const pages = JSON.stringify(site) + JSON.stringify(referral);
    expect(pages).not.toContain("Gurgaon only");
    expect(site.header.area).toBe("Delhi NCR");
    expect(site.footer.area).toBe("Delhi NCR · home service only");
    expect(site.pageTitles.home).toContain("across Delhi NCR");
    expect(site.pageDescriptions.home).toContain("across Delhi NCR");
    expect(referral.waitlist.body).toBe("Delhi NCR only, for now.");
    expect(referral.preview.description(3)).toMatch(/^Home-fitted hair systems across Delhi NCR\./);
  });

  // CLI-19: production keeps a result fourteen days (ADR 0039), as the privacy notice says.
  it("keeps the try-on's result for as long as the privacy notice says", () => {
    expect(textOf(site.legalPages.privacy)).toContain("the simulation itself is kept for fourteen days");
    expect(site.tryOn.sent.privacy).toContain("we delete it after fourteen days");
  });

  it("publishes only blocks whose material is real: the business number, the privacy notice and the terms", () => {
    const published = Object.entries(BLOCKS)
      .filter(([, block]) => block.publish)
      .map(([name]) => name);
    expect(published).toEqual(["whatsapp", "privacy", "terms"]);
  });
});

describe("the second copy round", () => {
  // The placeholder quotes and founder's note are the design's, kept until the owner supplies real ones.
  const pages = JSON.stringify({ ...site, testimonials: null, founderNote: null }) + JSON.stringify(referral);

  // CP-06: the FAQ concedes a hand through the hair can tell, so nothing may claim it cannot.
  it("calls the hair 100% real human hair in the hero, and claims nowhere that it is undetectable", () => {
    expect(site.hero.sequence).toContain("100% real human hair.");
    expect(pages).not.toMatch(/undetectable/i);
    expect(site.pageDescriptions.home).toMatch(/^Hair systems in 100% real human hair/);
    expect(referral.arrival.title).toBe("A hair system, fitted at home. The consultation is free.");
  });

  // CP-20: /book and its search snippet opened "He measures your scalp", with nobody for "He" to be.
  it("names the technician on /book and in the try-on before anything is said of him", () => {
    expect(site.booking.intro).toMatch(/^Your technician measures your scalp/);
    expect(site.pageDescriptions.book).toBe(site.booking.intro);
    expect(site.tryOn.stage.body).not.toMatch(/\bHe\b/);
  });

  it("says how long each choice on the booking form takes", () => {
    expect(referral.consultation.plan.options.map((option) => option.label)).toEqual([
      "Consultation · an hour",
      "Consultation and fit · three hours",
    ]);
  });

  // CP-44: the site promised a refit or a refund within 14 days; the app's pay step, that the technician stops.
  it("gives the guarantee in one sentence on the home page, in the FAQ and at the app's pay step", () => {
    const answer = site.faq.items.find((item) => item.q === "What if I do not like it at the fit?")?.a;
    expect(site.guarantee.text).toBe(GUARANTEE);
    expect(answer).toBe(GUARANTEE);
    expect(appBooking.pay.guarantee).toBe(GUARANTEE);
  });

  // CP-45: no flow books a telephone consultation, so How it works does not offer one.
  it("promises no phone call in How it works", () => {
    expect(JSON.stringify(site.howItWorks)).not.toMatch(/telephon|phone|call/i);
    expect(site.howItWorks.steps.map((step) => step.number)).toEqual(["01", "02", "03"]);
    expect(site.stepPhotos.images).toHaveLength(site.howItWorks.steps.length);
  });

  // CP-46: "for just" sneered. The owner kept "Two of these are not ours." on 2 October 2026.
  it("keeps the owner's comparison line and gives a transplant's cost without a sneer", () => {
    expect(site.comparison.intro).toBe("Two of these are not ours.");
    expect(JSON.stringify(site.comparison)).not.toMatch(/\bjust\b/);
  });

  // CP-47: the prices block is hidden, but switched on it said a client pays on the day of the fit, and "piece".
  it("keeps the hidden prices true to how a client pays, in hair systems rather than pieces", () => {
    expect(site.prices.payment).not.toMatch(/on the day of the fit/);
    expect(JSON.stringify({ site: site.prices, landing: referral.prices })).not.toMatch(/\bpiece\b/i);
  });
});

describe("the legal pages", () => {
  const pages = [site.legalPages.privacy, site.legalPages.terms];

  // UX-39, CP-51: both pages were unbroken paragraphs, and a phone could not tap the number to ask for erasure.
  it("give each topic its own heading, and the WhatsApp number only as a link", () => {
    for (const page of pages) {
      expect(page.sections.length, page.title).toBeGreaterThan(3);
      for (const section of page.sections) expect(section.heading, page.title).not.toBe("");
      expect(textOf(page), page.title).toContain("{whatsapp}");
      expect(textOf(page), page.title).not.toContain("90079 73247");
    }
    expect(site.whatsapp.label).toBe(`WhatsApp · ${site.whatsapp.display}`);
  });

  // CP-51: the notice of 22 September 2026 erased "the same day", let any visit move free by message, took payment
  // on the day of the fit, and offered a call.
  it("say what Phase 2 does: erasure decided within seven days, visits paid at booking, changes in the app", () => {
    const privacy = textOf(site.legalPages.privacy);
    const terms = textOf(site.legalPages.terms);
    expect(privacy).not.toContain("the same day");
    expect(DELETION_DECIDED_WITHIN_DAYS).toBe(7);
    expect(privacy).toContain("We decide a request to erase within seven days.");
    expect(privacy).toContain("Invoices are kept for eight years, as the law requires.");
    expect(terms).not.toMatch(/on the day of the fit|by messaging us, at no charge|\bcall\b|\bwith him\b|\bpiece\b/);
    expect(terms).toContain("A visit you book in the app is paid when you book it");
    expect(terms).toContain("You can move or cancel a visit in the app.");
    expect(terms).toContain("5 to 7 working days");
    expect(appChange.cancel.refund("Rs. 1", "UPI")).toContain("5 to 7 working days");
  });
});

describe("the publish gate", () => {
  // ADR 0104: production can no longer show the approved v1 pair, which promised the look on screen, so its build
  // waits for counsel to approve the try-on's new notices (docs/open-points.md, item 146), and the legal pages'
  // Phase 2 wording, and for nothing else.
  it("stops production on what awaits counsel alone: every published block is real", () => {
    expect(publishProblems()).toEqual([
      "the photo notice (photo-v3) is not approved",
      "the gate notice (gate-v3) is not approved",
      "the privacy page's wording is not approved",
      "the terms page's wording is not approved",
    ]);
    expect(publishProblems(undefined, APPROVED, undefined, LEGAL_APPROVED)).toEqual([]);
  });

  // CP-51: the pages' Phase 2 wording is a draft until counsel signs it off.
  it("stops a legal page whose wording is not approved", () => {
    const legal = { ...LEGAL_APPROVED, terms: { approved: false } };
    expect(publishProblems(undefined, APPROVED, undefined, legal)).toEqual([
      "the terms page's wording is not approved",
    ]);
  });

  it("stops a notice that is not approved", () => {
    const notices = { ...APPROVED, consultation: { ...site.notices.consultation, approved: false } };
    expect(publishProblems(undefined, notices, undefined, LEGAL_APPROVED)).toEqual([
      "the consultation notice (referral-consultation-v1) is not approved",
    ]);
  });

  it("stops a published block that still holds the design's placeholder material", () => {
    const blocks = {
      ...BLOCKS,
      technicians: { ...site.technicians, publish: true },
      privacy: realPage(site.legalPages.privacy),
      terms: realPage(site.legalPages.terms),
    };
    const problems = publishProblems(blocks, APPROVED, undefined, LEGAL_APPROVED);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^technicians is published but still holds the design's placeholder material: /);
    expect(problems[0]).toContain("Imran Qureshi");
  });

  it("lets a published block through once its material is replaced", () => {
    const blocks = {
      ...BLOCKS,
      founderNote: { ...site.founderNote, publish: true, paragraphs: ["A real note."] },
      privacy: realPage(site.legalPages.privacy),
      terms: realPage(site.legalPages.terms),
    };
    expect(publishProblems(blocks, APPROVED, undefined, LEGAL_APPROVED)).toEqual([]);
  });

  it("ignores unpublished blocks: they do not render in production", () => {
    const blocks = {
      ...BLOCKS,
      privacy: realPage(site.legalPages.privacy),
      terms: realPage(site.legalPages.terms),
    };
    expect(publishProblems(blocks, APPROVED, undefined, LEGAL_APPROVED)).toEqual([]);
  });
});

describe("site helpers", () => {
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
