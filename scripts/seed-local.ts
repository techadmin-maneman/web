// Fills the local database with enough of the story to click through
// (docs/getting-started.md):
//
//   npm run db:seed:local
//
// The browser tests' own seeds, so what a developer sees is what the tests
// see: the service area the booking pages read, a fitted client with visits,
// pieces, payments and photographs, and two clients whose next visits can be
// moved and cancelled (e2e/booking-area.ts, e2e/app/fitted.ts,
// e2e/app/changing.ts). Beside them, a technician to sign in as on the
// technician app, with jobs today and tomorrow at a client's address.
//
// Every name and number is made up. Run it with mm-api idle or stopped: wrangler
// writing to the local database while mm-api does meets it on SQLite's lock.
// Run it again for a fresh set; the technician and his client are the same
// ones every time, and their earlier jobs are cancelled.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changingClients, seedChanging } from "../e2e/app/changing.ts";
import { fittedClient, seedFitted, wrangler } from "../e2e/app/fitted.ts";
import { seedBookingArea } from "../e2e/booking-area.ts";
import { LOCAL_HAIR_SYSTEMS } from "../src/config/local-hair-systems.ts";
import { LOCAL_LOGIN_CODE, PORTS } from "./lib/local-stack.ts";
import { sqlRow } from "./lib/sql-literal.ts";

/** The technician a developer signs in as, and his client: fixed, so a second run finds the same ones. */
const TECHNICIAN = { id: "local-technician", fsmId: "local-resource-1", mobile: "9810099001", name: "Sandeep Yadav" };
const CLIENT = { id: "local-client", addressId: "local-client-address", mobile: "9810099002", name: "Neha Kapoor" };

const INDIA_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** India's calendar date `days` from today. */
const indiaDate = (days: number) => new Date(Date.now() + INDIA_OFFSET_MS + days * DAY_MS).toISOString().slice(0, 10);

/** A visit's window on an India date, as UTC: the morning is 10:00 to 11:30, the afternoon 2:00 to 3:30. */
const WINDOWS = {
  morning: { start: "04:30", end: "06:00" },
  afternoon: { start: "08:30", end: "10:00" },
} as const;

/**
 * The consumables the technician's step offers, what a service visit is expected to use, so its steppers start
 * filled, and stock in the central store and his kit (docs/decisions/0087-consumables-and-stock.md). Once only:
 * a second run finds them and leaves the ledger as it is.
 */
function consumables(now: string): string[] {
  const kept = [
    ["tape_strips", "Tape strips", "strip", 1200, 5, 50, 4],
    ["bonding_glue", "Bonding glue", "ml", 90, 20, 200, 3],
    ["solvent", "Solvent", "ml", 50, 50, 500, 10],
    ["shampoo_sachet", "Shampoo sachet", "sachet", 800, 2, 20, 0],
  ] as const;
  // Four times the store's level delivered, and three times the kit's level moved into the technician's kit.
  const moved = kept.flatMap(([code, , , , kit, central]) => [
    sqlRow(`local-stock-${code}-in`, code, "central", null, central * 4, "received", null, "staff", "seed", now),
    sqlRow(
      `local-stock-${code}-out`,
      code,
      "central",
      null,
      -kit * 3,
      "transferred",
      `local-${code}`,
      "staff",
      "seed",
      now,
    ),
    sqlRow(
      `local-stock-${code}-kit`,
      code,
      "kit",
      TECHNICIAN.id,
      kit * 3,
      "transferred",
      `local-${code}`,
      "staff",
      "seed",
      now,
    ),
  ]);
  return [
    `INSERT OR IGNORE INTO consumables (code, name, unit, unit_cost, reorder_kit, reorder_central, created_at,
       updated_at) VALUES ${kept.map(([code, name, unit, cost, kit, central]) => sqlRow(code, name, unit, cost, kit, central, now, now)).join(", ")};`,
    `INSERT OR IGNORE INTO consumable_usage (visit_type, tier, consumable_code, quantity, set_by, set_at) VALUES
       ${kept.flatMap(([code, , , , , , expected]) => (expected > 0 ? [sqlRow("service", "standard", code, expected, "seed", now)] : [])).join(", ")};`,
    `INSERT OR IGNORE INTO stock_movements (id, consumable_code, location, technician_id, quantity, reason, transfer_id,
       actor_kind, actor, created_at) VALUES ${moved.join(", ")};`,
  ];
}

/**
 * The four hair systems a first fit is sold as, as first-fit services, each with a made-up price, as ops keep them in
 * Settings · Services (src/config/local-hair-systems.ts). The generic "First fit" the migrations add is retired, as
 * ops retire it in the console, so a first fit is only ever one of these. Once only.
 */
function products(now: string): string[] {
  return [
    `INSERT OR IGNORE INTO services (kind, tier, name, minutes, sort, updated_by, updated_at) VALUES
       ${LOCAL_HAIR_SYSTEMS.map(({ tier, name }, index) => sqlRow("first_fit", tier, name, 180, index + 1, "seed", now)).join(", ")};`,
    `INSERT OR IGNORE INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES
       ${LOCAL_HAIR_SYSTEMS.map(({ tier, price }) => sqlRow("first_fit", tier, price, 0, "2026-01-01")).join(", ")};`,
    `UPDATE services SET retired_date = '${indiaDate(0)}', updated_by = 'seed', updated_at = '${now}'
       WHERE kind = 'first_fit' AND tier = 'standard' AND retired_date IS NULL;`,
  ];
}

async function seedTechnician(): Promise<void> {
  const now = new Date().toISOString();
  const visit = (date: string, window: keyof typeof WINDOWS) => {
    const id = crypto.randomUUID();
    return sqlRow(
      id,
      `local-${id}`,
      CLIENT.id,
      "service",
      `${date}T${WINDOWS[window].start}:00.000Z`,
      `${date}T${WINDOWS[window].end}:00.000Z`,
      TECHNICIAN.id,
      "scheduled",
      "Gurgaon",
      "122018",
      now,
    );
  };
  const sql = [
    `INSERT OR IGNORE INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
       VALUES ${sqlRow(TECHNICIAN.id, TECHNICIAN.fsmId, TECHNICIAN.name, "SY", 1, "Gurgaon", `+91${TECHNICIAN.mobile}`, now)};`,
    `UPDATE technicians SET active = 1, updated_at = '${now}' WHERE id = '${TECHNICIAN.id}';`,
    `INSERT OR IGNORE INTO people (id, created_at, mobile_e164, name, contactable)
       VALUES ${sqlRow(CLIENT.id, now, `+91${CLIENT.mobile}`, CLIENT.name, 1)};`,
    // No coordinates, as an address typed rather than chosen has none: "I have arrived" then passes anywhere,
    // which a laptop needs, having no position to give (src/domain/check-ins.ts).
    `INSERT OR IGNORE INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, access_notes,
       lat, lng) VALUES ${sqlRow(CLIENT.addressId, CLIENT.id, now, "Tower C, 14th floor", null, "Sector 65", "Gurgaon", "122018", "Gate code 4417", null, null)};`,
    `UPDATE appointments SET status = 'cancelled', synced_at = '${now}'
       WHERE technician_id = '${TECHNICIAN.id}' AND fsm_id LIKE 'local-%' AND status = 'scheduled';`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
       service_city, service_pincode, synced_at) VALUES
       ${visit(indiaDate(0), "morning")}, ${visit(indiaDate(0), "afternoon")}, ${visit(indiaDate(1), "morning")};`,
    ...consumables(now),
    ...products(now),
  ];
  const folder = await mkdtemp(join(tmpdir(), "mm-seed-"));
  try {
    await writeFile(join(folder, "technician.sql"), sql.join("\n"));
    await wrangler("d1", "execute", "DB", "--local", "--file", join(folder, "technician.sql"));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

const spaced = (mobile: string) => `${mobile.slice(0, 5)} ${mobile.slice(5)}`;

await seedBookingArea();
await seedFitted();
await seedChanging();
await seedTechnician();

const fitted = fittedClient();
const { free, late } = changingClients();
console.log(`
Seeded. Every login code is ${LOCAL_LOGIN_CODE}.
  client app (http://app.localhost:${String(PORTS.app)})
    ${spaced(fitted.mobile)}   fitted, with past visits, pieces, payments and photographs
    ${spaced(free.mobile)}   a paid visit in five days, free to move or cancel
    ${spaced(late.mobile)}   a paid visit in three hours, inside the 24 hours a change is charged in
  technician app (http://tech.localhost:${String(PORTS.tech)})
    ${spaced(TECHNICIAN.mobile)}   ${TECHNICIAN.name}: two jobs today and one tomorrow at ${CLIENT.name}'s
  the four products a consultation and fit in one visit offers, as first-fit services, with made-up prices
`);
