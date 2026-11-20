// Each person's attribution (docs/decisions/0288-attribution-and-conversions.md): their first touch, set once and never
// moved; their last, the latest a campaign put something in; their channel, the first touch's unless a code of ours
// reached us before their first consultation was booked; and, kept apart, what they told ops when asked.

import { clientChannel, type ChannelCode, type TouchCode } from "../../policy/channels.ts";
import type { HeardFrom } from "../../policy/heard-from.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";

interface TouchRow {
  readonly id: string;
  readonly at: string;
  readonly channel: ChannelCode;
}

interface Kept {
  readonly first_touch_id: string | null;
  readonly settled_at: string | null;
}

const TOUCH = "SELECT id, at, channel FROM touches WHERE";

/** The codes that reached us for this person before `until`, or ever while it is null. */
async function codesBefore(db: D1Database, personId: string, until: string | null): Promise<Set<TouchCode>> {
  const by = until ?? "9999";
  const rows = await db
    .prepare(
      `SELECT code_kind AS code FROM touches WHERE person_id = ?1 AND code_kind IS NOT NULL AND at <= ?2
       UNION SELECT 'friend' FROM referral_attributions WHERE referred_person_id = ?1 AND first_touch_at <= ?2
       UNION SELECT 'partner' FROM channel_attributions WHERE referred_person_id = ?1 AND first_touch_at <= ?2`,
    )
    .bind(personId, by)
    .all<{ code: TouchCode }>();
  return new Set(rows.results.map((row) => row.code));
}

/**
 * Brings a person's attribution up to date with their touches: made with their earliest touch as the first where they
 * have none, the last touch and the channels worked out again. A person with no touch has none.
 */
export async function refreshAttribution(db: D1Database, personId: string, now: Date): Promise<void> {
  const kept = await db
    .prepare("SELECT first_touch_id, settled_at FROM person_attribution WHERE person_id = ?1")
    .bind(personId)
    .first<Kept>();
  const first =
    kept?.first_touch_id === null || kept === null
      ? await db.prepare(`${TOUCH} person_id = ?1 ORDER BY at, id LIMIT 1`).bind(personId).first<TouchRow>()
      : await db.prepare(`${TOUCH} id = ?1`).bind(kept.first_touch_id).first<TouchRow>();
  if (first === null) return;
  const last =
    (await db
      .prepare(`${TOUCH} person_id = ?1 AND campaign_signal = 1 ORDER BY at DESC, id DESC LIMIT 1`)
      .bind(personId)
      .first<TouchRow>()) ?? first;
  const settledAt = kept?.settled_at ?? null;
  const channel = clientChannel(first.channel, await codesBefore(db, personId, settledAt));
  await db
    .prepare(
      `INSERT INTO person_attribution (person_id, first_touch_id, last_touch_id, attributed_channel,
         last_touch_channel, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (person_id) DO UPDATE SET
         first_touch_id = COALESCE(person_attribution.first_touch_id, excluded.first_touch_id),
         last_touch_id = excluded.last_touch_id, attributed_channel = excluded.attributed_channel,
         last_touch_channel = excluded.last_touch_channel, updated_at = excluded.updated_at`,
    )
    .bind(personId, first.id, last.id, channel, last.channel, now.toISOString())
    .run();
}

/** Fixes the channel from the person's first consultation's booking on: codes that come after it change nothing. */
export async function settleAttribution(db: D1Database, personId: string, bookedAt: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE person_attribution SET settled_at = ?2 WHERE person_id = ?1 AND settled_at IS NULL")
    .bind(personId, bookedAt)
    .run();
  await refreshAttribution(db, personId, now);
}

/** The person's channels as they stand: Direct for a person no touch names. */
export async function channelsOf(
  db: D1Database,
  personId: string,
): Promise<{ readonly attributed: ChannelCode; readonly lastTouch: ChannelCode }> {
  const row = await db
    .prepare("SELECT attributed_channel, last_touch_channel FROM person_attribution WHERE person_id = ?1")
    .bind(personId)
    .first<{ attributed_channel: ChannelCode; last_touch_channel: ChannelCode }>();
  return { attributed: row?.attributed_channel ?? "direct", lastTouch: row?.last_touch_channel ?? "direct" };
}

/** Records what the client told ops of how they heard of us, audited, beside their channel or before they have one. */
export async function setHeardFrom(
  db: D1Database,
  change: {
    readonly personId: string;
    readonly heardFrom: HeardFrom;
    readonly other: string | null;
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<void> {
  const at = change.now.toISOString();
  const other = change.heardFrom === "other" ? change.other : null;
  await db.batch([
    db
      .prepare(
        `INSERT INTO person_attribution (person_id, heard_from, heard_from_other, heard_from_by, heard_from_at,
           updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT (person_id) DO UPDATE SET heard_from = excluded.heard_from,
           heard_from_other = excluded.heard_from_other, heard_from_by = excluded.heard_from_by,
           heard_from_at = excluded.heard_from_at, updated_at = excluded.updated_at`,
      )
      .bind(change.personId, change.heardFrom, other, change.actor.id, at),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "client.heard_from",
        subject: { kind: "person", id: change.personId },
        requestId: change.requestId,
        detail: { heard_from: change.heardFrom },
      },
      change.now,
    ),
  ]);
}
