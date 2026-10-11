// The reporting copy's rows, worked out from D1 each night (docs/decisions/0146-the-nightly-analytics-copy.md): the
// shared tables of dates, cities, technicians, services and clients, and a row per visit and per payment. No row holds
// a client's name, number, address, pincode or free text, and records marked as tests are left out everywhere. Money
// is in rupees, before GST unless a column says otherwise.

import { addDays, indiaDate } from "../../lib/india-time.ts";
import { unitsFor } from "../../policy/visit-length.ts";
import type { Row, TableRows } from "../../providers/warehouse/index.ts";

const rupees = (paise: number | null): number => Math.round(paise ?? 0) / 100;
const dayOf = (at: string | null): string | null => (at === null ? null : indiaDate(new Date(at)));

/** The dates the copy covers, from the first visit or payment to a year ahead, as the calendar Zoho groups by. */
export function dateRows(from: string, to: string): TableRows {
  const rows: Row[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const date = new Date(`${day}T00:00:00Z`);
    const weekday = (date.getUTCDay() + 6) % 7;
    const month = date.getUTCMonth();
    const year = date.getUTCFullYear();
    const startsFy = month >= 3 ? year : year - 1;
    rows.push({
      day,
      week_start: addDays(day, -weekday),
      month_start: `${day.slice(0, 7)}-01`,
      quarter: `Q${String(Math.floor(((month + 9) % 12) / 3) + 1)}`,
      financial_year: `${String(startsFy)}-${String(startsFy + 1).slice(2)}`,
      weekday: weekday + 1,
      weekday_name: date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }),
    });
  }
  return { table: "dim_date", key: ["day"], rows };
}

export async function cityRows(db: D1Database): Promise<TableRows> {
  const { results } = await db
    .prepare("SELECT name AS city, zone, served = 1 AS served, active = 1 AS active FROM cities ORDER BY sort")
    .all<{ city: string; zone: string | null; served: number; active: number }>();
  return {
    table: "dim_city",
    key: ["city"],
    rows: results.map((row) => ({ ...row, served: row.served === 1, active: row.active === 1 })),
  };
}

export async function technicianRows(db: D1Database): Promise<TableRows> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.city, t.active,
         (SELECT MIN(a.window_start) FROM appointments a WHERE a.technician_id = t.id AND a.status = 'completed') AS first,
         (SELECT MAX(a.window_start) FROM appointments a WHERE a.technician_id = t.id AND a.status = 'completed') AS last
       FROM technicians t WHERE t.test_record = 0`,
    )
    .all<{
      id: string;
      name: string;
      city: string | null;
      active: number;
      first: string | null;
      last: string | null;
    }>();
  return {
    table: "dim_technician",
    key: ["technician_key"],
    rows: results.map((row) => ({
      technician_key: row.id,
      name: row.name,
      city: row.city,
      active: row.active === 1,
      first_day: dayOf(row.first),
      last_day: dayOf(row.last),
    })),
  };
}

export async function serviceRows(db: D1Database): Promise<TableRows> {
  const { results } = await db
    .prepare("SELECT kind, tier, name, minutes FROM services")
    .all<{ kind: string; tier: string; name: string; minutes: number }>();
  return {
    table: "dim_service",
    key: ["service_key"],
    rows: results.map((row) => ({
      service_key: `${row.kind}:${row.tier}`,
      kind: row.kind,
      tier: row.tier,
      name: row.name,
      minutes: row.minutes,
      half_slots: unitsFor(row.minutes),
    })),
  };
}

interface ClientRow {
  readonly id: string;
  readonly first_lead: string | null;
  readonly first_fit: string | null;
  readonly first_fit_city: string | null;
  readonly referred: number;
}

/**
 * Each client who has a lead or a visit: their first lead's day, their first fit's day, month and city, and whether a
 * friend's invite brought them. The channel rule comes with the growth figures; until then every client is "direct".
 */
export async function clientRows(db: D1Database, keys: ReadonlyMap<string, string>): Promise<TableRows> {
  const { results } = await db
    .prepare(
      `SELECT p.id,
         (SELECT MIN(l.created_at) FROM leads l WHERE l.person_id = p.id) AS first_lead,
         (SELECT MIN(a.window_start) FROM appointments a WHERE a.person_id = p.id AND a.type = 'first_fit'
            AND a.status = 'completed' AND a.deleted_at IS NULL) AS first_fit,
         (SELECT a.service_city FROM appointments a WHERE a.person_id = p.id AND a.type = 'first_fit'
            AND a.status = 'completed' AND a.deleted_at IS NULL ORDER BY a.window_start LIMIT 1) AS first_fit_city,
         EXISTS (SELECT 1 FROM referral_attributions r WHERE r.referred_person_id = p.id) AS referred
       FROM people p WHERE p.test_record = 0 AND p.erased_at IS NULL`,
    )
    .all<ClientRow>();
  const rows = results.flatMap((row) => {
    const key = keys.get(row.id);
    if (key === undefined || (row.first_lead === null && row.first_fit === null)) return [];
    const fitDay = dayOf(row.first_fit);
    return [
      {
        client_key: key,
        first_lead_date: dayOf(row.first_lead),
        first_fit_date: fitDay,
        cohort_month: fitDay === null ? null : `${fitDay.slice(0, 7)}-01`,
        first_fit_city: row.first_fit_city,
        channel: "direct",
        campaign_key: null,
        referred: row.referred === 1,
      },
    ];
  });
  return { table: "dim_client", key: ["client_key"], rows };
}

interface VisitRow {
  readonly id: string;
  readonly person_id: string;
  readonly erased: number;
  readonly window_start: string;
  readonly window_end: string | null;
  readonly city: string | null;
  readonly technician_id: string | null;
  readonly type: string;
  readonly tier: string | null;
  readonly status: string;
  readonly booked_at: string | null;
  readonly outcome: string | null;
  readonly partial_reason: string | null;
  readonly minutes: number | null;
  readonly on_time: number;
  readonly failed: number;
  readonly waived: number;
  readonly moves: number;
  readonly no_show: number;
  readonly charge: number | null;
}

/** A row per visit, booked or done, with how it went: on time, its check-ins, its moves and any no-show. */
export async function visitRows(db: D1Database, keys: ReadonlyMap<string, string>): Promise<TableRows> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.person_id, p.erased_at IS NOT NULL AS erased, a.window_start, a.window_end,
         a.service_city AS city, a.technician_id, a.type, a.tier, a.status,
         COALESCE(a.first_seen_at, a.synced_at) AS booked_at,
         v.outcome, v.partial_reason, v.duration_minutes AS minutes,
         EXISTS (SELECT 1 FROM checkins c WHERE c.appointment_id = a.id AND c.passed = 1
           AND (a.window_end IS NULL OR c.at <= a.window_end)) AS on_time,
         EXISTS (SELECT 1 FROM checkins c WHERE c.appointment_id = a.id AND c.passed = 0) AS failed,
         a.checkin_waived_at IS NOT NULL AS waived,
         (SELECT COUNT(*) FROM dispatch_moves m WHERE m.appointment_id = a.id)
           + (SELECT COUNT(*) FROM visit_changes x WHERE x.appointment_id = a.id AND x.kind = 'moved') AS moves,
         n.id IS NOT NULL AS no_show, n.kept_amount AS charge
       FROM appointments a JOIN people p ON p.id = a.person_id
       LEFT JOIN visits v ON v.appointment_id = a.id
       LEFT JOIN no_show_cases n ON n.appointment_id = a.id
       WHERE a.deleted_at IS NULL AND a.type IS NOT NULL AND a.window_start IS NOT NULL AND p.test_record = 0`,
    )
    .all<VisitRow>();
  return {
    table: "fact_visit",
    key: ["visit_key"],
    rows: results.map((row) => ({
      visit_key: row.id,
      visit_date: indiaDate(new Date(row.window_start)),
      // An erased client's visits stay, as the business's record, with nobody behind them.
      client_key: row.erased === 1 ? null : (keys.get(row.person_id) ?? null),
      city: row.city,
      technician_key: row.technician_id,
      service_key: row.tier === null ? null : `${row.type}:${row.tier}`,
      kind: row.type,
      tier: row.tier,
      booked_on: dayOf(row.booked_at),
      booking_window: null,
      state: row.status,
      outcome: row.outcome,
      is_done: row.status === "completed",
      is_on_time: row.status === "completed" ? row.on_time === 1 : null,
      checkin_failed: row.failed === 1,
      checkin_waived: row.waived === 1,
      minutes: row.minutes,
      partial_reason: row.partial_reason,
      moves: row.moves,
      is_no_show: row.no_show === 1,
      no_show_charge: rupees(row.charge),
    })),
  };
}

interface PaymentRow {
  readonly id: string;
  readonly person_id: string;
  readonly erased: number;
  readonly captured_at: string;
  readonly city: string | null;
  readonly appointment_id: string | null;
  readonly kind: string;
  readonly tier: string | null;
  readonly method: string | null;
  readonly amount: number;
  readonly amount_ex_gst: number | null;
  readonly refunded_amount: number | null;
  readonly discount: number | null;
}

/** A row per payment taken, with what it was for, its GST, any discount on its visit, and what went back. */
export async function paymentRows(db: D1Database, keys: ReadonlyMap<string, string>): Promise<TableRows> {
  const { results } = await db
    .prepare(
      `SELECT y.id, y.person_id, p.erased_at IS NOT NULL AS erased, y.captured_at, a.service_city AS city,
         y.appointment_id, y.kind, a.tier, y.method, y.amount, y.amount_ex_gst, y.refunded_amount,
         (SELECT SUM(u.amount_off) FROM discount_code_uses u WHERE u.appointment_id = y.appointment_id
            AND u.removed_at IS NULL) AS discount
       FROM payments y JOIN people p ON p.id = y.person_id LEFT JOIN appointments a ON a.id = y.appointment_id
       WHERE y.captured_at IS NOT NULL AND p.test_record = 0`,
    )
    .all<PaymentRow>();
  return {
    table: "fact_payment",
    key: ["payment_key"],
    rows: results.map((row) => {
      const exGst = row.amount_ex_gst ?? row.amount;
      return {
        payment_key: row.id,
        payment_date: indiaDate(new Date(row.captured_at)),
        client_key: row.erased === 1 ? null : (keys.get(row.person_id) ?? null),
        city: row.city,
        visit_key: row.appointment_id,
        kind: row.kind,
        tier: row.tier,
        method: row.method,
        amount: rupees(exGst),
        discount: rupees(row.discount),
        gst: rupees(row.amount - exGst),
        refunded: rupees(row.refunded_amount),
      };
    }),
  };
}
