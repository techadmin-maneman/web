// The publish gate, end to end: the production site builds, and ships none of
// the design's placeholder material. The gate's refusals are proven in
// test/node/site-content.test.ts.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESIGN_PLACEHOLDERS } from "../../site/src/content/design-placeholders.ts";
import { unreferencedAssets } from "../../site/src/lib/static-files.ts";

const OUT = "site/dist/production";

describe("the production site build", () => {
  it("passes the publish gate", { timeout: 180_000 }, () => {
    const build = spawnSync(process.execPath, ["scripts/build-site.ts", "--env", "production"], { encoding: "utf8" });
    expect(build.status, `${build.stdout}${build.stderr}`).toBe(0);
  });

  it("ships no placeholder tag, no noindex and none of the design's placeholder text", () => {
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
  it("ships none of the design's placeholder photographs or footage, even unlinked", () => {
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
