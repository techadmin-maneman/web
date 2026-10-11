// A move to another day that ops ask the client to confirm (docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md):
// proposed with the dispatch board's checks, the visit left where it is; accepted by the client, which moves the visit
// with those checks run again; withdrawn by ops; or moot once the visit has moved since, by ops or by the client.

import type { BookingWindow } from "../../config/scheduling.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { queueMessage } from "../messages/queued-messages.ts";
import { auditStatement, type AuditEntry } from "../ops/audit.ts";
import { agreedToVisitMessages, moveJob, planMove, type MoveInput } from "./dispatch.ts";

/** How long a proposal stays open: two days, or until the visit's own start if that is sooner. */
const OPEN_FOR_MS = 2 * DAY_MS;

type Refusal = Exclude<Awaited<ReturnType<typeof planMove>>, { readonly kind: "planned" }>;

/** messaged: the client was sent the proposal on WhatsApp; call: they have not agreed to it, so ops call them. */
/** no_client: the visit has no client to ask; same_day: the move keeps the visit's day, so the board makes it. */
type ProposeOutcome =
  | { readonly kind: "no_client" }
  | { readonly kind: "same_day" }
  | { readonly kind: "proposed"; readonly proposalId: string; readonly clientNotice: "messaged" | "call" }
  | Refusal;

interface ProposeDeps {
  /** Queues the client's message. */
  readonly notify?: (messageId: string) => Promise<unknown>;
}

/**
 * Asks the client to confirm a move to another day: the board's checks, then the proposal written, and any proposal
 * open on the visit before it withdrawn in the same batch. Nothing of the visit changes.
 */
export async function proposeMove(
  db: D1Database,
  deps: ProposeDeps,
  input: MoveInput,
  now: Date,
): Promise<ProposeOutcome> {
  const planned = await planMove(db, input, now);
  if (planned.kind !== "planned") return planned;
  const { move } = planned;
  const { job } = move;
  if (job.person_id === null) return { kind: "no_client" };
  if (move.date === indiaDate(new Date(job.window_start))) return { kind: "same_day" };
  const id = crypto.randomUUID();
  const at = now.toISOString();
  const expiresAt = new Date(Math.min(now.getTime() + OPEN_FOR_MS, Date.parse(job.window_start))).toISOString();
  const personId = job.person_id;
  const messageId = (await agreedToVisitMessages(db, job.id)) ? crypto.randomUUID() : null;
  await db.batch([
    db
      .prepare(
        "UPDATE move_proposals SET answered_at = ?2, answer = 'withdrawn' WHERE appointment_id = ?1 AND answered_at IS NULL",
      )
      .bind(job.id, at),
    db
      .prepare(
        `INSERT INTO move_proposals (id, appointment_id, technician_id, date, window_label, reason, proposed_by,
           expected_technician_id, expected_start, created_at, expires_at, message_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(
        id,
        job.id,
        move.technicianId,
        move.date,
        move.window,
        move.reason,
        move.actor,
        job.technician_id,
        job.window_start,
        at,
        expiresAt,
        messageId,
      ),
    ...(messageId === null
      ? []
      : [
          queueMessage(db, {
            id: messageId,
            personId,
            kind: "move_proposed",
            subject: { kind: "move_proposal", id },
            at,
          }),
        ]),
  ]);
  if (messageId !== null) await deps.notify?.(messageId);
  return { kind: "proposed", proposalId: id, clientNotice: messageId === null ? "call" : "messaged" };
}

/** A proposal still open on a visit, as the client's app and the dispatch board show it. */
interface OpenProposal {
  readonly id: string;
  /** India's date, and the window, the visit would go to. */
  readonly date: string;
  readonly window: BookingWindow;
  readonly technician: { readonly name: string; readonly initials: string } | null;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * The visit's open proposal, as a JSON object, in a query of the visits whose row is named \`visit\`; null for none.
 * One the visit has moved since is not open: it names the start it was made against.
 */
export const openProposalJson = (visit: string): string => `(SELECT json_object('id', p.id, 'date', p.date,
    'window', p.window_label, 'technician_name', t.name, 'technician_initials', t.initials,
    'created_at', p.created_at, 'expires_at', p.expires_at)
  FROM move_proposals p LEFT JOIN technicians t ON t.id = p.technician_id
  WHERE p.appointment_id = ${visit}.id AND p.answered_at IS NULL AND p.expected_start = ${visit}.window_start)`;

interface ProposalJson {
  id: string;
  date: string;
  window: BookingWindow;
  technician_name: string | null;
  technician_initials: string | null;
  created_at: string;
  expires_at: string;
}

/** The open proposal openProposalJson read, while it may still be accepted; null for none. */
export function openProposalOf(json: string | null, now: Date): OpenProposal | null {
  if (json === null) return null;
  const read = JSON.parse(json) as ProposalJson;
  if (Date.parse(read.expires_at) <= now.getTime()) return null;
  return {
    id: read.id,
    date: read.date,
    window: read.window,
    technician:
      read.technician_name === null || read.technician_initials === null
        ? null
        : { name: read.technician_name, initials: read.technician_initials },
    createdAt: read.created_at,
    expiresAt: read.expires_at,
  };
}

interface ProposalRow {
  id: string;
  appointment_id: string;
  technician_id: string;
  date: string;
  window_label: BookingWindow;
  reason: MoveInput["reason"];
  proposed_by: string;
  expected_technician_id: string | null;
  expected_start: string;
  expires_at: string;
  window_start: string;
}

/**
 * accepted: the visit moved where the proposal put it. gone: that time was taken since, or the visit cannot move now,
 * so the client picks again. none: no proposal is open on the client's visit, or it has run out.
 */
type AcceptOutcome = "accepted" | "gone" | "none";

/** A proposal no move can come of any more: the visit moved since, or its time was taken. */
const madeMoot = (db: D1Database, id: string, at: string) =>
  db
    .prepare("UPDATE move_proposals SET answered_at = ?2, answer = 'moot' WHERE id = ?1 AND answered_at IS NULL")
    .bind(id, at)
    .run();

/** The client accepts the proposal open on their visit: the move, its checks run again, as the board would make it. */
export async function acceptProposal(
  db: D1Database,
  deps: ProposeDeps,
  input: { readonly appointmentId: string; readonly personId: string; readonly audit: AuditEntry; readonly now: Date },
): Promise<AcceptOutcome> {
  const { now } = input;
  const proposal = await db
    .prepare(
      `SELECT p.id, p.appointment_id, p.technician_id, p.date, p.window_label, p.reason, p.proposed_by,
         p.expected_technician_id, p.expected_start, p.expires_at, a.window_start
       FROM move_proposals p JOIN appointments a ON a.id = p.appointment_id
       WHERE p.appointment_id = ?1 AND a.person_id = ?2 AND p.answered_at IS NULL`,
    )
    .bind(input.appointmentId, input.personId)
    .first<ProposalRow>();
  if (proposal === null || Date.parse(proposal.expires_at) <= now.getTime()) return "none";
  const at = now.toISOString();
  if (proposal.window_start !== proposal.expected_start) {
    await madeMoot(db, proposal.id, at);
    return "none";
  }

  const moved = await moveJob(
    db,
    deps,
    {
      appointmentId: proposal.appointment_id,
      technicianId: proposal.technician_id,
      date: proposal.date,
      window: proposal.window_label,
      reason: proposal.reason,
      actor: proposal.proposed_by,
      expected: { technicianId: proposal.expected_technician_id, startsAt: proposal.expected_start },
    },
    now,
  );
  if (moved.kind !== "moved") {
    await madeMoot(db, proposal.id, at);
    return "gone";
  }
  await db.batch([
    db
      .prepare(
        "UPDATE move_proposals SET answered_at = ?2, answer = 'accepted', move_id = ?3 WHERE id = ?1 AND answered_at IS NULL",
      )
      .bind(proposal.id, at, moved.moveId),
    auditStatement(db, { ...input.audit, detail: { proposal_id: proposal.id, move_id: moved.moveId } }, now),
  ]);
  return "accepted";
}

/** Ops take back a proposal still open. False when it is not open, or not in their cities. */
export async function withdrawProposal(
  db: D1Database,
  input: { readonly proposalId: string; readonly audit: AuditEntry; readonly now: Date },
): Promise<boolean> {
  const withdrawn = await db
    .prepare(
      "UPDATE move_proposals SET answered_at = ?2, answer = 'withdrawn' WHERE id = ?1 AND answered_at IS NULL RETURNING id",
    )
    .bind(input.proposalId, input.now.toISOString())
    .first();
  if (withdrawn === null) return false;
  await auditStatement(db, input.audit, input.now).run();
  return true;
}
