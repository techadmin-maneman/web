// The crm-sync consumer: the only caller of the CRM. Each message names a lead;
// the lead and person are read fresh from D1, which is the system of record.
//
// A failed sync is marked `failed`. A lead's first failure goes back on the
// queue for one more try QUICK_RETRY_DELAY_SECONDS later, so a passing hiccup
// costs seconds, not minutes. After that the sweeper re-enqueues failed leads
// every five minutes until MAX_SYNC_ATTEMPTS, then this consumer alerts once.
// See docs/decisions/0012-zoho-sync.md.

import { z } from "zod";
import type { LossExtent, VisitWindow } from "../config/booking.ts";
import type { Dependencies } from "../dependencies.ts";
import { scrubString, type Logger } from "../log.ts";
import type { CrmLead, LeadSource } from "../providers/crm.ts";

export const MAX_SYNC_ATTEMPTS = 10;
export const QUICK_RETRY_DELAY_SECONDS = 30;

export const CrmSyncMessageSchema = z.object({ lead_id: z.uuid(), request_id: z.string() });
export type CrmSyncMessage = z.infer<typeof CrmSyncMessageSchema>;

export async function handleCrmSyncBatch(
  batch: MessageBatch,
  db: D1Database,
  deps: Dependencies,
  log: Logger,
): Promise<void> {
  for (const message of batch.messages) {
    const parsed = CrmSyncMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      log.error("crm_sync_bad_message", { message_id: message.id });
      message.ack();
      continue;
    }
    const { retrySoon } = await syncLead(
      db,
      deps,
      log.child({ request_id: parsed.data.request_id }),
      parsed.data.lead_id,
    );
    if (retrySoon) message.retry({ delaySeconds: QUICK_RETRY_DELAY_SECONDS });
    else message.ack();
  }
}

interface LeadRow {
  lead_id: string;
  person_id: string;
  source: LeadSource;
  city: string | null;
  first_choice_window: VisitWindow | null;
  loss_extent: LossExtent;
  proposed_visit_date: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  sync_state: "pending" | "synced" | "failed";
  name: string;
  mobile_e164: string;
  email: string | null;
  zoho_lead_id: string | null;
  contactable: number;
  tried_on: number;
}

/** `retrySoon` is true only when this was the lead's first attempt and it failed. */
export async function syncLead(
  db: D1Database,
  deps: Dependencies,
  log: Logger,
  leadId: string,
): Promise<{ retrySoon: boolean }> {
  const started = Date.now();
  const row = await db
    .prepare(
      `SELECT l.id AS lead_id, l.person_id, l.source, l.city, l.first_choice_window, l.loss_extent,
              l.proposed_visit_date, l.utm_source, l.utm_campaign, l.sync_state,
              p.name, p.mobile_e164, p.email, p.zoho_lead_id, p.contactable,
              EXISTS (SELECT 1 FROM leads t WHERE t.person_id = p.id AND t.source = 'tryon') AS tried_on
       FROM leads l JOIN people p ON p.id = l.person_id
       WHERE l.id = ?1`,
    )
    .bind(leadId)
    .first<LeadRow>();

  if (row === null) {
    log.error("crm_sync_unknown_lead", { lead_id: leadId });
    return { retrySoon: false };
  }
  if (row.sync_state === "synced") return { retrySoon: false }; // a duplicate message

  const attempt = await db
    .prepare("UPDATE leads SET sync_attempts = sync_attempts + 1 WHERE id = ?1 RETURNING sync_attempts")
    .bind(leadId)
    .first<{ sync_attempts: number }>();
  const attempts = attempt?.sync_attempts ?? 1;

  try {
    const result = await deps.crm.syncLead(toCrmLead(row), row.zoho_lead_id);
    const at = deps.now().toISOString();
    await db.batch([
      db.prepare("UPDATE people SET zoho_lead_id = ?1 WHERE id = ?2").bind(result.crmLeadId, row.person_id),
      db
        .prepare("UPDATE leads SET sync_state = 'synced', synced_at = ?1, last_sync_error = NULL WHERE id = ?2")
        .bind(at, leadId),
      db
        .prepare(
          "INSERT INTO events (id, created_at, name, subject_id, payload_json) VALUES (?, ?, 'lead_synced', ?, ?)",
        )
        .bind(crypto.randomUUID(), at, leadId, JSON.stringify({ attempts, created: result.created })),
    ]);
    log.info("crm_synced", { lead_id: leadId, attempts, created: result.created, duration_ms: Date.now() - started });
    return { retrySoon: false };
  } catch (error) {
    const description = describe(error);
    await db
      .prepare("UPDATE leads SET sync_state = 'failed', last_sync_error = ?1 WHERE id = ?2")
      .bind(description, leadId)
      .run();
    log.error("crm_sync_failed", { lead_id: leadId, attempts, error, duration_ms: Date.now() - started });
    if (attempts >= MAX_SYNC_ATTEMPTS) {
      await deps.alert(`Lead ${leadId} did not reach the CRM after ${String(attempts)} attempts: ${description}`);
    }
    return { retrySoon: attempts === 1 };
  }
}

function toCrmLead(row: LeadRow): CrmLead {
  return {
    personId: row.person_id,
    leadId: row.lead_id,
    name: row.name,
    mobileE164: row.mobile_e164,
    email: row.email,
    source: row.source,
    city: row.city,
    firstChoiceWindow: row.first_choice_window,
    lossExtent: row.loss_extent,
    proposedVisitDate: row.proposed_visit_date,
    contactable: row.contactable === 1,
    tryOn: row.tried_on === 1,
    utmSource: row.utm_source,
    utmCampaign: row.utm_campaign,
  };
}

/** A short error for last_sync_error: no personal data, no stack. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return scrubString(message).slice(0, 300);
}
