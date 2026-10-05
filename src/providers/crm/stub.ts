// The CRM's local and test stand-in (./index.ts chooses it).

import type { Logger } from "../../log.ts";
import { assertStatusAllowed, statusForNewRecord, statusForUpdate } from "./rules.ts";
import type { CrmProvider } from "./index.ts";

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
