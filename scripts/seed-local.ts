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
import { fittedClient, row, seedFitted, wrangler } from "../e2e/app/fitted.ts";
import { seedBookingArea } from "../e2e/booking-area.ts";
import { LOCAL_LOGIN_CODE, PORTS } from "./lib/local-stack.ts";

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

async function seedTechnician(): Promise<void> {
  const now = new Date().toISOString();
  const visit = (date: string, window: keyof typeof WINDOWS) => {
    const id = crypto.randomUUID();
    return row(
      id,
      `local-${id}`,
      CLIENT.id,
      "service",
      `${date}T${WINDOWS[window].start}:00.000Z`,
      `${date}T${WINDOWS[window].end}:00.000Z`,
      TECHNICIAN.id,
      "scheduled",
      "Scheduled",
      "Gurgaon",
      "122018",
      now,
      now,
    );
  };
  const sql = [
    `INSERT OR IGNORE INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
       VALUES ${row(TECHNICIAN.id, TECHNICIAN.fsmId, TECHNICIAN.name, "SY", 1, "Gurgaon", `+91${TECHNICIAN.mobile}`, now)};`,
    `UPDATE technicians SET active = 1, updated_at = '${now}' WHERE id = '${TECHNICIAN.id}';`,
    `INSERT OR IGNORE INTO people (id, created_at, mobile_e164, name, contactable)
       VALUES ${row(CLIENT.id, now, `+91${CLIENT.mobile}`, CLIENT.name, 1)};`,
    // No coordinates, as an address typed rather than chosen has none: "I have arrived" then passes anywhere,
    // which a laptop needs, having no position to give (src/domain/check-ins.ts).
    `INSERT OR IGNORE INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, access_notes,
       lat, lng) VALUES ${row(CLIENT.addressId, CLIENT.id, now, "Tower C, 14th floor", null, "Sector 65", "Gurgaon", "122018", "Gate code 4417", null, null)};`,
    `UPDATE appointments SET status = 'cancelled', fsm_status = 'Cancelled', synced_at = '${now}'
       WHERE technician_id = '${TECHNICIAN.id}' AND fsm_id LIKE 'local-%' AND status = 'scheduled';`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
       fsm_status, service_city, service_pincode, fsm_modified_at, synced_at) VALUES
       ${visit(indiaDate(0), "morning")}, ${visit(indiaDate(0), "afternoon")}, ${visit(indiaDate(1), "morning")};`,
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
`);
