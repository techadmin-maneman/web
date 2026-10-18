// The design's placeholder material, frozen: the names, quotes, numbers and
// photographs in the design that stand in for real ones. Never edit this list to let
// a build through. Replace the material in site.ts instead.
//
// The publish gate (src/lib/publish-gate.ts) stops a production build when a
// published block in site.ts still contains any of these values. A value goes
// only when the site stops showing that material at all, as the technicians'
// notes did (ADR 0103).

export const DESIGN_PLACEHOLDERS = {
  whatsapp: ["919810040200", "WhatsApp · +91 98100 40200"],
  heroFootage: ["hero.mp4", "hero-phone.mp4", "hero-poster.jpg"],
  norwoodPhotos: ["nw-3.jpg", "nw-4.jpg", "nw-5.jpg", "nw-6.jpg", "nw-7.jpg"],
  teaserPair: ["ba-before.jpg", "ba-after.jpg"],
  stepPhotos: ["step-02-template.jpg", "step-03-fit.jpg", "step-04-kit.jpg"],
  founderNote: [
    "I started losing my hair at twenty-six. By thirty I had been to four clinics, and not one would tell me a price before I was sitting in the chair with a consultant beside me.",
    "So Mane Man does two things differently. The technician comes to your home, so nobody sees you walk in anywhere. And you hear the price at the free consultation, before anything is fitted or paid.",
  ],
  privacy: ["Placeholder. The privacy notice is supplied later."],
  terms: ["Placeholder. The terms are supplied later."],
} as const;

export type PlaceholderBlockName = keyof typeof DESIGN_PLACEHOLDERS;
