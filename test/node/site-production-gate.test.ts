// The publish gate, end to end: the production site builds only when every
// notice and legal page is approved, and then ships none of the design's
// placeholder material.
// The gate's refusals are proven in test/node/site-content.test.ts.
//
// Since the owner's ruling of 1 October 2026 the try-on's look goes to WhatsApp
// only (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md), and the only
// notices that say so await counsel (docs/open-points.md, item 146). Until
// counsel approves them, and the legal pages' Phase 2 wording, the production
// build refuses them, and nothing else; what a production build ships is
// checked again the day it builds.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESIGN_PLACEHOLDERS } from "../../site/src/content/design-placeholders.ts";
import { legalPages, notices } from "../../site/src/content/site.ts";
import { unreferencedAssets } from "../../site/src/lib/static-files.ts";

const OUT = "site/dist/production";
const AWAITING_COUNSEL = Object.values(notices).filter((notice) => !notice.approved);
const PAGES_AWAITING_COUNSEL = Object.values(legalPages).filter((page) => !page.approved);
const BUILDS = AWAITING_COUNSEL.length === 0 && PAGES_AWAITING_COUNSEL.length === 0;

describe("the production site build", () => {
  it.runIf(!BUILDS)("refuses what awaits counsel, and nothing else", { timeout: 180_000 }, () => {
    expect(AWAITING_COUNSEL.map((notice) => notice.version)).toEqual(["photo-v4", "gate-v4"]);
    expect(PAGES_AWAITING_COUNSEL.map((page) => page.title)).toEqual(["Privacy", "Terms"]);
    const build = spawnSync(process.execPath, ["scripts/build/build-site.ts", "--env", "production"], {
      encoding: "utf8",
    });
    const output = `${build.stdout}${build.stderr}`;
    expect(build.status, output).not.toBe(0);
    const problems = output.split("\n").filter((line) => line.startsWith("  - "));
    expect(problems.slice(0, 4)).toEqual([
      "  - the photo notice (photo-v4) is not approved",
      "  - the gate notice (gate-v4) is not approved",
      "  - the privacy page's wording is not approved",
      "  - the terms page's wording is not approved",
    ]);
    // The sentences counsel has still to see are marked in the site's content, and refused with the rest (CQ-43).
    expect(problems.slice(4)).toEqual([expect.stringMatching(/^ {2}- site\/src\/content\/site\.ts: \d+ lines marked/)]);
  });

  it.runIf(BUILDS)("passes the publish gate", { timeout: 180_000 }, () => {
    const build = spawnSync(process.execPath, ["scripts/build/build-site.ts", "--env", "production"], {
      encoding: "utf8",
    });
    expect(build.status, `${build.stdout}${build.stderr}`).toBe(0);
  });

  it.runIf(BUILDS)("ships no placeholder tag, no noindex and none of the design's placeholder text", () => {
    const pages = readdirSync(OUT).filter((file) => file.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(5);
    const placeholders = Object.values(DESIGN_PLACEHOLDERS)
      .flat()
      .filter((value) => value.length > 12);
    for (const page of pages) {
      const html = readFileSync(`${OUT}/${page}`, "utf8");
      expect(html, page).not.toContain(">Placeholder<");
      // Two pages stay out of search engines: the 404, and the referral landing, whose
      // address holds one person's invite code (docs/decisions/0027-referral-landing.md).
      if (page !== "404.html" && page !== "r.html") expect(html, page).not.toContain("noindex");
      for (const value of placeholders) expect(html, `${page}: ${value}`).not.toContain(value);
    }
    expect(readFileSync(`${OUT}/robots.txt`, "utf8")).toContain("Allow: /");
    expect(readFileSync(`${OUT}/_headers`, "utf8")).not.toContain("X-Robots-Tag");
  });

  // REQ-S4-01: a placeholder photograph is not published by leaving it at a hashed address nothing links to.
  it.runIf(BUILDS)("ships none of the design's placeholder photographs or footage, even unlinked", () => {
    const files = readdirSync(`${OUT}/_astro`);
    const stems = Object.values(DESIGN_PLACEHOLDERS)
      .flat()
      .filter((value) => /\.(jpg|mp4)$/.test(value))
      .map((file) => file.replace(/\.(jpg|mp4)$/, ""));
    expect(stems.length).toBeGreaterThan(20);
    for (const stem of stems) {
      expect(
        files.filter((file) => file.startsWith(`${stem}.`)),
        stem,
      ).toEqual([]);
    }
  });
});

describe("unreferenced assets", () => {
  it("are the built files no page, script or stylesheet names", () => {
    const texts = ['<img src="/_astro/logo.abc.webp">', "url(/_astro/font.def.woff2)"];
    expect(unreferencedAssets(["logo.abc.webp", "font.def.woff2", "hero.123.mp4"], texts)).toEqual(["hero.123.mp4"]);
  });
});
