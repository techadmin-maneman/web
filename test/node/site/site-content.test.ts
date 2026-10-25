// The site's content file and the publish gate that guards production.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { GUARANTEE } from "@maneman/web-kit/guarantee";
import { describe, expect, it } from "vitest";
import { booking as appBooking, change as appChange } from "../../../apps/app/src/content.ts";
import { DESIGN_PLACEHOLDERS, type PlaceholderBlockName } from "../../../site/src/content/design-placeholders.ts";
import { guides } from "../../../site/src/content/guides.ts";
import { referral } from "../../../site/src/content/referral.ts";
import * as site from "../../../site/src/content/site.ts";
import { siteEnvironment } from "../../../site/src/lib/environment.ts";
import { HOUSE_CARD, HOUSE_CARD_VERSION } from "../../../site/src/lib/invite.ts";
import { publishProblems } from "../../../site/src/lib/publish-gate.ts";
import { headersFile, robotsFile } from "../../../site/src/lib/static-files.ts";
import { fill } from "../../../site/src/lib/text.ts";
import { PRESETS } from "../../../src/config/presets.ts";
import { COPY_LONG_EDGE_PX, MAX_COPY_BYTES } from "../../../src/config/tryon.ts";
import { VISIT_BLOCKS } from "../../../src/config/scheduling.ts";
import { DELETION_DECIDED_WITHIN_DAYS } from "../../../src/policy/account-deletion.ts";
import { FREE_CHANGE_NOTICE_HOURS } from "../../../src/policy/moving-a-visit.ts";
import { NO_SHOW_WAIT_MIN } from "../../../src/policy/no-show.ts";

const BLOCKS: Record<PlaceholderBlockName, { publish: boolean }> = {
  whatsapp: site.whatsapp,
  heroFootage: site.heroFootage,
  norwoodPhotos: site.norwoodPhotos,
  teaserPair: site.teaserPair,
  stepPhotos: site.stepPhotos,
  founderNote: site.founderNote,
  privacy: site.legalPages.privacy,
  terms: site.legalPages.terms,
};
const APPROVED = Object.fromEntries(
  Object.entries(site.notices).map(([name, notice]) => [name, { ...notice, approved: true }]),
);
const LEGAL_APPROVED = { privacy: { approved: true }, terms: { approved: true } };

/** Every word of a legal page, as one text: its opening, each clause with its run-in heading, and its table. */
function textOf(page: site.LegalPage): string {
  const words = (block: site.LegalBlock): string[] =>
    "paragraph" in block
      ? [block.paragraph]
      : "lines" in block
        ? [...block.lines]
        : [block.lead ?? "", block.text, ...(block.items ?? []).flatMap(words)];
  const annex = page.annex === undefined ? [] : [page.annex.heading, ...page.annex.rows.flat(), page.annex.note];
  return [...page.intro, ...page.sections.flatMap((section) => section.blocks.flatMap(words)), ...annex].join(" ");
}

/** A legal page whose text is real, as counsel would hand it over. */
function realPage(page: site.LegalPage): site.LegalPage {
  return { ...page, publish: true, sections: [{ heading: "Real", blocks: [{ paragraph: "Real text." }] }] };
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

  // Every phone downloaded the 2.3 MB film.
  it("gives phones a film under 800 KB", () => {
    const path = assetPath(site.heroFootage.phoneVideo);
    expect(path).not.toBeNull();
    expect(statSync(path ?? "").size).toBeLessThan(800 * 1024);
  });

  it("offers the backend’s six looks in its order, each split at its first dot", () => {
    expect(site.looks.map((look) => look.id)).toEqual(PRESETS.map((preset) => preset.id));
    expect(site.looks[0]).toMatchObject({ name: "Side part", detail: "" });
    expect(site.looks[2]).toMatchObject({ name: "Textured crop", detail: "Low fade" });
  });

  // The try-on asked for its photo on a screen of its own, five rows long; now one line links to the full notice.
  it("gives the photo and the gate one line each, linking to the try-on notice on /notices", () => {
    expect(site.notices.photo.line).toEqual({
      says: "By using this photo, you agree to our try-on notice.",
      link: "try-on notice",
      href: "/notices#try-on",
    });
    expect(site.notices.gate.line?.says).toBe("By sending it, you agree to our try-on notice.");
    expect(site.noticeSections["try-on"].rows.map((row) => row.label)).toEqual([
      "Used for",
      "Kept for",
      "Training",
      "Shared with",
      "Marketing",
      "To withdraw",
    ]);
  });

  // The look goes to WhatsApp, and is shown on the page that proved the number once ready (ADR 0214), so every build
  // shows the notices that say so, which counsel approved and which still keep a client's try-on (ADR 0084).
  it("says on every page of the try-on that the look goes to WhatsApp and is shown here once ready", () => {
    expect([site.notices.photo.version, site.notices.gate.version]).toEqual(["photo-v7", "gate-v7"]);
    expect([site.notices.photo.approved, site.notices.gate.approved]).toEqual([true, true]);
    expect(site.tryOnSendsCopy).toBe(true);
    const terms = textOf(site.legalPages.terms);
    expect(terms).toContain("We will send the simulation to that WhatsApp number, and show it on the Platform");
    expect(terms).toContain(
      "we keep a small copy of your photograph in your Mane Man Account as your “before” photograph",
    );
    expect(terms).not.toMatch(/show it to you again|optional|AILabTools/);
    expect(site.tryOnTeaser.body).toContain("sent privately to your WhatsApp");
    const words = JSON.stringify({ tryOn: site.tryOn, notices: [site.notices.photo, site.notices.gate] });
    expect(words).not.toMatch(/next screen|Download|Drag the handle|hair patch/i);
  });

  it("makes the small copy the size the API keeps, as the technician’s camera makes a visit photograph", () => {
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

  // The design's lengths:
  // "consultation 60 minutes, service 90, replacement 135, first fit 180".
  it("says each visit is as long as the backend books it", () => {
    expect(VISIT_BLOCKS.consultation.minutes).toBe(60);
    expect(VISIT_BLOCKS.service.minutes).toBe(90);
    expect(VISIT_BLOCKS.first_fit.minutes).toBe(180);
    const published = JSON.stringify({ ...site, ...BLOCKS }) + JSON.stringify(referral);
    expect(published).not.toMatch(/forty minutes|about an hour|one hour|ninety minutes · at your table/i);
    expect(site.discretionBand.text).toMatch(/^3 hours at your own table/);
    expect(site.howItWorks.steps.map((step) => step.meta)).toEqual([
      "60 minutes · free",
      "3 hours · at your home",
      "90 minutes · at your home",
    ]);
    expect(site.faq.items[2]?.a).toMatch(/About 90 minutes, at your home\.$/);
    expect(site.closing.title).toBe("The consultation takes 60 minutes and costs nothing.");
    expect(referral.consultation.body).toBe("60 minutes, and free. Or have your fit in the same visit.");
    expect(referral.howItWorks.steps.map((step) => step.lead)).toEqual([
      "60 minutes. Completely confidential.",
      "3 hours. Real-time transformation. Be the Main Man again.",
      "No trips to the salon. We come to you.",
    ]);
    expect(site.norwood.restored).toBe("From these to this in 3 hours.");
  });

  // The home page's copy (ADR 0103): "hair system, not hair patch", and "100% real human hair".
  it("says hair system, never hair patch, and calls the hair 100% real human hair", () => {
    const pages = JSON.stringify(site) + JSON.stringify(referral);
    expect(pages).not.toMatch(/hair patch/i);
    expect(site.whatItIs.body).toContain("100% real human hair");
    expect(site.range.intro).toContain("100% real human hair");
    expect(site.whatItIs.body).toMatch(/bonded to the skin\. It is not a wig\.$/);
  });

  // The guide of 6 October 2026 compares them side by side, with no price; how long each lasts is its figure (ADR 0215).
  it("names the four hair systems as the product guide names them, and compares each on every row", () => {
    expect(site.range.products.map((product) => product.name)).toEqual([
      "Mane Man Essential",
      "Mane Man Active",
      "Mane Man Natural",
      "Mane Man Celebrity",
    ]);
    for (const row of site.range.rows) expect(row.cells, row.label).toHaveLength(site.range.products.length);
    expect(JSON.stringify(site.range)).not.toMatch(/Rs\.|₹/);
    expect(site.range.rows.find((row) => row.label === "Lasts")?.cells).toEqual([
      "8 months",
      "6 months",
      "6 months",
      "4 months",
    ]);
  });

  // The product guide marks the multi-layer base "Test before promising" and measures no life of its own: the site
  // promises no life in months for any base we fit.
  // The range table gives the guide's own figures (ADR 0215); nowhere else says one.
  it("promises no life in months for a base we fit, outside the range table", () => {
    const materials = guides.find((guide) => guide.slug === "hair-system-materials");
    const fitted = materials?.sections.filter((section) => section.heading !== "What we do not fit, and why");
    expect(fitted).toHaveLength(5);
    const said = JSON.stringify({ fitted, faq: site.faq });
    expect(said).not.toMatch(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b[^.]*\bmonths?\b/i);
  });

  // The site serves Delhi NCR, and the landing said Gurgaon. The wording is still open
  // (open point 14); until then every page says what the home page does.
  it("names one service area on every page", () => {
    const pages = JSON.stringify(site) + JSON.stringify(referral);
    expect(pages).not.toContain("Gurgaon only");
    expect(site.header.area).toBe("Delhi NCR");
    expect(site.footer.area).toBe("Delhi NCR · home service only");
    expect(site.pageTitles.home).toContain("across Delhi NCR");
    expect(site.pageDescriptions.home).toContain("across Delhi NCR");
    expect(referral.waitlist.body).toBe("Delhi NCR only, for now.");
    expect(referral.preview.description).toMatch(/^Home-fitted hair systems across Delhi NCR\./);
  });

  // Production keeps a result fourteen days (ADR 0039), as the terms say.
  it("keeps the try-on’s result for as long as the terms say", () => {
    expect(textOf(site.legalPages.terms)).toContain("The simulation itself will be kept for 14 (fourteen) days.");
    expect(site.tryOn.sent.privacy).toBe("We delete it after 14 days.");
  });

  it("publishes only blocks whose material is real: the business number, the privacy notice and the terms", () => {
    const published = Object.entries(BLOCKS)
      .filter(([, block]) => block.publish)
      .map(([name]) => name);
    expect(published).toEqual([
      "whatsapp",
      "heroFootage",
      "norwoodPhotos",
      "teaserPair",
      "stepPhotos",
      "founderNote",
      "privacy",
      "terms",
    ]);
  });
});

describe("the second copy round", () => {
  const pages = JSON.stringify(site) + JSON.stringify(referral);

  // The FAQ concedes a hand through the hair can tell, so nothing may claim it cannot.
  it("calls the hair 100% real human hair in the hero, and claims nowhere that it is undetectable", () => {
    expect(site.hero.sequence).toContain("100% real human hair.");
    expect(pages).not.toMatch(/undetectable/i);
    expect(site.pageDescriptions.home).toMatch(/^Hair systems in 100% real human hair/);
    expect(referral.arrival.title).toBe("A hair system, fitted at home. The consultation is free.");
  });

  // /book and its search snippet opened "He measures your scalp", with nobody for "He" to be.
  it("names who comes on /book and in the try-on before anything is said of them", () => {
    expect(site.booking.intro[0]).toMatch(/^In just 60 minutes, a specialist measures/);
    expect(site.pageDescriptions.book).toBe(site.booking.intro.join(" "));
    expect(JSON.stringify(site.tryOn)).not.toMatch(/\bHe\b/);
  });

  // Only the gate says where the look goes.
  it("leaves where the look goes to the gate", () => {
    const screens = JSON.stringify(site.tryOn);
    expect(screens).not.toMatch(/never shown|privately|for your privacy/i);
    expect(site.tryOn.gate.caption).toContain("WhatsApp");
  });

  // No empty "Preview" box stands in for a look's picture.
  it("draws the looks' pictures only once all six have one, and labels no empty box", () => {
    expect(site.tryOn.looks).not.toHaveProperty("preview");
    expect(site.lookPictures()).toEqual(site.looks.map((look) => `look-${look.id}.jpg`));
    const six = site.looks.map((look) => ({ picture: `${look.id}.jpg` }));
    expect(site.lookPictures(six)).toEqual(site.looks.map((look) => `${look.id}.jpg`));
    expect(site.lookPictures([...six.slice(1), { picture: undefined }])).toBeNull();
  });

  it("says how long each choice on the booking form takes", () => {
    expect(referral.consultation.plan.options.map((option) => option.label)).toEqual([
      "Consultation · 60 minutes",
      "Consultation and fit · 3 hours",
    ]);
  });

  // The site promised a refit or a refund within 14 days; the app's pay step, that the technician stops. The FAQ says
  // first that a client who decides against it before the fit pays nothing, as the one visit's flow has it.
  it("gives the guarantee in one sentence on the home page, in the FAQ and at the app’s pay step", () => {
    const answer = site.faq.items.find((item) => item.q === "What if I don’t like it?")?.a ?? "";
    expect(site.guarantee.text).toBe(GUARANTEE);
    expect(answer.startsWith("Say so before it’s fitted and you pay nothing. Once it’s fitted: ")).toBe(true);
    expect(answer.toLowerCase().endsWith(GUARANTEE.toLowerCase())).toBe(true);
    expect(appBooking.pay.guarantee).toBe(GUARANTEE);
  });

  // No flow books a telephone consultation, so How it works does not offer one.
  it("promises no phone call in How it works", () => {
    expect(JSON.stringify(site.howItWorks)).not.toMatch(/telephon|phone|call/i);
    expect(site.howItWorks.steps.map((step) => step.number)).toEqual(["01", "02", "03"]);
    expect(site.stepPhotos.images).toHaveLength(site.howItWorks.steps.length);
  });

  // "for just" sneered. The table gives a transplant's and medication's typical costs, never ours (ADR 0213).
  it("compares without a sneer, and gives no price of ours", () => {
    expect(site.comparison.intro).toBe("How a hair system compares.");
    expect(JSON.stringify(site.comparison)).not.toMatch(/\bjust\b/);
    expect(site.comparison.rows[0]?.cells).toEqual([
      "Rs. 1.2–3 lakh, very often repeated",
      "Rs. 20,000–50,000 a year, for life",
      "Quoted free, before anything is fitted",
    ]);
    expect(JSON.stringify(site.comparison.rows.map((row) => row.cells[2]))).not.toMatch(/Rs\.|₹/);
  });
});

describe("the legal pages", () => {
  const pages = [site.legalPages.privacy, site.legalPages.terms];

  // Counsel's documents, each blank filled: the company is Mane Man Private Limited, and the try-on is YouCam's.
  it("name the company and its services, with no blank or bracket of the draft left", () => {
    for (const page of pages) {
      const text = textOf(page);
      expect(page.sections.length, page.title).toBeGreaterThan(10);
      for (const section of page.sections) expect(section.heading, page.title).not.toBe("");
      expect(text, page.title).toContain("Mane Man Private Limited");
      expect(text, page.title).not.toMatch(/Grooming Services|AlLabTools|AILabTools|\[●\]|\[|\]/);
      expect(page.version, page.title).toEqual({ number: "1.00", date: expect.any(String) as string });
    }
    expect(textOf(site.legalPages.privacy)).toContain("YouCam (Perfect Corp), for the virtual try-on");
  });

  it("name the Grievance Officer, how to reach them, and how soon a complaint is answered", () => {
    for (const page of pages) {
      expect(textOf(page), page.title).toContain("Name: Adwate Kumar");
      expect(textOf(page), page.title).toContain("Designation: Co-founder and COO");
      expect(textOf(page), page.title).toContain("grievance@maneman.in");
    }
    const terms = textOf(site.legalPages.terms);
    expect(terms).toContain("Mobile: +91 90079 73247");
    expect(terms).toContain("acknowledge your complaint within 48 (forty-eight) hours");
    expect(terms).toContain("resolve it within 30 (thirty) days");
    expect(textOf(site.legalPages.privacy)).toContain(
      "Address: D-13 Ground Floor, CC Colony, Malka Ganj, Delhi 110007",
    );
  });

  // What the terms promise is what the app does: the free-change notice and the no-show wait are its own defaults.
  it("say what the app does: UPI at the visit, free changes until the notice, a 15-minute wait, refunds in 5 to 7 days", () => {
    const terms = textOf(site.legalPages.terms);
    expect(terms).toContain("by UPI to Mane Man at the time of the visit");
    expect(terms).toContain("the Technician should never be paid any amount");
    expect(terms).toContain(`Until ${String(FREE_CHANGE_NOTICE_HOURS)} (twenty-four) hours before the time slot`);
    expect(Object.values(NO_SHOW_WAIT_MIN)).toEqual([15, 15, 15, 15]);
    expect(terms).toContain("within 15 minutes of the booking time");
    expect(site.legalPages.terms.annex?.rows).toEqual([
      ["More than 24 hours", "0%"],
      ["24 hours or less", "Up to 100%"],
      [expect.stringContaining("15 minutes") as string, "Up to 100%"],
    ]);
    expect(terms).toContain("The Free Visit can be availed only once per individual.");
    expect(terms).toContain("confirmation of the booking via WhatsApp or SMS");
    expect(terms).toContain("5 (five) to 7 (seven) working days");
    expect(appChange.cancel.refund("Rs. 1", "UPI")).toContain("5 to 7 working days");
    expect(DELETION_DECIDED_WITHIN_DAYS).toBe(30);
    expect(textOf(site.legalPages.privacy)).toContain(
      "Mane Man may take up to 30 (thirty) working days to process your request",
    );
  });

  it("point the guarantee and the wear clause to the aftercare policy, and promotions to their own terms", () => {
    const terms = textOf(site.legalPages.terms);
    expect(terms.match(/https:\/\/maneman\.in\/aftercare/g)).toHaveLength(2);
    expect(terms).toContain("these Terms prevail over the terms of any promotional offer");
    expect(terms).toContain("https://maneman.in/offer-terms");
  });
});

describe("the publish gate", () => {
  // ADR 0104: production can no longer show the approved v1 pair, which promised the look on screen; the try-on's new
  // notices, the privacy policy, the terms, the aftercare policy and the offer terms are approved, so nothing holds
  // production's build.
  it("lets production build: every published block is real, and every notice and legal page approved", () => {
    expect(publishProblems()).toEqual([]);
    expect(publishProblems(undefined, APPROVED, undefined, LEGAL_APPROVED)).toEqual([]);
  });

  // The pages' wording for the apps is a draft until counsel signs it off.
  it("stops a legal page whose wording is not approved", () => {
    const legal = { ...LEGAL_APPROVED, terms: { approved: false } };
    expect(publishProblems(undefined, APPROVED, undefined, legal)).toEqual([
      "the terms page’s wording is not approved",
    ]);
  });

  it("stops a notice that is not approved", () => {
    const notices = { ...APPROVED, consultation: { ...site.notices.consultation, approved: false } };
    expect(publishProblems(undefined, notices, undefined, LEGAL_APPROVED)).toEqual([
      "the consultation notice (referral-consultation-v2) is not approved",
    ]);
  });

  it("stops a published block that still holds the design’s placeholder material", () => {
    const blocks = {
      ...BLOCKS,
      norwoodPhotos: { ...site.norwoodPhotos, images: [{ file: "nw-3.jpg", alt: "The design’s stage III" }] },
      privacy: realPage(site.legalPages.privacy),
      terms: realPage(site.legalPages.terms),
    };
    const problems = publishProblems(blocks, APPROVED, undefined, LEGAL_APPROVED);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^norwoodPhotos is published but still holds the design’s placeholder material: /);
    expect(problems[0]).toContain("nw-3.jpg");
  });

  it("lets a published block through once its material is replaced", () => {
    const blocks = {
      ...BLOCKS,
      norwoodPhotos: { ...site.norwoodPhotos, publish: true, images: [{ file: "stage-3.jpg", alt: "A real stage" }] },
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
  it("fills content holes and leaves unknown ones", () => {
    expect(fill("not yet in {city}.", { city: "Mumbai" })).toBe("not yet in Mumbai.");
    expect(fill("{unknown}", {})).toBe("{unknown}");
  });

  it("keeps staging and local out of search engines, and only them", () => {
    expect(headersFile(false, "default-src 'self'")).toContain("X-Robots-Tag: noindex");
    expect(robotsFile(false)).toContain("Disallow: /");
    expect(headersFile(true, "default-src 'self'")).not.toContain("X-Robots-Tag");
    expect(robotsFile(true)).toContain("Allow: /");
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
      // The referral card's gilt rule and lockup (scripts/build/make-house-card.ts).
      2: "d40596cbd613caf7083f6bee3ecf8f399b932fb3f4088ab4d8a91e485d89aa5a",
      // One field of the deep ink with the mark and wordmark at its centre, with no photographs to wait for.
      3: "8a2fb1e218698abce3ad056efd570369884a99df508da47f5379e05fc9280893",
    };
    const file = createHash("sha256").update(readFileSync("site/public/images/invite-house.jpg")).digest("hex");
    expect(file, "invite-house.jpg changed: raise HOUSE_CARD_VERSION and record the new file here").toBe(
      CARDS[HOUSE_CARD_VERSION],
    );
    expect(HOUSE_CARD).toBe(`/images/invite-house.jpg?v=${String(HOUSE_CARD_VERSION)}`);
  });
});
