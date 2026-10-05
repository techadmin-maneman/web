// The job sheet ops set in the console (docs/decisions/0087-consumables-and-stock.md;
// docs/open-points.md, item 28): each kind of visit's checklist, and the reasons
// a job may be left partly done. The technician app reads both with the job, and
// keeps them on the phone with it, so a job opened in a basement shows the list
// it was given (ADR 0053).
//
// A list ops have never saved is the committed one (src/config/job-sheet.ts).
// Once they save it, its rows are the list, in their order. An item they take
// off is retired rather than deleted: a phone may have queued it offline before
// the change reached it, and a job's summary still names it by its words.

import { CHECKLIST, JOB_SHEET_BOUNDS, PARTIAL_REASONS, type JobSheetItem } from "../config/job-sheet.ts";
import { VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import { auditStatement, type AuditActor } from "./audit.ts";
import { freshCode } from "../lib/slug.ts";

/** One list as it stands. */
export interface JobSheetList {
  /** What the technician is offered, in order. */
  readonly items: readonly JobSheetItem[];
  /** Taken off by ops, and still understood: a phone may have queued one before it knew. */
  readonly retired: readonly JobSheetItem[];
  /** Who last saved it, and when; null while the committed list stands. */
  readonly setBy: string | null;
  readonly setAt: string | null;
}

export interface JobSheet {
  readonly checklists: Readonly<Record<VisitType, JobSheetList>>;
  readonly partialReasons: JobSheetList;
}

interface Row {
  visit_type: VisitType | null;
  code: string;
  label: string;
  retired_at: string | null;
  set_by: string;
  set_at: string;
}

const committed = (items: readonly JobSheetItem[]): JobSheetList => ({
  items,
  retired: [],
  setBy: null,
  setAt: null,
});

/** A list from its rows, in their order; the committed one where there are none. */
function listOf(rows: readonly Row[], fallback: readonly JobSheetItem[]): JobSheetList {
  if (rows.length === 0) return committed(fallback);
  const item = (row: Row): JobSheetItem => ({ id: row.code, label: row.label });
  const latest = rows.reduce((last, row) => (row.set_at > last.set_at ? row : last));
  return {
    items: rows.filter((row) => row.retired_at === null).map(item),
    retired: rows.filter((row) => row.retired_at !== null).map(item),
    setBy: latest.set_by,
    setAt: latest.set_at,
  };
}

/** Every list, as the technician app and the console read them. Two small reads. */
export async function jobSheet(db: D1Database): Promise<JobSheet> {
  const [checklists, reasons] = await db.batch<Row>([
    db.prepare(
      `SELECT visit_type, code, label, retired_at, set_by, set_at FROM checklist_items
       ORDER BY visit_type, position, code`,
    ),
    db.prepare(
      `SELECT NULL AS visit_type, code, label, retired_at, set_by, set_at FROM partial_reasons
       ORDER BY position, code`,
    ),
  ]);
  const byType = (type: VisitType) => (checklists?.results ?? []).filter((row) => row.visit_type === type);
  return {
    checklists: Object.fromEntries(VISIT_TYPES.map((type) => [type, listOf(byType(type), CHECKLIST[type])])) as Record<
      VisitType,
      JobSheetList
    >,
    partialReasons: listOf(reasons?.results ?? [], PARTIAL_REASONS),
  };
}

/** Each item once, by its code, where it came first. */
const onceEach = (items: readonly JobSheetItem[]): JobSheetItem[] =>
  items.filter((item, index) => items.findIndex((other) => other.id === item.id) === index);

/**
 * The checklist a job runs: its kind's, or, for a consultation and fit in one visit, the consultation's and then the
 * first fit's, an item both hold listed once (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
 */
export function checklistOf(
  sheet: JobSheet,
  job: { readonly type: VisitType; readonly oneVisit: boolean },
): JobSheetList {
  if (!job.oneVisit) return sheet.checklists[job.type];
  const { consultation, first_fit: fit } = sheet.checklists;
  return {
    ...fit,
    items: onceEach([...consultation.items, ...fit.items]),
    retired: onceEach([...consultation.retired, ...fit.retired]),
  };
}

/** The checklist of a one visit whose client decided against the fit: the consultation's alone, as nothing is fitted. */
export const declinedChecklistOf = (sheet: JobSheet): JobSheetList => sheet.checklists.consultation;

/** Every code a list understands, retired ones included: what a phone's write is checked against. */
export const knownCodes = (list: JobSheetList): Set<string> =>
  new Set([...list.items, ...list.retired].map((item) => item.id));

/** Each code a list has ever offered, with its words. */
const labelsOf = (list: JobSheetList): Map<string, string> =>
  new Map([...list.retired, ...list.items].map((item) => [item.id, item.label]));

/** One item ops send: one already on the list by its code, or a new one by its words alone. */
interface ItemSent {
  readonly code?: string | undefined;
  readonly label: string;
}

/** Which list: a kind of visit's checklist, or the partial reasons. */
export type ListName =
  { readonly list: "checklist"; readonly visitType: VisitType } | { readonly list: "partial_reason" };

type ListSaved = { readonly ok: true; readonly list: JobSheetList } | { readonly ok: false; readonly fields: string[] };

/**
 * A new item's code, from its words: "Scalp checked" is scalp_checked, and a
 * second of the same words scalp_checked_2. It never changes after, so a
 * rename keeps what phones and summaries already hold.
 */
const codeFor = (label: string, taken: ReadonlySet<string>): string => freshCode(label, 40, "item", taken);

/** What is wrong with a list ops sent, by the field a form can point at; none when it may be saved. */
function refusalsOf(which: ListName, sent: readonly ItemSent[], known: ReadonlySet<string>): string[] {
  const most = which.list === "checklist" ? JOB_SHEET_BOUNDS.maxChecklistItems : JOB_SHEET_BOUNDS.maxPartialReasons;
  if (sent.length === 0 || sent.length > most) return ["items"];
  const fields: string[] = [];
  const codes = new Set<string>();
  const labels = new Set<string>();
  sent.forEach((item, index) => {
    const label = item.label.trim().toLowerCase();
    if (label === "" || item.label.trim().length > JOB_SHEET_BOUNDS.maxLabel || labels.has(label)) {
      fields.push(`items.${String(index)}.label`);
    }
    labels.add(label);
    if (item.code === undefined) return;
    if (!known.has(item.code) || codes.has(item.code)) fields.push(`items.${String(index)}.code`);
    codes.add(item.code);
  });
  return fields;
}

/**
 * Saves a list as ops sent it, in its order, with its audit entry in the same
 * batch. An item sent with its code keeps it, with the words sent; one without
 * is new and gets one; one left out is retired, and one sent again is back.
 */
export async function saveList(
  db: D1Database,
  input: {
    readonly which: ListName;
    readonly items: readonly ItemSent[];
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<ListSaved> {
  const { which, items, actor, requestId, now } = input;
  const sheet = await jobSheet(db);
  const was = which.list === "checklist" ? sheet.checklists[which.visitType] : sheet.partialReasons;
  const known = knownCodes(was);
  const fields = refusalsOf(which, items, known);
  if (fields.length > 0) return { ok: false, fields };

  const at = now.toISOString();
  const taken = new Set(known);
  const kept: JobSheetItem[] = items.map((item) => {
    const code = item.code ?? codeFor(item.label.trim(), taken);
    taken.add(code);
    return { id: code, label: item.label.trim() };
  });
  const keptCodes = new Set(kept.map((item) => item.id));
  const wasLabels = labelsOf(was);
  const takenOff = [...was.items, ...was.retired].filter((item) => !keptCodes.has(item.id));
  const alreadyRetired = new Set(was.retired.map((item) => item.id));

  // What is taken off stands after the list. An item retired before keeps the moment it went (the statement's
  // COALESCE); one taken off now goes now; one sent again is back.
  const rows = [
    ...kept.map((item, position) => ({ ...item, position, retiredAt: null as string | null })),
    ...takenOff.map((item, index) => ({ ...item, position: kept.length + index, retiredAt: at })),
  ];
  const renamed = kept.filter((item) => wasLabels.has(item.id) && wasLabels.get(item.id) !== item.label).length;

  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor,
        action: "job_sheet.set",
        subject: {
          kind: "job_sheet",
          id: which.list === "checklist" ? `checklist/${which.visitType}` : "partial_reasons",
        },
        requestId,
        detail: {
          items: kept.length,
          added: kept.filter((item) => !known.has(item.id)).length,
          renamed,
          retired: takenOff.filter((item) => !alreadyRetired.has(item.id)).length,
        },
      },
      now,
    ),
    ...rows.map((row) =>
      which.list === "checklist"
        ? db
            .prepare(
              `INSERT INTO checklist_items (visit_type, code, label, position, retired_at, set_by, set_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
               ON CONFLICT (visit_type, code) DO UPDATE SET label = excluded.label, position = excluded.position,
                 retired_at = ${RETIRED_AT("checklist_items")}, set_by = excluded.set_by, set_at = excluded.set_at`,
            )
            .bind(which.visitType, row.id, row.label, row.position, row.retiredAt, actor.id, at)
        : db
            .prepare(
              `INSERT INTO partial_reasons (code, label, position, retired_at, set_by, set_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)
               ON CONFLICT (code) DO UPDATE SET label = excluded.label, position = excluded.position,
                 retired_at = ${RETIRED_AT("partial_reasons")}, set_by = excluded.set_by, set_at = excluded.set_at`,
            )
            .bind(row.id, row.label, row.position, row.retiredAt, actor.id, at),
    ),
  ]);

  const saved = await jobSheet(db);
  return { ok: true, list: which.list === "checklist" ? saved.checklists[which.visitType] : saved.partialReasons };
}

/** Back on the list is not retired; still off it keeps the moment it first went. */
const RETIRED_AT = (table: "checklist_items" | "partial_reasons") =>
  `CASE WHEN excluded.retired_at IS NULL THEN NULL ELSE COALESCE(${table}.retired_at, excluded.retired_at) END`;
