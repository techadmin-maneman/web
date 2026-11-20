// The console's acquisition figures (docs/decisions/0288-attribution-and-conversions.md), from our own rows alone, never
// a platform's: for a week or a month, by channel, the spend; the clients whose first lead came then; the consultations
// booked and done, and the first fits paid, then; and the first fits' revenue, before GST and less what was refunded.
// A channel is the client's (their first touch's, or a code's that came before booking) or their last touch's when
// each thing happened. Beside them: each cohort fitted in the period, by what they paid within 30, 90 and 180 days of
// their first fit; and, of the clients whose consultation was done then, what they told ops against the channel the
// rule gives. Records marked as tests are left out.

import { CHANNELS, type ChannelCode } from "../../policy/channels.ts";

export type ChannelBy = "first" | "last";

interface Figures {
  readonly spend: number;
  readonly leads: number;
  readonly consults_booked: number;
  readonly consults_done: number;
  readonly first_fits: number;
  /** Paise, before GST, less refunds. */
  readonly first_fit_revenue: number;
}

export interface Acquisition {
  readonly rows: readonly ({ readonly channel: ChannelCode } & Figures)[];
  readonly totals: Figures;
  /** Each cohort fitted in the period, by channel: what they paid, in paise before GST, within each span. */
  readonly cohorts: readonly {
    readonly channel: ChannelCode;
    readonly clients: number;
    readonly d30: number;
    readonly d90: number;
    readonly d180: number;
  }[];
  /** Whether every client in the cohorts has had each span in full yet. */
  readonly cohort_complete: { readonly d30: boolean; readonly d90: boolean; readonly d180: boolean };
  /** What the clients consulted in the period told ops, against the channel the rule gives them. */
  readonly heard: readonly { readonly heard_from: string; readonly channel: ChannelCode; readonly clients: number }[];
  readonly tryons: number;
}

const NONE: Figures = { spend: 0, leads: 0, consults_booked: 0, consults_done: 0, first_fits: 0, first_fit_revenue: 0 };

/** What a payment brought in: before GST, less what was refunded of it. */
const NET = "COALESCE(y.amount_ex_gst, y.amount) * (y.amount - y.refunded_amount) / y.amount";

const known = (code: string | null): ChannelCode => {
  const found = CHANNELS.find((each) => each.code === code);
  return found === undefined ? "direct" : found.code;
};

interface Range {
  readonly from: string;
  readonly to: string;
  readonly fromDate: string;
  readonly toDate: string;
}

/** The clients whose first lead came in the range, by channel. */
async function leadsIn(db: D1Database, range: Range, by: ChannelBy) {
  const channel =
    by === "first"
      ? "(SELECT a.attributed_channel FROM person_attribution a WHERE a.person_id = f.person_id)"
      : `(SELECT t.channel FROM leads l JOIN touches t ON t.id = l.touch_id WHERE l.person_id = f.person_id
           ORDER BY l.created_at LIMIT 1)`;
  const { results } = await db
    .prepare(
      `SELECT ${channel} AS channel, COUNT(*) AS n FROM (
         SELECT l.person_id, MIN(l.created_at) AS first_at FROM leads l JOIN people p ON p.id = l.person_id
         WHERE p.test_record = 0 GROUP BY l.person_id) f
       WHERE f.first_at >= ?1 AND f.first_at < ?2 GROUP BY 1`,
    )
    .bind(range.from, range.to)
    .all<{ channel: string | null; n: number }>();
  return results;
}

/** Each milestone's count in the range, and first fits' revenue, by the channel recorded when it happened. */
async function milestonesIn(db: D1Database, range: Range, by: ChannelBy) {
  const channel = by === "first" ? "c.attributed_channel" : "c.last_touch_channel";
  const { results } = await db
    .prepare(
      `SELECT ${channel} AS channel, c.event, COUNT(DISTINCT c.person_id) AS n,
         COALESCE(SUM(CASE WHEN c.event = 'first_fit_paid' THEN
           (SELECT ${NET} FROM payments y WHERE y.id = c.subject_id) END), 0) AS revenue
       FROM conversions c JOIN people p ON p.id = c.person_id
       WHERE p.test_record = 0 AND c.event IN ('consult_booked', 'consult_done', 'first_fit_paid')
         AND c.occurred_at >= ?1 AND c.occurred_at < ?2
       GROUP BY 1, 2`,
    )
    .bind(range.from, range.to)
    .all<{ channel: string; event: string; n: number; revenue: number }>();
  return results;
}

/** Spend in the range, by channel: an entry made for a whole month counts on its first day. */
async function spendIn(db: D1Database, range: Range) {
  const { results } = await db
    .prepare(
      `SELECT channel, SUM(amount) AS spend FROM spend_entries
       WHERE removed_at IS NULL AND COALESCE(spent_date, month || '-01') >= ?1
         AND COALESCE(spent_date, month || '-01') < ?2
       GROUP BY channel`,
    )
    .bind(range.fromDate, range.toDate)
    .all<{ channel: string; spend: number }>();
  return results;
}

const SPANS = [30, 90, 180] as const;

/** The clients first fitted in the range, by channel, with what each paid within each span of their first fit. */
async function cohortsIn(db: D1Database, range: Range, by: ChannelBy) {
  const channel = by === "first" ? "c.attributed_channel" : "c.last_touch_channel";
  const within = (days: number) =>
    `(SELECT COALESCE(SUM(${NET}), 0) FROM payments y WHERE y.person_id = c.person_id AND y.captured_at IS NOT NULL
       AND y.captured_at >= c.occurred_at
       AND y.captured_at < strftime('%Y-%m-%dT%H:%M:%fZ', c.occurred_at, '+${String(days)} days'))`;
  const { results } = await db
    .prepare(
      `SELECT ${channel} AS channel, c.occurred_at, ${SPANS.map((days) => `${within(days)} AS d${String(days)}`).join(", ")}
       FROM conversions c JOIN people p ON p.id = c.person_id
       WHERE p.test_record = 0 AND c.event = 'first_fit_paid' AND c.occurred_at >= ?1 AND c.occurred_at < ?2
         AND c.occurred_at = (SELECT MIN(x.occurred_at) FROM conversions x
           WHERE x.person_id = c.person_id AND x.event = 'first_fit_paid')`,
    )
    .bind(range.from, range.to)
    .all<{ channel: string; occurred_at: string; d30: number; d90: number; d180: number }>();
  return results;
}

/** What the clients consulted in the range told ops, against their channel by the rule. */
async function heardIn(db: D1Database, range: Range) {
  const { results } = await db
    .prepare(
      `SELECT COALESCE(a.heard_from, 'not_asked') AS heard_from, COALESCE(a.attributed_channel, 'direct') AS channel,
         COUNT(DISTINCT c.person_id) AS clients
       FROM conversions c JOIN people p ON p.id = c.person_id LEFT JOIN person_attribution a ON a.person_id = c.person_id
       WHERE p.test_record = 0 AND c.event = 'consult_done' AND c.occurred_at >= ?1 AND c.occurred_at < ?2
       GROUP BY 1, 2`,
    )
    .bind(range.from, range.to)
    .all<{ heard_from: string; channel: string; clients: number }>();
  return results;
}

const tryonsIn = (db: D1Database, range: Range) =>
  db
    .prepare(
      "SELECT COUNT(*) AS n FROM tryon_jobs WHERE parent_job_id IS NULL AND created_at >= ?1 AND created_at < ?2",
    )
    .bind(range.from, range.to)
    .first<number>("n");

const EVENT_FIELD = {
  consult_booked: "consults_booked",
  consult_done: "consults_done",
  first_fit_paid: "first_fits",
} as const;

/** The figures for [from, to): instants for the events, India's days for the spend. */
export async function acquisition(
  db: D1Database,
  range: Range,
  options: { readonly by: ChannelBy; readonly channel: ChannelCode | null; readonly now: Date },
): Promise<Acquisition> {
  const [leads, milestones, spend, cohorts, heard, tryons] = await Promise.all([
    leadsIn(db, range, options.by),
    milestonesIn(db, range, options.by),
    spendIn(db, range),
    cohortsIn(db, range, options.by),
    heardIn(db, range),
    tryonsIn(db, range),
  ]);
  const byChannel = new Map<ChannelCode, Figures>();
  const add = (code: string | null, change: Partial<Record<keyof Figures, number>>) => {
    const channel = known(code);
    const was = byChannel.get(channel) ?? NONE;
    const next = { ...was };
    for (const [key, value] of Object.entries(change) as [keyof Figures, number][]) next[key] = was[key] + value;
    byChannel.set(channel, next);
  };
  for (const row of spend) add(row.channel, { spend: row.spend });
  for (const row of leads) add(row.channel, { leads: row.n });
  for (const row of milestones) {
    const field = EVENT_FIELD[row.event as keyof typeof EVENT_FIELD];
    add(row.channel, { [field]: row.n, ...(row.event === "first_fit_paid" ? { first_fit_revenue: row.revenue } : {}) });
  }
  const shown = (code: ChannelCode) => options.channel === null || options.channel === code;
  const rows = CHANNELS.map((each) => ({ channel: each.code, ...(byChannel.get(each.code) ?? NONE) })).filter(
    (row) => shown(row.channel) && Object.values(row).some((value) => typeof value === "number" && value !== 0),
  );
  const totals = rows.reduce<Figures>((sum, row) => {
    const next = { ...sum };
    for (const key of Object.keys(NONE) as (keyof Figures)[]) next[key] = sum[key] + row[key];
    return next;
  }, NONE);
  const cohortsBy = new Map<ChannelCode, { clients: number; d30: number; d90: number; d180: number }>();
  let latest = 0;
  for (const row of cohorts) {
    const channel = known(row.channel);
    if (!shown(channel)) continue;
    const was = cohortsBy.get(channel) ?? { clients: 0, d30: 0, d90: 0, d180: 0 };
    cohortsBy.set(channel, {
      clients: was.clients + 1,
      d30: was.d30 + row.d30,
      d90: was.d90 + row.d90,
      d180: was.d180 + row.d180,
    });
    latest = Math.max(latest, Date.parse(row.occurred_at));
  }
  const complete = (days: number) => latest === 0 || latest + days * 86_400_000 <= options.now.getTime();
  return {
    rows,
    totals,
    cohorts: [...cohortsBy].map(([channel, figures]) => ({ channel, ...figures })),
    cohort_complete: { d30: complete(30), d90: complete(90), d180: complete(180) },
    heard: heard
      .map((row) => ({ heard_from: row.heard_from, channel: known(row.channel), clients: row.clients }))
      .filter((row) => shown(row.channel)),
    tryons: tryons ?? 0,
  };
}
