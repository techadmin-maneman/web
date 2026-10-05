// The day the field tests start from (test/worker/field-*.test.ts). NOW is Monday 21 September 2026, 12 noon in India.
// Every name, number, address and photograph here is made up.

import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import { uuidv7 } from "../../apps/tech/src/store/uuidv7.ts";
import type { App } from "../../src/http/context.ts";
import { openTechnicianSession } from "../../src/domain/technicians.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request, type TestDependencies } from "./helpers.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";
export const TODAY_JOB = "22222222-2222-4222-8222-222222222221";
export const LATER_JOB = "22222222-2222-4222-8222-222222222222";
export const OTHER_JOB = "22222222-2222-4222-8222-222222222223";
/** Imran and Sameer, made up. */
export const IMRAN = "33333333-3333-4333-8333-333333333331";
export const SAMEER = "33333333-3333-4333-8333-333333333332";
export const DEVICE = "phone-abc-123";

/** The address the job goes to: House 7, Sector 65, Gurgaon. */
export const ADDRESS = { lat: 28.398, lng: 77.07 };
/** About 90 m north of it: inside the 200 m geofence. */
export const AT_THE_DOOR = { lat: 28.3988, lng: 77.07 };
/** About 2.2 km east: outside it. */
export const DOWN_THE_ROAD = { lat: 28.398, lng: 77.0925 };

export let tech: App;
export let ops: App;
export let deps: TestDependencies;
export let messageQueue: ReturnType<typeof fakeQueue>;
export let cookie: string;

export async function insertJob(
  id: string,
  options: { start: string; technician?: string | null; type?: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
       service_city, service_pincode, synced_at)
     VALUES (?1, ?1, ?2, ?3, 'scheduled', ?4, ?5, ?6, 'Gurgaon', '122018', ?7)`,
  )
    .bind(
      id,
      PERSON,
      options.type ?? "service",
      options.start,
      new Date(Date.parse(options.start) + 90 * 60_000).toISOString(),
      options.technician === undefined ? IMRAN : options.technician,
      NOW.toISOString(),
    )
    .run();
}

/** The day every field test starts from: two technicians, a client, two jobs and a signed-in phone. */
export function useFieldDay(): void {
  beforeEach(async () => {
    await markDatabase();
    messageQueue = fakeQueue();
    deps = depsAt(NOW);
    tech = appFor("local", deps, {}, "tech");
    ops = appFor("local", deps, {}, "ops");

    await env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
       VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Gurgaon', '+919810000009', ?3),
              (?2, ?2, 'Sameer Bhatt', 'SB', 1, 'Gurgaon', '+919810000008', ?3)`,
    )
      .bind(IMRAN, SAMEER, NOW.toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, access_notes, lat, lng,
         geocoded_at)
       VALUES ('addr-1', ?1, ?2, 'House 7', NULL, 'Sector 65', 'Gurgaon', '122018', 'Gate 4417, visitor bay B',
         ?3, ?4, ?2)`,
    )
      .bind(PERSON, NOW.toISOString(), ADDRESS.lat, ADDRESS.lng)
      .run();

    // Today at 13:00 in India, and one four days out.
    await insertJob(TODAY_JOB, { start: "2026-09-21T07:30:00.000Z" });
    await insertJob(LATER_JOB, { start: "2026-09-25T04:30:00.000Z" });

    cookie = `mm_tech=${await openTechnicianSession(env.DB, {
      technicianId: IMRAN,
      deviceId: DEVICE,
      label: "Chrome on Android",
      now: NOW,
    })}`;
  });
}

/** The dependencies a request runs with at `now`. */
export const depsAt = (now: Date): TestDependencies => fakeDependencies({ now: () => now });

/** The technician app's API, answering at `now`. */
export const techAt = (now: Date): App => appFor("local", depsAt(now), {}, "tech");

export const bindings = () => ({ MESSAGE_QUEUE: messageQueue }) as unknown as Partial<Env>;

export const get = (path: string) => request(tech, path, { headers: { Cookie: cookie } }, bindings());

export const post = (path: string, body: unknown, eventId: string) =>
  request(
    tech,
    path,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://maneman.test",
        "Content-Type": "application/json",
        "X-Client-Event-Id": eventId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings(),
  );

export const opsPost = (path: string, body: unknown) =>
  request(
    ops,
    path,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    bindings(),
  );

/** A write that reaches the API at `at`, as a phone replaying its outbox from a basement does. */
export const postAt = (at: Date, path: string, body: unknown, eventId: string, headers: Record<string, string> = {}) =>
  request(
    techAt(at),
    path,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://maneman.test",
        "Content-Type": "application/json",
        "X-Client-Event-Id": eventId,
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings(),
  );

/** Today's job starts at 13:00 in India. */
export const TODAY_START = new Date("2026-09-21T07:30:00.000Z");
/** Today's job as a dispatch board loaded now shows it, which every move sends. */
export const AS_THE_BOARD_SHOWS_IT = { expected_technician_id: IMRAN, expected_starts_at: TODAY_START.toISOString() };
export const minutesAfterStart = (minutes: number) => new Date(TODAY_START.getTime() + minutes * 60_000);
/** The event ID the app makes for a write queued that many minutes after the start. */
export const uuidv7At = (minutes: number) => uuidv7(minutesAfterStart(minutes).getTime());

/** Checks in at the door and starts the job, which every later step needs. */
export async function startJob(): Promise<void> {
  await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
  await post(`/api/tech/jobs/${TODAY_JOB}/start`, undefined, "event-start-01");
}

/** The five before photographs, step one, which the checklist follows. */
export async function beforePhotos(): Promise<void> {
  await post(`/api/tech/jobs/${TODAY_JOB}/photos`, { phase: "before" }, "event-photos-01");
}
