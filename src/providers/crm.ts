// The CRM, behind an interface. Callers use CrmProvider; only this file knows
// which implementation runs, and only src/providers/zoho.ts knows Zoho.

import type { LossExtent, VisitWindow } from "../config/booking.ts";
import type { ZohoSettings } from "../config/settings.ts";
import type { Logger } from "../log.ts";
import { assertStatusAllowed, statusForNewRecord, statusForUpdate } from "./crm-rules.ts";
import { createZohoCrm } from "./zoho.ts";

export type LeadSource = "form" | "waitlist" | "tryon";

/** Statuses the sync sets. Ops move leads on from these by hand. */
export type LeadStatus = "New" | "Waitlist" | "Try-on — delivery only";

/** Everything a CRM record is built from; read from D1 at sync time. */
export interface CrmLead {
  readonly personId: string;
  readonly leadId: string;
  readonly name: string;
  readonly mobileE164: string;
  readonly email: string | null;
  readonly source: LeadSource;
  readonly city: string | null;
  readonly firstChoiceWindow: VisitWindow | null;
  readonly lossExtent: LossExtent;
  readonly proposedVisitDate: string | null;
  /** The person has a contact consent: ops may call and message them. */
  readonly contactable: boolean;
  readonly tryOn: boolean;
  readonly utmSource: string | null;
  readonly utmCampaign: string | null;
}

export interface CrmSyncResult {
  readonly crmLeadId: string;
  readonly created: boolean;
}

export interface CrmProvider {
  /** Creates the person's CRM record, or updates it and adds a note. */
  syncLead(lead: CrmLead, knownCrmLeadId: string | null): Promise<CrmSyncResult>;
}

export function createCrmProvider(
  zoho: ZohoSettings | null,
  deps: { db: D1Database; fetch: typeof fetch; now: () => Date; log: Logger },
): CrmProvider {
  return zoho === null ? createStubCrm(deps.log) : createZohoCrm(zoho, deps);
}

/** Local and test stand-in: writes nothing anywhere, returns a fake ID. */
export function createStubCrm(log: Logger): CrmProvider {
  return {
    syncLead: (lead, knownCrmLeadId) => {
      const created = knownCrmLeadId === null;
      const status = created ? statusForNewRecord(lead) : statusForUpdate(lead);
      assertStatusAllowed(lead, status);
      log.info("crm_stub_sync", { lead_id: lead.leadId, status, created });
      return Promise.resolve({ crmLeadId: knownCrmLeadId ?? `stub-${lead.personId}`, created });
    },
  };
}
