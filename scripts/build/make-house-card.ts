// The house referral card (design/phase2/Referral and Waitlist, A2): the 1200 x 630 image an invite shows when a
// client has not made their own, or has taken theirs down. It has board A1's layout, from the same figures the
// phone composes a client's card with (apps/app/src/refer/card-layout.ts): a gilt rule 2 px wide down the middle,
// and the mark and the wordmark's small cut in the bottom right corner.
//
// PLACEHOLDER: where A2 has photographs, the two halves are the ink blocks the boards draw a card with (F2, F4),
// until the owner gives us licensed ones (docs/open-points.md, item 52).
//
//   node scripts/build/make-house-card.ts
//
// Writes site/public/images/invite-house.jpg, which the invite's Open Graph tags point at, and the same file into
// the app, whose preview (board F4) shows it. Chats cache a preview by its address, so a file that changes needs
// a new HOUSE_CARD_VERSION in site/src/lib/invite.ts; test/node/site-content.test.ts says so.

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

/** A brand drawing in its place, as board A1's SVGs draw it: whole, centred, in one colour. */
const drawing = (shape: Drawing, place: Place, colour: string, rule: "evenodd" | "nonzero") =>
  `<svg x="${String(place.left)}" y="${String(place.top)}" width="${String(place.width)}" height="${String(place.height)}"
     viewBox="${shape.viewBox}"><path fill="${colour}" fill-rule="${rule}" d="${shape.d}"/></svg>`;

const places = lockupPlaces();
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(CARD_WIDTH)}" height="${String(CARD_HEIGHT)}">
  <rect width="${String(HALF_WIDTH)}" height="${String(CARD_HEIGHT)}" fill="${token("--ink-frame")}"/>
  <rect x="${String(HALF_WIDTH + RULE_WIDTH)}" width="${String(HALF_WIDTH)}" height="${String(CARD_HEIGHT)}"
     fill="${token("--ink-raised")}"/>
  <rect x="${String(HALF_WIDTH)}" width="${String(RULE_WIDTH)}" height="${String(CARD_HEIGHT)}" fill="${token("--gilt")}"/>
  ${drawing(MARK, places.mark, token("--gilt"), "evenodd")}
  ${drawing(WORDMARK_SMALL, places.wordmark, token("--paper"), "nonzero")}
</svg>`;

// Full colour resolution: halved, as JPEG usually stores it, a rule 2 px wide comes out grey.
const jpeg = await sharp(new TextEncoder().encode(card)).jpeg({ quality: 82, chromaSubsampling: "4:4:4" }).toBuffer();
for (const output of OUTPUTS) writeFileSync(output, jpeg);
console.log(
  `house card: ${String(Math.round(jpeg.byteLength / 1024))} KB, ${String(CARD_WIDTH)}x${String(CARD_HEIGHT)}`,
);
