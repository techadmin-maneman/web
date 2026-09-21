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
import type { CrmLead, CrmProvider, LeadSource, LeadStatus } from "./crm.ts";
import {
  assertStatusAllowed,
  shouldAssign,
  shouldRunWorkflows,
  statusForNewRecord,
  statusForUpdate,
} from "./crm-rules.ts";

const TIMEOUT_MS = 10_000;
/** Refresh a token this long before Zoho would expire it. */
const TOKEN_MARGIN_MS = 60_000;

const LEAD_SOURCE_NAMES: Readonly<Record<LeadSource, string>> = {
  form: "Booking form",
  waitlist: "Waitlist",
  tryon: "Try-on",
};

/** A failed Zoho call. The message never includes record data. */
export class ZohoError extends Error {
  override readonly name = "ZohoError";
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(`Zoho ${String(status)} ${code}: ${message}`);
    this.status = status;
    this.code = code;
  }
}

interface ZohoDependencies {
  readonly db: D1Database;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
}

export function createZohoCrm(settings: ZohoSettings, deps: ZohoDependencies): CrmProvider {
  const api = createZohoApi(settings, deps);

  return {
    async syncLead(lead, knownCrmLeadId) {
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
  };
}

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

function createZohoApi(settings: ZohoSettings, deps: ZohoDependencies) {
  const tokens = createTokenCache(settings, deps);

  /** One API call. On 401 the token is refreshed once and the call repeated. */
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    for (const forceRefresh of [false, true]) {
      const token = await tokens.get(forceRefresh);
      const response = await deps.fetch(`https://${settings.apiHost}${path}`, {
        method,
        headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 401 && !forceRefresh) continue;
      if (response.status === 204) return null;

      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) throw errorFrom(response.status, json);
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
      const json = await call("GET", `/crm/v8/Leads/search?criteria=${criteria}`);
      const id = (json as { data?: { id?: unknown }[] } | null)?.data?.[0]?.id;
      return typeof id === "string" ? id : null;
    },

    async insertLead(
      record: Record<string, unknown>,
      options: { assignmentRuleId: string | null; runWorkflows: boolean },
    ): Promise<string> {
      const body: Record<string, unknown> = { data: [record], trigger: options.runWorkflows ? ["workflow"] : [] };
      if (options.assignmentRuleId !== null) body.lar_id = options.assignmentRuleId;
      return firstRecord(await call("POST", "/crm/v8/Leads", body)).id;
    },

    async updateLead(id: string, record: Record<string, unknown>, options: { runWorkflows: boolean }): Promise<void> {
      firstRecord(
        await call("PUT", `/crm/v8/Leads/${id}`, { data: [record], trigger: options.runWorkflows ? ["workflow"] : [] }),
      );
    },

    async addNote(id: string, note: { title: string; content: string }): Promise<void> {
      firstRecord(
        await call("POST", `/crm/v8/Leads/${id}/Notes`, {
          data: [{ Note_Title: note.title, Note_Content: note.content }],
        }),
      );
    },
  };
}

/** Access tokens live an hour; one is shared by every invocation through D1. */
function createTokenCache(settings: ZohoSettings, deps: ZohoDependencies) {
  return {
    async get(forceRefresh: boolean): Promise<string> {
      if (!forceRefresh) {
        const cached = await deps.db
          .prepare("SELECT access_token, expires_at FROM zoho_token WHERE id = 1")
          .first<{ access_token: string; expires_at: string }>();
        if (cached !== null && Date.parse(cached.expires_at) - deps.now().getTime() > TOKEN_MARGIN_MS) {
          return cached.access_token;
        }
      }

      const query = new URLSearchParams({
        refresh_token: settings.refreshToken,
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        grant_type: "refresh_token",
      });
      const response = await deps.fetch(`https://${settings.accountsHost}/oauth/v2/token?${query.toString()}`, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await response.json().catch(() => null)) as {
        access_token?: string;
        expires_in?: number;
        error?: string;
      } | null;
      if (typeof json?.access_token !== "string") {
        throw new ZohoError(
          response.status,
          json?.error ?? "TOKEN_REFRESH_FAILED",
          "could not refresh the access token",
        );
      }

      const expiresAt = new Date(deps.now().getTime() + (json.expires_in ?? 3600) * 1000).toISOString();
      await deps.db
        .prepare(
          `INSERT INTO zoho_token (id, access_token, expires_at) VALUES (1, ?1, ?2)
           ON CONFLICT (id) DO UPDATE SET access_token = excluded.access_token, expires_at = excluded.expires_at`,
        )
        .bind(json.access_token, expiresAt)
        .run();
      return json.access_token;
    },
  };
}

function errorFrom(status: number, json: unknown): ZohoError {
  const body = json as { code?: unknown; message?: unknown; data?: { code?: unknown; message?: unknown }[] } | null;
  const detail = body?.data?.[0] ?? body;
  const code = typeof detail?.code === "string" ? detail.code : "HTTP_ERROR";
  const message = typeof detail?.message === "string" ? detail.message : "request failed";
  return new ZohoError(status, code, message);
}
