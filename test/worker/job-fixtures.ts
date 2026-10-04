// A technician working today's job, for the tests of what the job sheet and the
// consumables ask of the technician app (docs/decisions/0087-consumables-and-stock.md).
// NOW is Monday 21 September 2026, 12 noon in India; the job is at 13:00. Every
// name and number is made up.

import { env } from "cloudflare:workers";
import type { Settings } from "../../src/config/settings.ts";
import type { Dependencies } from "../../src/dependencies.ts";
import type { App } from "../../src/http/context.ts";
import { openTechnicianSession } from "../../src/domain/technicians.ts";
import { createStubFsm, EMPTY_FSM, type FsmAppointment, type StubFsm } from "../../src/providers/fsm.ts";
import { appFor, fakeDependencies, fakeQueue, NOW, request, type TestDependencies } from "./helpers.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";
export const JOB = "22222222-2222-4222-8222-222222222221";
/** Imran and Sameer, made up. */
export const IMRAN = "33333333-3333-4333-8333-333333333331";
export const SAMEER = "33333333-3333-4333-8333-333333333332";

/** About 90 m from the client's door: inside the geofence. */
const AT_THE_DOOR = { lat: 28.3988, lng: 77.07 };

const appointment = (id: string): FsmAppointment => ({
  id,
  name: `AP-${id}`,
  status: "Scheduled",
  workOrderId: `wo-${id}`,
  contactId: "contact-1",
  scheduledStart: null,
  scheduledEnd: null,
  actualStart: null,
  actualEnd: null,
  technicianIds: ["resource-1"],
  serviceIds: [],
  serviceCity: "Gurgaon",
  servicePincode: "122018",
  modifiedAt: "2026-09-21T12:00:00+05:30",
});

export interface Working {
  readonly tech: App;
  readonly ops: App;
  readonly deps: TestDependencies;
  readonly fsm: StubFsm;
  readonly fsmQueue: ReturnType<typeof fakeQueue>;
  /** A GET from the technician's phone. */
  readonly get: (path: string) => Promise<Response>;
  /** A write from the technician's phone, under the event ID its outbox gave it. */
  readonly post: (path: string, body: unknown, eventId: string) => Promise<Response>;
  /** A write from the console. */
  readonly opsPost: (path: string, body?: unknown) => Promise<Response>;
  /** Checks in, starts, and sends the steps before the one named. */
  readonly workTo: (step: "checklist" | "consumables" | "outcome") => Promise<void>;
}

/**
 * Imran, his phone signed in, and today's service visit to Rohit, ready to work, with any vendor and setting a test
 * gives.
 */
export async function working(
  type = "service",
  vendors: Partial<Dependencies> = {},
  settings: Partial<Settings> = {},
): Promise<Working> {
  const fsm = createStubFsm({ ...EMPTY_FSM, appointments: [appointment("ap-today")] });
  const fsmQueue = fakeQueue();
  const deps = fakeDependencies({ fsm, ...vendors });
  const tech = appFor("local", deps, settings, "tech");
  const ops = appFor("local", deps, settings, "ops");
  const at = NOW.toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
       VALUES (?1, 'resource-1', 'Imran Qureshi', 'IQ', 1, 'Gurgaon', '+919810000009', ?3),
              (?2, 'resource-2', 'Sameer Bhatt', 'SB', 1, 'Gurgaon', '+919810000008', ?3)`,
    ).bind(IMRAN, SAMEER, at),
    env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
       VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'contact-1')`,
    ).bind(PERSON, at),
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, lat, lng, geocoded_at)
       VALUES ('addr-1', ?1, ?2, 'House 7', 'Sector 65', 'Gurgaon', '122018', 28.398, 77.07, ?2)`,
    ).bind(PERSON, at),
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
         window_end, technician_id, service_city, service_pincode, fsm_modified_at, synced_at)
       VALUES (?1, 'ap-today', 'wo-ap-today', ?2, ?3, 'scheduled', 'Scheduled', '2026-09-21T07:30:00.000Z',
         '2026-09-21T09:00:00.000Z', ?4, 'Gurgaon', '122018', ?5, ?5)`,
    ).bind(JOB, PERSON, type, IMRAN, at),
  ]);

  const cookie = `mm_tech=${await openTechnicianSession(env.DB, {
    technicianId: IMRAN,
    deviceId: "phone-abc-123",
    label: "Chrome on Android",
    now: NOW,
  })}`;
  const bindings = { FSM_QUEUE: fsmQueue, MESSAGE_QUEUE: fakeQueue() } as unknown as Partial<Env>;
  const get = (path: string) => request(tech, path, { headers: { Cookie: cookie } }, bindings);
  const post = (path: string, body: unknown, eventId: string) =>
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
      bindings,
    );
  const opsPost = (path: string, body?: unknown) =>
    request(
      ops,
      path,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      bindings,
    );

  const workTo = async (step: "checklist" | "consumables" | "outcome") => {
    await post(`/api/tech/jobs/${JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    await post(`/api/tech/jobs/${JOB}/start`, undefined, "event-start-01");
    await post(`/api/tech/jobs/${JOB}/photos`, { phase: "before" }, "event-photos-01");
    if (step === "checklist") return;
    await post(`/api/tech/jobs/${JOB}/checklist`, { done: [] }, "event-checklist-01");
    if (step === "consumables") return;
    await post(`/api/tech/jobs/${JOB}/consumables`, { items: [] }, "event-consumables-01");
    if (type === "consultation") return;
    await post(`/api/tech/jobs/${JOB}/photos`, { phase: "after" }, "event-afterphotos-01");
  };

  return { tech, ops, deps, fsm, fsmQueue, get, post, opsPost, workTo };
}
