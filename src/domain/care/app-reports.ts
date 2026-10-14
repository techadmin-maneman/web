// A client's word from the app that something is wrong with their hair system or with a visit
// (docs/decisions/0129-the-care-inbox.md): filed in their Care thread as though written on WhatsApp, with a note for
// Care alone beside it of their piece, when it was fitted and falls due, and its supplier's warranty. Their photographs
// follow on WhatsApp, into the same thread. Filing it sends nothing.

import { fullDate, shortDate } from "@maneman/web-kit/dates";
import { indiaDate } from "../../lib/india-time.ts";
import type { ProblemAbout } from "../../policy/problems.ts";
import { warrantyEndsOn } from "../../policy/purchasing.ts";
import { fileInbound } from "./inbox.ts";

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
  readonly about: ProblemAbout;
  /** The visit it is about; null for one about the hair system alone. */
  readonly visitId: string | null;
  readonly text: string;
  readonly at: Date;
}

/** Files the report and Care's note beside it; false where the visit named is not the client's. */
export async function reportProblem(db: D1Database, report: ProblemReport): Promise<boolean> {
  const about = report.visitId === null ? null : await visitLine(db, report.personId, report.visitId);
  if (report.visitId !== null && about === null) return false;
  const piece = await db.prepare(PIECE_SQL).bind(report.personId).first<PieceRow>();
  const heading =
    report.about === "hair_system" ? "Something's wrong with my hair system" : "Something's wrong with a visit";
  await fileInbound(db, {
    mobileE164: report.mobileE164,
    text: `${heading}:\n${report.text}`,
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
  return true;
}
