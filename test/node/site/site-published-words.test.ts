// The words the Words page published, laid over the site's copy as it is built (site/src/lib/published-words.ts,
// site/src/lib/published-words-apply.ts; docs/decisions/0127-publishing-the-words.md).

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyWords } from "../../../site/src/lib/published-words-apply.ts";
import { publishedWordsPlugin } from "../../../site/src/lib/published-words.ts";

describe("a copy module's published lines", () => {
  it("set the words in place, in objects and in lists", () => {
    const hero = { title: "A hair system, fitted at home.", sequence: ["Natural up close.", "Fitted at home."] };
    applyWords(
      "home",
      { hero },
      { "site:home/hero.title": "Hair, fitted at home.", "site:home/hero.sequence.1": "At home." },
    );
    expect(hero).toEqual({ title: "Hair, fitted at home.", sequence: ["Natural up close.", "At home."] });
  });

  it("leave another module's lines, and a place that no longer holds words, as the code has them", () => {
    const hero = { title: "A hair system.", steps: { count: 3 } };
    applyWords("home", { hero }, { "site:pages/hero.title": "Elsewhere", "site:home/hero.steps.count": "4" });
    applyWords("home", { hero }, { "site:home/hero.gone.title": "Moved", "site:home/missing.title": "Gone" });
    expect(hero).toEqual({ title: "A hair system.", steps: { count: 3 } });
  });
});

describe("the build's plugin", () => {
  const site = fileURLToPath(new URL("../../../site/", import.meta.url));
  const plugin = publishedWordsPlugin(site, { "site:home/hero.title": "Hair, fitted at home." });
  const transform = (code: string, id: string) =>
    (plugin.transform as (code: string, id: string) => string | null)(code, id);

  it("has a copy module with published lines set them on its own exports", () => {
    const out = transform(
      "export const hero = { title: 'x' };\nexport const faq = {};",
      join(site, "src/content/site/home.ts"),
    );
    expect(out).toContain('from "../../lib/published-words-apply.ts"');
    expect(out).toContain('__applyWords("home", { hero, faq }, {"site:home/hero.title":"Hair, fitted at home."});');
  });

  it("leaves every other module, and one with nothing published, as it is", () => {
    expect(transform("export const x = 1;", join(site, "src/lib/text.ts"))).toBeNull();
    expect(transform("export const booking = {};", join(site, "src/content/site/pages.ts"))).toBeNull();
  });
});
