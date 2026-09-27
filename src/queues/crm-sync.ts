// The crm-sync consumer: the only caller of the CRM. Each message names a lead
// to sync, a person to erase, or a person whose number or address changed;
// each is read fresh from D1, which is the system of record.
//
// A failed sync is marked `failed`. A lead's first failure goes back on the
// queue for one more try QUICK_RETRY_DELAY_SECONDS later, so a passing hiccup
// costs seconds, not minutes. After that the sweeper re-enqueues failed leads
// every five minutes until MAX_SYNC_ATTEMPTS, then this consumer alerts once.
// See docs/decisions/0012-zoho-sync.md.

import { z } from "zod";
import type { LossExtent, VisitWindow } from "../config/booking.ts";
import type { BookingWindow } from "../config/scheduling.ts";
import type { Dependencies } from "../dependencies.ts";
import { scrubString, type Logger } from "../log.ts";
import type { CrmLead, LeadSource } from "../providers/crm.ts";
import { leadNotice } from "../domain/lead-notice.ts";

export const MAX_SYNC_ATTEMPTS = 10;
export const QUICK_RETRY_DELAY_SECONDS = 30;

export const CrmSyncMessageSchema = z.union([
  z.object({ lead_id: z.uuid(), request_id: z.string() }),
  /** An erased person's record is blanked (docs/decisions/0019-erasure.md). */
  z.object({ erase_person_id: z.uuid(), request_id: z.string() }),
  /** A person whose number or address changed, written onto their record (src/http/contact-sync.ts). */
  z.object({ update_person_id: z.string().min(1), request_id: z.string() }),
]);
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
    const messageLog = log.child({ request_id: parsed.data.request_id });
    if ("update_person_id" in parsed.data) {
      await updateContact(message, db, deps, messageLog, parsed.data.update_person_id);
      continue;
    }
    const { retrySoon } =
      "erase_person_id" in parsed.data
        ? await eraseInCrm(db, deps, messageLog, parsed.data.erase_person_id)
        : await syncLead(db, deps, messageLog, parsed.data.lead_id);
    if (retrySoon) message.retry({ delaySeconds: QUICK_RETRY_DELAY_SECONDS });
    else message.ack();
  }
}

/** Tries of a contact update before ops are told to make it by hand. */
export const MAX_CONTACT_UPDATE_ATTEMPTS = 5;

/**
 * Writes a person's number, and the city of their address, onto their CRM
 * record, read afresh from D1. Nothing is written for an erased person or one
 * the CRM never had. A failure is tried again on the queue, and the fifth tells ops.
 */
async function updateContact(
  message: Message,
  db: D1Database,
  deps: Dependencies,
  log: Logger,
  personId: string,
): Promise<void> {
  const person = await db
    .prepare(
      `SELECT p.mobile_e164, p.zoho_lead_id,
         (SELECT city FROM addresses a WHERE a.person_id = p.id AND a.replaced_at IS NULL
          ORDER BY a.created_at DESC LIMIT 1) AS city
       FROM people p WHERE p.id = ?1 AND p.erased_at IS NULL`,
    )
    .bind(personId)
    .first<{ mobile_e164: string; zoho_lead_id: string | null; city: string | null }>();
  if (person === null) {
    message.ack();
    return;
  }
  try {
    const { crmLeadId } = await deps.crm.updateContact(
      { personId, mobileE164: person.mobile_e164, city: person.city },
      person.zoho_lead_id,
    );
    if (crmLeadId !== null && crmLeadId !== person.zoho_lead_id) {
      await db.prepare("UPDATE people SET zoho_lead_id = ?2 WHERE id = ?1").bind(personId, crmLeadId).run();
    }
    await deps.resolveAlert(`crm_contact_update:${personId}`);
    log.info("crm_contact_updated", { person_id: personId, found: crmLeadId !== null });
    message.ack();
  } catch (error) {
    const reason = describe(error);
    log.warn("crm_contact_update_failed", { person_id: personId, attempt: message.attempts, reason });
    if (message.attempts < MAX_CONTACT_UPDATE_ATTEMPTS) {
      message.retry({ delaySeconds: QUICK_RETRY_DELAY_SECONDS * 2 ** (message.attempts - 1) });
      return;
    }
    await deps.alertOnce({
      key: `crm_contact_update:${personId}`,
      message:
        `Client ${personId}'s new number or city did not reach their CRM lead after ` +
        `${String(message.attempts)} attempts: ${reason}. Update the lead by hand.`,
      link: `/clients/${personId}`,
    });
    message.ack();
  }
}

interface LeadRow {
  lead_id: string;
  person_id: string;
  source: LeadSource;
  city: string | null;
  first_choice_window: VisitWindow | null;
  loss_extent: LossExtent | null;
  proposed_visit_date: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  sync_state: "pending" | "synced" | "failed";
  erased_at: string | null;
  name: string;
  mobile_e164: string;
  email: string | null;
  zoho_lead_id: string | null;
  contactable: number;
  tried_on: number;
  invite_code: string | null;
  asked_window: BookingWindow | null;
}

/**
 * The window a Phase 2 booking asked for, for lead `l`: the request the site's form left while self-serve booking
 * is off, else the slot it held, for the day it proposed (LIFE-11). A Phase 1 lead carries its own choice instead.
 */
const ASKED_WINDOW = `(SELECT asked FROM (
    SELECT requested_window AS asked, created_at FROM consultation_requests
    WHERE person_id = l.person_id AND requested_date = l.proposed_visit_date
    UNION ALL
    SELECT window_label, created_at FROM slot_holds
    WHERE person_id = l.person_id AND date = l.proposed_visit_date AND type = 'consultation'
  ) ORDER BY created_at DESC LIMIT 1)`;

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
              p.erased_at, p.name, p.mobile_e164, p.email, p.zoho_lead_id, p.contactable,
              EXISTS (SELECT 1 FROM leads t WHERE t.person_id = p.id AND t.source = 'tryon') AS tried_on,
              (SELECT r.code FROM referral_attributions r WHERE r.referred_person_id = p.id) AS invite_code,
              ${ASKED_WINDOW} AS asked_window
       FROM leads l JOIN people p ON p.id = l.person_id
       WHERE l.id = ?1`,
    )
    .bind(leadId)
    .first<LeadRow>();
  // Timed, with the Zoho calls, to find where a stalled run spends its time (docs/decisions/0012).
  const readMs = Date.now() - started;

  if (row === null) {
    log.error("crm_sync_unknown_lead", { lead_id: leadId });
    return { retrySoon: false };
  }
  if (row.sync_state === "synced") return { retrySoon: false }; // a duplicate message
  if (row.erased_at !== null) {
    // Sending it would put the person back in the CRM. Given up at once, so the sweeper leaves it alone.
    await db
      .prepare(
        "UPDATE leads SET sync_state = 'failed', sync_attempts = ?2, last_sync_error = 'person erased' WHERE id = ?1",
      )
      .bind(leadId, MAX_SYNC_ATTEMPTS)
      .run();
    return { retrySoon: false };
  }

  const attempt = await db
    .prepare("UPDATE leads SET sync_attempts = sync_attempts + 1 WHERE id = ?1 RETURNING sync_attempts")
    .bind(leadId)
    .first<{ sync_attempts: number }>();
  const attempts = attempt?.sync_attempts ?? 1;
  const timings = { read_ms: readMs, claim_ms: Date.now() - started - readMs };

  try {
    const result = await deps.crm.syncLead(toCrmLead(row), row.zoho_lead_id);
    const at = deps.now().toISOString();
    const [person] = await db.batch([
      db
        .prepare("UPDATE people SET zoho_lead_id = ?1 WHERE id = ?2 RETURNING erased_at")
        .bind(result.crmLeadId, row.person_id),
      db
        .prepare("UPDATE leads SET sync_state = 'synced', synced_at = ?1, last_sync_error = NULL WHERE id = ?2")
        .bind(at, leadId),
      db
        .prepare(
          "INSERT INTO events (id, created_at, name, subject_id, payload_json) VALUES (?, ?, 'lead_synced', ?, ?)",
        )
        .bind(crypto.randomUUID(), at, leadId, JSON.stringify({ attempts, created: result.created })),
    ]);
    log.info("crm_synced", {
      lead_id: leadId,
      attempts,
      created: result.created,
      duration_ms: Date.now() - started,
      ...timings,
    });
    const erasedAt = (person?.results[0] as { erased_at: string | null } | undefined)?.erased_at ?? null;
    if (erasedAt !== null) {
      await eraseAgain(db, deps, log, row.person_id, result.crmLeadId);
      return { retrySoon: false };
    }
    await deps.notifyLead(leadNotice(row));
    return { retrySoon: false };
  } catch (error) {
    const description = describe(error);
    await db
      .prepare("UPDATE leads SET sync_state = 'failed', last_sync_error = ?1 WHERE id = ?2")
      .bind(description, leadId)
      .run();
    log.error("crm_sync_failed", { lead_id: leadId, attempts, error, duration_ms: Date.now() - started, ...timings });
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
    inviteCode: row.invite_code,
    askedWindow: row.first_choice_window === null ? row.asked_window : null,
  };
}

/**
 * Blanks an erased person's CRM record. Tried again like a lead: once soon,
 * then by the sweeper until MAX_SYNC_ATTEMPTS, then an alert asks for it by hand.
 */
export async function eraseInCrm(
  db: D1Database,
  deps: Dependencies,
  log: Logger,
  personId: string,
): Promise<{ retrySoon: boolean }> {
  const person = await db
    .prepare("SELECT zoho_lead_id, crm_erased_at FROM people WHERE id = ?1 AND erased_at IS NOT NULL")
    .bind(personId)
    .first<{ zoho_lead_id: string | null; crm_erased_at: string | null }>();
  if (person === null) {
    log.error("crm_erasure_unknown_person", { person_id: personId });
    return { retrySoon: false };
  }
  if (person.crm_erased_at !== null) return { retrySoon: false }; // a duplicate message

  const attempt = await db
    .prepare(
      "UPDATE people SET crm_erasure_attempts = crm_erasure_attempts + 1 WHERE id = ?1 RETURNING crm_erasure_attempts",
    )
    .bind(personId)
    .first<{ crm_erasure_attempts: number }>();
  const attempts = attempt?.crm_erasure_attempts ?? 1;

  try {
    const { found } = await deps.crm.erasePerson(personId, person.zoho_lead_id);
    await db
      .prepare("UPDATE people SET crm_erased_at = ?2, crm_erasure_error = NULL WHERE id = ?1")
      .bind(personId, deps.now().toISOString())
      .run();
    log.info("crm_erased", { person_id: personId, found, attempts });
    return { retrySoon: false };
  } catch (error) {
    const description = describe(error);
    await db.prepare("UPDATE people SET crm_erasure_error = ?2 WHERE id = ?1").bind(personId, description).run();
    log.error("crm_erasure_failed", { person_id: personId, attempts, error });
    if (attempts >= MAX_SYNC_ATTEMPTS) {
      await deps.alert(
        `Erasing person ${personId} in the CRM failed ${String(attempts)} times (${description}). Blank the record by hand.`,
      );
    }
    return { retrySoon: attempts === 1 };
  }
}

/**
 * The person was erased while their lead was being written to the CRM, so that
 * write may have landed after the erasure's and put their details back. The
 * record is blanked again; if that fails, the sweeper retries the erasure.
 */
async function eraseAgain(
  db: D1Database,
  deps: Dependencies,
  log: Logger,
  personId: string,
  crmLeadId: string,
): Promise<void> {
  try {
    await deps.crm.erasePerson(personId, crmLeadId);
    log.info("crm_erased_after_sync", { person_id: personId });
  } catch (error) {
    await db
      .prepare("UPDATE people SET crm_erased_at = NULL, crm_erasure_error = ?2 WHERE id = ?1")
      .bind(personId, describe(error))
      .run();
    log.error("crm_erasure_failed", { person_id: personId, error });
  }
}

/** A short error for last_sync_error: no personal data, no stack. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return scrubString(message).slice(0, 300);
}
