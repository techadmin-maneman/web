// The reporting copy's supervised first run (docs/decisions/0146-the-nightly-analytics-copy.md): one of every kind of
// record, in a database built from the migrations, copied by the real job into the real analytics schema as the API's
// own login, twice, then read back through Zoho's login. The second run must change nothing. Afterwards the rows are
// taken out again, so the copy starts clean: npm run analytics:first-run.
//
// It reads the logins from .env.analytics-supabase, which git ignores, and prints no password.

import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { copyTonight } from "../../src/domain/analytics/nightly.ts";
import { indiaDate } from "../../src/lib/india-time.ts";
import { createSupabaseWarehouse } from "../../src/providers/warehouse/supabase.ts";
import { asD1, migratedDatabase } from "../../test/node/d1-over-sqlite.ts";
import { analyticsLogin } from "../lib/analytics-logins.ts";
import { analyticsSeed, COPY_TABLES } from "../lib/analytics-seed.ts";

const now = new Date();
const today = indiaDate(now);

const db = migratedDatabase();
db.exec(analyticsSeed(now));
const d1 = asD1(db);
const secret = [...randomBytes(32)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const copy = async () => {
  const warehouse = createSupabaseWarehouse(analyticsLogin("analytics_writer"));
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

const reader = postgres(analyticsLogin("zoho_reader"), { max: 1, prepare: false });
try {
  const counts: Record<string, number> = {};
  for (const table of COPY_TABLES) {
    const [row] = await reader.unsafe(`select count(*)::int as n from analytics."${table}"`);
    counts[table] = Number(row?.n ?? 0);
  }
  console.log("read back through Zoho's login:", counts);
  const empty = COPY_TABLES.filter((table) => counts[table] === 0);
  console.log(empty.length === 0 ? "every table holds rows" : `empty: ${empty.join(", ")}`);
} finally {
  await reader.end({ timeout: 5 });
}
console.log(second.rowsChanged === 0 ? "the second run changed nothing" : "the second run changed rows: look at why");

// The rows were made up: they come out again, so the first real night starts from nothing.
const writer = postgres(analyticsLogin("analytics_writer"), { max: 1, prepare: false });
try {
  for (const table of COPY_TABLES) await writer.unsafe(`delete from analytics."${table}"`);
  console.log("taken out again");
} finally {
  await writer.end({ timeout: 5 });
}
