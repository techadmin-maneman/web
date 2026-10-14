// What a write to a visit keeps up beside it, in the same batch: the dispatch board's version, whether a consultation
// request is booked, whether a partial visit was followed up, the client's last visit, whether a piece's replacement
// is booked, and when the person became a client (../clients/people.ts). Each is worked out again from the visits as
// they now stand, after the write, so it is right however the visit changed, and worked out again it changes nothing.

import { becameClients } from "../clients/people.ts";

/** Whose figures a write moves: the clients of the visits it wrote, as they now stand, or people it names. */
export type Whose = { readonly visits: readonly string[] } | { readonly people: readonly (string | null)[] };

const WHOSE_VISITS = "SELECT person_id FROM appointments WHERE id IN (SELECT value FROM json_each(?1))";
const WHOSE_PEOPLE = "SELECT value FROM json_each(?1)";

/** A visit that still stands: not taken out, not cancelled. */
const STANDS = (alias: string) => `${alias}.deleted_at IS NULL AND ${alias}.status NOT IN ('cancelled', 'terminated')`;

/** The dispatch board's version, moved on so every open board reads itself again. */
export const boardMoved = (db: D1Database): D1PreparedStatement =>
  db.prepare("UPDATE board_version SET version = version + 1 WHERE id = 1");

/**
 * The statements that keep up what a write to visits moves, to follow the write in its batch: the board's version,
 * and the figures of the people `whose` names, worked out again for them alone.
 */
export function visitUpkeep(db: D1Database, whose: Whose): D1PreparedStatement[] {
  const named = "visits" in whose ? whose.visits : whose.people.filter((each): each is string => each !== null);
  const people = "visits" in whose ? WHOSE_VISITS : WHOSE_PEOPLE;
  const list = JSON.stringify([...new Set(named)]);
  return [
    boardMoved(db),
    // A consultation request is booked by a consultation that stands, and one asked as one visit by its first fit too.
    db
      .prepare(
        `UPDATE consultation_requests SET booked = EXISTS (
           SELECT 1 FROM appointments a
            WHERE a.person_id = consultation_requests.person_id AND ${STANDS("a")}
              AND (a.type = 'consultation' OR (consultation_requests.one_visit = 1 AND a.type = 'first_fit')))
         WHERE person_id IN (${people})`,
      )
      .bind(list),
    db
      .prepare(
        `UPDATE visits SET followed_up = EXISTS (
           SELECT 1 FROM appointments a JOIN appointments later ON later.person_id = a.person_id
            WHERE a.id = visits.appointment_id AND ${STANDS("later")} AND later.window_start > a.window_start)
         WHERE outcome = 'partial' AND appointment_id IN (SELECT id FROM appointments WHERE person_id IN (${people}))`,
      )
      .bind(list),
    db
      .prepare(
        `INSERT INTO last_visits (person_id, visit_id, visit_start, consulted_start)
         SELECT person_id, visit_id, visit_start, consulted_start FROM last_visits_now WHERE person_id IN (${people})
         ON CONFLICT (person_id) DO UPDATE SET
           visit_id = excluded.visit_id, visit_start = excluded.visit_start, consulted_start = excluded.consulted_start`,
      )
      .bind(list),
    db
      .prepare(
        `UPDATE pieces SET replacement_booked = EXISTS (
           SELECT 1 FROM appointments a
            WHERE a.person_id = pieces.person_id AND a.type = 'replacement' AND ${STANDS("a")}
              AND a.window_start >= pieces.replacement_due_at)
         WHERE person_id IN (${people}) AND replacement_due_at IS NOT NULL`,
      )
      .bind(list),
    becameClients(db, people, list),
  ];
}
