// An erased client's customer in Zoho Books: deleted where no invoice or payment names it, otherwise renamed "Erased
// client", blanked and made inactive, since Books keeps the invoices eight years. Then the CRM Contact that Books' own
// CRM integration made of that customer (ADR 0110), blanked and deleted. The erasure itself never waits on either:
// this pass, on the hourly cron, finds the erased people whose customer or Contact is still to be erased, a few a run.
//
// A payment the client made that is still on its way to Books is recorded first, for a day at most: Books deletes a
// customer no payment names yet, and the payment could then never be recorded.
//
// The Contact's ID is read from the customer before the customer goes: a deleted customer can no longer say it. The
// Contact is erased once the customer is, so Books' sync has nothing of the client's left to write back onto it.
//
// A failure is counted, apart for the customer and for the Contact, and tried again on the next run. The last try
// tells ops, once, to erase it by hand.

import type { CallBudget } from "../lib/call-budget.ts";
import { failureReason, type Logger } from "../log.ts";
import type { BooksProvider } from "../providers/books/index.ts";
import type { CrmProvider } from "../providers/crm/index.ts";
import type { AlertOnce } from "./alerts.ts";
import { MAX_SYNC_ATTEMPTS } from "../config/pipeline.ts";

/** Most customers, and most Contacts, one run erases. */
const PER_RUN = 5;
/** The customer's CRM link read, then a delete, or a blank and a deactivation where Books will not delete it. */
const CALLS_PER_CUSTOMER = 4;
/** A blank, then a delete. */
const CALLS_PER_CONTACT = 2;
/** How long an erasure waits for the client's payments to reach Books. */
const PAYMENT_WAIT_MS = 24 * 60 * 60 * 1000;

interface BooksErasurePass {
  readonly books: BooksProvider;
  readonly crm: CrmProvider;
  readonly alertOnce: AlertOnce;
  readonly log: Logger;
  readonly budget: CallBudget;
}

interface DueErasure {
  readonly id: string;
  readonly books_customer_id: string;
  readonly crm_contact_id: string | null;
}

interface DueContact {
  readonly id: string;
  readonly crm_contact_id: string;
}

/**
 * Erases the Books customers, then the CRM Contacts, of erased people that are still to be erased. Returns how many
 * customers it erased.
 */
export async function eraseBooksCustomers(db: D1Database, pass: BooksErasurePass, now: Date): Promise<number> {
  let erased = 0;
  for (const person of await dueErasures(db, now)) {
    if (!pass.budget.spend(CALLS_PER_CUSTOMER)) break;
    if (await eraseCustomer(db, pass, person, now)) erased += 1;
  }
  for (const person of await dueContacts(db)) {
    if (!pass.budget.spend(CALLS_PER_CONTACT)) break;
    await eraseContact(db, pass, person, now);
  }
  return erased;
}

async function dueErasures(db: D1Database, now: Date): Promise<DueErasure[]> {
  const paymentsWaitedFor = new Date(now.getTime() - PAYMENT_WAIT_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT pe.id, pe.books_customer_id, pe.crm_contact_id FROM people pe
       WHERE pe.erased_at IS NOT NULL AND pe.books_customer_id IS NOT NULL AND pe.books_erased_at IS NULL
         AND pe.books_erasure_attempts < ?1
         AND (pe.erased_at < ?3 OR NOT EXISTS (
           SELECT 1 FROM payments p
           WHERE p.person_id = pe.id AND p.captured_at IS NOT NULL AND p.books_payment_id IS NULL))
       ORDER BY pe.erased_at LIMIT ?2`,
    )
    .bind(MAX_SYNC_ATTEMPTS, PER_RUN, paymentsWaitedFor)
    .all<DueErasure>();
  return results;
}

async function dueContacts(db: D1Database): Promise<DueContact[]> {
  const { results } = await db
    .prepare(
      `SELECT id, crm_contact_id FROM people
       WHERE crm_contact_id IS NOT NULL AND crm_contact_erased_at IS NULL AND books_erased_at IS NOT NULL
         AND crm_contact_erasure_attempts < ?1
       ORDER BY erased_at LIMIT ?2`,
    )
    .bind(MAX_SYNC_ATTEMPTS, PER_RUN)
    .all<DueContact>();
  return results;
}

/** True when Books has erased it. */
async function eraseCustomer(db: D1Database, pass: BooksErasurePass, person: DueErasure, now: Date): Promise<boolean> {
  try {
    if (person.crm_contact_id === null) {
      const contactId = await pass.books.crmContactOf(person.books_customer_id);
      if (contactId !== null) {
        await db.prepare("UPDATE people SET crm_contact_id = ?2 WHERE id = ?1").bind(person.id, contactId).run();
      }
    }
    const outcome = await pass.books.eraseCustomer(person.books_customer_id);
    await db.prepare("UPDATE people SET books_erased_at = ?2 WHERE id = ?1").bind(person.id, now.toISOString()).run();
    pass.log.info("books_customer_erased", { person_id: person.id, outcome });
    return true;
  } catch (error) {
    await countFailure(db, pass, ERASING.customer, person.id, person.books_customer_id, failureReason(error));
    return false;
  }
}

async function eraseContact(db: D1Database, pass: BooksErasurePass, person: DueContact, now: Date): Promise<void> {
  try {
    const { found } = await pass.crm.eraseContact(person.crm_contact_id);
    await db
      .prepare("UPDATE people SET crm_contact_erased_at = ?2 WHERE id = ?1")
      .bind(person.id, now.toISOString())
      .run();
    pass.log.info("crm_contact_erased", { person_id: person.id, found });
  } catch (error) {
    await countFailure(db, pass, ERASING.contact, person.id, person.crm_contact_id, failureReason(error));
  }
}

/** What the pass erases: where its tries are counted, and what ops are told once it stops trying. */
interface Erasing {
  /** Counts a try, and answers how many there have been. */
  readonly countTry: (db: D1Database, personId: string) => D1PreparedStatement;
  readonly event: string;
  readonly key: string;
  readonly tell: (recordId: string, personId: string, tries: string) => string;
}

const ERASING = {
  customer: {
    countTry: (db, personId) =>
      db
        .prepare(
          `UPDATE people SET books_erasure_attempts = books_erasure_attempts + 1 WHERE id = ?1
           RETURNING books_erasure_attempts AS attempts`,
        )
        .bind(personId),
    event: "books_erasure_failed",
    key: "books_erasure",
    tell: (customerId, personId, tries) =>
      `Books would not erase customer ${customerId} of erased client ${personId} after ${tries}, and nothing will ` +
      'ask again. In Books, delete the customer, or where an invoice names it rename it "Erased client", clear its ' +
      "contact persons, numbers, e-mail and addresses, and mark it inactive, by hand.",
  },
  contact: {
    countTry: (db, personId) =>
      db
        .prepare(
          `UPDATE people SET crm_contact_erasure_attempts = crm_contact_erasure_attempts + 1 WHERE id = ?1
           RETURNING crm_contact_erasure_attempts AS attempts`,
        )
        .bind(personId),
    event: "crm_contact_erasure_failed",
    key: "crm_contact_erasure",
    tell: (contactId, personId, tries) =>
      `The CRM would not erase Contact ${contactId} of erased client ${personId} after ${tries}, and nothing will ` +
      "ask again. In the CRM, open the Contact, clear its name, numbers, e-mail and addresses, then delete it and " +
      "empty it from the recycle bin, by hand.",
  },
} as const satisfies Readonly<Record<string, Erasing>>;

async function countFailure(
  db: D1Database,
  pass: BooksErasurePass,
  erasing: Erasing,
  personId: string,
  recordId: string,
  reason: string,
) {
  const counted = await erasing.countTry(db, personId).first<{ attempts: number }>();
  const attempts = counted?.attempts ?? 1;
  pass.log.warn(erasing.event, { person_id: personId, attempts, reason });
  if (attempts < MAX_SYNC_ATTEMPTS) return;
  await pass.alertOnce({
    key: `${erasing.key}:${personId}`,
    message: erasing.tell(recordId, personId, `${String(attempts)} tries (${reason})`),
    link: `/clients/${personId}`,
  });
}
