// An erased client's customer in Zoho Books (docs/decisions/0049-dpdp.md): deleted where no invoice or payment names
// it, otherwise renamed "Erased client", blanked and made inactive, since Books keeps the invoices eight years
// (src/providers/books.ts). The erasure itself never waits on Books: this pass, on the five-minute cron, finds the
// erased people whose customer is still to be erased, a few a run.
//
// A failure is counted and tried again on the next run. The last try tells ops, once, to erase it by hand.

import type { CallBudget } from "../lib/call-budget.ts";
import { failureReason, type Logger } from "../log.ts";
import type { BooksProvider } from "../providers/books.ts";
import { MAX_SYNC_ATTEMPTS } from "../queues/crm-sync.ts";
import type { AlertOnce } from "./alerts.ts";

/** Most customers one run erases. */
const PER_RUN = 5;
/** Erasing a customer Books will not delete takes a delete, a blank and a deactivation. */
const CALLS_PER_CUSTOMER = 3;

export interface BooksErasurePass {
  readonly books: BooksProvider;
  readonly alertOnce: AlertOnce;
  readonly log: Logger;
  readonly budget: CallBudget;
}

interface DueErasure {
  readonly id: string;
  readonly books_customer_id: string;
}

/** Erases the Books customers of erased people that are still to be erased. Returns how many it erased. */
export async function eraseBooksCustomers(db: D1Database, pass: BooksErasurePass, now: Date): Promise<number> {
  let erased = 0;
  for (const person of await dueErasures(db)) {
    if (!pass.budget.spend(CALLS_PER_CUSTOMER)) break;
    if (await eraseCustomer(db, pass, person, now)) erased += 1;
  }
  return erased;
}

async function dueErasures(db: D1Database): Promise<DueErasure[]> {
  const { results } = await db
    .prepare(
      `SELECT id, books_customer_id FROM people
       WHERE erased_at IS NOT NULL AND books_customer_id IS NOT NULL AND books_erased_at IS NULL
         AND books_erasure_attempts < ?1
       ORDER BY erased_at LIMIT ?2`,
    )
    .bind(MAX_SYNC_ATTEMPTS, PER_RUN)
    .all<DueErasure>();
  return results;
}

/** True when Books has erased it. */
async function eraseCustomer(db: D1Database, pass: BooksErasurePass, person: DueErasure, now: Date): Promise<boolean> {
  try {
    const outcome = await pass.books.eraseCustomer(person.books_customer_id);
    await db.prepare("UPDATE people SET books_erased_at = ?2 WHERE id = ?1").bind(person.id, now.toISOString()).run();
    pass.log.info("books_customer_erased", { person_id: person.id, outcome });
    return true;
  } catch (error) {
    await countFailure(db, pass, person, failureReason(error));
    return false;
  }
}

async function countFailure(db: D1Database, pass: BooksErasurePass, person: DueErasure, reason: string) {
  const counted = await db
    .prepare(
      `UPDATE people SET books_erasure_attempts = books_erasure_attempts + 1 WHERE id = ?1
       RETURNING books_erasure_attempts`,
    )
    .bind(person.id)
    .first<{ books_erasure_attempts: number }>();
  const attempts = counted?.books_erasure_attempts ?? 1;
  pass.log.warn("books_erasure_failed", { person_id: person.id, attempts, reason });
  if (attempts < MAX_SYNC_ATTEMPTS) return;
  await pass.alertOnce({
    key: `books_erasure:${person.id}`,
    message:
      `Books would not erase customer ${person.books_customer_id} of erased client ${person.id} after ` +
      `${String(attempts)} tries (${reason}), and nothing will ask again. In Books, delete the customer, or where ` +
      'an invoice names it rename it "Erased client", clear its contact persons, numbers, e-mail and addresses, and ' +
      "mark it inactive, by hand.",
    link: `/clients/${person.id}`,
  });
}
