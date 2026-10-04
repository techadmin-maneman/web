// Refuses a production release of mm-api while its copy still waits for the owner's wording: the job sheet's labels
// and the WhatsApp texts (scripts/lib/content-gate.ts). The apps and the site are gated when they are built.
//
//   node scripts/check-copy.ts api

import { assertPublishableContent, CONTENT_FILES, type ContentOwner } from "./lib/content-gate.ts";

const owner = process.argv[2] ?? "";
if (!(owner in CONTENT_FILES)) {
  console.error(`usage: check-copy.ts <${Object.keys(CONTENT_FILES).join("|")}>`);
  process.exit(2);
}
try {
  assertPublishableContent(owner as ContentOwner);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
