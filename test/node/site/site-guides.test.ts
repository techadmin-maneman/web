// The guides and the cities page (site/src/content/guides.ts): each at an address of its own, described for a search
// engine within what it shows, and no price typed into any of them.

import { describe, expect, it } from "vitest";
import { areasPage, guides } from "../../../site/src/content/guides.ts";
import { publishProblems } from "../../../site/src/lib/publish-gate.ts";

describe("the guides", () => {
  it("each have an address of their own, in lower-case words", () => {
    const slugs = guides.map((guide) => guide.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });

  it("are described within the 160 characters a search engine shows", () => {
    for (const page of [...guides, areasPage])
      expect(page.description.length, page.description).toBeLessThanOrEqual(160);
  });

  it("each answer under at least two headings", () => {
    for (const guide of guides) {
      expect(guide.sections.length, guide.slug).toBeGreaterThanOrEqual(2);
      for (const section of guide.sections) expect(section.paragraphs.length, section.heading).toBeGreaterThan(0);
    }
  });

  it("type no price, which the publish gate would refuse", () => {
    const priced = publishProblems(undefined, undefined, [guides, areasPage]).filter((line) =>
      line.startsWith("a price is typed by hand"),
    );
    expect(priced).toEqual([]);
  });
});
