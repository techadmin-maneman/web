// The publish gate, end to end: the production site builds, and ships none of
// the design's placeholder material. The gate's refusals are proven in
// test/node/site-content.test.ts.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESIGN_PLACEHOLDERS } from "../../site/src/content/design-placeholders.ts";

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
      // The 404 page alone stays out of search engines.
      if (page !== "404.html") expect(html, page).not.toContain("noindex");
      for (const value of placeholders) expect(html, `${page}: ${value}`).not.toContain(value);
    }
    expect(readFileSync(`${OUT}/robots.txt`, "utf8")).toContain("Allow: /");
    expect(readFileSync(`${OUT}/_headers`, "utf8")).not.toContain("X-Robots-Tag");
  });
});
