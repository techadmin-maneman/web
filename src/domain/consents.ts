// Every consent is written here, and nowhere else. The ledger only ever gains rows, so each write names the rule
// that decides whether it adds one.

import type { NoticePurpose } from "../config/notices.ts";
import type { ConsentSource } from "../policy/consents.ts";

/**
 * Whether a write adds a row:
 * - "always": an agreement given just now, on the page that asked for it;
 * - "if_changed": unless the person's latest row for the purpose gives the same answer under the same notice;
 * - "if_undecided": only while the person has no row for the purpose, so a decision they made stands;
 * - "if_granted": only while the person's latest row for the purpose is a yes, so a withdrawal is recorded once.
 */
export type ConsentRule = "always" | "if_changed" | "if_undecided" | "if_granted";

/** Whose consent it is: by ID, or by number where the same batch writes the person. */
export type ConsentPerson = { readonly id: string } | { readonly mobileE164: string };

export interface ConsentAnswer {
  readonly person: ConsentPerson;
  readonly purpose: NoticePurpose;
  readonly granted: boolean;
  /** The version of the notice the person was shown. */
  readonly notice: string;
  /** Where it was given; null where the app did not say which screen. */
  readonly source: ConsentSource | null;
  readonly rule: ConsentRule;
  readonly ipHash: string | null;
  /** When it was given, as an ISO timestamp. */
  readonly givenAt: string;
}

/** A consent's write, to run in a batch. It returns the row's created_at only when it adds the row `id`. */
interface ConsentWrite {
  readonly id: string;
  readonly statement: D1PreparedStatement;
}

const PERSON_BY_ID = "?2";
const PERSON_BY_MOBILE = "(SELECT id FROM people WHERE mobile_e164 = ?2)";

function personSql(person: ConsentPerson): string {
  return "id" in person ? PERSON_BY_ID : PERSON_BY_MOBILE;
}

function personValue(person: ConsentPerson): string {
  return "id" in person ? person.id : person.mobileE164;
}

/** The rule as a condition on the person's earlier rows for the purpose. */
function ruleCondition(rule: ConsentRule, person: string): string {
  if (rule === "always") return "";
  if (rule === "if_undecided") {
    return `WHERE NOT EXISTS (SELECT 1 FROM consents WHERE person_id = ${person} AND purpose = ?3)`;
  }
  if (rule === "if_granted") {
    return `WHERE (SELECT granted FROM consents WHERE person_id = ${person} AND purpose = ?3
                   ORDER BY created_at DESC, rowid DESC LIMIT 1) = 1`;
  }
  return `WHERE NOT EXISTS (
         SELECT 1 FROM (SELECT granted, notice_version FROM consents WHERE person_id = ${person} AND purpose = ?3
                        ORDER BY created_at DESC, rowid DESC LIMIT 1)
         WHERE granted = ?5 AND notice_version = ?4
       )`;
}

/**
 * Records a consent under its rule. The write itself applies the rule, rather than a read before it, so two taps
 * at once cannot both add a row.
 */
export function recordConsent(db: D1Database, answer: ConsentAnswer): ConsentWrite {
  const id = crypto.randomUUID();
  const person = personSql(answer.person);
  const statement = db
    .prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash, source)
       SELECT ?1, ${person}, ?3, ?4, ?5, ?6, ?7, ?8
       ${ruleCondition(answer.rule, person)}
       RETURNING created_at`,
    )
    .bind(
      id,
      personValue(answer.person),
      answer.purpose,
      answer.notice,
      answer.granted ? 1 : 0,
      answer.givenAt,
      answer.ipHash,
      answer.source,
    );
  return { id, statement };
}

/**
 * The person's latest word on a purpose as a subquery: 1, 0, or NULL where they never gave one. `personColumn`
 * names the person's ID in the query it sits in. Consents are append-only, so the latest one stands.
 */
export const latestConsentSql = (personColumn: string, purpose: NoticePurpose): string =>
  `(SELECT c.granted FROM consents c WHERE c.person_id = ${personColumn} AND c.purpose = '${purpose}'
    ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1)`;

/** Whether the person's latest word on this purpose is yes. */
export async function consentGiven(db: D1Database, personId: string, purpose: NoticePurpose): Promise<boolean> {
  const latest = await db
    .prepare(
      `SELECT granted FROM consents WHERE person_id = ?1 AND purpose = ?2
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(personId, purpose)
    .first<{ granted: number }>();
  return latest?.granted === 1;
}
