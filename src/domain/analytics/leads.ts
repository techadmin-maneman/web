// A row per lead in the reporting copy (docs/decisions/0146-the-nightly-analytics-copy.md): the day it came, its city,
// its channel and campaign (docs/decisions/0148-the-channel-rule.md), how it came (the site's form, the waitlist, the
// try-on or WhatsApp) and the page it landed on, and the days its client first booked a consultation, had one, paid for
// a first fit and was fitted. A first fit done counts as the consultation done too, since a fit can be booked as one
// visit with it. A client not yet fitted carries why they did not go ahead, from their latest consultation
// (docs/decisions/0149-lost-reasons.md). Records marked as tests are left out.

import { statusNotIn, VISIT_CALLED_OFF } from "../../config/statuses.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { campaignCity, channelOf, CHANNELS, type Channel } from "../../policy/channels.ts";
import type { Row, TableRows } from "../../providers/warehouse/index.ts";
import { areaKeyOf } from "./pieces.ts";
import { jobSheet } from "../field/job-sheet-settings.ts";

interface LeadRow {
  readonly id: string;
  readonly person_id: string;
  readonly erased: number;
  readonly created_at: string;
  readonly city: string | null;
  readonly source: string | null;
  readonly landing_path: string | null;
  readonly utm_source: string | null;
  readonly utm_medium: string | null;
  readonly utm_campaign: string | null;
  readonly gclid: string | null;
  readonly fbclid: string | null;
  readonly referrer: string | null;
  readonly found_us: string | null;
  readonly referred_before: number;
  readonly partner_before: number;
  readonly consultation_booked: string | null;
  readonly consultation_done: string | null;
  readonly fit_paid: string | null;
  readonly fit_done: string | null;
  readonly lost_reason: string | null;
  readonly area_city: string | null;
  readonly area: string | null;
}

/** A client's first lead, whose channel and campaign they keep for life. */
export interface FirstTouch {
  readonly channel: Channel;
  readonly campaign_key: string | null;
}

const dayOf = (at: string | null) => (at === null ? null : indiaDate(new Date(at)));

const firstVisit = (types: string, done: boolean) =>
  `(SELECT MIN(${done ? "a.window_start" : "COALESCE(a.first_seen_at, a.synced_at)"}) FROM appointments a
    WHERE a.person_id = l.person_id AND a.type IN (${types}) AND a.deleted_at IS NULL
      ${done ? "AND a.status = 'completed'" : `AND ${statusNotIn("a.status", VISIT_CALLED_OFF)}`})`;

/** A campaign as the ad accounts name it, matched however its case or spaces were typed. */
const campaignKeyOf = (campaign: string | null) => {
  const key = (campaign ?? "").trim().toLowerCase();
  return key === "" ? null : key;
};

/** Every lead, the oldest first, with what the channel rule reads and the days its client moved on. */
const LEADS = `SELECT l.id, l.person_id, p.erased_at IS NOT NULL AS erased, l.created_at, l.city, l.source, l.landing_path,
     l.utm_source, l.utm_medium, l.utm_campaign, l.gclid, l.fbclid, l.referrer, l.found_us,
     EXISTS (SELECT 1 FROM referral_attributions r WHERE r.referred_person_id = l.person_id
       AND r.first_touch_at <= l.created_at) AS referred_before,
     EXISTS (SELECT 1 FROM channel_attributions c WHERE c.referred_person_id = l.person_id
       AND c.first_touch_at <= l.created_at) AS partner_before,
     ${firstVisit("'consultation', 'first_fit'", false)} AS consultation_booked,
     ${firstVisit("'consultation', 'first_fit'", true)} AS consultation_done,
     (SELECT MIN(y.captured_at) FROM payments y JOIN appointments a ON a.id = y.appointment_id
       WHERE y.person_id = l.person_id AND a.type = 'first_fit' AND y.captured_at IS NOT NULL) AS fit_paid,
     ${firstVisit("'first_fit'", true)} AS fit_done,
     (SELECT v.lost_reason FROM visits v JOIN appointments a ON a.id = v.appointment_id
       WHERE a.person_id = l.person_id AND v.lost_reason IS NOT NULL
       ORDER BY a.window_start DESC LIMIT 1) AS lost_reason,
     sp.city AS area_city, sp.area
   FROM leads l
   LEFT JOIN addresses d ON d.person_id = l.person_id AND d.replaced_at IS NULL
   LEFT JOIN serviceable_pincodes sp ON sp.pincode = d.pincode JOIN people p ON p.id = l.person_id WHERE p.test_record = 0
   ORDER BY l.created_at`;

/**
 * The leads, the oldest first; the channels; the campaigns their tags name, each with the channel of its first lead and
 * the city its name gives; and each client's first touch, by their key.
 */
export async function leadTables(
  db: D1Database,
  keys: ReadonlyMap<string, string>,
  cities: readonly string[],
): Promise<{ readonly tables: readonly TableRows[]; readonly firstTouch: ReadonlyMap<string, FirstTouch> }> {
  const { results } = await db.prepare(LEADS).all<LeadRow>();

  const { lostReasons } = await jobSheet(db);
  const lostWords = new Map([...lostReasons.retired, ...lostReasons.items].map((item) => [item.id, item.label]));
  const leads: Row[] = [];
  const campaigns = new Map<string, Row>();
  const firstTouch = new Map<string, FirstTouch>();
  for (const row of results) {
    const channel = channelOf({
      utmSource: row.utm_source,
      utmMedium: row.utm_medium,
      gclid: row.gclid,
      fbclid: row.fbclid,
      referrer: row.referrer,
      referredBefore: row.referred_before === 1,
      partnerBefore: row.partner_before === 1,
      foundUs: row.found_us,
    });
    const campaign = campaignKeyOf(row.utm_campaign);
    if (campaign !== null && !campaigns.has(campaign)) {
      campaigns.set(campaign, {
        campaign_key: campaign,
        channel,
        source: row.utm_source,
        medium: row.utm_medium,
        campaign: row.utm_campaign,
        city: campaignCity(campaign, cities),
      });
    }
    const client = row.erased === 1 ? null : (keys.get(row.person_id) ?? null);
    if (client !== null && !firstTouch.has(client)) firstTouch.set(client, { channel, campaign_key: campaign });
    leads.push({
      lead_key: row.id,
      lead_date: indiaDate(new Date(row.created_at)),
      client_key: client,
      city: row.city,
      area_key: row.area_city === null || row.area === null ? null : areaKeyOf(row.area_city, row.area),
      channel,
      campaign_key: campaign,
      landing_page: row.landing_path,
      source: row.source,
      consultation_booked_date: dayOf(row.consultation_booked),
      consultation_done_date: dayOf(row.consultation_done),
      first_fit_paid_date: dayOf(row.fit_paid),
      first_fit_done_date: dayOf(row.fit_done),
      lost_reason:
        row.fit_done === null && row.lost_reason !== null ? (lostWords.get(row.lost_reason) ?? row.lost_reason) : null,
    });
  }
  const channels = CHANNELS.map((each, index) => ({
    channel: each.channel,
    channel_group: each.group,
    sort: index + 1,
  }));
  return {
    tables: [
      { table: "dim_channel", key: ["channel"], stamped: false, rows: channels },
      { table: "dim_campaign", key: ["campaign_key"], stamped: false, rows: [...campaigns.values()] },
      { table: "fact_lead", key: ["lead_key"], stamped: true, rows: leads },
    ],
    firstTouch,
  };
}
