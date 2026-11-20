// The site's visitors (docs/decisions/0288-attribution-and-conversions.md): one row for each visitor cookie the site's
// Worker gave, made the first time the page reports a touch, with the reference a WhatsApp message from them ends with.

import { REF_ALPHABET, REF_LENGTH } from "../../config/ref-tokens.ts";
import { failedUniqueOn } from "../../lib/d1-errors.ts";

/** A fresh reference: five of the letters no one misreads, about 28 million in all. */
function newRef(): string {
  const picks = crypto.getRandomValues(new Uint8Array(REF_LENGTH));
  return [...picks].map((pick) => REF_ALPHABET[pick % REF_ALPHABET.length] ?? "").join("");
}

/** How many fresh references are tried before giving up on one already taken. */
const REF_TRIES = 4;

/** The visitor's reference and person, the row made if new and its last sight moved on. */
export async function seeVisitor(
  db: D1Database,
  visitorId: string,
  now: Date,
): Promise<{ readonly ref: string; readonly personId: string | null }> {
  const at = now.toISOString();
  for (let tried = 0; tried < REF_TRIES; tried += 1) {
    try {
      const row = await db
        .prepare(
          `INSERT INTO visitors (id, ref, created_at, seen_at) VALUES (?1, ?2, ?3, ?3)
           ON CONFLICT (id) DO UPDATE SET seen_at = excluded.seen_at
           RETURNING ref, person_id`,
        )
        .bind(visitorId, newRef(), at)
        .first<{ ref: string; person_id: string | null }>();
      if (row !== null) return { ref: row.ref, personId: row.person_id };
    } catch (error) {
      // Another visitor holds the reference just drawn: draw again.
      if (!failedUniqueOn(error, "visitors")) throw error;
    }
  }
  throw new Error("visitor_ref_exhausted");
}

/** The visitor a WhatsApp reference names, or null. */
export async function visitorOfRef(db: D1Database, ref: string): Promise<string | null> {
  const row = await db.prepare("SELECT id FROM visitors WHERE ref = ?1").bind(ref).first<{ id: string }>();
  return row?.id ?? null;
}
