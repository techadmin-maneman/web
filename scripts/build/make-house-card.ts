// The house referral card (design/phase2/Referral and Waitlist, A2): the 1200 x 630 image an invite shows when a
// client has not made their own, or has taken theirs down. It has the referral card's layout, from the figures in
// apps/app/src/refer/card-layout.ts: a gilt rule 2 px wide down the middle, and the mark and the wordmark's small cut
// in the bottom right corner. The same rule and lockup, alone on a clear ground, are the overlay the API draws over
// a client's two photographs to make their own card (src/providers/cards.ts).
//
// PLACEHOLDER: where the design has photographs, the two halves are the ink blocks it draws a card with, until
// licensed ones are supplied (open point 52).
//
//   node scripts/build/make-house-card.ts
//
// Writes site/public/images/invite-house.jpg, which the invite's Open Graph tags point at, the same file into the
// app, whose invite preview shows it, and the overlay into src/config/card-overlay.ts. Chats cache a preview by
// its address, so a house card that changes needs a new HOUSE_CARD_VERSION in site/src/lib/invite.ts;
// test/node/site/site-content.test.ts says so.

import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { token } from "../../packages/web-kit/pwa.ts";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  HALF_WIDTH,
  lockupPlaces,
  RULE_WIDTH,
  type Place,
} from "../../apps/app/src/refer/card-layout.ts";
import { MARK, WORDMARK_SMALL, type Drawing } from "../../packages/brand/marks.ts";

const OUTPUTS = ["site/public/images/invite-house.jpg", "apps/app/src/refer/invite-house.jpg"];
const OVERLAY_MODULE = "src/config/card-overlay.ts";

/** A brand drawing in its place, as the design's SVGs draw it: whole, centred, in one colour. */
const drawing = (shape: Drawing, place: Place, colour: string, rule: "evenodd" | "nonzero") =>
  `<svg x="${String(place.left)}" y="${String(place.top)}" width="${String(place.width)}" height="${String(place.height)}"
     viewBox="${shape.viewBox}"><path fill="${colour}" fill-rule="${rule}" d="${shape.d}"/></svg>`;

const places = lockupPlaces();
/** The rule and the lockup, which every card carries. */
const marks = `<rect x="${String(HALF_WIDTH)}" width="${String(RULE_WIDTH)}" height="${String(CARD_HEIGHT)}" fill="${token("--gilt")}"/>
  ${drawing(MARK, places.mark, token("--gilt"), "evenodd")}
  ${drawing(WORDMARK_SMALL, places.wordmark, token("--paper"), "nonzero")}`;
const svg = (inside: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${String(CARD_WIDTH)}" height="${String(CARD_HEIGHT)}">
  ${inside}
</svg>`;

const card = svg(`<rect width="${String(HALF_WIDTH)}" height="${String(CARD_HEIGHT)}" fill="${token("--ink-frame")}"/>
  <rect x="${String(HALF_WIDTH + RULE_WIDTH)}" width="${String(HALF_WIDTH)}" height="${String(CARD_HEIGHT)}"
     fill="${token("--ink-raised")}"/>
  ${marks}`);

// Full colour resolution: halved, as JPEG usually stores it, a rule 2 px wide comes out grey.
const jpeg = await sharp(new TextEncoder().encode(card)).jpeg({ quality: 82, chromaSubsampling: "4:4:4" }).toBuffer();
for (const output of OUTPUTS) writeFileSync(output, jpeg);
console.log(
  `house card: ${String(Math.round(jpeg.byteLength / 1024))} KB, ${String(CARD_WIDTH)}x${String(CARD_HEIGHT)}`,
);

const overlay = await sharp(new TextEncoder().encode(svg(marks)))
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync(
  OVERLAY_MODULE,
  `// Written by scripts/build/make-house-card.ts: the referral card's gilt rule and lockup on a clear ground, ${String(CARD_WIDTH)} x ${String(CARD_HEIGHT)},
// the overlay the API draws over a client's two photographs (src/providers/cards.ts). Never edited by hand.

export const CARD_OVERLAY_PNG =
  "${btoa(Array.from(overlay, (byte) => String.fromCharCode(byte)).join(""))}";
`,
);
console.log(`card overlay: ${String(Math.round(overlay.byteLength / 1024))} KB`);
