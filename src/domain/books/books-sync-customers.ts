// The Books customers the sync makes and keeps current (./books-sync.ts): one for each client with money or a
// finished visit to record, and a client's new number or address written to theirs.

import { customerFor, updateCustomerOf } from "./books-customers.ts";
import { type Pass, tellFailure, closeFailures } from "./books-pass.ts";
import { PER_PASS } from "./vendor-pass.ts";

// ---------------------------------------------------------------------------
// Making a client's customer
// ---------------------------------------------------------------------------
/**
 * People with no customer yet and a captured payment not yet recorded, or a finished visit to invoice. Read from what
 * waits on them, so only the waiting rows are read; one with two such rows is listed once.
 */
export async function customersToAdd(pass: Pass): Promise<string[]> {
  const { results } = await pass.db
    .prepare(
      `SELECT pe.id FROM (
         SELECT p.person_id AS id FROM payments p WHERE p.books_payment_id IS NULL AND p.captured_at IS NOT NULL
         UNION ALL
         SELECT a.person_id AS id FROM appointments a
         WHERE a.status = 'completed' AND a.invoice_issued_at IS NULL AND a.deleted_at IS NULL
           AND a.type IN ('first_fit', 'service', 'replacement') AND a.one_visit IS NOT 'declined') waiting
       JOIN people pe ON pe.id = waiting.id
       WHERE pe.books_customer_id IS NULL AND pe.erased_at IS NULL
         AND (pe.books_checked_at IS NULL OR pe.books_checked_at < ?1)
       LIMIT ?2`,
    )
    .bind(pass.recheck, PER_PASS)
    .all<{ id: string }>();
  return [...new Set(results.map((row) => row.id))];
}

/** True when the person has a customer now. */
export async function addCustomer(pass: Pass, personId: string): Promise<boolean> {
  const claimed = await pass.db
    .prepare(
      `UPDATE people SET books_checked_at = ?1
       WHERE id = ?2 AND books_customer_id IS NULL AND (books_checked_at IS NULL OR books_checked_at < ?3)
       RETURNING id`,
    )
    .bind(pass.at, personId, pass.recheck)
    .first();
  if (claimed === null) return false;

  const failed = {
    kind: "customer",
    id: personId,
    personId,
    what: `client ${personId}'s customer record`,
    then: "It is asked again every hour.",
  } as const;
  try {
    const customerId = await customerFor(pass.db, pass.deps.books, personId, pass.options.gst);
    if (customerId === null) return false;
  } catch (error) {
    await tellFailure(pass, failed, error);
    return false;
  }
  await closeFailures(pass, failed);
  return true;
}

// ---------------------------------------------------------------------------
// Writing a client's new number or address to their customer
// ---------------------------------------------------------------------------
/** People with a customer whose number or address changed after it was last written. */
export async function customersToUpdate(pass: Pass): Promise<string[]> {
  const { results } = await pass.db
    .prepare(
      `SELECT id FROM people
       WHERE books_details_changed_at IS NOT NULL AND books_customer_id IS NOT NULL AND erased_at IS NULL
         AND (books_checked_at IS NULL OR books_checked_at < ?1)
       ORDER BY books_details_changed_at LIMIT ?2`,
    )
    .bind(pass.recheck, PER_PASS)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

/** True when Books has the client's details as they were when this pass read them. */
export async function updateCustomer(pass: Pass, personId: string): Promise<boolean> {
  const claimed = await pass.db
    .prepare(
      `UPDATE people SET books_checked_at = ?1
       WHERE id = ?2 AND books_details_changed_at IS NOT NULL AND (books_checked_at IS NULL OR books_checked_at < ?3)
       RETURNING books_details_changed_at`,
    )
    .bind(pass.at, personId, pass.recheck)
    .first<{ books_details_changed_at: string }>();
  if (claimed === null) return false;

  const failed = {
    kind: "customer_update",
    id: personId,
    personId,
    what: `client ${personId}'s new number or address`,
    then: "It is asked again every hour.",
  } as const;
  try {
    const updated = await updateCustomerOf(pass.db, pass.deps.books, personId, pass.options.gst);
    if (!updated) return false;
  } catch (error) {
    await tellFailure(pass, failed, error);
    return false;
  }
  await pass.db.batch([
    // A change made while Books was being written keeps its mark, for the next pass.
    pass.db
      .prepare("UPDATE people SET books_details_changed_at = NULL WHERE id = ?1 AND books_details_changed_at = ?2")
      .bind(personId, claimed.books_details_changed_at),
    pass.db.prepare("UPDATE people SET books_checked_at = NULL WHERE id = ?1").bind(personId),
  ]);
  await closeFailures(pass, failed);
  return true;
}
