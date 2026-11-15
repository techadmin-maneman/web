// A client's report from the app that something is wrong (docs/decisions/0129-the-care-inbox.md,
// docs/decisions/0258-the-issue-log.md): recorded with its number for their issue log, and filed in their Care thread
// as though written on WhatsApp, under its reference and category, with a note for Care alone beside it of their piece,
// when it was fitted and falls due, and its supplier's warranty. Filing it sends nothing.

import { fullDate, shortDate } from "@maneman/web-kit/dates";
import { indiaDate } from "../../lib/india-time.ts";
import { guaranteeUntil } from "../../policy/fit-guarantee.ts";
import { reportReference, type ProblemCategory } from "../../policy/problems.ts";
import { warrantyEndsOn } from "../../policy/purchasing.ts";
import { fileInbound } from "./inbox.ts";
import type { CloseReason } from "./replies.ts";

/** Each category as Care read it in the thread. */
const CATEGORY_WORDS: Readonly<Record<ProblemCategory, string>> = {
  fit_guarantee: "The fit (guarantee)",
  edges_lifting: "Edges lifting",
  itching: "Itching or irritation",
  colour: "Colour or shine",
  shedding: "Shedding",
  fit_comfort: "Fit or comfort",
  visit: "A visit or technician",
  payment: "Payment or refund",
  other: "Something else",
};

/** The closure reason Care's close opens on, for each category. */
export const CLOSE_REASON_OF: Readonly<Record<ProblemCategory, CloseReason>> = {
  fit_guarantee: "fit_problem",
  edges_lifting: "fit_problem",
  itching: "aftercare",
  colour: "aftercare",
  shedding: "aftercare",
  fit_comfort: "fit_problem",
  visit: "booking",
  payment: "billing",
  other: "other",
};

interface PieceRow {
  readonly piece_code: string;
  readonly fitted_at: string;
  readonly replacement_due_at: string | null;
  readonly warranty_days: number | null;
  readonly received_at: string | null;
}

// The piece the client wears now, and the receipt its unit came in on by its first move.
const PIECE_SQL = `SELECT p.piece_code, p.fitted_at, p.replacement_due_at, s.warranty_days, r.received_at
  FROM pieces p
  LEFT JOIN stock_units u ON u.code = p.piece_code
  LEFT JOIN receipt_lines l ON l.movement_id = (SELECT e.movement_id FROM stock_unit_events e
    WHERE e.unit_id = u.id AND e.movement_id IS NOT NULL ORDER BY e.at LIMIT 1)
  LEFT JOIN receipts r ON r.id = l.receipt_id
  LEFT JOIN purchase_orders o ON o.id = r.po_id
  LEFT JOIN suppliers s ON s.id = o.supplier_id
  WHERE p.person_id = ?1 AND p.deleted_at IS NULL AND p.fitted_at IS NOT NULL AND p.replaced_at IS NULL
  ORDER BY p.fitted_at DESC LIMIT 1`;

/** What Care reads of the client's piece: "Piece MM-NAT-4417-A, fitted 21 Sep 2026 · due 21 Mar 2027 · ...". */
function pieceLine(piece: PieceRow | null, today: string): string {
  if (piece === null) return "No piece on record.";
  const due = piece.replacement_due_at === null ? null : indiaDate(new Date(piece.replacement_due_at));
  const warranty =
    piece.received_at === null || piece.warranty_days === null
      ? "no supplier receipt on record"
      : warrantyLine(warrantyEndsOn(piece.received_at, piece.warranty_days), today);
  return [
    `Piece ${piece.piece_code}, fitted ${fullDate(indiaDate(new Date(piece.fitted_at)))}`,
    ...(due === null ? [] : [`replacement due ${fullDate(due)}`]),
    warranty,
  ].join(" · ");
}

const warrantyLine = (endsOn: string, today: string) =>
  endsOn < today ? `supplier's warranty ended ${fullDate(endsOn)}` : `supplier's warranty to ${fullDate(endsOn)}`;

/** The visit a report is about, as Care reads it; null where it is not the client's. */
async function visitLine(db: D1Database, personId: string, visitId: string): Promise<string | null> {
  const visit = await db
    .prepare(
      `SELECT a.type, a.window_start, t.name AS technician FROM appointments a
       LEFT JOIN technicians t ON t.id = a.technician_id
       WHERE a.id = ?1 AND a.person_id = ?2 AND a.deleted_at IS NULL`,
    )
    .bind(visitId, personId)
    .first<{ type: string; window_start: string; technician: string | null }>();
  if (visit === null) return null;
  const day = shortDate(indiaDate(new Date(visit.window_start)));
  return `About the ${visit.type.replace("_", " ")} of ${day}${visit.technician === null ? "" : ` with ${visit.technician}`}.`;
}

export interface ProblemReport {
  readonly personId: string;
  readonly mobileE164: string;
  readonly category: ProblemCategory;
  /** The visit it is about; null for one about none. */
  readonly visitId: string | null;
  readonly text: string;
  readonly at: Date;
  /** The fit guarantee's days in force now, for a fit whose sign-off recorded none. */
  readonly guaranteeDays: number;
}

/**
 * The first fit a report on the fit (guarantee) claims: the visit named, else the client's latest first fit done, where
 * the report comes inside its guarantee, by the days recorded at its sign-off or in force now; null otherwise.
 */
async function claimedFit(db: D1Database, report: ProblemReport): Promise<string | null> {
  if (report.category !== "fit_guarantee") return null;
  const fit = await db
    .prepare(
      `SELECT a.id, a.window_start, s.guarantee_days FROM appointments a
         JOIN visit_outcomes v ON v.appointment_id = a.id AND v.outcome = 'done'
         LEFT JOIN fit_sign_offs s ON s.appointment_id = a.id
        WHERE a.person_id = ?1 AND a.type = 'first_fit' AND a.deleted_at IS NULL AND (?2 IS NULL OR a.id = ?2)
        ORDER BY a.window_start DESC LIMIT 1`,
    )
    .bind(report.personId, report.visitId)
    .first<{ id: string; window_start: string; guarantee_days: number | null }>();
  if (fit === null) return null;
  const until = guaranteeUntil(indiaDate(new Date(fit.window_start)), fit.guarantee_days ?? report.guaranteeDays);
  return indiaDate(report.at) <= until ? fit.id : null;
}

/** A report recorded: its ID and the number its reference is made of. */
export interface Reported {
  readonly id: string;
  readonly number: number;
}

/**
 * Records the report with the next number, then files it and Care's note beside it in the client's thread; null where
 * the visit named is not the client's.
 */
export async function reportProblem(db: D1Database, report: ProblemReport): Promise<Reported | null> {
  const about = report.visitId === null ? null : await visitLine(db, report.personId, report.visitId);
  if (report.visitId !== null && about === null) return null;
  const piece = await db.prepare(PIECE_SQL).bind(report.personId).first<PieceRow>();
  const id = crypto.randomUUID();
  const claim = await claimedFit(db, report);
  const recorded = await db
    .prepare(
      `INSERT INTO client_reports (id, number, person_id, category, visit_id, claim_visit_id, text, created_at)
       SELECT ?1, COALESCE(MAX(number), 0) + 1, ?2, ?3, ?4, ?5, ?6, ?7 FROM client_reports
       RETURNING number`,
    )
    .bind(id, report.personId, report.category, report.visitId, claim, report.text, report.at.toISOString())
    .first<{ number: number }>();
  const number = recorded?.number ?? 0;
  await fileInbound(db, {
    mobileE164: report.mobileE164,
    text: `${reportReference(number)} · ${CATEGORY_WORDS[report.category]}:\n${report.text}`,
    providerMessageId: null,
    at: report.at,
  });
  const note = ["From the app.", ...(about === null ? [] : [about]), pieceLine(piece, indiaDate(report.at))].join(" ");
  // A moment after the client's words, so the thread reads it beneath them.
  const at = new Date(report.at.getTime() + 1).toISOString();
  await db
    .prepare(
      `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at)
       SELECT ?1, id, 'note', 'system', ?3, ?4, ?4 FROM conversations WHERE mobile_e164 = ?2`,
    )
    .bind(crypto.randomUUID(), report.mobileE164, note, at)
    .run();
  // The thread it went into, which its log reads.
  await db
    .prepare(
      "UPDATE client_reports SET conversation_id = (SELECT id FROM conversations WHERE mobile_e164 = ?2) WHERE id = ?1",
    )
    .bind(id, report.mobileE164)
    .run();
  return { id, number };
}

/** A report of the client's, by its number, with the number their Care chat is with; null for any other. */
export async function reportOf(
  db: D1Database,
  personId: string,
  number: number,
): Promise<{ readonly id: string; readonly number: number; readonly mobile_e164: string } | null> {
  return db
    .prepare(
      `SELECT r.id, r.number, pe.mobile_e164 FROM client_reports r JOIN people pe ON pe.id = r.person_id
       WHERE r.person_id = ?1 AND r.number = ?2 AND pe.erased_at IS NULL`,
    )
    .bind(personId, number)
    .first<{ id: string; number: number; mobile_e164: string }>();
}

/**
 * The client's later words on a report, an update or a reopening, filed in its Care chat under its reference; either
 * opens it again, so one settled reads open until Care settle it once more.
 */
export async function addToReport(
  db: D1Database,
  added: {
    readonly report: { readonly id: string; readonly number: number };
    readonly mobileE164: string;
    readonly text: string;
    readonly reopening: boolean;
    readonly at: Date;
  },
): Promise<void> {
  const heading = `${reportReference(added.report.number)} · ${added.reopening ? "Reopened" : "Update"}`;
  await fileInbound(db, {
    mobileE164: added.mobileE164,
    text: `${heading}:\n${added.text}`,
    providerMessageId: null,
    at: added.at,
  });
  await db
    .prepare("UPDATE client_reports SET reopened_at = ?2 WHERE id = ?1")
    .bind(added.report.id, added.at.toISOString())
    .run();
}

/** The client says the report is sorted. */
export async function markReportSorted(db: D1Database, reportId: string, at: Date): Promise<void> {
  await db.prepare("UPDATE client_reports SET sorted_at = ?2 WHERE id = ?1").bind(reportId, at.toISOString()).run();
}
