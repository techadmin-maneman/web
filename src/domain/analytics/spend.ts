// What was spent to win clients, as the reporting copy holds it beside the ad accounts' own (docs/decisions/0150-spend.md):
// each month's offline spend typed in on the Spend page, each month paid to partners, and each free visit a friend's
// invite or a partner's code gave, valued at its service's price on the day it was used. A free visit given back, as a
// cancel in time gives it, is no spend. Rupees before GST.

import { indiaDate, indiaDateSql } from "../../lib/india-time.ts";
import { CHANNELS, type Channel } from "../../policy/channels.ts";
import type { Row, TableRows } from "../../providers/warehouse/index.ts";
import { tierOf } from "../../config/visit-types.ts";

interface EntryRow {
  readonly key: string;
  readonly month: string;
  readonly city: string | null;
  readonly channel: string;
  readonly campaign: string | null;
  readonly amount: number;
}

interface CreditRow {
  readonly id: string;
  readonly window_start: string;
  readonly city: string | null;
  readonly from_partner: number;
  readonly visits: number;
  readonly price: number | null;
}

const rupees = (paise: number) => Math.round(paise) / 100;
const channelNamed = (code: string): Channel => CHANNELS.find((each) => each.code === code)?.channel ?? "Direct";

/** Each free visit a referral grant paid for, not given back, with its service's price on its day. */
const CREDITS_USED = `SELECT r.id, a.window_start, a.service_city AS city, r.visits,
    EXISTS (SELECT 1 FROM channel_attributions c WHERE c.id = g.source_id) AS from_partner,
    (SELECT b.amount_ex_gst FROM price_book b WHERE b.item = a.type AND b.tier = ${tierOf("a.tier")}
       AND b.valid_from <= ${indiaDateSql("a.window_start")} ORDER BY b.valid_from DESC LIMIT 1) AS price
  FROM credit_ledger r JOIN credit_ledger g ON g.id = r.grant_id JOIN appointments a ON a.id = r.source_id
  JOIN people p ON p.id = r.person_id
  WHERE r.kind = 'redeem' AND g.source_kind = 'referral' AND p.test_record = 0
    AND NOT EXISTS (SELECT 1 FROM credit_ledger x WHERE x.kind = 'restore' AND x.grant_id = r.grant_id
      AND x.source_id = r.source_id)`;

export async function spendRows(db: D1Database): Promise<TableRows> {
  const [entries, credits] = await db.batch<EntryRow | CreditRow>([
    db.prepare(
      `SELECT 'e:' || id AS key, month, city, channel, campaign, amount FROM spend_entries WHERE removed_at IS NULL
       UNION ALL
       SELECT 'p:' || id, month, NULL, 'partner', NULL, amount FROM partner_payouts WHERE amount > 0`,
    ),
    db.prepare(CREDITS_USED),
  ]);
  const rows: Row[] = [
    ...((entries?.results ?? []) as EntryRow[]).map((row) => ({
      spend_key: row.key,
      day: `${row.month}-01`,
      city: row.city,
      channel: channelNamed(row.channel),
      campaign_key: row.campaign === null ? null : row.campaign.trim().toLowerCase(),
      amount: rupees(row.amount),
    })),
    ...((credits?.results ?? []) as CreditRow[]).map((row) => ({
      spend_key: `c:${row.id}`,
      day: indiaDate(new Date(row.window_start)),
      city: row.city,
      channel: row.from_partner === 1 ? "Offline and partners" : "Referral",
      campaign_key: null,
      amount: rupees((row.price ?? 0) * Math.abs(row.visits)),
    })),
  ];
  return { table: "fact_spend", key: ["spend_key"], stamped: true, rows };
}
