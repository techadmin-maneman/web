// The dispatch board's writes under real conditions: a technician-only change,
// a visit with no room, two moves at once, and a client who cannot be messaged.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and
// address here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.ts";
import { createStubFsm, EMPTY_FSM, type FsmAppointment, type StubFsm } from "../../src/providers/fsm.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const ROHIT = "11111111-1111-4111-8111-111111111111";
const IMRAN = "33333333-3333-4333-8333-333333333331";
const SAMEER = "33333333-3333-4333-8333-333333333332";

const FIT = "22222222-2222-4222-8222-222222222221";
const REPLACEMENT = "22222222-2222-4222-8222-222222222222";

/** Tuesday 22 September in India, as UTC: each half-slot's start (docs/decisions/0035-window-slot-map.md). */
const TUESDAY = {
  "09:00": "2026-09-22T03:30:00.000Z",
  "10:30": "2026-09-22T05:00:00.000Z",
  "12:00": "2026-09-22T06:30:00.000Z",
  "14:00": "2026-09-22T08:30:00.000Z",
} as const;

const MINUTES = { consultation: 60, service: 90, replacement: 135, first_fit: 180 } as const;
type Kind = keyof typeof MINUTES;

let ops: App;
let fsm: StubFsm;
let messageQueue: ReturnType<typeof fakeQueue>;

const fsmAppointment = (id: string): FsmAppointment => ({
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

async function insertJob(
  id: string,
  options: { type: Kind; start: string; technician: string | null; person?: string | null },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
       window_end, technician_id, service_city, service_pincode, fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'scheduled', 'Scheduled', ?6, ?7, ?8, 'Gurgaon', '122018', ?9, ?9)`,
  )
    .bind(
      id,
      `ap-${id}`,
      `wo-${id}`,
      options.person === undefined ? ROHIT : options.person,
      options.type,
      options.start,
      new Date(Date.parse(options.start) + MINUTES[options.type] * 60_000).toISOString(),
      options.technician,
      NOW.toISOString(),
    )
    .run();
}

beforeEach(async () => {
  await markDatabase();
  fsm = createStubFsm({
    ...EMPTY_FSM,
    appointments: [fsmAppointment(`ap-${FIT}`), fsmAppointment(`ap-${REPLACEMENT}`)],
  });
  messageQueue = fakeQueue();
  ops = appFor("local", fakeDependencies({ fsm }), {}, "ops");

  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, updated_at)
     VALUES (?1, 'resource-1', 'Imran Qureshi', 'IQ', 1, 'Sec 40–65', ?3),
            (?2, 'resource-2', 'Sameer Bhatt', 'SB', 1, 'Sec 1–39', ?3)`,
  )
    .bind(IMRAN, SAMEER, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'contact-1')`,
  )
    .bind(ROHIT, NOW.toISOString())
    .run();
});

const bindings = () => ({ MESSAGE_QUEUE: messageQueue }) as unknown as Partial<Env>;

const opsPost = (path: string, body: unknown) =>
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

const startOf = async (id: string) =>
  (
    await env.DB.prepare("SELECT window_start, technician_id FROM appointments WHERE id = ?1")
      .bind(id)
      .first<{ window_start: string; technician_id: string | null }>()
  )?.window_start;

describe("a change of technician alone", () => {
  // BIZ-18: a first fit at 12:00 given to a technician whose replacement runs from 10:30 to 12:45.
  // His afternoon window is free, but the first fit's own half-slots are not.
  it("keeps the visit's own time, and refuses it where that time is taken, as not fitting", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });
    await insertJob(REPLACEMENT, { type: "replacement", start: TUESDAY["10:30"], technician: SAMEER });

    const sameWindow = await opsPost("/api/dispatch/move", {
      appointment_id: FIT,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "afternoon",
      reason: "zone_rebalance",
    });
    const noTime = await opsPost("/api/dispatch/move", {
      appointment_id: FIT,
      technician_id: SAMEER,
      reason: "zone_rebalance",
    });

    for (const answer of [sameWindow, noTime]) {
      expect(answer.status).toBe(409);
      expect(await answer.json()).toMatchObject({ error: { code: "does_not_fit" } });
    }
    expect(fsm.made.assigned).toEqual([]);
    expect(fsm.made.rescheduled).toEqual([]);
    expect(await startOf(FIT)).toBe(TUESDAY["12:00"]);
  });

  it("gives the visit to the other technician at the same time, and messages nobody", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: FIT,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "afternoon",
      reason: "zone_rebalance",
    });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ client_notice: "unchanged" });
    expect(fsm.made.assigned).toEqual([{ appointmentId: `ap-${FIT}`, technicianId: "resource-2" }]);
    // The time does not move, so FSM is not asked to move it, and the client has nothing to be told.
    expect(fsm.made.rescheduled).toEqual([]);
    expect(await startOf(FIT)).toBe(TUESDAY["12:00"]);
    expect(messageQueue.sent).toEqual([]);
    const messages = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_messages").first<{ n: number }>();
    expect(messages?.n).toBe(0);
  });
});

describe("a visit with no room", () => {
  // OPS-06: a first fit takes four half-slots, and the evening has two.
  it("refuses a first fit in an empty evening as not fitting, not as a clash", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: FIT,
      technician_id: SAMEER,
      date: "2026-09-23",
      window: "evening",
      reason: "client_asked",
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "does_not_fit" } });
    expect(fsm.made.assigned).toEqual([]);
  });

  it("places a visit moved to another day wherever that window has room", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });
    // Sameer's Wednesday replacement runs from 10:30 to 12:45, into the afternoon's first two half-slots.
    await insertJob(REPLACEMENT, { type: "replacement", start: "2026-09-23T05:00:00.000Z", technician: SAMEER });

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: FIT,
      technician_id: SAMEER,
      date: "2026-09-23",
      window: "afternoon",
      reason: "client_asked",
    });

    expect(answer.status).toBe(200);
    expect(fsm.made.rescheduled).toEqual([
      { appointmentId: `ap-${FIT}`, start: "2026-09-23T14:00:00+05:30", end: "2026-09-23T17:00:00+05:30" },
    ]);
  });
});
