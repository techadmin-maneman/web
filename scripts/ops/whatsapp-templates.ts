// node scripts/ops/whatsapp-templates.ts [--origin https://maneman.in]
//
// Prints every WhatsApp template as it is submitted for approval in MSG91's dashboard (WhatsApp → Templates): its name,
// category, language, body with sample values, image header and buttons. A button's address is the origin followed by
// {{1}}, the suffix each message adds. docs/provisioning.md, "WhatsApp through MSG91", says how to submit them.

import { parseArgs } from "node:util";
import { APPROVED_TEMPLATES, type ApprovedButton } from "../../src/config/approved-templates.ts";
import { MSG91_TEMPLATE_LANGUAGE } from "../../src/config/msg91.ts";

const { values } = parseArgs({ options: { origin: { type: "string", default: "https://maneman.in" } } });
const origin = values.origin.replace(/\/+$/, "");

/** A button as the dashboard asks for it. */
function describe(button: ApprovedButton): string {
  if (button.kind === "copy_code") return "Copy code (WhatsApp's own)";
  return `URL "${button.label}": ${origin}/{{1}}`;
}

for (const template of APPROVED_TEMPLATES) {
  console.log(`\n${template.name}  [${template.category}, ${MSG91_TEMPLATE_LANGUAGE}]`);
  if (template.category === "authentication") {
    console.log("  Body: WhatsApp's authentication text, with the code and a copy-code button");
    continue;
  }
  if (template.imageHeader) console.log("  Header: image");
  console.log(`  Body: ${template.body}`);
  if (/\{\{\d+\}\}\.$/.test(template.body)) {
    console.log("  Note: ends on a variable and a full stop; if WhatsApp asks, add a few words after it");
  }
  for (const button of template.buttons) console.log(`  Button: ${describe(button)}`);
}
