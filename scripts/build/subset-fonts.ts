// Cuts the rupee sign out of EB Garamond's latin-ext file. ₹ is the only
// character on the site outside Google's latin subset, and without this a
// visitor downloads the whole latin-ext file (57 KB) to draw it. Instrument
// Sans has no ₹ to cut (fonts.css).
//
// The file is WOFF, not WOFF2: one glyph compresses to more bytes than it holds, and Chrome refuses a WOFF2 file
// that does ("Size of decompressed WOFF 2.0 is less than compressed size"). WOFF keeps such a table uncompressed.
//
//   node scripts/build/subset-fonts.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import subsetFont from "subset-font";

const FACES = [["eb-garamond", 400]] as const;
const OUT = "packages/brand/fonts";

mkdirSync(OUT, { recursive: true });
for (const [family, weight] of FACES) {
  const source = readFileSync(
    `node_modules/@fontsource/${family}/files/${family}-latin-ext-${String(weight)}-normal.woff2`,
  );
  const subset = await subsetFont(source, "₹", { targetFormat: "woff" });
  const file = `${OUT}/${family}-rupee-${String(weight)}.woff`;
  writeFileSync(file, subset);
  console.log(`${file}: ${String(subset.length)} bytes`);
}
