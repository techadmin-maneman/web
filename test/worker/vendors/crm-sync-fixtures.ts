// What the CRM sync tests share (crm-sync*.test.ts): a logger, a CRM that records what it is sent, a lead's row, and
// the alerts left open.

import { env } from "cloudflare:workers";
import { createLogger } from "../../../src/log.ts";
import type { CrmContact, CrmLead, CrmProvider } from "../../../src/providers/crm/index.ts";

export const log = createLogger();

/** A CRM that remembers what it was asked. */
export function recordingCrm(): CrmProvider & {
  calls: { lead: CrmLead; knownId: string | null }[];
  erasures: { personId: string; knownId: string | null }[];
  updates: { contact: CrmContact; knownId: string | null }[];
} {
  const calls: { lead: CrmLead; knownId: string | null }[] = [];
  const erasures: { personId: string; knownId: string | null }[] = [];
  const updates: { contact: CrmContact; knownId: string | null }[] = [];
  return {
    calls,
    erasures,
    updates,
    syncLead: (lead, knownId) => {
      calls.push({ lead, knownId });
      return Promise.resolve({ crmLeadId: knownId ?? "zoho-1", created: knownId === null });
    },
    erasePerson: (personId, knownId) => {
      erasures.push({ personId, knownId });
      return Promise.resolve({ found: knownId !== null });
    },
    eraseContact: () => Promise.resolve({ found: true }),
    updateContact: (contact, knownId) => {
      updates.push({ contact, knownId });
      return Promise.resolve({ crmLeadId: knownId ?? "zoho-found" });
    },
  };
}

export function leadRow(leadId: string) {
  return env.DB.prepare("SELECT sync_state, sync_attempts, last_sync_error, synced_at FROM leads WHERE id = ?")
    .bind(leadId)
    .first<{ sync_state: string; sync_attempts: number; last_sync_error: string | null; synced_at: string | null }>();
}

export const openAlertKeys = () =>
  env.DB.prepare("SELECT key FROM alerts WHERE resolved_at IS NULL ORDER BY key")
    .all<{ key: string }>()
    .then((answer) => answer.results.map((row) => row.key));
