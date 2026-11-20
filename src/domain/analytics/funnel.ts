// The growth funnel for the console's Funnel page: over a period, how many first try-ons were made, and of the clients
// whose first lead in it came then, how many booked a consultation, had one and were fitted, all of them and by the
// client's channel (docs/decisions/0288-attribution-and-conversions.md). A first fit done counts as the consultation done
// too, since a fit can be booked as one visit with it. Records marked as tests are left out.

import { statusNotIn, statusIn, VISIT_CALLED_OFF } from "../../config/statuses.ts";
import { channelNamed, CHANNELS, type Channel } from "../../policy/channels.ts";

interface FunnelSteps {
  readonly leads: number;
  readonly booked: number;
  readonly consulted: number;
  readonly fitted: number;
}

export interface Funnel {
  /** First looks at the try-on, a second look of one photo not counted again. */
  readonly tryons: number;
  readonly steps: FunnelSteps;
  /** Every channel, in the figures' order, with its own steps. */
  readonly channels: readonly ({ readonly channel: Channel } & FunnelSteps)[];
}

interface LeadRow {
  person_id: string;
  channel: string | null;
  booked: number;
  consulted: number;
  fitted: number;
}

const visited = (types: string, done: boolean) =>
  `EXISTS (SELECT 1 FROM appointments a WHERE a.person_id = l.person_id AND a.type IN (${types})
     AND a.deleted_at IS NULL AND ${done ? statusIn("a.status", ["completed"]) : statusNotIn("a.status", VISIT_CALLED_OFF)})`;

const LEADS = `SELECT l.person_id,
     (SELECT a.attributed_channel FROM person_attribution a WHERE a.person_id = l.person_id) AS channel,
     ${visited("'consultation', 'first_fit'", false)} AS booked,
     ${visited("'consultation', 'first_fit'", true)} AS consulted,
     ${visited("'first_fit'", true)} AS fitted
   FROM leads l JOIN people p ON p.id = l.person_id
   WHERE p.test_record = 0 AND l.created_at >= ?1 AND l.created_at < ?2
   ORDER BY l.created_at`;

const NONE: FunnelSteps = { leads: 0, booked: 0, consulted: 0, fitted: 0 };

const plus = (steps: FunnelSteps, row: LeadRow): FunnelSteps => ({
  leads: steps.leads + 1,
  booked: steps.booked + row.booked,
  consulted: steps.consulted + row.consulted,
  fitted: steps.fitted + row.fitted,
});

/** The funnel over [from, to), instants. */
export async function growthFunnel(db: D1Database, from: Date, to: Date): Promise<Funnel> {
  const [leads, tryons] = await Promise.all([
    db.prepare(LEADS).bind(from.toISOString(), to.toISOString()).all<LeadRow>(),
    db
      .prepare(
        "SELECT COUNT(*) AS tryons FROM tryon_jobs WHERE parent_job_id IS NULL AND created_at >= ?1 AND created_at < ?2",
      )
      .bind(from.toISOString(), to.toISOString())
      .first<number>("tryons"),
  ]);
  // A client counts once, by their first lead in the period.
  const first = new Map<string, LeadRow>();
  for (const row of leads.results) if (!first.has(row.person_id)) first.set(row.person_id, row);
  let steps = NONE;
  const byChannel = new Map<Channel, FunnelSteps>();
  for (const row of first.values()) {
    const channel = channelNamed(row.channel);
    steps = plus(steps, row);
    byChannel.set(channel, plus(byChannel.get(channel) ?? NONE, row));
  }
  return {
    tryons: tryons ?? 0,
    steps,
    channels: CHANNELS.map((each) => ({ channel: each.channel, ...(byChannel.get(each.channel) ?? NONE) })),
  };
}
