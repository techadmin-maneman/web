// The production site's publish gate end to end runs in CI's build job (scripts/ci/site-production-gate.ts), which
// builds the site; these are its parts: which refusals only counsel's approval clears, the reasons read back from a
// refused build, and what a passing build must not ship. The gate's refusals are proven in
// test/node/site/site-content.test.ts.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { awaitsApproval, refusals, refusedFor, shippedPlaceholders } from "../../../scripts/lib/site-gate.ts";
import { DESIGN_PLACEHOLDERS } from "../../../site/src/content/design-placeholders.ts";
import { unreferencedAssets } from "../../../site/src/lib/static-files.ts";

describe("what stops the production site", () => {
  it("is today only what waits for counsel's approval", () => {
    expect(refusals().filter((problem) => !awaitsApproval(problem))).toEqual([]);
  });

  it("tells a notice, a legal page or marked words, which approval clears, from a defect, which it does not", () => {
    expect(awaitsApproval("the photo notice (photo-v9) is not approved")).toBe(true);
    expect(awaitsApproval("the terms page’s wording is not approved")).toBe(true);
    expect(awaitsApproval("site/src/content/site/legal.ts: 2 lines marked PLACEHOLDER, at 3, 9")).toBe(true);
    expect(awaitsApproval('a price is typed by hand, "Rs. 2,000": the site gives no price of ours')).toBe(false);
    expect(awaitsApproval("the home page is not published: production needs its text")).toBe(false);
  });

  it("is read back from a refused build, a reason a line", () => {
    const output = "The production build is blocked (docs/site.md):\n  - one\n  - two\nError: at astro.config.ts";
    expect(refusedFor(output)).toEqual(["one", "two"]);
  });
});

describe("a production site that passes its gate", () => {
  let out: string;
  const page = (name: string, html: string) => {
    writeFileSync(path.join(out, name), html);
  };

  beforeEach(() => {
    out = mkdtempSync(path.join(tmpdir(), "mm-site-"));
    mkdirSync(path.join(out, "_astro"));
    for (const name of ["index", "try", "book", "guides", "contact"]) page(`${name}.html`, "<h1>Mane Man</h1>");
    page("404.html", '<meta name="robots" content="noindex">');
    writeFileSync(path.join(out, "robots.txt"), "User-agent: *\nAllow: /");
    writeFileSync(path.join(out, "_headers"), "/*\n  X-Content-Type-Options: nosniff");
  });

  afterEach(() => {
    rmSync(out, { recursive: true, force: true });
  });

  it("ships nothing of the design's", () => {
    expect(shippedPlaceholders(out)).toEqual([]);
  });

  it("is caught shipping a placeholder tag, a page kept from search, or the design's text", () => {
    const text = Object.values(DESIGN_PLACEHOLDERS)
      .flat()
      .find((value) => value.length > 12 && !/\.(jpg|mp4)$/.test(value));
    page("index.html", `<span>Placeholder</span><span>>Placeholder<</span> ${text ?? ""}`);
    page("try.html", '<meta name="robots" content="noindex">');
    expect(shippedPlaceholders(out)).toEqual([
      "index.html carries a placeholder tag",
      `index.html holds the design's "${text ?? ""}"`,
      "try.html is kept out of search engines",
    ]);
  });

  // A placeholder photograph is not published by leaving it at a hashed address nothing links to.
  it("is caught shipping a placeholder photograph, even unlinked", () => {
    const photo = Object.values(DESIGN_PLACEHOLDERS)
      .flat()
      .find((value) => value.endsWith(".jpg"));
    const stem = (photo ?? "none.jpg").replace(/\.jpg$/, "");
    writeFileSync(path.join(out, "_astro", `${stem}.Ab12Cd.webp`), "");
    expect(shippedPlaceholders(out)).toEqual([`_astro/${stem}.Ab12Cd.webp was shipped`]);
  });
});

describe("unreferenced assets", () => {
  it("are the built files no page, script or stylesheet names", () => {
    const texts = ['<img src="/_astro/logo.abc.webp">', "url(/_astro/font.def.woff2)"];
    expect(unreferencedAssets(["logo.abc.webp", "font.def.woff2", "hero.123.mp4"], texts)).toEqual(["hero.123.mp4"]);
  });
});
