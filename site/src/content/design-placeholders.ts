// The design's placeholder material, frozen: the names, quotes, numbers and
// photographs in v2 that stand in for real ones. Never edit this list to let
// a build through. Replace the material in site.ts instead.
//
// The publish gate (src/lib/publish-gate.ts) stops a production build when a
// published block in site.ts still contains any of these values.

export const DESIGN_PLACEHOLDERS = {
  contact: ["919810040200", "+911244002200", "WhatsApp · +91 98100 40200", "Phone · +91 124 400 2200"],
  heroFootage: ["hero.mp4", "hero-poster.jpg"],
  whatPlate: ["membrane-on-skin.jpg"],
  norwoodPhotos: ["nw-1.jpg", "nw-2.jpg", "nw-3.jpg", "nw-4.jpg", "nw-5.jpg", "nw-6.jpg", "nw-7.jpg"],
  teaserPair: ["ba-before.jpg", "ba-after.jpg"],
  stepPhotos: ["step-01-call.jpg", "step-02-template.jpg", "step-03-fit.jpg", "step-04-kit.jpg"],
  basePhotos: ["base-monofilament.jpg", "base-thinskin.jpg"],
  technicians: [
    "Imran Qureshi",
    "Sandeep Rawat",
    "Vikas Chauhan",
    "tech-1.jpg",
    "tech-2.jpg",
    "tech-3.jpg",
    "Does most of our thin-skin work. Covers Gurgaon and South Delhi.",
    "Cuts and colour-matches. Covers Noida, Ghaziabad and East Delhi.",
    "Handles repairs and the monthly visits. Covers Gurgaon and Faridabad.",
  ],
  testimonials: [
    "Client name",
    "client-1.jpg",
    "client-2.jpg",
    "client-3.jpg",
    "He came on a Sunday morning and was finished by eleven. I had a wedding that week and nobody said a word about my hair.",
    "The first fit took about ninety minutes. What I did not expect was the monthly visit — he lifts it, cleans the base, re-cuts it, and is gone inside an hour.",
    "I asked what happens if I hate it. He gave me the fourteen-day terms before taking any money, which is why I went ahead.",
  ],
  founderNote: [
    "I started losing my hair at twenty-six. By thirty I had been to four clinics, and not one would tell me a price before I was sitting in the chair with a consultant beside me.",
    "So Mane Man does two things differently. The technician comes to your home, so nobody sees you walk into anywhere. And every price is on this page, so you can decide before you speak to us.",
  ],
  privacy: ["Placeholder. The privacy notice is supplied later."],
  terms: ["Placeholder. The terms are supplied later."],
} as const;

export type PlaceholderBlockName = keyof typeof DESIGN_PLACEHOLDERS;
