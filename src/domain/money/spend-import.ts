// Google's and Meta's spend, taken from the daily CSV each ad account exports (docs/decisions/0288-attribution-and-
// conversions.md): one entry per day and campaign, under the platform's channel, in the city the campaign's name starts
// with or national (docs/decisions/0148-the-channel-rule.md). The same rows twice are refused while the first are on the
// figures; spend an API pulls one day can be added through these same rows.

import { sha256Hex } from "../../lib/hash.ts";
import { campaignCity } from "../../policy/channels.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";
import { spendStatement } from "./spend.ts";

const CHANNEL = { google: "google_ads", meta: "meta_ads" } as const;

export interface ImportedRow {
  readonly day: string;
  readonly campaign: string;
  /** Paise, before GST. */
  readonly amount: number;
}

/** Adds the rows; "already_imported" where the same rows are on the figures already. Says how many were added. */
export async function importSpend(
  db: D1Database,
  change: {
    readonly platform: keyof typeof CHANNEL;
    readonly rows: readonly ImportedRow[];
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<number | "already_imported"> {
  const sorted = [...change.rows].sort((a, b) =>
    `${a.day}|${a.campaign}|${String(a.amount)}`.localeCompare(`${b.day}|${b.campaign}|${String(b.amount)}`),
  );
  const importId = await sha256Hex(JSON.stringify([change.platform, sorted]));
  const taken = await db
    .prepare("SELECT 1 FROM spend_entries WHERE import_id = ?1 AND removed_at IS NULL LIMIT 1")
    .bind(importId)
    .first();
  if (taken !== null) return "already_imported";
  const { results } = await db.prepare("SELECT name FROM cities").all<{ name: string }>();
  const cities = results.map((row) => row.name);
  const by = { actorId: change.actor.id, at: change.now };
  const statements = sorted.map(
    (row) =>
      spendStatement(
        db,
        {
          spent_date: row.day,
          city: campaignCity(row.campaign, cities),
          channel: CHANNEL[change.platform],
          campaign: row.campaign,
          amount: row.amount,
          note: null,
          source: "csv",
          link_id: null,
          cost_line: null,
          import_id: importId,
        },
        by,
      ).statement,
  );
  // An earlier file's rows for the same days and campaigns are this one's to replace: exports overlap, and the latest
  // has the platform's final figures. One batch, so a file is on the figures whole or not at all.
  const replaced = [...new Set(sorted.map((row) => `${row.day}|${row.campaign}`))];
  await db.batch([
    db
      .prepare(
        `UPDATE spend_entries SET removed_by = ?1, removed_at = ?2
         WHERE source = 'csv' AND channel = ?3 AND removed_at IS NULL
           AND spent_date || '|' || campaign IN (SELECT value FROM json_each(?4))`,
      )
      .bind(change.actor.id, change.now.toISOString(), CHANNEL[change.platform], JSON.stringify(replaced)),
    ...statements,
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "spend.import",
        subject: { kind: "spend", id: importId },
        requestId: change.requestId,
        detail: { platform: change.platform, rows: sorted.length },
      },
      change.now,
    ),
  ]);
  return sorted.length;
}
