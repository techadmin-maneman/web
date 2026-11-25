// The redesign reuses every asset the site has (docs/prompts/site-redesign.md, the brief's ruling 2), and the Gurgaon
// page adds its clients' films (docs/decisions/0321-the-gurgaon-page.md): a picture or film added to site/src/assets,
// or taken from it, fails here until the list changes with the material.

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ASSETS = [
  "fit-film-phone.mp4",
  "fit-film-poster.jpg",
  "fit-film.mp4",
  "guide-care.jpg",
  "guide-fitted.jpg",
  "guide-lasts.jpg",
  "guide-materials.jpg",
  "guide-what-is-a-hair-system.jpg",
  "gurgaon-founder-film-poster.jpg",
  "gurgaon-founder-film.mp4",
  "gurgaon-hero-phone-poster.jpg",
  "gurgaon-hero-phone.mp4",
  "gurgaon-hero-poster.jpg",
  "gurgaon-hero.mp4",
  "gurgaon-story-nitin-poster.jpg",
  "gurgaon-story-nitin.mp4",
  "gurgaon-transformation-poster.jpg",
  "gurgaon-transformation.mp4",
  "look-crew-cut.jpg",
  "look-french-crop.jpg",
  "look-quiff.jpg",
  "look-side-part.jpg",
  "look-slick-back.jpg",
  "look-textured-crop.jpg",
  "norwood-3.jpg",
  "norwood-4.jpg",
  "norwood-5.jpg",
  "norwood-6.jpg",
  "norwood-7.jpg",
  "norwood-restored.jpg",
  "result-1-after.jpg",
  "result-1-before.jpg",
  "result-2-after.jpg",
  "result-2-before.jpg",
  "result-3-after.jpg",
  "result-3-before.jpg",
  "result-4-after.jpg",
  "result-4-before.jpg",
  "step-consultation.jpg",
  "step-first-fit.jpg",
  "step-service.jpg",
  "tryon-after.jpg",
  "tryon-before.jpg",
];

describe("the site's assets", () => {
  it("are the ones it had before the redesign, no more and no fewer", () => {
    expect(readdirSync("site/src/assets").sort()).toEqual(ASSETS);
  });
});
