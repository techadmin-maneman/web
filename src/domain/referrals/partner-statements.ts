// Partners' monthly statements (docs/decisions/0124-partner-statements.md): for a month in India, what the friends
// fitted in it earned each partner, less what a refund under the guarantee took back in it, and the payment Finance
// recorded against it. A statement holds days, counts and amounts, never a client. Each payment recorded or deleted
// is one batch with its audit entry, which keeps the month and the amount.

import { addMonths, indiaDate, indiaInstant, monthOf } from "../../lib/india-time.ts";
import { auditStatementIfDeleted, auditStatementIfWritten, type AuditActor } from "../platform/audit.ts";

/**
 * Paise a partner, `c`, is owed: what its fitted friends earned, less what refunds took back, which leaves a friend
 * granted no longer, and less what it has been paid.
 */
export const OWED = `(SELECT COALESCE(SUM(a.commission), 0) FROM channel_attributions a
    WHERE a.channel_id = c.id AND a.grant_state = 'granted')
  - (SELECT COALESCE(SUM(p.amount), 0) FROM partner_payouts p WHERE p.channel_id = c.id)`;

/** One line of a statement: a friend fitted, or one whose commission a refund took back, on a day in India. */
interface StatementLine {
  readonly day: string;
  readonly kind: "fitted" | "taken_back";
  readonly commission: number;
}

interface Payout {
  readonly amount: number;
  readonly paid_on: string;
  readonly reference: string;
  readonly recorded_by: string;
}

export interface PartnerStatement {
  readonly channel_id: string;
  readonly name: string;
  readonly code: string;
  readonly fitted: number;
  readonly earned: number;
  readonly taken_back: number;
  readonly taken_back_amount: number;
  /** What the month came to: earned, less what was taken back. */
  readonly due: number;
  readonly payout: Payout | null;
  /** Paise owed to date, this month and every other. */
  readonly owed: number;
  readonly lines: StatementLine[];
}

/** The instants a month in India runs between: its first midnight, and the next month's. */
function monthBounds(month: string): { from: string; to: string } {
  const startOf = (each: string) => indiaInstant(`${each}-01`, "00:00").toISOString();
  return { from: startOf(month), to: startOf(addMonths(month, 1)) };
}

/** The month a partner was first added in, or this month while there is none. */
export async function firstPartnerMonth(db: D1Database, now: Date): Promise<string> {
  const row = await db
    .prepare("SELECT MIN(created_at) AS first FROM referral_channels")
    .first<{ first: string | null }>();
  return monthOf(indiaDate(row?.first === null || row?.first === undefined ? now : new Date(row.first)));
}

interface ChannelRow {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly owed: number;
}

/** Each partner with anything in the month, or anything owed, and its statement for the month. */
export async function partnerStatements(db: D1Database, month: string): Promise<PartnerStatement[]> {
  const { from, to } = monthBounds(month);
  const [channels, lines, payouts] = await db.batch([
    db.prepare(`SELECT c.id, c.name, c.code, ${OWED} AS owed FROM referral_channels c ORDER BY c.name`),
    db
      .prepare(
        `SELECT channel_id, granted_at AS at, 'fitted' AS kind, COALESCE(commission, 0) AS commission
           FROM channel_attributions WHERE granted_at >= ?1 AND granted_at < ?2
         UNION ALL
         SELECT channel_id, clawed_back_at, 'taken_back', COALESCE(commission, 0)
           FROM channel_attributions WHERE clawed_back_at >= ?1 AND clawed_back_at < ?2
         ORDER BY at`,
      )
      .bind(from, to),
    db
      .prepare("SELECT channel_id, amount, paid_on, reference, recorded_by FROM partner_payouts WHERE month = ?1")
      .bind(month),
  ]);
  const linesOf = (lines?.results ?? []) as (StatementLine & { channel_id: string; at: string })[];
  const payoutsOf = (payouts?.results ?? []) as (Payout & { channel_id: string })[];
  return ((channels?.results ?? []) as ChannelRow[])
    .map((channel) =>
      statementOf(
        channel,
        linesOf.filter((line) => line.channel_id === channel.id),
        payoutsOf.find((payout) => payout.channel_id === channel.id) ?? null,
      ),
    )
    .filter((statement) => statement.lines.length > 0 || statement.payout !== null || statement.owed !== 0);
}

function statementOf(
  channel: ChannelRow,
  lines: readonly (StatementLine & { at: string })[],
  payout: (Payout & { channel_id: string }) | null,
): PartnerStatement {
  const fitted = lines.filter((line) => line.kind === "fitted");
  const takenBack = lines.filter((line) => line.kind === "taken_back");
  const sum = (some: readonly StatementLine[]) => some.reduce((total, line) => total + line.commission, 0);
  return {
    channel_id: channel.id,
    name: channel.name,
    code: channel.code,
    fitted: fitted.length,
    earned: sum(fitted),
    taken_back: takenBack.length,
    taken_back_amount: sum(takenBack),
    due: sum(fitted) - sum(takenBack),
    payout:
      payout === null
        ? null
        : {
            amount: payout.amount,
            paid_on: payout.paid_on,
            reference: payout.reference,
            recorded_by: payout.recorded_by,
          },
    owed: channel.owed,
    lines: lines.map((line) => ({ day: indiaDate(new Date(line.at)), kind: line.kind, commission: line.commission })),
  };
}

interface Change {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/** A month's payment to a partner, as Finance made it from the payout tool. */
export async function recordPayout(
  db: D1Database,
  payout: Change & {
    readonly channelId: string;
    readonly month: string;
    readonly amount: number;
    readonly paidOn: string;
    readonly reference: string;
  },
): Promise<"recorded" | "not_found" | "taken"> {
  const channel = await db.prepare("SELECT 1 FROM referral_channels WHERE id = ?1").bind(payout.channelId).first();
  if (channel === null) return "not_found";
  const id = crypto.randomUUID();
  const [written] = await db.batch([
    db
      .prepare(
        `INSERT INTO partner_payouts (id, channel_id, month, amount, paid_on, reference, recorded_by, recorded_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (channel_id, month) DO NOTHING`,
      )
      .bind(
        id,
        payout.channelId,
        payout.month,
        payout.amount,
        payout.paidOn,
        payout.reference,
        payout.actor.id,
        payout.now.toISOString(),
      ),
    auditStatementIfWritten(
      db,
      {
        surface: "ops",
        actor: payout.actor,
        action: "partner_payout.record",
        subject: { kind: "referral_channel", id: payout.channelId },
        requestId: payout.requestId,
        detail: { month: payout.month, amount: payout.amount },
      },
      payout.now,
      { table: "partner_payouts", id },
    ),
  ]);
  return written?.meta.changes === 1 ? "recorded" : "taken";
}

/** A payment recorded by mistake, taken off; the month is owed again. */
export async function deletePayout(
  db: D1Database,
  payout: Change & { readonly channelId: string; readonly month: string },
): Promise<"deleted" | "not_found"> {
  const row = await db
    .prepare("SELECT id, amount FROM partner_payouts WHERE channel_id = ?1 AND month = ?2")
    .bind(payout.channelId, payout.month)
    .first<{ id: string; amount: number }>();
  if (row === null) return "not_found";
  await db.batch([
    db.prepare("DELETE FROM partner_payouts WHERE id = ?1").bind(row.id),
    auditStatementIfDeleted(
      db,
      {
        surface: "ops",
        actor: payout.actor,
        action: "partner_payout.delete",
        subject: { kind: "referral_channel", id: payout.channelId },
        requestId: payout.requestId,
        detail: { month: payout.month, amount: row.amount },
      },
      payout.now,
      { table: "partner_payouts", column: "id", value: row.id },
    ),
  ]);
  return "deleted";
}
