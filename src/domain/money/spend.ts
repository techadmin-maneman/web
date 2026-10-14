// Offline spend (docs/decisions/0150-spend.md): what was spent in a month to win clients that no ad account reports,
// for a city or national, by channel, typed in on the console's Spend page. Each entry, and each taken off, is audited;
// one taken off is kept, and leaves the figures.

import type { SpendChannel } from "../../policy/channels.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";

export interface SpendEntry {
  readonly id: string;
  /** "YYYY-MM". */
  readonly month: string;
  /** Null for spend not aimed at one city. */
  readonly city: string | null;
  readonly channel: SpendChannel;
  readonly campaign: string | null;
  /** Paise, before GST. */
  readonly amount: number;
  readonly note: string | null;
  readonly entered_by: string;
  readonly entered_at: string;
}

interface Change {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

type NewSpend = Omit<SpendEntry, "id" | "entered_by" | "entered_at">;

/** The entries from this month on, the latest month first. */
export async function spendSince(db: D1Database, month: string): Promise<SpendEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT id, month, city, channel, campaign, amount, note, entered_by, entered_at FROM spend_entries
       WHERE removed_at IS NULL AND month >= ?1 ORDER BY month DESC, entered_at DESC`,
    )
    .bind(month)
    .all<SpendEntry>();
  return results;
}

/** Adds an entry; "no_city" for a city we do not hold. */
export async function addSpend(db: D1Database, change: Change & NewSpend): Promise<SpendEntry | "no_city"> {
  if (change.city !== null) {
    const held = await db.prepare("SELECT 1 FROM cities WHERE name = ?1").bind(change.city).first();
    if (held === null) return "no_city";
  }
  const entry: SpendEntry = {
    id: crypto.randomUUID(),
    month: change.month,
    city: change.city,
    channel: change.channel,
    campaign: change.campaign,
    amount: change.amount,
    note: change.note,
    entered_by: change.actor.id,
    entered_at: change.now.toISOString(),
  };
  await db.batch([
    db
      .prepare(
        `INSERT INTO spend_entries (id, month, city, channel, campaign, amount, note, entered_by, entered_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        entry.id,
        entry.month,
        entry.city,
        entry.channel,
        entry.campaign,
        entry.amount,
        entry.note,
        entry.entered_by,
        entry.entered_at,
      ),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "spend.add",
        subject: { kind: "spend", id: entry.id },
        requestId: change.requestId,
        detail: { month: entry.month, channel: entry.channel, amount: entry.amount },
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
