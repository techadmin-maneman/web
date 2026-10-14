// Refuses a production release of mm-api while its copy still waits for its wording: the job sheet's labels
// and the WhatsApp texts, each on a surface production has switched on (scripts/lib/content-gate.ts). The apps and
// the site are gated when they are built.
//
//   node scripts/release/check-copy.ts api

import {
  apiCopyInProduction,
  assertPublishableContent,
  CONTENT_FILES,
  type ContentOwner,
} from "../lib/content-gate.ts";

const owner = process.argv[2] ?? "";
if (!(owner in CONTENT_FILES)) {
  console.error(`usage: check-copy.ts <${Object.keys(CONTENT_FILES).join("|")}>`);
  process.exit(2);
}
const shown = owner === "api" ? apiCopyInProduction() : undefined;
for (const file of CONTENT_FILES.api) {
  if (shown !== undefined && !shown.includes(file)) console.log(`${file}: on no surface production shows yet`);
}
try {
  assertPublishableContent(owner as ContentOwner, shown);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
