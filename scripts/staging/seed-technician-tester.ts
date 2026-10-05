// A technician in staging's database whom a real person signs in as, on his own
// phone, with jobs to walk (docs/technician-test-setup.md).
//
//   TECH_TESTER_MOBILE=98110xxxxx node scripts/staging/seed-technician-tester.ts
//   TECH_TESTER_MOBILE=98110xxxxx node scripts/staging/seed-technician-tester.ts --clear
//
// **Staging only.** Every call names `maneman-staging` and passes `--env
// staging`, so there is no path from here to production.
//
// The tester's number belongs to a real person, so it is read from the
// environment and never written down: not in this file, not in a fixture, and
// not in anything this prints. Everybody else in the fixture is invented — the
// technician's name is plainly made up, and the client is "Staging test" with a
// random `9xxxxxxxxx` number, the house's convention since M2.
//
// No device and no session are written. The whole point is that the tester
// signs in himself, and the first sign-in enrols the phone it is made from
// (`openTechnicianSession`, src/domain/technicians.ts).
//
// The login reads `technicians` in D1 and nowhere else
// (docs/decisions/0052-technician-sessions.md). His row is marked
// `hand_written`, as every technician a script writes is (migration 0046), and
// his jobs are visits like any other: each step he sends lands as it would on a
// real job.

import { parseArgs } from "node:util";
import { indiaDate } from "../../src/lib/india-time.ts";
import { d1Execute, d1Query } from "../lib/d1.ts";
import { clearTester } from "../lib/technician-tester.ts";
import { sqlLiteral, sqlRow } from "../lib/sql-literal.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The mark on every row this script writes: a row whose `fsm_id` begins with this
 * is one of its own, and no other row can be mistaken for it, which is what lets
 * --clear delete.
 */
const FSM_ID_PREFIX = "tech-tester-";

/** Gurgaon, where the serviceable pincodes are: the zone the dispatch board groups him by. */
const ZONE = "Gurgaon";
/** A served Gurgaon pincode (`serviceable_pincodes`), so the job sits inside the area we cover. */
const PINCODE = "122003";
const SECTOR = "Sector 45";

const { values: options } = parseArgs({ options: { clear: { type: "boolean", default: false } } });

const mobile = process.env.TECH_TESTER_MOBILE ?? "";
if (!/^[6-9]\d{9}$/.test(mobile)) {
  console.error("set TECH_TESTER_MOBILE to the tester's ten digits, e.g. TECH_TESTER_MOBILE=98110xxxxx");
  process.exit(1);
}
const mobileE164 = `+91${mobile}`;

/**
 * Runs SQL on the staging database. A file, not a command, so quoting is the
 * file's problem and not the shell's, and so the number never reaches a command
 * line. It is tried twice, as e2e/tech-staging/seed.ts is: D1 has answered a
 * statement with `{"D1_RESET_DO":true}` and done nothing.
 */
function execute(statements: readonly string[]): void {
  try {
    d1Execute("staging", statements);
  } catch {
    d1Execute("staging", statements);
  }
}

/** India's calendar date `days` from today. */
const indiaDay = (days: number) => indiaDate(new Date(Date.now() + days * DAY_MS));

/** The morning window on an India date, as UTC instants: 10:00 to 11:30 India, a service visit's 90 minutes. */
const morning = (date: string) => ({ start: `${date}T04:30:00.000Z`, end: `${date}T06:00:00.000Z` });

const existing = d1Query<{ id: string; fsm_id: string; name: string }>(
  "staging",
  `SELECT id, fsm_id, name FROM technicians WHERE mobile_e164 = ${sqlLiteral(mobileE164)};`,
);
const ours = existing.filter((technician) => technician.fsm_id.startsWith(FSM_ID_PREFIX));

if (options.clear) {
  if (ours.length === 0) {
    console.log("nothing to clear: no test technician is on that number");
    process.exit(0);
  }
  const ids = ours.map((technician) => sqlLiteral(technician.id)).join(", ");
  const people = d1Query<{ person_id: string }>(
    "staging",
    `SELECT DISTINCT person_id FROM appointments WHERE technician_id IN (${ids}) AND person_id IS NOT NULL;`,
  );
  execute(
    clearTester(
      ours.map((technician) => technician.id),
      people.map((person) => person.person_id),
    ),
  );
  // The photographs themselves stay in R2 until ops delete them; the field test's
  // command lists them, and they are of whoever the tester photographed.
  console.log(`cleared ${String(ours.length)} test technician and everything hanging off it`);
  process.exit(0);
}

if (existing.length > 0) {
  console.error(
    `a technician already holds that number in staging (${existing.map((one) => one.name).join(", ")}). ` +
      "Two active rows on one number and the login picks either: clear it first, with --clear.",
  );
  process.exit(1);
}

const id = () => crypto.randomUUID();
const tag = id().slice(0, 8);
const now = new Date().toISOString();
const [technicianId, personId, addressId] = [id(), id(), id()];
const jobs = { today: id(), tomorrow: id(), later: id() };
const dates = { today: indiaDay(0), tomorrow: indiaDay(1), later: indiaDay(3) };

// A random ten-digit test number for the invented client, as every staging fixture since M2 has used.
const clientMobile = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;

const appointment = (jobId: string, date: string) => {
  const when = morning(date);
  return sqlRow(
    jobId,
    `${FSM_ID_PREFIX}${tag}-${jobId}`,
    personId,
    "service",
    when.start,
    when.end,
    technicianId,
    "scheduled",
    "Gurgaon",
    PINCODE,
    now,
  );
};

execute([
  `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at, hand_written)
     VALUES ${sqlRow(technicianId, `${FSM_ID_PREFIX}${tag}`, "Test Technician", "TT", 1, ZONE, mobileE164, now, 1)};`,
  `INSERT INTO people (id, created_at, mobile_e164, name, contactable, test_record)
     VALUES ${sqlRow(personId, now, `+91${clientMobile}`, "Staging test", 1, 1)};`,
  // No lat or lng, on purpose. An address with no coordinates cannot be measured
  // against, so "I have arrived" is accepted wherever the tester is standing
  // (src/domain/check-ins.ts). The 200 m geofence is docs/tech-field-test.md's
  // to measure, at real addresses.
  `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, access_notes, lat, lng)
     VALUES ${sqlRow(addressId, personId, now, "Tower C, 14th floor", null, SECTOR, "Gurgaon", PINCODE, "PLACEHOLDER Gate code on the test fixture", null, null)};`,
  `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
     service_city, service_pincode, synced_at) VALUES
     ${appointment(jobs.today, dates.today)},
     ${appointment(jobs.tomorrow, dates.tomorrow)},
     ${appointment(jobs.later, dates.later)};`,
]);

// Never the numbers.
console.log(`technician ${technicianId} (Test Technician, zone ${ZONE}), client ${personId} (Staging test)`);
console.log(`today    ${dates.today}  job ${jobs.today}`);
console.log(`tomorrow ${dates.tomorrow}  job ${jobs.tomorrow}`);
console.log(`later    ${dates.later}  job ${jobs.later}`);
