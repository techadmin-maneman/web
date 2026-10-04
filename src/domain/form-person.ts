// The person a form on the site is from (src/domain/public-booking.ts): found by their number, or made, with the
// consent they gave on the page.

import type { ConsentSource } from "../policy/consents.ts";
import { recordConsent } from "./consents.ts";

/** The person a form is from, and the writes that record them and the consent they gave on the page. */
export interface FormPerson {
  readonly id: string;
  /** Run in one batch with what the form books, so a refusal leaves nothing behind. */
  readonly statements: D1PreparedStatement[];
}

/** The person who holds this number; null for a number nobody holds yet. */
export async function personWithMobile(db: D1Database, mobile: string): Promise<string | null> {
  const row = await db.prepare("SELECT id FROM people WHERE mobile_e164 = ?1").bind(mobile).first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * The person with this number, new or known, and the consent they gave, on the page they gave it. A person we know
 * keeps their name: a form anyone can fill in with a number never renames the one it belongs to.
 */
export function formPerson(
  db: D1Database,
  input: {
    knownId: string | null;
    mobile: string;
    name: string;
    testRecord: boolean;
    purpose: "whatsapp_visits" | "contact";
    notice: string;
    source: ConsentSource;
    ipHash: string;
    now: Date;
  },
): FormPerson {
  const at = input.now.toISOString();
  const id = input.knownId ?? crypto.randomUUID();
  const person =
    input.knownId === null
      ? db
          .prepare(
            `INSERT INTO people (id, created_at, mobile_e164, name, contactable, test_record)
             VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
          )
          .bind(id, at, input.mobile, input.name, input.testRecord ? 1 : 0)
      : db.prepare("UPDATE people SET contactable = 1 WHERE id = ?1").bind(id);
  const consent = recordConsent(db, {
    person: { id },
    purpose: input.purpose,
    granted: true,
    notice: input.notice,
    source: input.source,
    rule: "always",
    ipHash: input.ipHash,
    givenAt: at,
  });
  return { id, statements: [person, consent.statement] };
}
