// The audit log read back for the console's Activity page (docs/decisions/0031-access-and-audit.md): every entry,
// newest first, narrowed by who made it, what it was, one client's whole record, one visit, or the days it fell on,
// with each person named as the console knows them. A page at a time, each going on from the last.

import type { Surface } from "../../config/environments.ts";
import { addDays, indiaInstant } from "../../lib/india-time.ts";
import type { AuditAction, AuditActor } from "./audit.ts";

/** How many entries a page holds. */
const ACTIVITY_PAGE = 50;

interface ActivityFilter {
  readonly actorKind?: AuditActor["kind"] | undefined;
  /** A member of staff's e-mail, a service token's client ID, or a client's or a technician's ID. */
  readonly actor?: string | undefined;
  readonly action?: AuditAction | undefined;
  /** One client: everything they did, and everything done to their record and what belongs to it. */
  readonly person?: string | undefined;
  /** One visit, and the holds that booked it. */
  readonly visit?: string | undefined;
  /** India dates, both included. */
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  /** The page goes on from the entry before this one. */
  readonly before?: number | undefined;
}

interface ActivityEntry {
  readonly id: number;
  readonly at: string;
  readonly surface: Surface;
  /** Named where the console knows a name: a client not erased, a technician, a service token's label. */
  readonly actor: { readonly kind: AuditActor["kind"]; readonly id: string; readonly name: string | null };
  readonly action: AuditAction;
  readonly subject: { readonly kind: string; readonly id: string } | null;
  readonly detail: Readonly<Record<string, unknown>> | null;
}

interface ActivityPage {
  readonly entries: readonly ActivityEntry[];
  /** What to ask with as `before` for the page after, or null when this one reaches the start of the log. */
  readonly nextBefore: number | null;
}

/** The kinds of record an entry may name that belong to one client, ?4, and the IDs of theirs. */
const CLIENTS_OWN: readonly (readonly [string, string])[] = [
  ["appointment", "SELECT id FROM appointments WHERE person_id = ?4"],
  ["hold", "SELECT id FROM slot_holds WHERE person_id = ?4"],
  ["slot_hold", "SELECT id FROM slot_holds WHERE person_id = ?4"],
  ["number_change", "SELECT id FROM number_change_requests WHERE person_id = ?4"],
  ["deletion", "SELECT id FROM deletion_requests WHERE person_id = ?4"],
  ["grievance", "SELECT id FROM grievances WHERE person_id = ?4"],
  ["no_show_dispute", "SELECT id FROM no_show_disputes WHERE person_id = ?4"],
  [
    "no_show_case",
    "SELECT c.id FROM no_show_cases c JOIN appointments v ON v.id = c.appointment_id WHERE v.person_id = ?4",
  ],
  ["consent", "SELECT id FROM consents WHERE person_id = ?4"],
  ["credit_ledger", "SELECT id FROM credit_ledger WHERE person_id = ?4"],
  ["referral", "SELECT id FROM referral_attributions WHERE referred_person_id = ?4"],
];

const theirs = CLIENTS_OWN.map(([kind, ids]) => `(a.subject_kind = '${kind}' AND a.subject_id IN (${ids}))`).join(
  "\n         OR ",
);

const ACTIVITY_SQL = `
  SELECT a.id, a.at, a.surface, a.actor_kind, a.actor, a.action, a.subject_kind, a.subject_id, a.detail,
    CASE a.actor_kind
      WHEN 'client' THEN (SELECT name FROM people WHERE id = a.actor AND erased_at IS NULL)
      WHEN 'technician' THEN (SELECT name FROM technicians WHERE id = a.actor)
      WHEN 'service' THEN (SELECT label FROM staff_service_tokens WHERE client_id = a.actor)
    END AS actor_name
  FROM audit_log a
  WHERE (?1 IS NULL OR a.actor_kind = ?1)
    AND (?2 IS NULL OR a.actor = ?2)
    AND (?3 IS NULL OR a.action = ?3)
    AND (?4 IS NULL OR (a.actor_kind = 'client' AND a.actor = ?4) OR (a.subject_kind = 'person' AND a.subject_id = ?4)
         OR ${theirs})
    AND (?5 IS NULL OR (a.subject_kind = 'appointment' AND a.subject_id = ?5)
         OR (a.subject_kind IN ('hold', 'slot_hold') AND a.subject_id IN (SELECT id FROM slot_holds WHERE appointment_id = ?5)))
    AND (?6 IS NULL OR a.at >= ?6)
    AND (?7 IS NULL OR a.at < ?7)
    AND (?8 IS NULL OR a.id < ?8)
  ORDER BY a.id DESC
  LIMIT ?9`;

/** A row as the log's CHECKs and AUDIT_ACTIONS keep it: no other surface, kind of actor or action is written. */
interface Row {
  id: number;
  at: string;
  surface: Surface;
  actor_kind: AuditActor["kind"];
  actor: string;
  action: AuditAction;
  subject_kind: string | null;
  subject_id: string | null;
  detail: string | null;
  actor_name: string | null;
}

function entryOf(row: Row): ActivityEntry {
  return {
    id: row.id,
    at: row.at,
    surface: row.surface,
    actor: { kind: row.actor_kind, id: row.actor, name: row.actor_name },
    action: row.action,
    subject:
      row.subject_kind === null || row.subject_id === null ? null : { kind: row.subject_kind, id: row.subject_id },
    detail: row.detail === null ? null : (JSON.parse(row.detail) as Record<string, unknown>),
  };
}

/** The India date's first instant, as the log writes its times. */
const startOf = (date: string): string => indiaInstant(date, "00:00").toISOString();

/** One page of the log, newest first, as `filter` narrows it. */
export async function activity(db: D1Database, filter: ActivityFilter): Promise<ActivityPage> {
  const { results } = await db
    .prepare(ACTIVITY_SQL)
    .bind(
      filter.actorKind ?? null,
      filter.actor ?? null,
      filter.action ?? null,
      filter.person ?? null,
      filter.visit ?? null,
      filter.from === undefined ? null : startOf(filter.from),
      filter.to === undefined ? null : startOf(addDays(filter.to, 1)),
      filter.before ?? null,
      ACTIVITY_PAGE + 1,
    )
    .all<Row>();
  const entries = results.slice(0, ACTIVITY_PAGE).map(entryOf);
  return { entries, nextBefore: results.length > ACTIVITY_PAGE ? (entries.at(-1)?.id ?? null) : null };
}
