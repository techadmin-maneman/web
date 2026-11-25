// The steps from lead to fitted by channel, Growth › Funnel's second table (docs/decisions/0324-the-weekly-dashboard.md):
// for a week or a month, the clients fitted then and their tiers; the consultations closed as a no-show then; the middle
// first reply, in Care hours, to the first message of the clients whose first lead came then (one who never wrote has
// none), and how many of them have been fitted since;
// and the reasons the leads lost then were lost for, commonest first. A channel is the client's, or their last touch's
// as it stands. Records marked as tests are left out.

import { tierOf } from "../../config/visit-types.ts";
import { careMinutesBetween, type CareHours } from "../../policy/care-hours.ts";
import { CHANNELS, type ChannelCode } from "../../policy/channels.ts";
import { AUTO_REPLY } from "../care/after-hours.ts";
import { jobSheet } from "../field/job-sheet-settings.ts";
import type { ChannelBy } from "./acquisition.ts";

export interface Steps {
  /** Clients whose first fit was done in the period: the lead's fitted stage (docs/decisions/0320-lead-stages.md). */
  readonly fitted: number;
  /** Consultations in the period the technician closed as a no-show. */
  readonly no_shows: number;
  /** Of the clients whose first lead came in the period, those fitted since. */
  readonly leads_fitted: number;
  /** The middle wait from those clients' first message to Care's reply, in Care hours' minutes; null with none. */
  readonly first_reply_minutes: number | null;
  /** The tiers of the clients fitted, the most first. */
  readonly tiers: readonly { readonly tier: string; readonly clients: number }[];
  /** Why the leads lost in the period were lost, in the job sheet's words, the commonest three. */
  readonly lost: readonly { readonly reason: string; readonly clients: number }[];
}

interface Range {
  readonly from: string;
  readonly to: string;
}

/** A client's first fit done, when, and its tier, for every client fitted. */
const FIRST_FITS = `SELECT a.person_id, MIN(a.window_start) AS at,
    (SELECT ${tierOf("x.tier")} FROM appointments x WHERE x.person_id = a.person_id AND x.deleted_at IS NULL
       AND x.status = 'completed' AND (x.type = 'first_fit' OR (x.type = 'consultation' AND x.one_visit = 'fitted'))
     ORDER BY x.window_start LIMIT 1) AS tier
  FROM appointments a
 WHERE a.deleted_at IS NULL AND a.status = 'completed' AND a.window_start IS NOT NULL
   AND (a.type = 'first_fit' OR (a.type = 'consultation' AND a.one_visit = 'fitted'))
 GROUP BY a.person_id`;

/** Each client's first lead, when it came. */
const FIRST_LEADS = "SELECT person_id, MIN(created_at) AS first_at FROM leads GROUP BY person_id";

const channelOf = (by: ChannelBy) => (by === "first" ? "pa.attributed_channel" : "pa.last_touch_channel");

const known = (code: string | null): ChannelCode => CHANNELS.find((each) => each.code === code)?.code ?? "direct";

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
};

/** Counts of things, the most first, as many as `most`. */
function commonest<T extends string>(counts: ReadonlyMap<T, number>, most: number) {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, most);
}

/** The rows the steps are counted from, each with the client's channel by `by`. */
function readSteps(db: D1Database, range: Range, by: ChannelBy) {
  const channel = channelOf(by);
  return Promise.all([
    db
      .prepare(
        `SELECT ${channel} AS channel, f.tier FROM (${FIRST_FITS}) f JOIN people p ON p.id = f.person_id
           LEFT JOIN person_attribution pa ON pa.person_id = f.person_id
          WHERE p.test_record = 0 AND f.at >= ?1 AND f.at < ?2`,
      )
      .bind(range.from, range.to)
      .all<{ channel: string | null; tier: string }>(),
    db
      .prepare(
        `SELECT ${channel} AS channel, COUNT(DISTINCT a.id) AS n FROM no_show_cases n
           JOIN appointments a ON a.id = n.appointment_id JOIN people p ON p.id = a.person_id
           LEFT JOIN person_attribution pa ON pa.person_id = a.person_id
          WHERE p.test_record = 0 AND n.closed_at IS NOT NULL AND a.type = 'consultation'
            AND a.window_start >= ?1 AND a.window_start < ?2
          GROUP BY 1`,
      )
      .bind(range.from, range.to)
      .all<{ channel: string | null; n: number }>(),
    db
      .prepare(
        `SELECT ${channel} AS channel, w.wrote_at,
           (SELECT MIN(m.sent_at) FROM conversations c JOIN chat_messages m ON m.conversation_id = c.id
             WHERE c.person_id = l.person_id AND m.sent_at >= w.wrote_at AND m.direction = 'out'
               AND m.author NOT IN ('system', 'client', ?3) AND COALESCE(m.delivery, 'sent') = 'sent') AS replied_at,
           EXISTS (SELECT 1 FROM (${FIRST_FITS}) f WHERE f.person_id = l.person_id) AS fitted
          FROM (${FIRST_LEADS}) l JOIN people p ON p.id = l.person_id
          LEFT JOIN person_attribution pa ON pa.person_id = l.person_id
          LEFT JOIN (SELECT c.person_id, MIN(i.sent_at) AS wrote_at FROM conversations c
            JOIN chat_messages i ON i.conversation_id = c.id WHERE i.direction = 'in' GROUP BY c.person_id) w
            ON w.person_id = l.person_id
         WHERE p.test_record = 0 AND l.first_at >= ?1 AND l.first_at < ?2`,
      )
      .bind(range.from, range.to, AUTO_REPLY)
      .all<{ channel: string | null; wrote_at: string | null; replied_at: string | null; fitted: number }>(),
    db
      .prepare(
        `SELECT ${channel} AS channel, pa.lost_reason AS reason, COUNT(*) AS n FROM person_attribution pa
           JOIN people p ON p.id = pa.person_id
          WHERE p.test_record = 0 AND pa.lost_reason IS NOT NULL AND pa.lost_at >= ?1 AND pa.lost_at < ?2
          GROUP BY 1, 2`,
      )
      .bind(range.from, range.to)
      .all<{ channel: string | null; reason: string; n: number }>(),
    jobSheet(db),
  ]);
}

interface Tally {
  fitted: number;
  no_shows: number;
  leads_fitted: number;
  replies: number[];
  tiers: Map<string, number>;
  lost: Map<string, number>;
}

const fresh = (): Tally => ({
  fitted: 0,
  no_shows: 0,
  leads_fitted: 0,
  replies: [],
  tiers: new Map(),
  lost: new Map(),
});

const bump = (counts: Map<string, number>, key: string, by = 1) => counts.set(key, (counts.get(key) ?? 0) + by);

const stepsOf = (tally: Tally): Steps => ({
  fitted: tally.fitted,
  no_shows: tally.no_shows,
  leads_fitted: tally.leads_fitted,
  first_reply_minutes: median(tally.replies),
  tiers: commonest(tally.tiers, tally.tiers.size).map(([tier, clients]) => ({ tier, clients })),
  lost: commonest(tally.lost, 3).map(([reason, clients]) => ({ reason, clients })),
});

/** The steps for [from, to), each channel's and the total's. */
export async function funnelSteps(
  db: D1Database,
  range: Range,
  { by, hours }: { readonly by: ChannelBy; readonly hours: CareHours },
): Promise<{ readonly byChannel: ReadonlyMap<ChannelCode, Steps>; readonly total: Steps }> {
  const [fits, noShows, leads, lost, sheet] = await readSteps(db, range, by);
  const { items, retired } = sheet.lostReasons;
  const words = new Map([...retired, ...items].map((item) => [item.id, item.label]));
  const tallies = new Map<ChannelCode, Tally>();
  const total = fresh();
  const each = (code: string | null, add: (tally: Tally) => void) => {
    const key = known(code);
    const tally = tallies.get(key) ?? fresh();
    tallies.set(key, tally);
    add(tally);
    add(total);
  };
  for (const row of fits.results) {
    each(row.channel, (tally) => {
      tally.fitted += 1;
      bump(tally.tiers, row.tier);
    });
  }
  for (const row of noShows.results) each(row.channel, (tally) => (tally.no_shows += row.n));
  for (const row of leads.results) {
    const waited =
      row.wrote_at === null || row.replied_at === null
        ? null
        : careMinutesBetween(new Date(row.wrote_at), new Date(row.replied_at), hours);
    each(row.channel, (tally) => {
      if (row.fitted === 1) tally.leads_fitted += 1;
      if (waited !== null) tally.replies.push(waited);
    });
  }
  for (const row of lost.results) {
    each(row.channel, (tally) => bump(tally.lost, words.get(row.reason) ?? row.reason, row.n));
  }
  return { byChannel: new Map([...tallies].map(([code, tally]) => [code, stepsOf(tally)])), total: stepsOf(total) };
}
