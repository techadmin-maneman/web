// What a client's Home says once their consultation is done and they are not yet fitted: the day, who came, and the
// hair system recommended there (src/domain/clients/hair-profiles.ts). The booking sheet marks that hair system
// among those it offers, and opens with it chosen (src/domain/visits/next-visit.ts).

import { indiaDate } from "../../lib/india-time.ts";
import { recommendedProduct } from "../clients/hair-profiles.ts";

interface ConsultationRecap {
  /** India's date of the consultation. */
  readonly date: string;
  readonly technician: { readonly name: string; readonly initials: string } | null;
  /** The tier of the first-fit service recommended; null where the profile records none. */
  readonly recommended: string | null;
}

interface RecapRow {
  window_start: string;
  technician_name: string | null;
  technician_initials: string | null;
}

/** The client's latest consultation done; null before one is. */
export async function consultationRecap(db: D1Database, personId: string): Promise<ConsultationRecap | null> {
  const [row, recommended] = await Promise.all([
    db
      .prepare(
        `SELECT a.window_start, t.name AS technician_name, t.initials AS technician_initials
         FROM appointments a LEFT JOIN technicians t ON t.id = a.technician_id
         WHERE a.person_id = ?1 AND a.type = 'consultation' AND a.status = 'completed' AND a.deleted_at IS NULL
           AND a.window_start IS NOT NULL
         ORDER BY a.window_start DESC LIMIT 1`,
      )
      .bind(personId)
      .first<RecapRow>(),
    recommendedProduct(db, personId),
  ]);
  if (row === null) return null;
  const { technician_name: name, technician_initials: initials } = row;
  return {
    date: indiaDate(new Date(row.window_start)),
    technician: name === null || initials === null ? null : { name, initials },
    recommended,
  };
}
