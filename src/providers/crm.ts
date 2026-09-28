// The CRM, behind an interface. Callers use CrmProvider; only this file knows
// which implementation runs, and only src/providers/zoho-crm.ts knows Zoho.

import type { LossExtent, VisitWindow } from "../config/booking.ts";
import type { BookingWindow } from "../config/scheduling.ts";
import type { ZohoSettings } from "../config/settings.ts";
import type { Logger } from "../log.ts";
import { assertStatusAllowed, statusForNewRecord, statusForUpdate } from "./crm-rules.ts";
import { createZohoCrm } from "./zoho-crm.ts";
import type { ZohoRequesterDependencies } from "./zoho-http.ts";

export type LeadSource = "form" | "waitlist" | "tryon";

/** Statuses the sync sets. Ops move leads on from these by hand. */
export const LEAD_STATUSES = ["New", "Waitlist", "Try-on — delivery only"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

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
  /** Null for a booking made on a Phase 2 form, which does not ask (migration 0025). */
  readonly lossExtent: LossExtent | null;
  readonly proposedVisitDate: string | null;
  /** The person has a contact consent: ops may call and message them. */
  readonly contactable: boolean;
  readonly tryOn: boolean;
  readonly utmSource: string | null;
  readonly utmCampaign: string | null;
  /** The code of the friend's invite the person came through; null for one who came on their own. */
  readonly inviteCode: string | null;
  /** The window a Phase 2 booking asked for, where the lead's own Phase 1 choice is absent. */
  readonly askedWindow: BookingWindow | null;
}

export interface CrmSyncResult {
  readonly crmLeadId: string;
  readonly created: boolean;
}

/** A person's details as they are now, after a change of number or address, or an invite ops attached. */
export interface CrmContact {
  readonly personId: string;
  readonly mobileE164: string;
  /** The city of their current address; null where they have given none. */
  readonly city: string | null;
  /** The code of the invite they came through; null for none. */
  readonly inviteCode: string | null;
  /** Ops have just attached that invite, which the record is told of in a note, as a new lead's invite is. */
  readonly inviteAttached: boolean;
}

export interface CrmProvider {
  /** Creates the person's CRM record, or updates it and adds a note. */
  syncLead(lead: CrmLead, knownCrmLeadId: string | null): Promise<CrmSyncResult>;
  /**
   * Blanks an erased person's record: name, number and e-mail, and the consent
   * to contact them. `found` is false when the CRM never had them.
   */
  erasePerson(personId: string, knownCrmLeadId: string | null): Promise<{ found: boolean }>;
  /**
   * Writes a person's number, their address's city and the invite they came
   * through onto their record, with workflows off: nothing chases a client for
   * a change of number. An invite ops have just attached is noted as well. The
   * record's ID, or null when the CRM never had them.
   */
  updateContact(contact: CrmContact, knownCrmLeadId: string | null): Promise<{ crmLeadId: string | null }>;
}

export function createCrmProvider(zoho: ZohoSettings | null, deps: ZohoRequesterDependencies): CrmProvider {
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
    erasePerson: (personId, knownCrmLeadId) => {
      log.info("crm_stub_erase", { person_id: personId });
      return Promise.resolve({ found: knownCrmLeadId !== null });
    },
    updateContact: (contact, knownCrmLeadId) => {
      log.info("crm_stub_update_contact", { person_id: contact.personId });
      return Promise.resolve({ crmLeadId: knownCrmLeadId });
    },
  };
}
