// Zoho CRM v8. Only src/providers/crm.ts imports this module. Request shapes
// follow Zoho's v8 docs, recorded in docs/decisions/0012-zoho-sync.md:
//
//   insert  POST /crm/v8/Leads             { data: [record], trigger: [...], lar_id? }
//   update  PUT  /crm/v8/Leads/{id}        { data: [record], trigger: [...] }
//   note    POST /crm/v8/Leads/{id}/Notes  { data: [{ Note_Title, Note_Content }] }
//   find    GET  /crm/v8/Leads/search?criteria=(D1_Person_ID:equals:{id})
//   token   POST https://{accounts}/oauth/v2/token?grant_type=refresh_token&...
//
// "trigger": [] turns workflows off; leaving the key out would run them.

import { LOSS_EXTENT_NAMES, WINDOW_NAMES } from "../config/booking.ts";
import type { ZohoSettings } from "../config/settings.ts";
import type { Logger } from "../log.ts";
import type { CrmLead, CrmProvider, LeadSource, LeadStatus } from "./crm.ts";
import { createTokenCache, type TokenStore, ZohoError, zohoErrorFrom, zohoSend } from "./zoho-http.ts";
import {
  assertStatusAllowed,
  shouldAssign,
  shouldRunWorkflows,
  statusForNewRecord,
  statusForUpdate,
} from "./crm-rules.ts";

export const LEAD_SOURCE_NAMES: Readonly<Record<LeadSource, string>> = {
  form: "Booking form",
  waitlist: "Waitlist",
  tryon: "Try-on",
};

interface ZohoDependencies {
  readonly db: D1Database;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly log: Logger;
}

export function createZohoCrm(settings: ZohoSettings, deps: ZohoDependencies): CrmProvider {
  return {
    async syncLead(lead, knownCrmLeadId) {
      const api = createZohoApi(settings, { ...deps, log: deps.log.child({ lead_id: lead.leadId }) });
      const existingId = knownCrmLeadId ?? (await api.findLeadByPersonId(lead.personId));

      if (existingId === null) {
        const status = statusForNewRecord(lead);
        assertStatusAllowed(lead, status);
        const id = await api.insertLead(recordFor(lead, status, true), {
          assignmentRuleId: shouldAssign(lead) ? settings.larId : null,
          runWorkflows: shouldRunWorkflows(lead),
        });
        return { crmLeadId: id, created: true };
      }

      const status = statusForUpdate(lead);
      assertStatusAllowed(lead, status);
      await api.updateLead(existingId, recordFor(lead, status, false), { runWorkflows: shouldRunWorkflows(lead) });
      await api.addNote(existingId, noteFor(lead));
      return { crmLeadId: existingId, created: false };
    },

    async erasePerson(personId, knownCrmLeadId) {
      const api = createZohoApi(settings, { ...deps, log: deps.log.child({ person_id: personId }) });
      const id = knownCrmLeadId ?? (await api.findLeadByPersonId(personId));
      if (id === null) return { found: false };
      // Workflows off: nothing should chase, or e-mail about, an erased person.
      await api.updateLead(id, ERASED_RECORD, { runWorkflows: false });
      await api.addNote(id, { title: "Personal data erased", content: "Erased at the person's request." });
      return { found: true };
    },
  };
}

/** What an erased person's record keeps: the lead history, without who it was. */
export const ERASED_RECORD: Readonly<Record<string, unknown>> = {
  Last_Name: "Erased",
  Mobile: null,
  Email: null,
  Contact_Consent: false,
};

/** The Zoho Leads fields for this lead. See docs/runbook.md, "Setting up Zoho", for the custom fields. */
export function recordFor(lead: CrmLead, status: LeadStatus | null, isNew: boolean): Record<string, unknown> {
  const record: Record<string, unknown> = {
    Last_Name: lead.name,
    Mobile: lead.mobileE164,
    Contact_Consent: lead.contactable,
    D1_Person_ID: lead.personId,
    D1_Lead_ID: lead.leadId,
  };
  if (status !== null) record.Lead_Status = status;
  if (isNew) record.Lead_Source = LEAD_SOURCE_NAMES[lead.source];
  if (lead.email !== null) record.Email = lead.email;
  if (lead.tryOn) record.Try_On = true;
  if (lead.utmSource !== null) record.UTM_Source = lead.utmSource;
  if (lead.utmCampaign !== null) record.UTM_Campaign = lead.utmCampaign;

  // Booking details come only from bookings; a try-on must not blank them.
  if (lead.source !== "tryon") {
    if (lead.city !== null) record.City = lead.city;
    if (lead.firstChoiceWindow !== null) record.First_Choice_Window = WINDOW_NAMES[lead.firstChoiceWindow];
    record.Loss_Extent = LOSS_EXTENT_NAMES[lead.lossExtent];
    if (lead.proposedVisitDate !== null) record.Proposed_Visit_Date = lead.proposedVisitDate;
  }
  return record;
}

/** The note added to an existing record. City and dates only; no personal data. */
export function noteFor(lead: CrmLead): { title: string; content: string } {
  if (lead.source === "form") {
    const window = lead.firstChoiceWindow === null ? "" : `, ${WINDOW_NAMES[lead.firstChoiceWindow].toLowerCase()}`;
    const date = lead.proposedVisitDate === null ? "" : `, proposed ${lead.proposedVisitDate}`;
    return {
      title: "New booking request",
      content: `Asked for a visit in ${lead.city ?? "an unknown city"}${window}${date}.`,
    };
  }
  if (lead.source === "waitlist") {
    return { title: "Joined a waitlist", content: `Asked to be told when ${lead.city ?? "their city"} is served.` };
  }
  return { title: "Used the try-on", content: "Generated a simulation and asked for a copy on WhatsApp." };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

type Step = "token" | "search" | "insert" | "update" | "note";

function createZohoApi(settings: ZohoSettings, deps: ZohoDependencies) {
  const tokens = createTokenCache(settings, crmTokenStore(deps.db), deps);

  /** One API call. On 401 the token is refreshed once and the call repeated. */
  async function call(step: Step, method: string, path: string, body?: unknown): Promise<unknown> {
    for (const forceRefresh of [false, true]) {
      const token = await tokens.get(forceRefresh);
      const response = await zohoSend(deps, step, `https://${settings.apiHost}${path}`, {
        method,
        headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
      });
      if (response.status === 401 && !forceRefresh) continue;
      if (response.status === 204) return null;

      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) throw zohoErrorFrom(response.status, json);
      return json;
    }
    throw new ZohoError(401, "AUTHENTICATION_FAILURE", "rejected a freshly refreshed token");
  }

  /** Zoho answers per record inside `data`; the first record's outcome is ours. */
  function firstRecord(json: unknown): { id: string } {
    const record = (json as { data?: unknown[] } | null)?.data?.[0] as
      { status?: string; code?: string; message?: string; details?: { id?: string } } | undefined;
    if (record?.status !== "success" || typeof record.details?.id !== "string") {
      throw new ZohoError(200, record?.code ?? "UNKNOWN", record?.message ?? "no record in the response");
    }
    return { id: record.details.id };
  }

  return {
    async findLeadByPersonId(personId: string): Promise<string | null> {
      const criteria = encodeURIComponent(`(D1_Person_ID:equals:${personId})`);
      const json = await call("search", "GET", `/crm/v8/Leads/search?criteria=${criteria}`);
      const id = (json as { data?: { id?: unknown }[] } | null)?.data?.[0]?.id;
      return typeof id === "string" ? id : null;
    },

    async insertLead(
      record: Record<string, unknown>,
      options: { assignmentRuleId: string | null; runWorkflows: boolean },
    ): Promise<string> {
      const body: Record<string, unknown> = { data: [record], trigger: options.runWorkflows ? ["workflow"] : [] };
      if (options.assignmentRuleId !== null) body.lar_id = options.assignmentRuleId;
      return firstRecord(await call("insert", "POST", "/crm/v8/Leads", body)).id;
    },

    async updateLead(id: string, record: Record<string, unknown>, options: { runWorkflows: boolean }): Promise<void> {
      firstRecord(
        await call("update", "PUT", `/crm/v8/Leads/${id}`, {
          data: [record],
          trigger: options.runWorkflows ? ["workflow"] : [],
        }),
      );
    },

    async addNote(id: string, note: { title: string; content: string }): Promise<void> {
      firstRecord(
        await call("note", "POST", `/crm/v8/Leads/${id}/Notes`, {
          data: [{ Note_Title: note.title, Note_Content: note.content }],
        }),
      );
    },
  };
}

/** The CRM's access token, in its own one-row table (migrations/0002_lead_path.sql). */
function crmTokenStore(db: D1Database): TokenStore {
  return {
    async read() {
      const row = await db
        .prepare("SELECT access_token, expires_at FROM zoho_token WHERE id = 1")
        .first<{ access_token: string; expires_at: string }>();
      return row === null ? null : { accessToken: row.access_token, expiresAt: row.expires_at };
    },
    async write(accessToken, expiresAt) {
      await db
        .prepare(
          `INSERT INTO zoho_token (id, access_token, expires_at) VALUES (1, ?1, ?2)
           ON CONFLICT (id) DO UPDATE SET access_token = excluded.access_token, expires_at = excluded.expires_at`,
        )
        .bind(accessToken, expiresAt)
        .run();
    },
  };
}
