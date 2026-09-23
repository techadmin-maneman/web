// The fixtures the technician app's real-wire proof runs on, written straight
// into the **staging** database, the way e2e/app/fitted.ts writes the local one:
//
//   a technician   invented, with a random test mobile number
//   a client       invented, with a Gurgaon address that has coordinates
//   three jobs     today, tomorrow and three days out, so the day-before unlock
//                  can be seen from both sides
//   a session      bound to one phone, because the right code cannot be read
//
// **Staging only.** Every call names `maneman-staging` and passes `--env staging`,
// so there is no path from here to production.
//
// No real person. Both numbers are random `9xxxxxxxxx` test numbers, the house's
// convention since M2; India publishes no reserved test range for mobiles. Nothing
// is sent to either: staging sends codes and messages to its allowlist only
// (src/http/send-code.ts), and neither number is on it.
//
// **Why the session is written rather than logged in to.** A code is stored as an
// HMAC under `OTP_PEPPER`, a Worker secret, and staging has no fixed code
// (`OTP_FIXED_CODE` is refused outside local, src/config/settings.ts). So the one
// leg of sign-in a desktop cannot walk is the right code; the proof walks the rest
// through the app and writes the session `openTechnicianSession` would have
// written (src/domain/technicians.ts). The token is generated here and never
// printed.

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const WRANGLER = resolve("node_modules/wrangler/bin/wrangler.js");
const DATABASE = "maneman-staging";
const BUCKET = "mm-staging-client-photos";
const DAY_MS = 24 * 60 * 60 * 1000;
/** India is five and a half hours ahead of UTC, all year. */
const INDIA_OFFSET_MS = 330 * 60 * 1000;

/** Where the global setup leaves the fixtures for the tests, as e2e/app/fitted.ts does. */
const HANDOVER = "MM_TECH_STAGING";

/** Everything the proof needs to know about what was seeded. */
export interface StagingFixture {
  /** Marks every row this run wrote, so the teardown can find them all. */
  readonly tag: string;
  /** When the seed ran, which bounds what the teardown may take out. */
  readonly startedAt: string;
  readonly technicianId: string;
  readonly technicianName: string;
  /** Ten digits, as the sign-in's field takes them. */
  readonly technicianMobile: string;
  /** A number no technician is listed under, for the leg of sign-in that must send nothing at all. */
  readonly unknownMobile: string;
  readonly deviceId: string;
  /** The mm_tech cookie's value. Never logged. */
  readonly sessionToken: string;
  readonly personId: string;
  readonly clientName: string;
  readonly today: Job;
  readonly tomorrow: Job;
  readonly later: Job;
  /** The address the geofence measures against. */
  readonly address: { readonly lat: number; readonly lng: number };
  readonly sector: string;
}

export interface Job {
  readonly id: string;
  /** India's calendar date, YYYY-MM-DD. */
  readonly date: string;
}

/** The address the proof's jobs are at: a Gurgaon office block, not anybody's home. */
const ADDRESS = { lat: 28.4595, lng: 77.0266 } as const;
const SECTOR = "Sector 24";

/** A point about 40 m from the address: inside the 200 m fence. */
export const INSIDE = { latitude: 28.4598, longitude: 77.0268, accuracy: 12 } as const;
/** A point about 610 m from the address: outside it. */
export const OUTSIDE = { latitude: 28.465, longitude: 77.0266, accuracy: 25 } as const;

const wrangler = (...args: string[]) => run(process.execPath, [WRANGLER, ...args], { cwd: resolve(".") });

const quote = (value: string | number | null) =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
const row = (...values: (string | number | null)[]) => `(${values.map(quote).join(", ")})`;

/** Runs SQL on the staging database. A file, not a command, so quoting is the file's problem and not the shell's. */
async function execute(statements: readonly string[]): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), "mm-tech-staging-"));
  try {
    const file = join(folder, "statements.sql");
    await writeFile(file, statements.join("\n"));
    await wrangler("d1", "execute", DATABASE, "--env", "staging", "--remote", "--file", file);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Reads rows from the staging database. */
export async function query<T>(sql: string): Promise<T[]> {
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
function indiaDate(days: number): string {
  return new Date(Date.now() + INDIA_OFFSET_MS + days * DAY_MS).toISOString().slice(0, 10);
}

/** The morning window on an India date, as UTC instants: 10:00 to 11:30 India. */
function morning(date: string): { start: string; end: string } {
  return { start: `${date}T04:30:00.000Z`, end: `${date}T06:00:00.000Z` };
}

/** A random ten-digit test number, as every staging proof since M2 has used. */
const testMobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;

export async function seedStaging(): Promise<StagingFixture> {
  const id = () => crypto.randomUUID();
  const tag = id().slice(0, 8);
  const now = new Date().toISOString();
  const [technicianId, personId, addressId] = [id(), id(), id()];
  const jobs = { today: id(), tomorrow: id(), later: id() };
  const dates = { today: indiaDate(0), tomorrow: indiaDate(1), later: indiaDate(3) };

  // The cookie's token, and the SHA-256 of it that the sessions table holds
  // (src/domain/sessions.ts). The token itself is never stored and never logged.
  const sessionToken = randomBytes(32).toString("base64url");
  const sessionId = createHash("sha256").update(sessionToken).digest("hex");
  const deviceId = id();
  const expiresAt = new Date(Date.now() + 90 * DAY_MS).toISOString();

  const technicianMobile = testMobile();
  const clientMobile = testMobile();
  const technicianName = "Staging Technician";
  const clientName = "Staging test";

  const appointment = (jobId: string, date: string) => {
    const when = morning(date);
    return row(
      jobId,
      `tech-proof-${tag}-${jobId}`,
      personId,
      "service",
      when.start,
      when.end,
      technicianId,
      "scheduled",
      "Scheduled",
      "Gurgaon",
      "122022",
      now,
      now,
    );
  };

  await execute([
    `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at, mobile_e164)
       VALUES ${row(technicianId, `tech-proof-${tag}`, technicianName, "ST", 1, now, `+91${technicianMobile}`)};`,
    `INSERT INTO people (id, created_at, mobile_e164, name, contactable)
       VALUES ${row(personId, now, `+91${clientMobile}`, clientName, 1)};`,
    `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, access_notes, lat, lng,
       geocoded_at)
       VALUES ${row(addressId, personId, now, "Tower C, 14th floor", null, SECTOR, "Gurgaon", "122022", "PLACEHOLDER Gate code on the proof fixture", ADDRESS.lat, ADDRESS.lng, now)};`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
       fsm_status, service_city, service_pincode, fsm_modified_at, synced_at) VALUES
       ${appointment(jobs.today, dates.today)},
       ${appointment(jobs.tomorrow, dates.tomorrow)},
       ${appointment(jobs.later, dates.later)};`,
    `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at, device_label)
       VALUES ${row(sessionId, "technician", technicianId, now, now, expiresAt, "Chrome on the proof's desktop")};`,
    `INSERT INTO technician_devices (id, technician_id, device_id, session_id, label, created_at, last_seen_at)
       VALUES ${row(id(), technicianId, deviceId, sessionId, "Chrome on the proof's desktop", now, now)};`,
  ]);

  const fixture: StagingFixture = {
    tag,
    startedAt: now,
    technicianId,
    technicianName,
    technicianMobile,
    unknownMobile: testMobile(),
    deviceId,
    sessionToken,
    personId,
    clientName,
    today: { id: jobs.today, date: dates.today },
    tomorrow: { id: jobs.tomorrow, date: dates.tomorrow },
    later: { id: jobs.later, date: dates.later },
    address: ADDRESS,
    sector: SECTOR,
  };
  process.env[HANDOVER] = JSON.stringify(fixture);
  return fixture;
}

/** The fixtures the global setup seeded. */
export function stagingFixture(): StagingFixture {
  const handed = process.env[HANDOVER];
  if (handed === undefined) throw new Error("no staging fixture: e2e/tech-staging/global-setup.ts seeds one");
  return JSON.parse(handed) as StagingFixture;
}

/**
 * Takes every row and every photograph this run wrote back out of staging.
 * It runs promptly, because a job event whose FSM write keeps failing alerts
 * ops on its fifth attempt: with the event gone, the fsm-sync consumer
 * acknowledges the message and says nothing (src/queues/fsm-sync.ts).
 */
export async function clearStaging(fixture: StagingFixture): Promise<void> {
  const ids = [fixture.today.id, fixture.tomorrow.id, fixture.later.id].map(quote).join(", ");

  const photos = await query<{ r2_key: string }>(
    `SELECT p.r2_key FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id WHERE s.appointment_id IN (${ids});`,
  );
  for (const photo of photos) {
    await wrangler("r2", "object", "delete", `${BUCKET}/${photo.r2_key}`, "--remote").catch(() => undefined);
  }

  await execute([
    `DELETE FROM job_events WHERE appointment_id IN (${ids});`,
    `DELETE FROM consumables_used WHERE appointment_id IN (${ids});`,
    `DELETE FROM no_show_cases WHERE appointment_id IN (${ids});`,
    `DELETE FROM checkins WHERE appointment_id IN (${ids});`,
    `DELETE FROM photos WHERE photo_set_id IN (SELECT id FROM photo_sets WHERE appointment_id IN (${ids}));`,
    `DELETE FROM photo_sets WHERE appointment_id IN (${ids});`,
    `DELETE FROM appointments WHERE id IN (${ids});`,
    `DELETE FROM addresses WHERE person_id = ${quote(fixture.personId)};`,
    `DELETE FROM people WHERE id = ${quote(fixture.personId)};`,
    `DELETE FROM otp_challenges WHERE technician_id = ${quote(fixture.technicianId)};`,
    // The challenge for a number FSM does not list holds no technician and no code hash.
    `DELETE FROM otp_challenges WHERE technician_login = 1 AND technician_id IS NULL
       AND created_at >= ${quote(fixture.startedAt)};`,
    `DELETE FROM technician_devices WHERE technician_id = ${quote(fixture.technicianId)};`,
    `DELETE FROM sessions WHERE subject_kind = 'technician' AND subject_id = ${quote(fixture.technicianId)};`,
    `DELETE FROM technicians WHERE id = ${quote(fixture.technicianId)};`,
  ]);
}
