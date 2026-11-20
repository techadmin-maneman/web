// Each person's attribution (docs/decisions/0288-attribution-and-conversions.md): their first touch, set once and never
// moved; their last, the latest a campaign put something in; their channel, the first touch's unless a code of ours
// reached us before their first consultation was booked; and, kept apart, what they told ops when asked.

import { clientChannel, type ChannelCode, type TouchCode, type TouchVia } from "../../policy/channels.ts";
import type { HeardFrom } from "../../policy/heard-from.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";

interface TouchRow {
  readonly id: string;
  readonly at: string;
  readonly channel: ChannelCode;
}

/** The person's first touch: the one kept, else their earliest, ties going to the one written first. */
const FIRST_TOUCH = `SELECT id, at, channel FROM touches WHERE id = COALESCE(
    (SELECT first_touch_id FROM person_attribution WHERE person_id = ?1),
    (SELECT id FROM touches WHERE person_id = ?1 ORDER BY at, rowid LIMIT 1))`;
const LAST_TOUCH = `SELECT id, at, channel FROM touches WHERE person_id = ?1 AND campaign_signal = 1
  ORDER BY at DESC, rowid DESC LIMIT 1`;
/** The codes that reached us for the person before their first consultation was booked, or ever until it is. */
const CODES_BEFORE = `SELECT code_kind AS code FROM touches WHERE person_id = ?1 AND code_kind IS NOT NULL
    AND at <= COALESCE((SELECT settled_at FROM person_attribution WHERE person_id = ?1), '9999')
  UNION SELECT 'friend' FROM referral_attributions WHERE referred_person_id = ?1
    AND first_touch_at <= COALESCE((SELECT settled_at FROM person_attribution WHERE person_id = ?1), '9999')
  UNION SELECT 'partner' FROM channel_attributions WHERE referred_person_id = ?1
    AND first_touch_at <= COALESCE((SELECT settled_at FROM person_attribution WHERE person_id = ?1), '9999')`;

/**
 * Runs `writes`, then brings the person's attribution up to date with their touches as the writes left them: made with
 * their earliest touch as the first where they have none, the last touch and the channels worked out again. Two round
 * trips: the writes with the reads after them in one batch, then the attribution. A person with no touch has none.
 */
export async function withAttribution(
  db: D1Database,
  personId: string,
  writes: readonly D1PreparedStatement[],
  now: Date,
): Promise<void> {
  const reads = await db.batch([
    ...writes,
    db.prepare(FIRST_TOUCH).bind(personId),
    db.prepare(LAST_TOUCH).bind(personId),
    db.prepare(CODES_BEFORE).bind(personId),
  ]);
  const [firstRead, lastRead, codesRead] = reads.slice(writes.length);
  const first = (firstRead?.results[0] as TouchRow | undefined) ?? null;
  if (first === null) return;
  const last = (lastRead?.results[0] as TouchRow | undefined) ?? first;
  const codes = new Set((codesRead?.results ?? []).map((row) => (row as { code: TouchCode }).code));
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
    .bind(personId, first.id, last.id, clientChannel(first.channel, codes), last.channel, now.toISOString())
    .run();
}

/** Brings a person's attribution up to date with their touches. */
export const refreshAttribution = (db: D1Database, personId: string, now: Date): Promise<void> =>
  withAttribution(db, personId, [], now);

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

/** Each platform's waiting sends of one client, let go. */
const LET_GO_META = `UPDATE conversions SET meta_state = 'skipped', meta_error = 'sharing_stopped',
    meta_next_at = NULL
  WHERE person_id = ?1 AND meta_state = 'pending'`;
const LET_GO_GOOGLE = `UPDATE conversions SET google_state = 'skipped', google_error = 'sharing_stopped',
    google_next_at = NULL
  WHERE person_id = ?1 AND google_state = 'pending'`;

/**
 * Stops anything more of the client's going to Google or Meta, as they asked: recorded with who took the request, and
 * each conversion of theirs still waiting let go. Audited.
 */
export async function stopSharing(
  db: D1Database,
  change: { readonly personId: string; readonly actor: AuditActor; readonly requestId: string; readonly now: Date },
): Promise<void> {
  const at = change.now.toISOString();
  const letGo = (platform: "meta" | "google") =>
    (platform === "meta" ? db.prepare(LET_GO_META) : db.prepare(LET_GO_GOOGLE)).bind(change.personId);
  await db.batch([
    db
      .prepare(
        `INSERT INTO person_attribution (person_id, sharing_stopped_at, sharing_stopped_by, updated_at)
         VALUES (?1, ?2, ?3, ?2)
         ON CONFLICT (person_id) DO UPDATE SET sharing_stopped_at = COALESCE(person_attribution.sharing_stopped_at,
           excluded.sharing_stopped_at), sharing_stopped_by = COALESCE(person_attribution.sharing_stopped_by,
           excluded.sharing_stopped_by), updated_at = excluded.updated_at`,
      )
      .bind(change.personId, at, change.actor.id),
    letGo("meta"),
    letGo("google"),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "client.sharing_stop",
        subject: { kind: "person", id: change.personId },
        requestId: change.requestId,
      },
      change.now,
    ),
  ]);
}

/** A touch as the client's page shows it. */
export interface TouchShown {
  readonly at: string;
  readonly via: TouchVia;
  readonly channel: ChannelCode;
  readonly utm_source: string | null;
  readonly utm_medium: string | null;
  readonly utm_campaign: string | null;
  readonly landing_path: string | null;
  readonly referrer: string | null;
  readonly link_name: string | null;
}

export interface ClientAttribution {
  readonly attributed_channel: ChannelCode | null;
  readonly last_touch_channel: ChannelCode | null;
  readonly first_touch: TouchShown | null;
  readonly last_touch: TouchShown | null;
  readonly touches: number;
  readonly heard_from: HeardFrom | null;
  readonly heard_from_other: string | null;
  readonly heard_from_at: string | null;
  readonly sharing_stopped_at: string | null;
}

const SHOWN = `SELECT t.at, t.via, t.channel, t.utm_source, t.utm_medium, t.utm_campaign, t.landing_path, t.referrer,
    (SELECT l.name FROM campaign_links l WHERE l.id = t.link_id) AS link_name
  FROM touches t WHERE t.id = ?1`;

/** How the client found us, as their page shows it: null for a client we hold nothing of. */
export async function clientAttribution(db: D1Database, personId: string): Promise<ClientAttribution | null> {
  const row = await db
    .prepare(
      `SELECT first_touch_id, last_touch_id, attributed_channel, last_touch_channel, heard_from, heard_from_other,
         heard_from_at, sharing_stopped_at,
         (SELECT COUNT(*) FROM touches t WHERE t.person_id = ?1) AS touches
       FROM person_attribution WHERE person_id = ?1`,
    )
    .bind(personId)
    .first<
      Omit<ClientAttribution, "first_touch" | "last_touch"> & {
        first_touch_id: string | null;
        last_touch_id: string | null;
      }
    >();
  if (row === null) return null;
  const touchOf = (id: string | null) =>
    id === null ? Promise.resolve(null) : db.prepare(SHOWN).bind(id).first<TouchShown>();
  const [first, last] = await Promise.all([touchOf(row.first_touch_id), touchOf(row.last_touch_id)]);
  const { first_touch_id: _first, last_touch_id: _last, ...rest } = row;
  return { ...rest, first_touch: first, last_touch: last };
}
