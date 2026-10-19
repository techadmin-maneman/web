// node scripts/ops/whatsapp-templates.ts [--origin https://maneman.in]
// node --env-file=.env.msg91 scripts/ops/whatsapp-templates.ts --submit | --status [--origin https://maneman.in]
//
// Prints every WhatsApp template as it is submitted for approval in MSG91's dashboard (WhatsApp → Templates): its name,
// category, language, body with sample values, image header and buttons. A button's address is the origin followed by
// {{1}}, the suffix each message adds. docs/provisioning.md, "WhatsApp through MSG91", says how to submit them.
//
// --submit sends each template MSG91 does not hold yet to its API for approval, on MSG91_INTEGRATED_NUMBER with
// MSG91_AUTH_KEY; --status lists each template's state there. Neither prints the key.

import { parseArgs } from "node:util";
import {
  APPROVED_TEMPLATES,
  approvedParams,
  type ApprovedButton,
  type ApprovedTemplate,
} from "../../src/config/approved-templates.ts";
import { CLIENT_ORIGIN } from "../../src/config/environments.ts";
import { MSG91_TEMPLATE_LANGUAGE } from "../../src/config/msg91.ts";
import { samplesOf } from "./whatsapp-template-samples.ts";

const { values } = parseArgs({
  options: {
    origin: { type: "string", default: "https://maneman.in" },
    submit: { type: "boolean", default: false },
    status: { type: "boolean", default: false },
  },
});
const origin = values.origin.replace(/\/+$/, "");

const MSG91 = "https://control.msg91.com/api/v5/whatsapp";
/** How long a login code lasts, which its template says (login_code_v1). */
const CODE_MINUTES = 10;
/** An image WhatsApp's reviewers see in the try-on's look's place. */
const SAMPLE_LOOK = `${origin}/images/invite-house.jpg`;

/** A button as the dashboard asks for it. */
function describe(button: ApprovedButton): string {
  if (button.kind === "copy_code") return "Copy code (WhatsApp's own)";
  if (button.kind === "app") return `URL "${button.label}": ${CLIENT_ORIGIN.production} (static)`;
  return `URL "${button.label}": ${origin}/{{1}}`;
}

/** A button as MSG91's API takes it, with an address its reviewers can open. */
function buttonOf(button: ApprovedButton, samples: readonly string[]) {
  if (button.kind === "copy_code") return { type: "OTP", otp_type: "COPY_CODE", text: "Copy code" };
  if (button.kind === "app") return { type: "URL", text: button.label, url: CLIENT_ORIGIN.production };
  const sample = button.kind === "stop" ? `${origin}/stop` : (samples[button.param - 1] ?? origin);
  return { type: "URL", text: button.label, url: `${origin}/{{1}}`, example: [sample] };
}

/** The template as MSG91's API takes it: WhatsApp's own words for a login code, else our body and its samples. */
function payloadOf(template: ApprovedTemplate, integratedNumber: string) {
  const head = { integrated_number: integratedNumber, template_name: template.name, language: MSG91_TEMPLATE_LANGUAGE };
  if (template.category === "authentication") {
    return {
      ...head,
      category: "AUTHENTICATION",
      components: [
        { type: "BODY", add_security_recommendation: true },
        { type: "FOOTER", code_expiration_minutes: CODE_MINUTES },
        { type: "BUTTONS", buttons: template.buttons.map((button) => buttonOf(button, [])) },
      ],
    };
  }
  const samples = samplesOf(template.name);
  const ordered = approvedParams(template, samples) ?? [];
  const components: object[] = [];
  if (template.imageHeader)
    components.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [SAMPLE_LOOK] } });
  components.push({
    type: "BODY",
    text: template.body,
    ...(ordered.length > 0 ? { example: { body_text: [ordered] } } : {}),
  });
  if (template.buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons: template.buttons.map((button) => buttonOf(button, samples)) });
  }
  return { ...head, category: "UTILITY", button_url: false, components };
}

function msg91Settings(): { authKey: string; integratedNumber: string } {
  const given: Record<string, string | undefined> = process.env;
  const authKey = given.MSG91_AUTH_KEY?.trim() ?? "";
  const integratedNumber = (given.MSG91_INTEGRATED_NUMBER ?? "").replace(/\D/g, "");
  if (authKey === "" || integratedNumber === "") {
    throw new Error("MSG91_AUTH_KEY and MSG91_INTEGRATED_NUMBER are not set; pass the file with --env-file");
  }
  return { authKey, integratedNumber };
}

/** Each template MSG91 holds for the number, by name, with its state: APPROVED, PENDING or REJECTED. */
async function heldTemplates(authKey: string, integratedNumber: string): Promise<Map<string, string>> {
  const answer = await fetch(`${MSG91}/get-template-client/${integratedNumber}`, {
    headers: { authkey: authKey, accept: "application/json" },
  });
  const body = await answer.json<{ hasError?: boolean; errors?: unknown; data?: unknown }>();
  if (!answer.ok || body.hasError === true) throw new Error(`MSG91 refused the list: ${JSON.stringify(body.errors)}`);
  const held = new Map<string, string>();
  const list = Array.isArray(body.data) ? (body.data as { name?: string; languages?: { status?: string }[] }[]) : [];
  for (const template of list) {
    if (template.name !== undefined) held.set(template.name, template.languages?.[0]?.status ?? "UNKNOWN");
  }
  return held;
}

async function submit(): Promise<void> {
  const { authKey, integratedNumber } = msg91Settings();
  const held = await heldTemplates(authKey, integratedNumber);
  for (const template of APPROVED_TEMPLATES) {
    if (held.has(template.name)) {
      console.log(`${template.name}: held, ${held.get(template.name) ?? ""}`);
      continue;
    }
    const answer = await fetch(`${MSG91}/client-panel-template/`, {
      method: "POST",
      headers: { authkey: authKey, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payloadOf(template, integratedNumber)),
    });
    const body = await answer.json<{ hasError?: boolean; errors?: unknown; data?: { message?: string } }>();
    const refused = !answer.ok || body.hasError === true;
    console.log(
      `${template.name}: ${refused ? `refused, ${JSON.stringify(body.errors)}` : (body.data?.message ?? "sent")}`,
    );
  }
}

async function status(): Promise<void> {
  const { authKey, integratedNumber } = msg91Settings();
  const held = await heldTemplates(authKey, integratedNumber);
  for (const template of APPROVED_TEMPLATES)
    console.log(`${template.name}: ${held.get(template.name) ?? "not submitted"}`);
}

function print(): void {
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
}

if (values.submit) await submit();
else if (values.status) await status();
else print();
