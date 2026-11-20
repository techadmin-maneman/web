// Spend (docs/decisions/0150-spend.md, amended by 0288): what was spent on a day to win clients, for a city or national,
// by channel, Google's and Meta's included, so the figures read only our own rows. An entry is typed on the console's
// Spend page, taken from an ad account's CSV, or written with a society activation's costs; an API may add rows the same
// way one day. Each entry, and each taken off, is audited; one taken off is kept, and leaves the figures.

import type { SpendChannel } from "../../policy/channels.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";

/** Where an entry came from. */
export type SpendSource = "manual" | "csv" | "link" | "api";

/** What a society activation's cost was for. */
export type CostLine = "stall" | "staff" | "collateral" | "other";

export interface SpendEntry {
  readonly id: string;
  /** "YYYY-MM". */
  readonly month: string;
  /** "YYYY-MM-DD"; null for an entry made for a whole month before entries had a day. */
  readonly spent_date: string | null;
  /** Null for spend not aimed at one city. */
  readonly city: string | null;
  readonly channel: SpendChannel;
  readonly campaign: string | null;
  /** Paise, before GST. */
  readonly amount: number;
  readonly note: string | null;
  readonly source: SpendSource;
  readonly link_id: string | null;
  readonly cost_line: CostLine | null;
  readonly entered_by: string;
  readonly entered_at: string;
}

interface Change {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

export type NewSpend = Omit<SpendEntry, "id" | "month" | "entered_by" | "entered_at" | "spent_date"> & {
  readonly spent_date: string;
  /** The CSV it came in with, for an imported row. */
  readonly import_id?: string | null;
};

const COLUMNS = `id, month, spent_date, city, channel, campaign, amount, note, source, link_id, cost_line, entered_by,
  entered_at`;

/** The entries from this month on, the latest day first. */
export async function spendSince(db: D1Database, month: string): Promise<SpendEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM spend_entries WHERE removed_at IS NULL AND month >= ?1
       ORDER BY COALESCE(spent_date, month || '-01') DESC, entered_at DESC`,
    )
    .bind(month)
    .all<SpendEntry>();
  return results;
}

/** The entry as written, and the statement that writes it; its month is its day's. */
export function spendStatement(
  db: D1Database,
  spend: NewSpend,
  by: { readonly actorId: string; readonly at: Date },
): { readonly entry: SpendEntry; readonly statement: D1PreparedStatement } {
  const entry: SpendEntry = {
    id: crypto.randomUUID(),
    month: spend.spent_date.slice(0, 7),
    spent_date: spend.spent_date,
    city: spend.city,
    channel: spend.channel,
    campaign: spend.campaign,
    amount: spend.amount,
    note: spend.note,
    source: spend.source,
    link_id: spend.link_id,
    cost_line: spend.cost_line,
    entered_by: by.actorId,
    entered_at: by.at.toISOString(),
  };
  const statement = db
    .prepare(
      `INSERT INTO spend_entries (${COLUMNS}, import_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
    .bind(
      entry.id,
      entry.month,
      entry.spent_date,
      entry.city,
      entry.channel,
      entry.campaign,
      entry.amount,
      entry.note,
      entry.source,
      entry.link_id,
      entry.cost_line,
      entry.entered_by,
      entry.entered_at,
      spend.import_id ?? null,
    );
  return { entry, statement };
}

/** Whether we hold the city, or the entry names none. */
export async function cityHeld(db: D1Database, city: string | null): Promise<boolean> {
  if (city === null) return true;
  return (await db.prepare("SELECT 1 FROM cities WHERE name = ?1").bind(city).first()) !== null;
}

/** Adds an entry typed on the Spend page; "no_city" for a city we do not hold. */
export async function addSpend(
  db: D1Database,
  change: Change & Omit<NewSpend, "source" | "link_id" | "cost_line">,
): Promise<SpendEntry | "no_city"> {
  if (!(await cityHeld(db, change.city))) return "no_city";
  const { entry, statement } = spendStatement(
    db,
    { ...change, source: "manual", link_id: null, cost_line: null },
    { actorId: change.actor.id, at: change.now },
  );
  await db.batch([
    statement,
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "spend.add",
        subject: { kind: "spend", id: entry.id },
        requestId: change.requestId,
        detail: { day: entry.spent_date, channel: entry.channel, amount: entry.amount },
      },
      change.now,
    ),
  ]);
  return entry;
}

/** Takes an entry off the figures; false for one not on them. */
export async function removeSpend(db: D1Database, change: Change & { readonly id: string }): Promise<boolean> {
  const listed = await db
    .prepare("SELECT 1 FROM spend_entries WHERE id = ?1 AND removed_at IS NULL")
    .bind(change.id)
    .first();
  if (listed === null) return false;
  await db.batch([
    db
      .prepare("UPDATE spend_entries SET removed_by = ?2, removed_at = ?3 WHERE id = ?1")
      .bind(change.id, change.actor.id, change.now.toISOString()),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "spend.remove",
        subject: { kind: "spend", id: change.id },
        requestId: change.requestId,
      },
      change.now,
    ),
  ]);
  return true;
}
