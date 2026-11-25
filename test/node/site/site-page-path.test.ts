// A link to one of the home page's sections stays on a page that has that section of its own, as the Gurgaon page has
// the questions (site/src/lib/page-path.ts, docs/decisions/0321-the-gurgaon-page.md).

import { describe, expect, it } from "vitest";
import { sectionHref } from "../../../site/src/lib/page-path.ts";

describe("a section link", () => {
  it("stays on the page where the page has the section", () => {
    expect(sectionHref("/#faq", ["faq"])).toBe("#faq");
  });

  it("goes to the home page for a section the page has not, and leaves other links alone", () => {
    expect(sectionHref("/#range", ["faq"])).toBe("/#range");
    expect(sectionHref("/#faq", [])).toBe("/#faq");
    expect(sectionHref("/try", ["faq"])).toBe("/try");
  });
});
