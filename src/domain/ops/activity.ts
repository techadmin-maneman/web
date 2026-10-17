// The audit log read back for the console's Activity page (docs/decisions/0031-access-and-audit.md): every entry,
// newest first, narrowed by who made it, what it was, one client's whole record, one visit, or the days it fell on,
// with each person named as the console knows them. A page at a time, each going on from the last.

import type { Surface } from "../../config/environments.ts";
import { addDays, indiaInstant } from "../../lib/india-time.ts";
import type { AuditAction, AuditActor } from "../platform/audit.ts";
import { z } from "zod";
import { storedJson } from "../../lib/stored-json.ts";
import { OPS_SETTINGS } from "../../policy/ops-settings.ts";

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
  /** The calls that only read, as each page a member of staff opens makes, shown too; else what changed alone. */
  readonly reads?: boolean | undefined;
}

interface ActivityEntry {
  readonly id: number;
  readonly at: string;
  readonly surface: Surface;
  /** Named where the console knows a name: a client not erased, a technician, a service token's label. */
  readonly actor: { readonly kind: AuditActor["kind"]; readonly id: string; readonly name: string | null };
  readonly action: AuditAction;
  /** The record touched, by its kind and ID, and its name or number where it has one: a setting by its title. */
  readonly subject: { readonly kind: string; readonly id: string; readonly label: string | null } | null;
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
    (SELECT r.detail FROM audit_log r INDEXED BY audit_log_by_request
      WHERE r.request_id = a.request_id AND r.action = 'call.refused') AS refused,
    CASE a.actor_kind
      WHEN 'client' THEN (SELECT name FROM people WHERE id = a.actor AND erased_at IS NULL)
      WHEN 'technician' THEN (SELECT name FROM technicians WHERE id = a.actor)
      WHEN 'service' THEN (SELECT label FROM staff_service_tokens WHERE client_id = a.actor)
    END AS actor_name,
    CASE a.subject_kind
      WHEN 'consumable' THEN (SELECT name FROM consumables WHERE code = a.subject_id)
      WHEN 'purchase_order' THEN (SELECT 'PO-' || printf('%04d', number) FROM purchase_orders WHERE id = a.subject_id)
      WHEN 'count_task' THEN (SELECT p.name FROM count_tasks t JOIN stock_places p ON p.id = t.place_id
                               WHERE t.id = a.subject_id)
      WHEN 'supplier' THEN (SELECT name FROM suppliers WHERE id = a.subject_id)
      WHEN 'technician' THEN (SELECT name FROM technicians WHERE id = a.subject_id)
      WHEN 'stock_place' THEN (SELECT name FROM stock_places WHERE id = a.subject_id)
    END AS subject_label
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
    -- A refusal is told on the call it refused, never as a row of its own.
    AND a.action <> 'call.refused'
    -- A count's items are told by the count they were counted in.
    AND (a.action <> 'stock.count' OR NOT EXISTS (SELECT 1 FROM audit_log t INDEXED BY audit_log_by_request
                                                  WHERE t.request_id = a.request_id AND t.action = 'count_task.count'))
    AND (?10 = 1 OR a.action NOT IN ('ops.call', 'client.call', 'tech.call')
         OR (COALESCE(json_extract(a.detail, '$.method'), '') <> 'GET'
             AND COALESCE(json_extract(a.detail, '$.path'), '') NOT GLOB '*/find'
             AND COALESCE(json_extract(a.detail, '$.path'), '') NOT GLOB '*/search'
             -- A link to upload a photograph to changes nothing until the photograph is recorded.
             AND COALESCE(json_extract(a.detail, '$.path'), '') NOT GLOB '*/upload-url'
             AND NOT EXISTS (SELECT 1 FROM audit_log o INDEXED BY audit_log_by_request
                              WHERE o.request_id = a.request_id AND o.id <> a.id
                                AND o.action NOT IN ('ops.call', 'client.call', 'tech.call', 'call.refused'))
             -- A call whose own action is logged beside it, by the same person within seconds, is that action.
             AND NOT EXISTS (SELECT 1 FROM audit_log d INDEXED BY audit_log_actor
                              WHERE d.actor_kind = a.actor_kind AND d.actor = a.actor
                                AND d.at BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', a.at, '-5 seconds')
                                             AND strftime('%Y-%m-%dT%H:%M:%fZ', a.at, '+5 seconds')
                                AND d.action NOT IN ('ops.call', 'client.call', 'tech.call', 'call.refused'))))
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
  /** The refusal written under the same request, where the API refused the call. */
  refused: string | null;
  actor_name: string | null;
  subject_label: string | null;
}

/** A record's name as Activity says it: a setting by its title, the rest as the log's read gave it. */
function labelOf(kind: string, id: string, read: string | null): string | null {
  if (kind === "setting") return OPS_SETTINGS.find((setting) => setting.name === id)?.title ?? null;
  return read;
}

function entryOf(row: Row): ActivityEntry {
  return {
    id: row.id,
    at: row.at,
    surface: row.surface,
    actor: { kind: row.actor_kind, id: row.actor, name: row.actor_name },
    action: row.action,
    subject:
      row.subject_kind === null || row.subject_id === null
        ? null
        : {
            kind: row.subject_kind,
            id: row.subject_id,
            label: labelOf(row.subject_kind, row.subject_id, row.subject_label),
          },
    detail: detailOf(row),
  };
}

const DETAIL = z.record(z.string(), z.unknown());

/** The entry's detail, with a refused call's status and code under `refused`. */
function detailOf(row: Row): Record<string, unknown> | null {
  const detail = row.detail === null ? null : storedJson(DETAIL, row.detail, "audit_log.detail");
  if (row.refused === null) return detail;
  return { ...detail, refused: storedJson(DETAIL, row.refused, "audit_log.detail") };
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
      filter.reads === true ? 1 : 0,
    )
    .all<Row>();
  const entries = results.slice(0, ACTIVITY_PAGE).map(entryOf);
  return { entries, nextBefore: results.length > ACTIVITY_PAGE ? (entries.at(-1)?.id ?? null) : null };
}
