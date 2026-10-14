// A client's number, city, invite and last chat written onto their CRM lead (src/queues/crm-sync.ts). What the lead is
// owed is kept in D1 until it has it (src/domain/clients/contact-updates.ts), so the sweeper sends again what the queue
// leaves.

import { LAST_CONTACT_REASONS } from "../config/crm.ts";
import { QUICK_RETRY_DELAY_SECONDS } from "../config/pipeline.ts";
import { ALERT_WORDS } from "../config/alert-words.ts";
import type { Dependencies } from "../dependencies.ts";
import { contactUpdateSent, contactUpdateTried, owedUpdate } from "../domain/clients/contact-updates.ts";
import { noteAnswered } from "../domain/platform/vendor-breakers.ts";
import { indiaDate } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import { isRefusal } from "../providers/provider-error.ts";
import { backoffSeconds, DONE, type Settle } from "./consumer.ts";
import { crmHeld, describe, heldBy } from "./crm-held.ts";

/** Deliveries of a contact update the queue tries before leaving it to the sweeper, which sends what is still owed. */
export const MAX_CONTACT_UPDATE_ATTEMPTS = 3;

interface PersonRow {
  readonly mobile_e164: string;
  readonly zoho_lead_id: string | null;
  readonly city: string | null;
  readonly invite_code: string | null;
  /** "<closed_at> <close_reason>" of their last closed chat. */
  readonly last_contact: string | null;
}

/** Their last closed chat, as the CRM records it: India's date, and what it was about. */
function lastContactOf(row: string | null): { date: string; reason: string | null } | null {
  if (row === null) return null;
  const [closedAt = "", reason = ""] = row.split(" ");
  return { date: indiaDate(new Date(closedAt)), reason: LAST_CONTACT_REASONS[reason] ?? null };
}

/**
 * Writes a person's number, the city of their address, the invite they came
 * through and their last closed chat onto their CRM record, read afresh from D1,
 * with a note when ops have just attached the invite. Nothing is written for an erased person or one the
 * CRM never had. What is owed stays owed until the lead has it (src/domain/clients/contact-updates.ts): a failure is
 * tried again on the queue, then by the sweeper; the CRM refusing the record tells ops to write it by hand.
 */
export async function updateContact(
  db: D1Database,
  deps: Dependencies,
  log: Logger,
  { personId, inviteAttached, attempts }: { personId: string; inviteAttached: boolean; attempts: number },
): Promise<Settle> {
  const person = await db
    .prepare(
      `SELECT p.mobile_e164, p.zoho_lead_id,
         (SELECT city FROM addresses a WHERE a.person_id = p.id AND a.replaced_at IS NULL
          ORDER BY a.created_at DESC LIMIT 1) AS city,
         (SELECT r.code FROM referral_attributions r WHERE r.referred_person_id = p.id) AS invite_code,
         (SELECT c.closed_at || ' ' || COALESCE(c.close_reason, '') FROM conversations c
          WHERE c.person_id = p.id AND c.closed_at IS NOT NULL ORDER BY c.closed_at DESC LIMIT 1) AS last_contact
       FROM people p WHERE p.id = ?1 AND p.erased_at IS NULL`,
    )
    .bind(personId)
    .first<PersonRow>();
  const owed = await owedUpdate(db, personId);
  const settled = owed === null ? [] : [contactUpdateSent(db, personId, owed)];
  if (person === null) {
    if (settled.length > 0) await db.batch(settled);
    return DONE;
  }
  if (await crmHeld(db, deps)) {
    log.info("crm_held", { person_id: personId });
    return DONE;
  }
  try {
    const { crmLeadId } = await deps.crm.updateContact(
      {
        personId,
        mobileE164: person.mobile_e164,
        city: person.city,
        inviteCode: person.invite_code,
        inviteAttached: inviteAttached || owed?.inviteAttached === true,
        lastContact: lastContactOf(person.last_contact),
      },
      person.zoho_lead_id,
    );
    const found = crmLeadId !== null && crmLeadId !== person.zoho_lead_id;
    const written = [
      ...(found ? [db.prepare("UPDATE people SET zoho_lead_id = ?2 WHERE id = ?1").bind(personId, crmLeadId)] : []),
      ...settled,
    ];
    if (written.length > 0) await db.batch(written);
    await noteAnswered(db, "crm", deps.resolveAlert);
    await deps.resolveAlert(`crm_contact_update:${personId}`);
    log.info("crm_contact_updated", { person_id: personId, found: crmLeadId !== null });
    return DONE;
  } catch (error) {
    const reason = describe(error);
    log.warn("crm_contact_update_failed", { person_id: personId, attempt: attempts, reason });
    if (isRefusal(error)) {
      await deps.alertOnce({
        key: `crm_contact_update:${personId}`,
        message: ALERT_WORDS.crm_contact_update({ client: personId, attempts, reason }),
        link: `/clients/${personId}`,
      });
      if (settled.length > 0) await db.batch(settled);
      return DONE;
    }
    const held = await heldBy(db, deps, error);
    await contactUpdateTried(db, personId, deps.now()).run();
    if (held || attempts >= MAX_CONTACT_UPDATE_ATTEMPTS) return DONE;
    return { retryAfterSeconds: backoffSeconds(attempts, QUICK_RETRY_DELAY_SECONDS) };
  }
}
