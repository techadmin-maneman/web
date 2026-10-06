// The technician and the two jobs the real-wire run works (e2e/tech-live/day.e2e.ts), written into the local
// database the local mm-api reads, as e2e/app/fitted.ts writes its client. Every name and number is made up.
//
//   a technician   new each run, with a random number: the sign-in is walked through the app with the local
//                  fixed code. His fsm_id starts "e2e-", so the next run's seeds retire him and cancel what he
//                  left booked (e2e/technicians.ts).
//   two clients    at one address the geofence measures against, one job each: one technician never takes two
//                  of a client's visits in a row (ADR 0111), so the second job's move needs a client of its own
//   two jobs       today, a little ahead, so the phone may check in now (src/policy/phone-clock.ts): the first
//                  is worked to its close, the second is moved by ops while the phone holds it

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqlRow } from "../../scripts/lib/sql-literal.ts";
import { wrangler } from "../app/fitted.ts";
import { randomMobile } from "../support.ts";

const MINUTE = 60 * 1000;
const INDIA_OFFSET = 330 * MINUTE;

/** Where the global setup leaves the fixture for the tests. */
const HANDOVER = "MM_E2E_TECH_LIVE";

/** The address the jobs are at: a Gurgaon office block, not anybody's home. */
const ADDRESS = { lat: 28.4595, lng: 77.0266 } as const;
/** A point about 40 m from the address, well inside any fence ops set. */
export const AT_THE_DOOR = { latitude: 28.4598, longitude: 77.0268, accuracy: 12 } as const;

export interface LiveJob {
  readonly id: string;
  /** The start the phone holds, as the API writes it. */
  readonly startsAt: string;
}

export interface LiveDay {
  readonly technicianId: string;
  /** Ten digits, as the sign-in's field takes them. */
  readonly mobile: string;
  /** The client, as the unlocked card names them. */
  readonly client: string;
  readonly worked: LiveJob;
  readonly moved: LiveJob;
}

/** `minutes` from now, held to today in India, so a run just before midnight still has its jobs today. */
function laterToday(minutes: number): Date {
  const now = Date.now();
  const endOfDay = Date.parse(`${new Date(now + INDIA_OFFSET).toISOString().slice(0, 10)}T23:59:00+05:30`);
  return new Date(Math.min(now + minutes * MINUTE, endOfDay));
}

export async function seedTechLive(): Promise<void> {
  const id = () => crypto.randomUUID();
  const now = new Date().toISOString();
  const [technicianId, person, otherPerson] = [id(), id(), id()];
  const mobile = randomMobile();
  const job = (minutes: number): LiveJob => ({ id: id(), startsAt: laterToday(minutes).toISOString() });
  const worked = job(15);
  const moved = job(20);
  const appointment = ({ id: jobId, startsAt }: LiveJob, client: string) =>
    sqlRow(
      jobId,
      `e2e-${jobId}`,
      client,
      "service",
      startsAt,
      new Date(Date.parse(startsAt) + 90 * MINUTE).toISOString(),
      technicianId,
      "scheduled",
      "Scheduled",
      "Gurgaon",
      "122022",
      now,
      now,
    );

  const address = (client: string) =>
    sqlRow(id(), client, now, "Tower B, 6th floor", "Sector 24", "Gurgaon", "122022", ADDRESS.lat, ADDRESS.lng, now);

  const sql = [
    `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at, mobile_e164, hand_written)
       VALUES ${sqlRow(technicianId, `e2e-live-${technicianId}`, "Vikas Rana", "VR", 1, now, `+91${mobile}`, 1)};`,
    `INSERT INTO people (id, created_at, mobile_e164, name) VALUES
       ${sqlRow(person, now, `+91${randomMobile()}`, "Arjun Mehta")},
       ${sqlRow(otherPerson, now, `+91${randomMobile()}`, "Kabir Anand")};`,
    `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, lat, lng, geocoded_at) VALUES
       ${address(person)},
       ${address(otherPerson)};`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
       fsm_status, service_city, service_pincode, fsm_modified_at, synced_at) VALUES
       ${appointment(worked, person)},
       ${appointment(moved, otherPerson)};`,
  ];
  const folder = await mkdtemp(join(tmpdir(), "mm-e2e-live-"));
  try {
    await writeFile(join(folder, "seed.sql"), sql.join("\n"));
    await wrangler("d1", "execute", "DB", "--local", "--file", join(folder, "seed.sql"));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }

  const day: LiveDay = { technicianId, mobile, client: "Arjun Mehta", worked, moved };
  process.env[HANDOVER] = JSON.stringify(day);
}

/** The day the global setup seeded. */
export function liveDay(): LiveDay {
  const handed = process.env[HANDOVER];
  if (handed === undefined) throw new Error("no technician's day: e2e/global-setup.ts seeds one");
  return JSON.parse(handed) as LiveDay;
}
