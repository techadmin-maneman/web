// The Care inbox (docs/decisions/0129-the-care-inbox.md): one thread for each number that writes to us, matched to
// its client where we know the number, and every message in it. A client who writes reopens their thread. A thread
// reads our automatic messages from outbound_messages beside the chat, so nothing is copied.

import { replyBy, type CareHours } from "../../policy/care-hours.ts";
import { AUTO_REPLY } from "./after-hours.ts";
import { giveCarePerson } from "./care-people.ts";

/** A message a client wrote to our number, as the bridge or MSG91 reports it. */
export interface Inbound {
  readonly mobileE164: string;
  readonly text: string;
  /** WhatsApp's ID for it: a message reported twice is filed once. */
  readonly providerMessageId: string | null;
  readonly at: Date;
}

/**
 * Files a client's message in their thread, opening the thread or reopening it; once, however often it is reported.
 * A client with no Care person yet is given one (./care-people.ts).
 */
export async function fileInbound(db: D1Database, inbound: Inbound): Promise<void> {
  const at = inbound.at.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, last_inbound_at,
           created_at, updated_at)
         VALUES (?1, (SELECT id FROM people WHERE mobile_e164 = ?2 AND erased_at IS NULL), ?2, 'open', ?3, ?3, ?3, ?3, ?3)
         ON CONFLICT (mobile_e164) DO UPDATE SET
           person_id = COALESCE(conversations.person_id, excluded.person_id),
           state = 'open',
           opened_at = CASE WHEN conversations.state = 'closed' THEN excluded.opened_at ELSE conversations.opened_at END,
           closed_at = NULL,
           closed_by = NULL,
           last_message_at = MAX(conversations.last_message_at, excluded.last_message_at),
           last_inbound_at = excluded.last_inbound_at,
           updated_at = excluded.updated_at`,
      )
      .bind(crypto.randomUUID(), inbound.mobileE164, at),
    db
      .prepare(
        `INSERT INTO chat_messages (id, conversation_id, direction, author, text, provider_message_id, sent_at,
           created_at)
         SELECT ?1, id, 'in', 'client', ?3, ?4, ?5, ?5 FROM conversations WHERE mobile_e164 = ?2
         ON CONFLICT DO NOTHING`,
      )
      .bind(crypto.randomUUID(), inbound.mobileE164, inbound.text, inbound.providerMessageId, at),
  ]);
  const filed = await db
    .prepare("SELECT person_id FROM conversations WHERE mobile_e164 = ?1")
    .bind(inbound.mobileE164)
    .first<{ person_id: string | null }>();
  if (filed !== null && filed.person_id !== null) await giveCarePerson(db, filed.person_id, inbound.at);
}

export const INBOX_VIEWS = ["mine", "open", "waiting", "closed", "all"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

/** How many threads a view lists, newest first. */
const LISTED = 200;

export interface ConversationRow {
  readonly id: string;
  readonly person: { readonly id: string; readonly name: string } | null;
  readonly mobile: string;
  readonly state: "open" | "waiting" | "closed";
  /** The client's Care person, by e-mail; null for a number we don't know, or a client not given one. */
  readonly care_person: string | null;
  /** Who covers the Care person today, while they are off (src/domain/care/cover.ts); null while they are on. */
  readonly covered_by: string | null;
  /** One of our technicians, by their number on record; Operations answer them. Null for anyone else. */
  readonly technician: { readonly id: string; readonly name: string } | null;
  readonly last_message_at: string;
  /** The last thing said in the chat, ours or theirs; null where only our automatic messages went. */
  readonly last_line: string | null;
  /** When the client last wrote, unanswered since; null when nothing waits on us. */
  readonly waiting_since: string | null;
  /** When our reply is due, by the Care hours (src/policy/care-hours.ts); null when nothing waits on us. */
  readonly reply_by: string | null;
}

interface ListRow {
  readonly id: string;
  readonly person_id: string | null;
  readonly name: string | null;
  readonly mobile_e164: string;
  readonly state: ConversationRow["state"];
  readonly care_person: string | null;
  readonly technician_id: string | null;
  readonly technician_name: string | null;
  readonly last_message_at: string;
  readonly last_inbound_at: string | null;
  readonly last_line: string | null;
  readonly last_reply_at: string | null;
}

/** When the client last wrote, unanswered since; null when nothing waits on us. */
const waitingSince = (row: ListRow): string | null =>
  row.state === "open" && row.last_inbound_at !== null && (row.last_reply_at ?? "") < row.last_inbound_at
    ? row.last_inbound_at
    : null;

/** What the inbox reads each chat against: the Care hours, and who covers whom today. */
export interface InboxContext {
  readonly hours: CareHours;
  readonly cover: ReadonlyMap<string, string>;
}

function rowOf(row: ListRow, { hours, cover }: InboxContext): ConversationRow {
  const since = waitingSince(row);
  return {
    id: row.id,
    person: row.person_id === null ? null : { id: row.person_id, name: row.name ?? "" },
    mobile: row.mobile_e164,
    state: row.state,
    care_person: row.care_person,
    covered_by: row.care_person === null ? null : (cover.get(row.care_person) ?? null),
    technician: row.technician_id === null ? null : { id: row.technician_id, name: row.technician_name ?? "" },
    last_message_at: row.last_message_at,
    last_line: row.last_line,
    waiting_since: since,
    reply_by: since === null ? null : replyBy(new Date(since), hours).toISOString(),
  };
}

/**
 * The threads of a view, the latest first; "mine" is the open and waiting threads of `me`'s clients, and of the clients
 * of whoever `me` covers today.
 */
export async function listConversations(
  db: D1Database,
  view: InboxView,
  me: string,
  context: InboxContext,
): Promise<ConversationRow[]> {
  const covered = [...context.cover].filter(([, by]) => by === me).map(([off]) => off);
  const { results } = await db
    .prepare(
      `SELECT c.id, c.person_id, p.name, c.mobile_e164, c.state, o.email AS care_person, t.id AS technician_id,
         t.name AS technician_name, c.last_message_at,
         c.last_inbound_at,
         (SELECT m.text FROM chat_messages m WHERE m.conversation_id = c.id AND m.direction <> 'note'
            AND m.author <> ?4 ORDER BY m.sent_at DESC LIMIT 1) AS last_line,
         (SELECT MAX(m.sent_at) FROM chat_messages m WHERE m.conversation_id = c.id AND m.direction = 'out'
            AND m.author <> ?4) AS last_reply_at
       FROM conversations c LEFT JOIN people p ON p.id = c.person_id LEFT JOIN care_owners o ON o.person_id = c.person_id
         LEFT JOIN technicians t ON t.mobile_e164 = c.mobile_e164 AND t.active = 1
       WHERE ?1 = 'all' OR c.state = ?1 OR (?1 = 'mine' AND o.email IN (SELECT value FROM json_each(?3)) AND c.state <> 'closed')
       ORDER BY c.last_message_at DESC LIMIT ?2`,
    )
    .bind(view, LISTED, JSON.stringify([me, ...covered]), AUTO_REPLY)
    .all<ListRow>();
  return results.map((row) => rowOf(row, context));
}

/** One entry of a thread: a chat message, or one of our automatic messages to the client. */
type ThreadItem =
  | {
      readonly kind: "in" | "out" | "note";
      readonly at: string;
      readonly author: string;
      readonly text: string | null;
      /** For a reply: sent, or failed; null for the client's messages and notes. */
      readonly delivery: "sent" | "failed" | null;
    }
  | {
      readonly kind: "auto";
      readonly at: string;
      /** The message's kind, as outbound_messages names it: "visit_reminder". */
      readonly message: string;
      readonly state: string;
      readonly delivered_at: string | null;
      readonly read_at: string | null;
    };

export interface Thread {
  readonly conversation: ConversationRow;
  readonly items: ThreadItem[];
}

/** How far back a thread reads, so a long-standing client's opens quickly. */
const THREAD_ITEMS = 300;

/** A thread with its chat and our automatic messages to the client, in order; null for one we do not have. */
export async function conversationThread(db: D1Database, id: string, context: InboxContext): Promise<Thread | null> {
  const row = await db
    .prepare(
      `SELECT c.id, c.person_id, p.name, c.mobile_e164, c.state, o.email AS care_person, t.id AS technician_id,
         t.name AS technician_name, c.last_message_at,
         c.last_inbound_at, NULL AS last_line,
         (SELECT MAX(m.sent_at) FROM chat_messages m WHERE m.conversation_id = c.id AND m.direction = 'out'
            AND m.author <> ?2) AS last_reply_at
       FROM conversations c LEFT JOIN people p ON p.id = c.person_id LEFT JOIN care_owners o ON o.person_id = c.person_id
         LEFT JOIN technicians t ON t.mobile_e164 = c.mobile_e164 AND t.active = 1
       WHERE c.id = ?1`,
    )
    .bind(id, AUTO_REPLY)
    .first<ListRow>();
  if (row === null) return null;
  const [chat, auto] = await db.batch([
    db
      .prepare(
        `SELECT direction AS kind, sent_at AS at, author, text, delivery FROM chat_messages WHERE conversation_id = ?1
         ORDER BY sent_at DESC LIMIT ?2`,
      )
      .bind(id, THREAD_ITEMS),
    db
      .prepare(
        `SELECT 'auto' AS kind, COALESCE(sent_at, queued_at) AS at, kind AS message, state, delivered_at, read_at
         FROM outbound_messages WHERE person_id = ?1 AND state IN ('sent', 'queued')
         ORDER BY created_at DESC LIMIT ?2`,
      )
      .bind(row.person_id, THREAD_ITEMS),
  ]);
  const items = [...((chat?.results ?? []) as ThreadItem[]), ...((auto?.results ?? []) as ThreadItem[])]
    .sort((one, other) => one.at.localeCompare(other.at))
    .slice(-THREAD_ITEMS);
  return { conversation: rowOf({ ...row, last_line: null }, context), items };
}
