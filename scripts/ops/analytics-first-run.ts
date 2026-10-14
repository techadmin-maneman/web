// The reporting copy's supervised first run (docs/decisions/0146-the-nightly-analytics-copy.md): one of every kind of
// record, in a database built from the migrations, copied by the real job into the real analytics schema as the API's
// own login, twice, then read back through Zoho's login. The second run must change nothing. Afterwards the rows are
// taken out again, so the copy starts clean: npm run analytics:first-run.
//
// It reads the logins from .env.analytics-supabase, which git ignores, and prints no password.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { copyTonight } from "../../src/domain/analytics/nightly.ts";
import { indiaDate } from "../../src/lib/india-time.ts";
import { createSupabaseWarehouse } from "../../src/providers/warehouse/supabase.ts";
import { asD1, migratedDatabase } from "../../test/node/d1-over-sqlite.ts";

const POOLER = "aws-0-ap-south-1.pooler.supabase.com:5432";

const env = Object.fromEntries(
  readFileSync(".env.analytics-supabase", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
const login = (user: string, password: string | undefined) =>
  `postgres://${user}.${String(env.ANALYTICS_PROJECT_REF)}:${String(password)}@${POOLER}/postgres?sslmode=require`;

const now = new Date();
const today = indiaDate(now);
const at = now.toISOString();
const days = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString();

/** One of every kind of record the copy reads, made up. */
const SEED = `
INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at, city, fits_trained)
  VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, '${at}', 'Gurgaon', 1);
INSERT INTO people (id, created_at, mobile_e164, name) VALUES
  ('p1', '${days(-60)}', '+919810000001', 'Rohit Malhotra'),
  ('p2', '${days(-40)}', '+919810000002', 'Arjun Bedi');
INSERT INTO leads (id, person_id, created_at, source, utm_source, utm_medium, utm_campaign, gclid, landing_path,
    loss_extent, request_id)
  VALUES ('l1', 'p1', '${days(-60)}', 'form', 'google', 'cpc', 'gurgaon-search', 'gc1', '/book', 'crown', 'r1'),
         ('l2', 'p2', '${days(-40)}', 'form', NULL, NULL, NULL, NULL, '/', 'crown', 'r2');
INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, service_city,
    service_pincode, synced_at)
  VALUES ('c1', 'c1', 'p1', 'consultation', 'completed', '${days(-55)}', '${days(-55)}', 't1', 'Gurgaon', '122018', '${at}'),
         ('f1', 'f1', 'p1', 'first_fit', 'completed', '${days(-45)}', '${days(-45)}', 't1', 'Gurgaon', '122018', '${at}'),
         ('s1', 's1', 'p1', 'service', 'scheduled', '${days(3)}', '${days(3)}', 't1', 'Gurgaon', '122018', '${at}'),
         ('c2', 'c2', 'p2', 'consultation', 'completed', '${days(-35)}', '${days(-35)}', 't1', 'Gurgaon', '122018', '${at}');
INSERT INTO visit_outcomes (id, appointment_id, outcome, duration_minutes, updated_at, lost_reason)
  VALUES ('v1', 'c1', 'done', 45, '${at}', NULL), ('v2', 'f1', 'done', 150, '${at}', NULL),
         ('v3', 'c2', 'done', 40, '${at}', 'price');
INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, amount_ex_gst, gst_percent, currency,
    method, status, refunded_amount, captured_at, created_at, updated_at)
  VALUES ('y1', 'p1', 'f1', 'pay_y1', 1180000, 1000000, 18, 'INR', 'upi', 'captured', 0, '${days(-45)}', '${days(-45)}',
    '${days(-45)}');
INSERT INTO standard_costs (item, tier, cost, valid_from, set_by, set_at)
  VALUES ('first_fit', 'standard', 600000, '2026-01-01', 'first-run', '${at}');
INSERT INTO consumables (code, name, unit, unit_cost, reorder_kit, created_at, updated_at)
  VALUES ('first_run_strip', 'First-run strip', 'strip', 4000, 5, '${at}', '${at}');
INSERT INTO consumable_usage (visit_type, tier, consumable_code, quantity, set_by, set_at)
  VALUES ('first_fit', 'standard', 'first_run_strip', 2, 'first-run', '${at}');
INSERT INTO stock_movements (id, consumable_code, location, technician_id, quantity, reason, transfer_id, actor_kind,
    actor, created_at)
  VALUES ('m1', 'first_run_strip', 'central', NULL, 10, 'received', NULL, 'staff', 'first-run', '${days(-50)}'),
         ('m2', 'first_run_strip', 'central', NULL, -4, 'transferred', 'tr1', 'staff', 'first-run', '${days(-49)}'),
         ('m3', 'first_run_strip', 'kit', 't1', 4, 'transferred', 'tr1', 'staff', 'first-run', '${days(-49)}');
INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, created_at)
  VALUES ('g1', 'p1', 'grant', 2, 'ops', 'first-run', '${days(-40)}');
INSERT INTO spend_entries (id, month, city, channel, campaign, amount, entered_by, entered_at)
  VALUES ('e1', '${today.slice(0, 7)}', 'Gurgaon', 'partner', 'gurgaon-salons', 2500000, 'first-run', '${at}');
INSERT INTO targets (month, city, measure, target, set_by, set_at)
  VALUES ('${today.slice(0, 7)}', 'Gurgaon', 'new_clients', 40, 'first-run', '${at}');
INSERT INTO staff (email, active, added_by, added_at) VALUES ('first-run@maneman.in', 1, 'first-run', '${at}');
INSERT INTO staff_grants (email, department, level, geography, place, granted_by, granted_at)
  VALUES ('first-run@maneman.in', 'growth', 'view', 'city', 'Gurgaon', 'first-run', '${at}');
INSERT INTO grievances (id, person_id, text, state, created_at) VALUES ('gr1', 'p2', 'Call first.', 'open', '${days(-5)}');
INSERT INTO task_spans (id, task_group, subject_id, episode, city, opened_at)
  VALUES ('ts1', 'first_fit_to_book', 'p2', '', 'Gurgaon', '${days(-28)}');
INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, supplier_lot, fitted_at, replacement_due_at, appointment_id,
    synced_at)
  VALUES ('pc1', 'pc1', 'p1', 'MM-STD-1', 'lace', 'LOT-9', '${days(-45)}', '${days(135)}', 'f1', '${at}');
INSERT OR REPLACE INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Sector 65', 'Gurgaon', 1);
INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, sent_at, delivered_at)
  VALUES ('o1', '${days(-2)}', 'p1', 'visit_reminder', 's1', 'sent', '${days(-2)}', '${days(-2)}');
`;

const TABLES = [
  "dim_date",
  "dim_city",
  "dim_technician",
  "dim_service",
  "dim_client",
  "dim_channel",
  "dim_campaign",
  "dim_item",
  "dim_stock_place",
  "dim_area",
  "access",
  "fact_visit",
  "fact_payment",
  "fact_lead",
  "fact_client_month",
  "fact_capacity",
  "fact_care",
  "fact_message_day",
  "fact_spend",
  "fact_credit",
  "fact_stock_movement",
  "fact_stock_week",
  "fact_target",
  "fact_piece",
  "load_run",
];

const db = migratedDatabase();
db.exec(SEED);
const d1 = asD1(db);
const secret = [...randomBytes(32)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const copy = async () => {
  const warehouse = createSupabaseWarehouse(login("analytics_writer", env.ANALYTICS_WRITER_DB_PASSWORD));
  try {
    return await copyTonight(d1, warehouse, { secret, date: today, now: () => new Date() });
  } finally {
    await warehouse.close();
  }
};

const first = await copy();
console.log("first run:", { written: first.rowsWritten, changed: first.rowsChanged, totals: first.totalsChecked });
const second = await copy();
console.log("second run:", { written: second.rowsWritten, changed: second.rowsChanged, totals: second.totalsChecked });

const reader = postgres(login("zoho_reader", env.ZOHO_READER_DB_PASSWORD), { max: 1, prepare: false });
try {
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const [row] = await reader.unsafe(`select count(*)::int as n from analytics."${table}"`);
    counts[table] = Number(row?.n ?? 0);
  }
  console.log("read back through Zoho's login:", counts);
  const empty = TABLES.filter((table) => counts[table] === 0);
  console.log(empty.length === 0 ? "every table holds rows" : `empty: ${empty.join(", ")}`);
} finally {
  await reader.end({ timeout: 5 });
}
console.log(second.rowsChanged === 0 ? "the second run changed nothing" : "the second run changed rows: look at why");

// The rows were made up: they come out again, so the first real night starts from nothing.
const writer = postgres(login("analytics_writer", env.ANALYTICS_WRITER_DB_PASSWORD), { max: 1, prepare: false });
try {
  for (const table of TABLES) await writer.unsafe(`delete from analytics."${table}"`);
  console.log("taken out again");
} finally {
  await writer.end({ timeout: 5 });
}
