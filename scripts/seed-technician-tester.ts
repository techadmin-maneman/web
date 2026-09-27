// A technician in staging's database whom a real person signs in as, on his own
// phone, with jobs to walk (docs/technician-test-setup.md).
//
//   TECH_TESTER_MOBILE=98110xxxxx node scripts/seed-technician-tester.ts
//   TECH_TESTER_MOBILE=98110xxxxx node scripts/seed-technician-tester.ts --clear
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
// Nothing is written to FSM, and nothing needs to be: the login reads
// `technicians` in D1 and nowhere else (docs/decisions/0052-technician-sessions.md).
// The jobs are mirror rows with no Zoho record behind them, so each job event's
// write to FSM will fail; docs/technician-test-setup.md says what that looks
// like and who sees it.

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";

const run = promisify(execFile);
const WRANGLER = resolve("node_modules/wrangler/bin/wrangler.js");
const DATABASE = "maneman-staging";
const DAY_MS = 24 * 60 * 60 * 1000;
/** India is five and a half hours ahead of UTC, all year. */
const INDIA_OFFSET_MS = 330 * 60 * 1000;

/**
 * The mark on every row this script writes. The FSM mirror writes a technician
 * under FSM's own ID, so a row whose `fsm_id` begins with this is one of ours
 * and no mirror row can be mistaken for it — which is what lets --clear delete.
 */
const FSM_ID_PREFIX = "tech-tester-";

/** Gurgaon, where the serviceable pincodes are: FSM's territory, as the dispatch board groups by it. */
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

const wrangler = (...args: string[]) => run(process.execPath, [WRANGLER, ...args], { cwd: resolve(".") });

const quote = (value: string | number | null) =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
const row = (...values: (string | number | null)[]) => `(${values.map(quote).join(", ")})`;

/**
 * Runs SQL on the staging database. A file, not a command, so quoting is the
 * file's problem and not the shell's, and so the number never reaches a command
 * line. It is tried twice, as e2e/tech-staging/seed.ts is: D1 has answered a
 * statement with `{"D1_RESET_DO":true}` and done nothing.
 */
async function execute(statements: readonly string[]): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), "mm-tech-tester-"));
  try {
    const file = join(folder, "statements.sql");
    await writeFile(file, statements.join("\n"));
    try {
      await wrangler("d1", "execute", DATABASE, "--env", "staging", "--remote", "--file", file);
    } catch {
      await wrangler("d1", "execute", DATABASE, "--env", "staging", "--remote", "--file", file);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Reads rows from the staging database. */
async function query<T>(sql: string): Promise<T[]> {
  const { stdout } = await wrangler(
    "d1",
    "execute",
    DATABASE,
    "--env",
    "staging",
    "--remote",
    "--json",
    "--command",
    sql,
  );
  // wrangler prints its banner before the JSON when the terminal is not a TTY.
  const start = stdout.indexOf("[");
  if (start < 0) throw new Error("the staging query answered nothing that looks like JSON");
  const answers = JSON.parse(stdout.slice(start)) as { results: T[] }[];
  return answers[0]?.results ?? [];
}

/** India's calendar date `days` from today. */
const indiaDate = (days: number) => new Date(Date.now() + INDIA_OFFSET_MS + days * DAY_MS).toISOString().slice(0, 10);

/** The morning window on an India date, as UTC instants: 10:00 to 11:30 India, a service visit's 90 minutes. */
const morning = (date: string) => ({ start: `${date}T04:30:00.000Z`, end: `${date}T06:00:00.000Z` });

const existing = await query<{ id: string; fsm_id: string; name: string }>(
  `SELECT id, fsm_id, name FROM technicians WHERE mobile_e164 = ${quote(mobileE164)};`,
);
const ours = existing.filter((technician) => technician.fsm_id.startsWith(FSM_ID_PREFIX));

if (options.clear) {
  if (ours.length === 0) {
    console.log("nothing to clear: no test technician is on that number");
    process.exit(0);
  }
  const ids = ours.map((technician) => quote(technician.id)).join(", ");
  const people = await query<{ person_id: string }>(
    `SELECT DISTINCT person_id FROM appointments WHERE technician_id IN (${ids}) AND person_id IS NOT NULL;`,
  );
  const persons = people.map((person) => quote(person.person_id)).join(", ") || "NULL";
  await execute([
    // A job's use and what was used point at its events, and the kit's stock at the technician. A
    // transfer goes with both its rows, so the central store holds what it held before it.
    `DELETE FROM stock_movements WHERE technician_id IN (${ids})
       OR appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}))
       OR transfer_id IN (SELECT transfer_id FROM stock_movements WHERE technician_id IN (${ids}));`,
    `DELETE FROM consumables_used WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM job_events WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM no_show_cases WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM checkins WHERE technician_id IN (${ids});`,
    `DELETE FROM photos WHERE photo_set_id IN (SELECT id FROM photo_sets WHERE appointment_id IN
       (SELECT id FROM appointments WHERE technician_id IN (${ids})));`,
    `DELETE FROM photo_sets WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM outbound_messages WHERE subject_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    // Written if ops move one of the jobs on the dispatch board while the fixture stands.
    `DELETE FROM dispatch_moves WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM visit_changes WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM visits WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM appointments WHERE technician_id IN (${ids});`,
    `DELETE FROM addresses WHERE person_id IN (${persons});`,
    `DELETE FROM people WHERE id IN (${persons});`,
    `DELETE FROM otp_challenges WHERE technician_id IN (${ids});`,
    `DELETE FROM technician_devices WHERE technician_id IN (${ids});`,
    `DELETE FROM sessions WHERE subject_kind = 'technician' AND subject_id IN (${ids});`,
    // An active technician is one the booking availability offers, so something
    // else on staging can take a slot on him while the fixture stands.
    `DELETE FROM slot_claims WHERE technician_id IN (${ids});`,
    `DELETE FROM slot_holds WHERE technician_id IN (${ids});`,
    `DELETE FROM technicians WHERE id IN (${ids});`,
  ]);
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
const dates = { today: indiaDate(0), tomorrow: indiaDate(1), later: indiaDate(3) };

// A random ten-digit test number for the invented client, as every staging fixture since M2 has used.
const clientMobile = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;

const appointment = (jobId: string, date: string) => {
  const when = morning(date);
  return row(
    jobId,
    `${FSM_ID_PREFIX}${tag}-${jobId}`,
    personId,
    "service",
    when.start,
    when.end,
    technicianId,
    "scheduled",
    "Scheduled",
    "Gurgaon",
    PINCODE,
    now,
    now,
  );
};

await execute([
  `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
     VALUES ${row(technicianId, `${FSM_ID_PREFIX}${tag}`, "Test Technician", "TT", 1, ZONE, mobileE164, now)};`,
  `INSERT INTO people (id, created_at, mobile_e164, name, contactable)
     VALUES ${row(personId, now, `+91${clientMobile}`, "Staging test", 1)};`,
  // No lat or lng, on purpose. An address with no coordinates cannot be measured
  // against, so "I have arrived" is accepted wherever the tester is standing
  // (src/domain/check-ins.ts). The 200 m geofence is docs/tech-field-test.md's
  // to measure, at real addresses.
  `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, access_notes, lat, lng)
     VALUES ${row(addressId, personId, now, "Tower C, 14th floor", null, SECTOR, "Gurgaon", PINCODE, "PLACEHOLDER Gate code on the test fixture", null, null)};`,
  `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
     fsm_status, service_city, service_pincode, fsm_modified_at, synced_at) VALUES
     ${appointment(jobs.today, dates.today)},
     ${appointment(jobs.tomorrow, dates.tomorrow)},
     ${appointment(jobs.later, dates.later)};`,
]);

// Never the numbers.
console.log(`technician ${technicianId} (Test Technician, zone ${ZONE}), client ${personId} (Staging test)`);
console.log(`today    ${dates.today}  job ${jobs.today}`);
console.log(`tomorrow ${dates.tomorrow}  job ${jobs.tomorrow}`);
console.log(`later    ${dates.later}  job ${jobs.later}`);
