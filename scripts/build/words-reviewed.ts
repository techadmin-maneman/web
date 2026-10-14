// Marks every line of the Words catalogue as reviewed, in its wording now: run once a copy review has read them all,
// then `npm run words` so the catalogue says so. A line written or changed after it shows as not reviewed on the
// Words page until the next review: npm run words:reviewed.

import { readFileSync, writeFileSync } from "node:fs";

const CATALOGUE = "src/config/words.json";
const REVIEWED = "src/config/words-reviewed.json";

const lines = JSON.parse(readFileSync(CATALOGUE, "utf8")) as readonly { key: string; text: string }[];
const reviewed = Object.fromEntries(lines.map((line) => [line.key, line.text]));
writeFileSync(REVIEWED, `${JSON.stringify(reviewed, null, 2)}\n`);
console.log(`${String(lines.length)} lines marked reviewed in ${REVIEWED}`);
