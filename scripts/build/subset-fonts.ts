// Cuts the rupee sign out of EB Garamond's latin-ext file. ₹ is the only
// character on the site outside Google's latin subset, and without this a
// visitor downloads the whole latin-ext file (57 KB) to draw it. Instrument
// Sans has no ₹ to cut (fonts.css).
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
  const subset = await subsetFont(source, "₹", { targetFormat: "woff2" });
  const file = `${OUT}/${family}-rupee-${String(weight)}.woff2`;
  writeFileSync(file, subset);
  console.log(`${file}: ${String(subset.length)} bytes`);
}
