// Checks that a Zoho org is set up the way the sync expects (docs/runbook.md,
// "Provisioning an environment", step 8), and lists the Leads assignment rules
// so ZOHO_LAR_ID can be chosen. Read-only: it changes nothing in Zoho.
//
//   node --env-file=.env.worker-staging scripts/check-zoho-setup.ts
//
// The file holds the ZOHO_* secrets. The refresh token's scope must include
// ZohoCRM.settings.fields.READ and ZohoCRM.settings.assignment_rules.READ.
// No secret is printed.

import { LOSS_EXTENT_NAMES, WINDOW_NAMES } from "../src/config/booking.ts";
import { LEAD_STATUSES } from "../src/providers/crm.ts";
import { LEAD_SOURCE_NAMES } from "../src/providers/zoho.ts";

interface ExpectedField {
  readonly apiName: string;
  readonly type: string;
  readonly values?: readonly string[];
}

/** What src/providers/zoho.ts writes. The values come from the same constants it uses. */
const EXPECTED_FIELDS: readonly ExpectedField[] = [
  { apiName: "Lead_Status", type: "picklist", values: LEAD_STATUSES },
  { apiName: "Lead_Source", type: "picklist", values: Object.values(LEAD_SOURCE_NAMES) },
  { apiName: "First_Choice_Window", type: "picklist", values: Object.values(WINDOW_NAMES) },
  { apiName: "Loss_Extent", type: "picklist", values: Object.values(LOSS_EXTENT_NAMES) },
  { apiName: "Proposed_Visit_Date", type: "date" },
  { apiName: "Contact_Consent", type: "boolean" },
  { apiName: "Try_On", type: "boolean" },
  { apiName: "D1_Lead_ID", type: "text" },
  { apiName: "D1_Person_ID", type: "text" },
  { apiName: "UTM_Source", type: "text" },
  { apiName: "UTM_Campaign", type: "text" },
];

interface ZohoField {
  api_name: string;
  data_type: string;
  pick_list_values?: { actual_value: string }[];
}

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "") {
    console.error(`${name} is not set; pass the secrets file with --env-file`);
    process.exit(2);
  }
  return value;
}

/** Empty when unset. */
function optional(name: string): string {
  return process.env[name]?.trim() ?? "";
}

const accountsHost = required("ZOHO_ACCOUNTS_HOST");
const apiHost = required("ZOHO_API_HOST");

async function accessToken(): Promise<string> {
  const query = new URLSearchParams({
    refresh_token: required("ZOHO_REFRESH_TOKEN"),
    client_id: required("ZOHO_CLIENT_ID"),
    client_secret: required("ZOHO_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
  const response = await fetch(`https://${accountsHost}/oauth/v2/token?${query.toString()}`, { method: "POST" });
  const body = await response.json<{ access_token?: string; error?: string }>();
  if (body.access_token === undefined) {
    console.error(`FAIL  token: Zoho refused the refresh token (${body.error ?? String(response.status)})`);
    process.exit(1);
  }
  return body.access_token;
}

async function get(token: string, path: string): Promise<unknown> {
  const response = await fetch(`https://${apiHost}${path}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (body as { code?: string } | null)?.code ?? String(response.status);
    throw new Error(
      `${path}: ${code}. Check the token's scope includes the settings READ scopes, and that ZOHO_API_HOST ` +
        "matches the org: developer.zohoapis.<dc> for a Developer Edition org, www.zohoapis.<dc> for production.",
    );
  }
  return body;
}

let failures = 0;
function report(ok: boolean, what: string, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}: ${detail}`);
}

const token = await accessToken();
report(true, "token", `refreshed through ${accountsHost}`);

const { fields } = (await get(token, "/crm/v8/settings/fields?module=Leads")) as { fields: ZohoField[] };
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
  const present = new Set((field.pick_list_values ?? []).map((value) => value.actual_value));
  const missing = (expected.values ?? []).filter((value) => !present.has(value));
  report(
    missing.length === 0,
    expected.apiName,
    missing.length === 0 ? expected.type : `missing values: ${missing.join(", ")}`,
  );
}

const { assignment_rules: rules = [] } = (await get(token, "/crm/v8/settings/automation/assignment_rules")) as {
  assignment_rules?: { id: string; name: string; module?: { api_name?: string } }[];
};
const leadRules = rules.filter((rule) => rule.module?.api_name === "Leads");
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
