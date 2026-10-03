// A client's customer in Zoho Books, where no FSM sync makes it or keeps it up to date. Books keys it by the person's
// ID in its "MM person ID" field, so a write whose answer never came lands on the same customer. Never written for an
// erased person: their customer still holds the ID, and a write would refill it.

import { placeOfSupply, stateOf, type GstRegistration } from "../config/gst.ts";
import type { BooksProvider, NewBooksCustomer } from "../providers/books.ts";
import { currentAddress, streetOf, type SavedAddress } from "./profile.ts";

interface PersonRow {
  name: string;
  mobile_e164: string;
  email: string | null;
  erased_at: string | null;
  books_customer_id: string | null;
  /** Where their latest visit was, or their latest lead named, for a client who has saved no address. */
  last_city: string | null;
}

function personRow(db: D1Database, personId: string): Promise<PersonRow | null> {
  return db
    .prepare(
      `SELECT pe.name, pe.mobile_e164, pe.email, pe.erased_at, pe.books_customer_id,
         COALESCE(
           (SELECT a.service_city FROM appointments a
             WHERE a.person_id = pe.id AND a.service_city IS NOT NULL AND a.deleted_at IS NULL
             ORDER BY a.window_start DESC LIMIT 1),
           (SELECT l.city FROM leads l WHERE l.person_id = pe.id AND l.city IS NOT NULL
             ORDER BY l.created_at DESC LIMIT 1)) AS last_city
       FROM people pe WHERE pe.id = ?1`,
    )
    .bind(personId)
    .first<PersonRow>();
}

async function customerFrom(
  db: D1Database,
  personId: string,
  person: PersonRow,
  gst: GstRegistration,
): Promise<NewBooksCustomer> {
  const saved = await currentAddress(db, personId);
  return {
    personId,
    name: person.name,
    mobile: person.mobile_e164,
    email: person.email,
    stateCode: placeOfSupply(saved?.city ?? person.last_city, gst),
    address: billingAddressOf(saved),
  };
}

/** The address the client saved, as the customer's billing address; null where they have saved none. */
function billingAddressOf(saved: SavedAddress | null): NewBooksCustomer["address"] {
  if (saved === null) return null;
  return { ...streetOf(saved), city: saved.city, state: stateOf(saved.city)?.name ?? null, pincode: saved.pincode };
}

/**
 * The person's Books customer: the one kept on them, else one written now by their person ID and kept at once. One
 * Books call at most. Null for a person erased.
 */
export async function customerFor(
  db: D1Database,
  books: BooksProvider,
  personId: string,
  gst: GstRegistration,
): Promise<string | null> {
  const person = await personRow(db, personId);
  if (person === null) return null;
  if (person.erased_at !== null) return null;
  if (person.books_customer_id !== null) return person.books_customer_id;

  const customerId = await books.upsertCustomer(await customerFrom(db, personId, person, gst));
  // Kept even if the person was erased meanwhile: the erasure finds the customer by it.
  await db
    .prepare(
      "UPDATE people SET books_customer_id = ?1, books_checked_at = NULL WHERE id = ?2 AND books_customer_id IS NULL",
    )
    .bind(customerId, personId)
    .run();
  return customerId;
}

/**
 * Marks the client's number or address as changed, for the Books pass to write to their customer. Marked whether or
 * not they have a customer yet, so one being made from their old details meanwhile still gets the change.
 */
export async function markCustomerChanged(db: D1Database, personId: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE people SET books_details_changed_at = ?2 WHERE id = ?1 AND erased_at IS NULL")
    .bind(personId, now.toISOString())
    .run();
}

/**
 * Writes the person's details as they are now over their Books customer. One Books call at most. False for a person
 * erased, or one with no customer.
 */
export async function updateCustomerOf(
  db: D1Database,
  books: BooksProvider,
  personId: string,
  gst: GstRegistration,
): Promise<boolean> {
  const person = await personRow(db, personId);
  if (person === null) return false;
  if (person.erased_at !== null) return false;
  if (person.books_customer_id === null) return false;

  await books.updateCustomer(person.books_customer_id, await customerFrom(db, personId, person, gst));
  return true;
}
