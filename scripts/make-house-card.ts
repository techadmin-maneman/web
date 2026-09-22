// The house referral card (design/phase2/Referral and Waitlist, A2): the 1200 x 630 image an invite shows when a
// client has not made their own, or has taken theirs down. PLACEHOLDER: two tones and the gold rule of the
// design's layout, with no photograph, until the owner gives us a licensed one (docs/open-points.md, item 43).
//
//   node scripts/make-house-card.ts
//
// Writes site/public/images/invite-house.jpg, which the invite's Open Graph tags point at.

import { writeFileSync } from "node:fs";
import sharp from "sharp";

const WIDTH = 1200;
const HEIGHT = 630;
const RULE = 6;

/** The brand's ink and its paper, as packages/brand/tokens.css holds them. */
const LEFT = "#16233a";
const RIGHT = "#e9e4d8";
const GOLD = "#7a5b24";

const half = (background: string) =>
  sharp({ create: { width: (WIDTH - RULE) / 2, height: HEIGHT, channels: 3, background } })
    .jpeg()
    .toBuffer();

const [left, right, rule] = await Promise.all([
  half(LEFT),
  half(RIGHT),
  sharp({ create: { width: RULE, height: HEIGHT, channels: 3, background: GOLD } })
    .jpeg()
    .toBuffer(),
]);

const card = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: LEFT } })
  .composite([
    { input: left, left: 0, top: 0 },
    { input: rule, left: (WIDTH - RULE) / 2, top: 0 },
    { input: right, left: (WIDTH + RULE) / 2, top: 0 },
  ])
  .jpeg({ quality: 82 })
  .toBuffer();

writeFileSync("site/public/images/invite-house.jpg", card);
console.log(`house card: ${String(Math.round(card.byteLength / 1024))} KB, ${String(WIDTH)}x${String(HEIGHT)}`);
