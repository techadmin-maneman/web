// Sets up a Zoho CRM org the way the lead sync expects (docs/runbook.md,
// "Setting up Zoho", step 8): the custom fields on Leads, and the pick-list
// values the sync writes into Lead_Status and Lead_Source. It creates only what
// is missing, so it is safe to run again.
//
//   node --env-file=.env.crm-staging scripts/setup-crm.ts --check   read-only
//   node --env-file=.env.crm-staging scripts/setup-crm.ts           creates what is missing
//
// The file holds ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_SCRIPTS_REFRESH_TOKEN,
// ZOHO_ACCOUNTS_HOST and ZOHO_API_HOST: the scripts' own refresh token, never the
// Worker's (scripts/lib/zoho-script-token.ts). Its scope must include
// ZohoCRM.settings.fields.ALL. No secret is printed.
//
// Zoho names a new field itself, from its label: "D1 Person ID" becomes
// D1_Person_ID. The script checks the name it got, because the sync writes that
// name and nothing else. scripts/check-zoho-setup.ts then proves the whole org.

import { parseArgs } from "node:util";
import { LOSS_EXTENT_NAMES, WINDOW_NAMES } from "../src/config/booking.ts";
import { BOOKED_WINDOW_NAMES, REFERRAL_LEAD_SOURCE } from "../src/config/crm.ts";
import { LEAD_STATUSES } from "../src/providers/crm/index.ts";
import { LEAD_SOURCE_NAMES } from "../src/providers/crm/zoho.ts";
import { fieldProblem, fieldWritten, LEAD_FIELDS, type LeadField } from "./lib/crm-settings.ts";
import { zohoScriptClient } from "./lib/zoho-script-client.ts";

interface NewField {
  /** The label Zoho shows, chosen so that the API name it derives is `apiName`. */
  readonly label: string;
  readonly apiName: string;
  readonly dataType: "text" | "date" | "boolean" | "picklist";
  readonly values?: readonly string[];
  /** Zoho must refuse a second record with the same value. */
  readonly unique?: true;
}

/** The custom fields src/providers/crm/zoho.ts writes, with the values from the same constants. */
const CUSTOM_FIELDS: readonly NewField[] = [
  {
    label: "First Choice Window",
    apiName: "First_Choice_Window",
    dataType: "picklist",
    values: Object.values(WINDOW_NAMES),
  },
  { label: "Loss Extent", apiName: "Loss_Extent", dataType: "picklist", values: Object.values(LOSS_EXTENT_NAMES) },
  { label: "Proposed Visit Date", apiName: "Proposed_Visit_Date", dataType: "date" },
  { label: "Contact Consent", apiName: "Contact_Consent", dataType: "boolean" },
  { label: "Try On", apiName: "Try_On", dataType: "boolean" },
  { label: "D1 Lead ID", apiName: "D1_Lead_ID", dataType: "text" },
  { label: "D1 Person ID", apiName: "D1_Person_ID", dataType: "text", unique: true },
  { label: "UTM Source", apiName: "UTM_Source", dataType: "text" },
  { label: "UTM Campaign", apiName: "UTM_Campaign", dataType: "text" },
  // An invited friend and the window a Phase 2 booking asked for (docs/decisions/0074-hand-offs-and-messages.md).
  // The sync writes them only once CRM_ORG_HAS_REFERRAL_FIELDS (src/config/crm.ts) is turned on after this has run.
  { label: "Referral Code", apiName: "Referral_Code", dataType: "text" },
  {
    label: "Booked Window",
    apiName: "Booked_Window",
    dataType: "picklist",
    values: Object.values(BOOKED_WINDOW_NAMES),
  },
];

/** The values the sync sets on Zoho's own pick-lists, which every org already has. */
const PICK_LIST_VALUES: Readonly<Record<string, readonly string[]>> = {
  Lead_Status: LEAD_STATUSES,
  Lead_Source: [...Object.values(LEAD_SOURCE_NAMES), REFERRAL_LEAD_SOURCE],
};

// --use-worker-token is read by refreshTokenForScript; it is named here so the parser takes it.
const { values: options } = parseArgs({
  options: { check: { type: "boolean", default: false }, "use-worker-token": { type: "boolean", default: false } },
});

let failures = 0;
function report(ok: boolean, check: string, detail: string): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${check}: ${detail}`);
}

const crm = await zohoScriptClient("crm");
report(true, "token", `issued for ${crm.host}`);

async function leadFields(): Promise<LeadField[]> {
  const answer = await crm.call("GET", "/crm/v8/settings/fields?module=Leads&type=all");
  const fields = LEAD_FIELDS.safeParse(answer.json).data?.fields;
  if (fields === undefined) {
    console.error(`FAIL  fields: Zoho answered ${String(answer.status)}; the token needs ZohoCRM.settings.fields.ALL`);
    process.exit(1);
  }
  return fields;
}

function pickListFor(field: NewField): { display_value: string; actual_value: string }[] | undefined {
  return field.values?.map((value) => ({ display_value: value, actual_value: value }));
}

async function createField(field: NewField): Promise<void> {
  const answer = await crm.call("POST", "/crm/v8/settings/fields?module=Leads", {
    fields: [
      {
        field_label: field.label,
        data_type: field.dataType,
        ...(field.dataType === "text" ? { length: 255 } : {}),
        ...(field.unique === true ? { unique: { case_sensitive: false } } : {}),
        ...(field.values === undefined ? {} : { pick_list_values: pickListFor(field) }),
      },
    ],
  });
  if (!fieldWritten(answer.json)) {
    report(false, field.apiName, `Zoho refused it (${fieldProblem(answer.json)})`);
    return;
  }
  // Zoho derives the API name from the label and does not answer with it, so read it back:
  // the sync writes that name and nothing else.
  const after = await leadFields();
  const got = after.find((candidate) => candidate.field_label === field.label)?.api_name ?? "(not found)";
  report(got === field.apiName, field.apiName, got === field.apiName ? "created" : `created, but named ${got}`);
}

/** Adds the values the sync writes, keeping every value the org already has. */
async function addPickListValues(field: LeadField, wanted: readonly string[]): Promise<void> {
  const present = new Set((field.pick_list_values ?? []).map((value) => value.actual_value));
  const missing = wanted.filter((value) => !present.has(value));
  if (missing.length === 0) {
    report(true, field.api_name, "has every value the sync writes");
    return;
  }
  if (options.check) {
    report(false, field.api_name, `missing values: ${missing.join(", ")}`);
    return;
  }
  const answer = await crm.call("PATCH", `/crm/v8/settings/fields/${field.id}?module=Leads`, {
    fields: [
      {
        id: field.id,
        pick_list_values: [
          ...(field.pick_list_values ?? []).map((value) => ({
            id: value.id,
            display_value: value.display_value,
            actual_value: value.actual_value,
          })),
          ...missing.map((value) => ({ display_value: value, actual_value: value })),
        ],
      },
    ],
  });
  const added = fieldWritten(answer.json);
  report(
    added,
    field.api_name,
    added ? `added ${missing.join(", ")}` : `Zoho refused the values (${fieldProblem(answer.json)})`,
  );
}

const before = await leadFields();

for (const field of CUSTOM_FIELDS) {
  const found = before.find((candidate) => candidate.api_name === field.apiName);
  if (found !== undefined) {
    report(found.data_type === field.dataType, field.apiName, `exists as ${found.data_type}`);
    continue;
  }
  if (options.check) {
    report(false, field.apiName, "missing");
    continue;
  }
  await createField(field);
}

for (const [apiName, wanted] of Object.entries(PICK_LIST_VALUES)) {
  const found = before.find((candidate) => candidate.api_name === apiName);
  if (found === undefined) {
    report(false, apiName, "missing; every CRM org has this field, so check the module");
    continue;
  }
  await addPickListValues(found, wanted);
}

console.log(
  failures === 0
    ? `\nLeads is set up${options.check ? "" : "; run scripts/check-zoho-setup.ts to prove it"}`
    : `\n${String(failures)} problem(s) in Zoho`,
);
process.exit(failures === 0 ? 0 : 1);
