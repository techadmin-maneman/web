// Checks that a Zoho org is set up the way the sync expects (docs/runbook.md,
// "Provisioning an environment", step 8), and lists the Leads assignment rules
// so ZOHO_LAR_ID can be chosen. Read-only: it changes nothing in Zoho.
//
//   node --env-file=.env.worker-staging scripts/check-zoho-setup.ts
//
// The file holds the ZOHO_* secrets, with ZOHO_SCRIPTS_REFRESH_TOKEN, the scripts'
// own refresh token, never the Worker's (scripts/lib/zoho-script-token.ts). Its scope must include
// ZohoCRM.settings.fields.READ and ZohoCRM.settings.assignment_rules.READ.
// No secret is printed.

import type { z } from "zod";
import { LOSS_EXTENT_NAMES, WINDOW_NAMES } from "../src/config/booking.ts";
import { BOOKED_WINDOW_NAMES, REFERRAL_LEAD_SOURCE } from "../src/config/crm.ts";
import { LEAD_STATUSES } from "../src/providers/crm/index.ts";
import { LEAD_SOURCE_NAMES } from "../src/providers/crm/zoho.ts";
import { ASSIGNMENT_RULES, LEAD_FIELDS } from "./lib/crm-settings.ts";
import { zohoScriptClient } from "./lib/zoho-script-client.ts";

interface ExpectedField {
  readonly apiName: string;
  readonly type: string;
  readonly values?: readonly string[];
  /** Zoho must refuse a second record with the same value. */
  readonly unique?: true;
}

/** What src/providers/crm/zoho.ts writes. The values come from the same constants it uses. */
const EXPECTED_FIELDS: readonly ExpectedField[] = [
  { apiName: "Lead_Status", type: "picklist", values: LEAD_STATUSES },
  // "Referral" is written only once CRM_ORG_HAS_REFERRAL_FIELDS (src/config/crm.ts) is on; it is checked here so
  // the org is proved ready before that.
  {
    apiName: "Lead_Source",
    type: "picklist",
    values: [...Object.values(LEAD_SOURCE_NAMES), REFERRAL_LEAD_SOURCE],
  },
  { apiName: "First_Choice_Window", type: "picklist", values: Object.values(WINDOW_NAMES) },
  { apiName: "Loss_Extent", type: "picklist", values: Object.values(LOSS_EXTENT_NAMES) },
  { apiName: "Proposed_Visit_Date", type: "date" },
  { apiName: "Contact_Consent", type: "boolean" },
  { apiName: "Try_On", type: "boolean" },
  { apiName: "D1_Lead_ID", type: "text" },
  // Unique, so two overlapping syncs of one person cannot both insert a record.
  { apiName: "D1_Person_ID", type: "text", unique: true },
  { apiName: "UTM_Source", type: "text" },
  { apiName: "UTM_Campaign", type: "text" },
  // What CRM_ORG_HAS_REFERRAL_FIELDS (src/config/crm.ts) needs before it is turned on: scripts/setup-crm.ts makes them.
  { apiName: "Referral_Code", type: "text" },
  { apiName: "Booked_Window", type: "picklist", values: Object.values(BOOKED_WINDOW_NAMES) },
];

/** Empty when unset. */
function optional(name: string): string {
  return process.env[name]?.trim() ?? "";
}

let failures = 0;
function report(ok: boolean, what: string, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}: ${detail}`);
}

const crm = await zohoScriptClient("crm");
report(true, "token", `issued for ${crm.host}`);

/** A settings read, or the script stops with what to check: the token's scope, and the org's API host. */
async function read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  try {
    return await crm.get(path, schema);
  } catch (error) {
    console.error(
      `FAIL  ${error instanceof Error ? error.message : String(error)}. Check the token's scope includes the settings READ scopes, and that ` +
        "ZOHO_API_HOST matches the org: developer.zohoapis.<dc> for a Developer Edition org, www.zohoapis.<dc> for production.",
    );
    process.exit(1);
  }
}

const { fields } = await read("/crm/v8/settings/fields?module=Leads", LEAD_FIELDS);
for (const expected of EXPECTED_FIELDS) {
  const field = fields.find((candidate) => candidate.api_name === expected.apiName);
  if (field === undefined) {
    report(false, expected.apiName, "missing (check the API name, not the label)");
    continue;
  }
  if (field.data_type !== expected.type) {
    report(false, expected.apiName, `is ${field.data_type}, expected ${expected.type}`);
    continue;
  }
  if (expected.unique === true && Object.keys(field.unique ?? {}).length === 0) {
    report(false, expected.apiName, 'allows duplicates; tick "Do not allow duplicate values" on the field');
    continue;
  }
  const present = new Set((field.pick_list_values ?? []).map((value) => value.actual_value));
  const missing = (expected.values ?? []).filter((value) => !present.has(value));
  report(
    missing.length === 0,
    expected.apiName,
    missing.length === 0
      ? `${expected.type}${expected.unique === true ? ", unique" : ""}`
      : `missing values: ${missing.join(", ")}`,
  );
}

const rules = (await read("/crm/v8/settings/automation/assignment_rules", ASSIGNMENT_RULES))?.assignment_rules ?? [];

const leadRules = rules.filter((rule) => rule.module.api_name === "Leads");
console.log("\nLeads assignment rules (ZOHO_LAR_ID is one of these IDs):");
for (const rule of leadRules) console.log(`  ${rule.id}  ${rule.name}`);
if (leadRules.length === 0) report(false, "assignment rule", "no Leads assignment rule exists");

const larId = optional("ZOHO_LAR_ID");
if (larId !== "") {
  report(
    leadRules.some((rule) => rule.id === larId),
    "ZOHO_LAR_ID",
    leadRules.some((rule) => rule.id === larId) ? "matches a Leads assignment rule" : "is not a Leads assignment rule",
  );
}

console.log(failures === 0 ? "\nZoho setup looks right" : `\n${String(failures)} problem(s) to fix in Zoho`);
process.exit(failures === 0 ? 0 : 1);
