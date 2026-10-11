// The Care numbers (docs/decisions/0144-care-numbers.md): whether the same-day promise holds, over a period. How soon
// a chat opened in it was first answered, counted in Care hours, and the share within the reply target; the share
// closed the day it opened; the backlog now; what chats were about; and the remedies given. Each by Care person too.

import { careMinutesBetween, replyBy, type CareHours } from "../../policy/care-hours.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { AUTO_REPLY } from "./after-hours.ts";

interface Replies {
  readonly chats: number;
  /** The middle first reply, in Care-hours minutes; null with none answered. */
  readonly median_minutes: number | null;
  /** The share of chats answered within the reply target, 0 to 1; null with none. */
  readonly within_target: number | null;
}

export interface CareNumbers {
  /** India's dates, both included. */
  readonly from: string;
  readonly to: string;
  readonly replies: Replies;
  /** The share of chats closed the India day they opened, 0 to 1; null with none. */
  readonly same_day: number | null;
  readonly backlog: { readonly waiting_on_us: number; readonly overdue: number; readonly waiting_on_client: number };
  readonly reasons: { readonly reason: string; readonly chats: number }[];
  readonly remedies: { readonly reason: string; readonly remedies: number; readonly visits: number }[];
  readonly by_person: (Replies & { readonly email: string })[];
}

interface ChatRow {
  readonly opened_at: string;
  readonly closed_at: string | null;
  readonly close_reason: string | null;
  readonly owner: string | null;
  readonly first_reply_at: string | null;
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((one, other) => one - other);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
};

const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

function repliesOf(chats: readonly ChatRow[], hours: CareHours): Replies {
  const waits = chats.flatMap((chat) =>
    chat.first_reply_at === null
      ? []
      : [careMinutesBetween(new Date(chat.opened_at), new Date(chat.first_reply_at), hours)],
  );
  const onTime = chats.filter(
    (chat) =>
      chat.first_reply_at !== null && chat.first_reply_at <= replyBy(new Date(chat.opened_at), hours).toISOString(),
  );
  return { chats: chats.length, median_minutes: median(waits), within_target: share(onTime.length, chats.length) };
}

function countBy<T>(rows: readonly T[], keyOf: (row: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key !== null) groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

/** The numbers over the `days` India days to `now`'s, both included. */
export async function careNumbers(db: D1Database, days: number, hours: CareHours, now: Date): Promise<CareNumbers> {
  const to = indiaDate(now);
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();
  const [chatRows, openRows, remedyRows] = await db.batch([
    db
      .prepare(
        `SELECT c.opened_at, c.closed_at, c.close_reason, o.email AS owner,
           (SELECT MIN(m.sent_at) FROM chat_messages m WHERE m.conversation_id = c.id AND m.direction = 'out'
              AND m.author <> ?2 AND m.sent_at >= c.opened_at) AS first_reply_at
         FROM conversations c LEFT JOIN care_owners o ON o.person_id = c.person_id
         WHERE c.opened_at >= ?1`,
      )
      .bind(since, AUTO_REPLY),
    db.prepare("SELECT state, last_inbound_at FROM conversations WHERE state IN ('open', 'waiting')"),
    db
      .prepare(
        `SELECT reason, COUNT(*) AS remedies, SUM(visits) AS visits FROM remedies
         WHERE given_at >= ?1 AND state = 'given' GROUP BY reason ORDER BY remedies DESC`,
      )
      .bind(since),
  ]);
  const chats = (chatRows?.results ?? []) as ChatRow[];
  const open = (openRows?.results ?? []) as { state: string; last_inbound_at: string | null }[];
  const waiting = open.filter((chat) => chat.state === "open");
  const closedSameDay = chats.filter(
    (chat) => chat.closed_at !== null && indiaDate(new Date(chat.closed_at)) === indiaDate(new Date(chat.opened_at)),
  );
  return {
    from: indiaDate(new Date(since)),
    to,
    replies: repliesOf(chats, hours),
    same_day: share(closedSameDay.length, chats.length),
    backlog: {
      waiting_on_us: waiting.length,
      overdue: waiting.filter(
        (chat) => chat.last_inbound_at !== null && replyBy(new Date(chat.last_inbound_at), hours) < now,
      ).length,
      waiting_on_client: open.length - waiting.length,
    },
    reasons: [...countBy(chats, (chat) => chat.close_reason)]
      .map(([reason, rows]) => ({ reason, chats: rows.length }))
      .sort((one, other) => other.chats - one.chats),
    remedies: (remedyRows?.results ?? []) as CareNumbers["remedies"],
    by_person: [...countBy(chats, (chat) => chat.owner)]
      .map(([email, rows]) => ({ email, ...repliesOf(rows, hours) }))
      .sort((one, other) => other.chats - one.chats),
  };
}
