// P2-M4: the technician surface and dispatch. NOW is Monday 21 September 2026,
// 12 noon in India. Every name, number, address and photograph here is made up.
//
// The cases the milestone turns on:
//   - a job invisible before it unlocks
//   - a check-in outside the radius
//   - a replayed event landing once
//   - a clash refused
//   - a no-show closed with its evidence
//   - an FSM write that fails and is retried
//
// What does not depend on FSM runs on both records of field work: FSM's, and our own with FSM switched off
// (src/config/field-record.ts).

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "../../apps/tech/src/store/uuidv7.ts";
import type { FieldRecord } from "../../src/config/field-record.ts";
import type { App } from "../../src/http/context.ts";
import { occupancy, placement } from "../../src/domain/scheduling.ts";
import { readMeter } from "../../src/domain/storage-meter.ts";
import { MAX_PHOTO_BYTES, MAX_THUMBNAIL_BYTES } from "../../src/domain/tech-photos.ts";
import { PHASE_2_SHARE_BYTES, RUNAWAY_CEILING_BYTES } from "../../src/policy/storage-share.ts";
import { openTechnicianSession } from "../../src/domain/technicians.ts";
import { createLogger } from "../../src/log.ts";
import {
  createStubFsm,
  EMPTY_FSM,
  STUB_TRANSITIONS,
  type FsmAppointment,
  type StubFsm,
} from "../../src/providers/fsm.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import {
  appFor,
  fakeDependencies,
  fakeQueue,
  fsmSwitchedOff,
  markDatabase,
  NOW,
  PROVIDERS_FOR,
  request,
  type TestDependencies,
} from "./helpers.ts";
import { syntheticJpeg, syntheticPng } from "./tryon-fixtures.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const TODAY_JOB = "22222222-2222-4222-8222-222222222221";
const LATER_JOB = "22222222-2222-4222-8222-222222222222";
const OTHER_JOB = "22222222-2222-4222-8222-222222222223";
/** Imran and Sameer, made up. */
const IMRAN = "33333333-3333-4333-8333-333333333331";
const SAMEER = "33333333-3333-4333-8333-333333333332";
const DEVICE = "phone-abc-123";

/** The address the job goes to: House 7, Sector 65, Gurgaon. */
const ADDRESS = { lat: 28.398, lng: 77.07 };
/** About 90 m north of it: inside the 200 m geofence. */
const AT_THE_DOOR = { lat: 28.3988, lng: 77.07 };
/** About 2.2 km east: outside it. */
const DOWN_THE_ROAD = { lat: 28.398, lng: 77.0925 };

const RECORDS: readonly FieldRecord[] = ["fsm", "ours"];

let tech: App;
let ops: App;
let deps: TestDependencies;
let fsm: StubFsm;
/** Who holds the record of field work in this test: FSM, or our own database with FSM switched off. */
let recordInUse: FieldRecord;
let fsmQueue: ReturnType<typeof fakeQueue>;
let messageQueue: ReturnType<typeof fakeQueue>;
let cookie: string;
/** How many of the queued FSM writes runFsmQueue has delivered. */
let delivered: number;

/** An appointment as FSM holds it, with only what the stub's transitions read. */
const fsmAppointment = (id: string, status = "Scheduled"): FsmAppointment => ({
  id,
  name: `AP-${id}`,
  status,
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

const world = () => ({
  ...EMPTY_FSM,
  appointments: [fsmAppointment("ap-today"), fsmAppointment("ap-later"), fsmAppointment("ap-other")],
  items: [{ id: "part-standard", name: "Standard base", type: "Part" as const, price: null }],
});

async function insertJob(
  id: string,
  options: { fsmId: string; start: string; technician?: string | null; type?: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
       window_end, technician_id, service_city, service_pincode, fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'scheduled', 'Scheduled', ?6, ?7, ?8, 'Gurgaon', '122018', ?9, ?9)`,
  )
    .bind(
      id,
      options.fsmId,
      `wo-${options.fsmId}`,
      PERSON,
      options.type ?? "service",
      options.start,
      new Date(Date.parse(options.start) + 90 * 60_000).toISOString(),
      options.technician === undefined ? IMRAN : options.technician,
      NOW.toISOString(),
    )
    .run();
}

beforeEach(async () => {
  await markDatabase();
  fsm = createStubFsm(world());
  fsmQueue = fakeQueue();
  delivered = 0;
  messageQueue = fakeQueue();
  onRecord("fsm");

  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
     VALUES (?1, 'resource-1', 'Imran Qureshi', 'IQ', 1, 'Gurgaon', '+919810000009', ?3),
            (?2, 'resource-2', 'Sameer Bhatt', 'SB', 1, 'Gurgaon', '+919810000008', ?3)`,
  )
    .bind(IMRAN, SAMEER, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'contact-1')`,
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
  await insertJob(TODAY_JOB, { fsmId: "ap-today", start: "2026-09-21T07:30:00.000Z" });
  await insertJob(LATER_JOB, { fsmId: "ap-later", start: "2026-09-25T04:30:00.000Z" });

  cookie = `mm_tech=${await openTechnicianSession(env.DB, {
    technicianId: IMRAN,
    deviceId: DEVICE,
    label: "Chrome on Android",
    now: NOW,
  })}`;
});

/** The dependencies a request runs with on this test's record, at `now`: FSM's stub, or FSM switched off. */
const depsAt = (now: Date): TestDependencies =>
  fakeDependencies({ fsm: recordInUse === "ours" ? fsmSwitchedOff() : fsm, now: () => now });

/** The technician app's API on this test's record, answering at `now`. */
const techAt = (now: Date): App => appFor("local", depsAt(now), {}, "tech", PROVIDERS_FOR[recordInUse]);

/** Runs the rest of the test on this record: its dependencies and both apps are made again for it. */
function onRecord(next: FieldRecord): void {
  recordInUse = next;
  deps = depsAt(NOW);
  tech = appFor("local", deps, {}, "tech", PROVIDERS_FOR[recordInUse]);
  ops = appFor("local", deps, {}, "ops", PROVIDERS_FOR[recordInUse]);
}

const bindings = () => ({ FSM_QUEUE: fsmQueue, MESSAGE_QUEUE: messageQueue }) as unknown as Partial<Env>;

const get = (path: string) => request(tech, path, { headers: { Cookie: cookie } }, bindings());

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
    bindings(),
  );

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

/** A write that reaches the API at `at`, as a phone replaying its outbox from a basement does. */
const postAt = (at: Date, path: string, body: unknown, eventId: string, headers: Record<string, string> = {}) =>
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
const TODAY_START = new Date("2026-09-21T07:30:00.000Z");
/** Today's job as a dispatch board loaded now shows it, which every move sends (FEO-05). */
const AS_THE_BOARD_SHOWS_IT = { expected_technician_id: IMRAN, expected_starts_at: TODAY_START.toISOString() };
const minutesAfterStart = (minutes: number) => new Date(TODAY_START.getTime() + minutes * 60_000);
/** The event ID the app makes for a write queued that many minutes after the start. */
const uuidv7At = (minutes: number) => uuidv7(minutesAfterStart(minutes).getTime());

/** Checks in at the door and starts the job, which every later step needs. */
async function startJob(): Promise<void> {
  await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
  await post(`/api/tech/jobs/${TODAY_JOB}/start`, undefined, "event-start-01");
}

/** The five before photographs, step one, which the checklist follows. */
async function beforePhotos(): Promise<void> {
  await post(`/api/tech/jobs/${TODAY_JOB}/photos`, { phase: "before" }, "event-photos-01");
}

describe.each(RECORDS)("the day's jobs, on %s's record", (record) => {
  beforeEach(() => {
    onRecord(record);
  });

  it("hides the address, access notes and client card until the day before", async () => {
    const answer = await get(`/api/tech/jobs/${LATER_JOB}`);
    const job = await answer.json<Record<string, unknown>>();

    expect(answer.status).toBe(200);
    expect(job).toMatchObject({
      unlocked: false,
      // Time, type and sector, and nothing else of the place.
      type: "service",
      sector: "Sector 65",
      address: null,
      access_notes: null,
      client: null,
      // 6 pm in India on the day before the visit (src/policy/job-visibility.ts).
      unlocks_at: "2026-09-24T12:30:00.000Z",
    });
    expect(JSON.stringify(job)).not.toContain("House 7");
    expect(JSON.stringify(job)).not.toContain("9810000001");
  });

  // ADR 0069: the board names the area of the pincode a visit is booked for; the technician's card used the address.
  it("names the area of the visit's pincode, as the dispatch board does", async () => {
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Sector 65 and 66', 'Gurgaon', 1)",
    ).run();

    const later = await (await get(`/api/tech/jobs/${LATER_JOB}`)).json<Record<string, unknown>>();
    const listed = await (await get("/api/tech/jobs?date=2026-09-25")).json<{ jobs: Record<string, unknown>[] }>();

    expect(later).toMatchObject({ unlocked: false, sector: "Sector 65 and 66" });
    expect(listed.jobs[0]).toMatchObject({ id: LATER_JOB, sector: "Sector 65 and 66" });
  });

  it("shows the address, access notes and client card from the day before", async () => {
    const job = await (await get(`/api/tech/jobs/${TODAY_JOB}`)).json<Record<string, unknown>>();

    expect(job).toMatchObject({
      unlocked: true,
      day: "today",
      address: { line1: "House 7", locality: "Sector 65", lat: ADDRESS.lat },
      access_notes: "Gate 4417, visitor bay B",
      client: { name: "Rohit Malhotra", mobile: "+919810000001" },
    });
  });

  it("gives the whole address the client saved: building, tower, floor, flat and landmark", async () => {
    await env.DB.prepare(
      `UPDATE addresses SET building = 'Emerald Heights', tower = 'C', floor = '14', flat = '1402',
         landmark = 'Opposite the water tank' WHERE id = 'addr-1'`,
    ).run();

    const job = await (await get(`/api/tech/jobs/${TODAY_JOB}`)).json<{ address: Record<string, unknown> }>();

    expect(job.address).toMatchObject({
      line1: "House 7",
      building: "Emerald Heights",
      tower: "C",
      floor: "14",
      flat: "1402",
      landmark: "Opposite the water tank",
    });
  });

  it("marks a visit the price book charges nothing for as free, still with no amount", async () => {
    await insertJob(OTHER_JOB, { fsmId: "ap-other", start: "2026-09-21T10:30:00.000Z", type: "consultation" });

    const answer = await get("/api/tech/jobs?date=2026-09-21");
    const body = await answer.text();

    const { jobs } = JSON.parse(body) as { jobs: { id: string; badge: string }[] };
    expect(jobs.map(({ id, badge }) => ({ id, badge }))).toEqual([
      { id: TODAY_JOB, badge: "prepaid" },
      { id: OTHER_JOB, badge: "free" },
    ]);
    expect(body).not.toMatch(/amount|price|rupee|"paise"/i);
  });

  // docs/decisions/0085-services-ops-can-edit.md: the badge is the visit's own service's, not the standard tier's.
  it("reads the badge from the visit's own service's price on its day", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
         VALUES ('consultation', 'at_home', 'Consultation at home', 60, 1, 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
         VALUES ('consultation', 'at_home', 50000, 0, '2026-01-01')`,
      ),
    ]);
    await insertJob(OTHER_JOB, { fsmId: "ap-other", start: "2026-09-21T10:30:00.000Z", type: "consultation" });
    await env.DB.prepare("UPDATE appointments SET tier = 'at_home' WHERE id = ?1").bind(OTHER_JOB).run();

    const { jobs } = await (
      await get("/api/tech/jobs?date=2026-09-21")
    ).json<{ jobs: { id: string; badge: string }[] }>();

    expect(jobs.find((job) => job.id === OTHER_JOB)?.badge).toBe("prepaid");
  });

  it("carries a badge and never an amount", async () => {
    const answer = await get("/api/tech/jobs?date=2026-09-21");
    const body = await answer.text();

    expect(JSON.parse(body)).toMatchObject({ date: "2026-09-21", jobs: [{ id: TODAY_JOB, badge: "prepaid" }] });
    expect(body).not.toMatch(/amount|price|rupee|"paise"/i);
  });

  it("is nobody else's job", async () => {
    await insertJob(OTHER_JOB, { fsmId: "ap-other", start: "2026-09-21T07:30:00.000Z", technician: SAMEER });
    expect((await get(`/api/tech/jobs/${OTHER_JOB}`)).status).toBe(404);
  });
});

describe.each(RECORDS)("checking in, on %s's record", (record) => {
  beforeEach(() => {
    onRecord(record);
  });

  it("fails outside the radius, records the distance it measured, and starts no wait", async () => {
    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, DOWN_THE_ROAD, "event-far-01");
    const body = await answer.json<{ passed: boolean; distance_m: number; radius_m: number; wait_ends_at: null }>();

    expect(answer.status).toBe(200);
    expect(body.passed).toBe(false);
    expect(body.distance_m).toBeGreaterThan(2000);
    expect(body.radius_m).toBe(200);
    expect(body.wait_ends_at).toBeNull();

    // The row is written either way, so the radius can be tuned from real data.
    const row = await env.DB.prepare("SELECT passed, distance_m, radius_m FROM checkins WHERE appointment_id = ?1")
      .bind(TODAY_JOB)
      .first<{ passed: number; distance_m: number; radius_m: number }>();
    expect(row).toMatchObject({ passed: 0, radius_m: 200 });
    expect(row?.distance_m).toBeGreaterThan(2000);
    // Nothing landed, so the job cannot be started.
    expect((await post(`/api/tech/jobs/${TODAY_JOB}/start`, undefined, "event-start-01")).status).toBe(409);
  });

  it("passes inside it, and opens the no-show wait", async () => {
    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-near-01");
    const body = await answer.json<{ passed: boolean; distance_m: number; wait_ends_at: string }>();

    expect(body.passed).toBe(true);
    expect(body.distance_m).toBeLessThan(200);
    // Fifteen minutes from the check-in.
    expect(body.wait_ends_at).toBe(new Date(NOW.getTime() + 15 * 60_000).toISOString());
  });

  it("gives the card the wait and the distance, so a phone that lost its copy can still close a no-show", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    const job = await (
      await get(`/api/tech/jobs/${TODAY_JOB}`)
    ).json<{
      progress: { wait_ends_at: string | null; distance_m: number | null };
    }>();
    expect(job.progress.wait_ends_at).toBe(new Date(NOW.getTime() + 15 * 60_000).toISOString());
    expect(job.progress.distance_m).toBeLessThan(200);
  });

  it("refuses a check-in on a day other than the job's own", async () => {
    const answer = await post(`/api/tech/jobs/${LATER_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "not_today" } });
    const landed = await env.DB.prepare("SELECT COUNT(*) AS n FROM job_events WHERE appointment_id = ?1")
      .bind(LATER_JOB)
      .first<{ n: number }>();
    expect(landed?.n).toBe(0);
  });
});

// ADR 0047 promised the arrival WhatsApp, and the no-show evidence reads its receipt; nothing ever wrote one, so the
// only evidence was the day-before reminder (BIZ-22). The consumer sends it only with the client's consent to
// WhatsApp about visits, and records why when it does not.
describe.each(RECORDS)("the arrival WhatsApp, on %s's record", (record) => {
  beforeEach(() => {
    onRecord(record);
  });

  const arrivals = () =>
    env.DB.prepare(
      "SELECT id, subject_id, state, last_error FROM outbound_messages WHERE kind = 'arrival_notice' ORDER BY rowid",
    ).all<{ id: string; subject_id: string; state: string; last_error: string | null }>();

  it("is queued once, at the first check-in that passes", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, DOWN_THE_ROAD, "event-far-01");
    expect((await arrivals()).results).toEqual([]);

    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-near-01");
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-near-02");

    const { results } = await arrivals();
    expect(results).toEqual([
      { id: expect.any(String) as string, subject_id: TODAY_JOB, state: "queued", last_error: null },
    ]);
    expect(messageQueue.sent).toEqual([{ message_id: results[0]?.id, request_id: expect.any(String) as string }]);
  });

  it("is recorded as not sent when the check-in reaches us too late to tell the client anything", async () => {
    // Checked in at the booked start with no signal, and heard of forty minutes on.
    await postAt(
      minutesAfterStart(40),
      `/api/tech/jobs/${TODAY_JOB}/checkin`,
      { ...AT_THE_DOOR, at: TODAY_START.toISOString() },
      "event-checkin-01",
    );

    expect((await arrivals()).results).toEqual([
      {
        id: expect.any(String) as string,
        subject_id: TODAY_JOB,
        state: "skipped",
        last_error: "the check-in reached us too late to tell the client",
      },
    ]);
    expect(messageQueue.sent).toEqual([]);
  });

  it("is the message a no-show case reads the receipt of", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    const arrival = (await arrivals()).results[0]?.id;

    // Sixteen minutes later the wait has run.
    const closed = await postAt(
      new Date(NOW.getTime() + 16 * 60_000),
      `/api/tech/jobs/${TODAY_JOB}/no-show`,
      undefined,
      "event-ns-01",
    );
    expect(closed.status).toBe(200);

    const opened = await env.DB.prepare("SELECT message_id FROM no_show_cases").first<{ message_id: string }>();
    expect(opened?.message_id).toBe(arrival);
  });
});

// A check-in's time is the evidence a no-show is charged on, and the phone's
// clock is the technician's to set (docs/decisions/0065-a-technicians-writes-reach-fsm.md).
describe("the phone's clock", () => {
  it("keeps a back-dated check-in's claim, bounds it, and runs the no-show wait on our clock too", async () => {
    // Ten minutes after the booked start, the phone says he arrived three hours ago.
    const received = minutesAfterStart(10);
    const claimed = minutesAfterStart(-180);
    const answer = await postAt(
      received,
      `/api/tech/jobs/${TODAY_JOB}/checkin`,
      { ...AT_THE_DOOR, at: claimed.toISOString() },
      "event-checkin-01",
    );
    const body = await answer.json<{ checked_in_at: string; wait_ends_at: string }>();

    // No earlier than an hour before the booked start; the wait ends fifteen minutes after we heard.
    expect(body.checked_in_at).toBe(minutesAfterStart(-60).toISOString());
    expect(body.wait_ends_at).toBe(minutesAfterStart(25).toISOString());

    const early = await postAt(minutesAfterStart(11), `/api/tech/jobs/${TODAY_JOB}/no-show`, undefined, "event-ns-01");
    expect(early.status).toBe(425);
    const closed = await postAt(minutesAfterStart(25), `/api/tech/jobs/${TODAY_JOB}/no-show`, undefined, "event-ns-01");
    expect(closed.status).toBe(200);

    const { cases } = await (
      await request(ops, "/api/no-shows", {}, bindings())
    ).json<{
      cases: Record<string, unknown>[];
    }>();
    expect(cases[0]).toMatchObject({
      checked_in_at: minutesAfterStart(-60).toISOString(),
      phone_checked_in_at: claimed.toISOString(),
      received_at: received.toISOString(),
      window_start: TODAY_START.toISOString(),
      window_end: minutesAfterStart(90).toISOString(),
      minutes_late: -60,
      wait_ends_at: minutesAfterStart(25).toISOString(),
    });
  });

  // The owner kept the hour on 27 September 2026, as a console setting (docs/decisions/0088-every-policy-in-the-console.md).
  it("bounds a back-dated check-in to the margin ops set", async () => {
    await env.DB.prepare(
      `INSERT INTO ops_settings (name, value, set_by, set_at)
       VALUES ('phone_clock', '{"before_start": 30, "held_offline": 24}', 'ops', ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    const answer = await postAt(
      minutesAfterStart(10),
      `/api/tech/jobs/${TODAY_JOB}/checkin`,
      { ...AT_THE_DOOR, at: minutesAfterStart(-180).toISOString() },
      "event-checkin-01",
    );
    expect((await answer.json<{ checked_in_at: string }>()).checked_in_at).toBe(minutesAfterStart(-30).toISOString());
  });

  it("keeps the phone's times for a job worked offline and replayed at once, so its duration is real", async () => {
    // Worked from 13:05 to 14:20 with no signal, and sent at 14:30 in one go.
    const replayedAt = minutesAfterStart(90);
    const steps: [string, unknown, number][] = [
      ["checkin", AT_THE_DOOR, 2],
      ["start", undefined, 5],
      ["photos", { phase: "before" }, 10],
      ["checklist", { done: ["piece_removed"] }, 40],
      ["consumables", { items: [] }, 45],
      ["photos", { phase: "after" }, 75],
      ["outcome", { outcome: "done" }, 80],
    ];
    for (const [step, body, minute] of steps) {
      const answer = await postAt(replayedAt, `/api/tech/jobs/${TODAY_JOB}/${step}`, body, uuidv7At(minute));
      expect(answer.status).toBeLessThan(300);
    }

    await runFsmQueue();
    const fields = fsm.made.appointmentUpdates.map((update) => update.fields);
    expect(fields).toContainEqual({ Actual_Start_Date_Time: "2026-09-21T13:05:00+05:30" });
    expect(fields.at(-1)?.Actual_End_Date_Time).toBe("2026-09-21T14:20:00+05:30");
    expect(fsm.made.transitioned.at(-1)?.note).toContain("Duration 75 minutes");
  });
});

describe.each(RECORDS)("the outbox, on %s's record", (record) => {
  beforeEach(() => {
    onRecord(record);
  });

  it("lands a replayed event once", async () => {
    await startJob();
    await beforePhotos();
    const body = { done: ["piece_removed", "scalp_cleaned"] };

    const first = await post(`/api/tech/jobs/${TODAY_JOB}/checklist`, body, "event-checklist-01");
    const again = await post(`/api/tech/jobs/${TODAY_JOB}/checklist`, body, "event-checklist-01");

    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ event_id: "event-checklist-01", replayed: false });
    expect(again.status).toBe(202);
    expect(await again.json()).toMatchObject({ event_id: "event-checklist-01", replayed: true });

    const landed = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM job_events WHERE appointment_id = ?1 AND event_id = 'event-checklist-01'",
    )
      .bind(TODAY_JOB)
      .first<{ n: number }>();
    expect(landed?.n).toBe(1);
    // And only the first put an FSM write on the queue: check-in, start, photos, checklist. Our own record queues none.
    expect(fsmQueue.sent).toHaveLength(record === "fsm" ? 4 : 0);
  });

  it.runIf(record === "fsm")(
    "lands a step whose FSM write the queue refused, and leaves it pending for the sweeper to send",
    async () => {
      await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
      fsmQueue = { ...fakeQueue(), send: () => Promise.reject(new Error("queue unavailable")) };

      const answer = await post(`/api/tech/jobs/${TODAY_JOB}/start`, undefined, "event-start-01");

      expect(answer.status).toBe(202);
      expect(await answer.json()).toMatchObject({
        event_id: "event-start-01",
        replayed: false,
        fsm_write_state: "pending",
      });
      const row = await env.DB.prepare(
        "SELECT fsm_write_state, superseded FROM job_events WHERE event_id = 'event-start-01'",
      ).first<{ fsm_write_state: string; superseded: number }>();
      // What src/scheduled/sweeper.ts sends on once its grace has passed.
      expect(row).toEqual({ fsm_write_state: "pending", superseded: 0 });
    },
  );

  it("refuses a step sent before the one ahead of it", async () => {
    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/outcome`, { outcome: "done" }, "event-early-01");

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "out_of_order", fields: ["start"] } });
  });

  it("rejects a write as superseded once ops have reassigned the job", async () => {
    await startJob();
    await beforePhotos();
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(TODAY_JOB, SAMEER).run();

    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checklist`, { done: [] }, "event-late-01");

    expect(answer.status).toBe(409);
    // Moved in FSM itself, so nothing of ours says when.
    expect(await answer.json()).toMatchObject({
      error: { code: "superseded", fields: ["technician"], moved: { technician: "Sameer", at: null } },
    });
    const row = await env.DB.prepare(
      "SELECT superseded, fsm_write_state FROM job_events WHERE event_id = 'event-late-01'",
    ).first<{ superseded: number; fsm_write_state: string }>();
    expect(row).toEqual({ superseded: 1, fsm_write_state: "rejected" });
  });

  // Open point 92, ruled by the owner on 27 September 2026: "the other technician's first name may reach the phone.
  // Name the technician the job went to, and when."
  it("names the technician ops gave the job to, by first name alone, and when they moved it", async () => {
    const moved = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      reason: "technician_unavailable",
    });
    expect(moved.status).toBe(200);

    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    expect(answer.status).toBe(409);
    const { error } = await answer.json<{ error: Record<string, unknown> }>();
    // Nothing else of Sameer's: not his whole name, his number or his zone.
    expect(error).toEqual({
      code: "superseded",
      request_id: expect.any(String) as string,
      fields: ["technician"],
      moved: { technician: "Sameer", at: NOW.toISOString() },
    });
  });

  it("names nobody for a job that was cancelled, whoever it was left with", async () => {
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled', technician_id = ?2 WHERE id = ?1")
      .bind(TODAY_JOB, SAMEER)
      .run();

    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    expect(answer.status).toBe(409);
    const { error } = await answer.json<{ error: Record<string, unknown> }>();
    expect(error).toMatchObject({ code: "superseded", fields: ["status", "technician"] });
    expect(error).not.toHaveProperty("moved");
  });

  it("rejects a write as superseded once ops have moved the job to another time", async () => {
    const heldStart = TODAY_START.toISOString();
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    // Ops move it to 16:00 while the phone is offline, still holding 13:00.
    await env.DB.prepare("UPDATE appointments SET window_start = ?2 WHERE id = ?1")
      .bind(TODAY_JOB, minutesAfterStart(180).toISOString())
      .run();

    const answer = await postAt(NOW, `/api/tech/jobs/${TODAY_JOB}/start`, undefined, "event-start-01", {
      "X-Job-Starts-At": heldStart,
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "superseded", fields: ["time"] } });
  });

  it("refuses a check-in on a job moved to another day, even from a phone that does not say what it held", async () => {
    await env.DB.prepare("UPDATE appointments SET window_start = '2026-09-22T07:30:00.000Z' WHERE id = ?1")
      .bind(TODAY_JOB)
      .run();

    const answer = await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "not_today" } });
  });
});

describe("the photographs", () => {
  it("takes the bytes through the API and attaches them to FSM", async () => {
    await startJob();
    const link = await opsFreeUploadLink();
    const put = await request(
      tech,
      link,
      {
        method: "PUT",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "image/jpeg" },
        body: syntheticJpeg(1200, 1600),
      },
      bindings(),
    );
    expect(put.status).toBe(200);

    const confirmed = await post(`/api/tech/jobs/${TODAY_JOB}/photos`, { phase: "before" }, "event-photos-01");
    expect(confirmed.status).toBe(202);

    await runFsmQueue();
    expect(
      fsm.made.attached.map(({ appointmentId, name, contentType }) => ({ appointmentId, name, contentType })),
    ).toEqual([{ appointmentId: "ap-today", name: "before-front.jpg", contentType: "image/jpeg" }]);
    expect(fsm.made.attached[0]?.bytes).toBeGreaterThan(0);
    const stored = await env.DB.prepare(
      `SELECT p.fsm_attachment_id FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id
       WHERE s.appointment_id = ?1`,
    )
      .bind(TODAY_JOB)
      .first<{ fsm_attachment_id: string | null }>();
    expect(stored?.fsm_attachment_id).toMatch(/^stub-attachment-/);
  });

  /** A JPEG of this size in pixels, padded to exactly `length` bytes. */
  function jpegOf(length: number, width = 1200, height = 1600): Uint8Array {
    const header = syntheticJpeg(width, height);
    const padded = new Uint8Array(length);
    padded.set(header.subarray(0, header.length - 2));
    padded.set([0xff, 0xd9], length - 2);
    return padded;
  }

  const putPhoto = (link: string, body: Uint8Array) =>
    request(
      tech,
      link,
      {
        method: "PUT",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "image/jpeg" },
        body,
      },
      bindings(),
    );

  it("takes a photograph of up to 2 MB, and refuses a larger one, which no build of the app sends", async () => {
    await startJob();
    expect((await putPhoto(await opsFreeUploadLink(), jpegOf(MAX_PHOTO_BYTES))).status).toBe(200);
    const refused = await putPhoto(await opsFreeUploadLink(), jpegOf(MAX_PHOTO_BYTES + 1));
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { code: "photo_invalid_file" } });
    expect(MAX_PHOTO_BYTES).toBe(2 * 1024 * 1024);
  });

  it("counts each photograph it stores on the storage meter", async () => {
    await startJob();
    const bytes = syntheticJpeg(1200, 1600, "front");
    await putPhoto(await opsFreeUploadLink(), bytes);
    expect((await readMeter(env.DB)).bytes).toBe(bytes.byteLength);
  });

  it("stores a photograph when the share of R2 is full, as the owner ruled", async () => {
    await startJob();
    await env.DB.prepare("UPDATE storage_meter SET bytes = ?1")
      .bind(PHASE_2_SHARE_BYTES * 1.5)
      .run();
    expect((await putPhoto(await opsFreeUploadLink(), syntheticJpeg(1200, 1600))).status).toBe(200);
    expect(deps.alerts).toEqual([]);
  });

  it("refuses a photograph past the runaway ceiling, which waits on the phone, and tells ops", async () => {
    await startJob();
    await env.DB.prepare("UPDATE storage_meter SET bytes = ?1")
      .bind(RUNAWAY_CEILING_BYTES - 10)
      .run();
    const refused = await putPhoto(await opsFreeUploadLink(), syntheticJpeg(1200, 1600));
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "busy" } });
    expect(deps.alerts).toEqual([expect.stringContaining("past the runaway ceiling of 20 GB")]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS photos FROM photos").first("photos")).toBe(0);
  });

  const heldPhoto = () =>
    env.DB.prepare("SELECT r2_key, thumbnail_key FROM photos").first<{
      r2_key: string;
      thumbnail_key: string | null;
    }>();

  /** The photograph, and the take it names, which its thumbnail's upload sends back. */
  async function putTake(link: string, body: Uint8Array): Promise<string> {
    const answer = await putPhoto(link, body);
    expect(answer.status).toBe(200);
    const { take } = await answer.json<{ take: string }>();
    return take;
  }

  const putThumbnail = (link: string, take: string, body: Uint8Array) => putPhoto(`${link}?take=${take}`, body);

  it("takes the small copy after the photograph and keeps it beside it, counted", async () => {
    await startJob();
    const links = await uploadLinks();
    const photo = syntheticJpeg(1200, 1600, "front");
    const small = syntheticJpeg(300, 400, "front, small");
    const take = await putTake(links.upload_url, photo);
    expect((await putThumbnail(links.small_upload_url, take, small)).status).toBe(204);

    const held = await heldPhoto();
    expect(held?.r2_key).toBe(`visits/${TODAY_JOB}/before-front-${take}.jpg`);
    expect(held?.thumbnail_key).toBe(`visits/${TODAY_JOB}/before-front-${take}-small.jpg`);
    expect((await env.CLIENT_PHOTOS.head(held?.thumbnail_key ?? ""))?.size).toBe(small.byteLength);
    expect((await readMeter(env.DB)).bytes).toBe(photo.byteLength + small.byteLength);
  });

  it("refuses a small copy before its photograph, so none is ever held without one", async () => {
    await startJob();
    const refused = await putThumbnail(
      (await uploadLinks()).small_upload_url,
      crypto.randomUUID(),
      syntheticJpeg(300, 400),
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "upload_missing" } });
    expect((await env.CLIENT_PHOTOS.list({ prefix: "visits/" })).objects).toEqual([]);
  });

  // ADR 0028 lets a technician photograph in either app while both run: FSM's copy of a newer take can land between
  // the phone's photograph and its thumbnail, and the row then names FSM's.
  it("claims a small copy on its own photograph, never on a newer take copied from FSM meanwhile", async () => {
    await startJob();
    const links = await uploadLinks();
    const take = await putTake(links.upload_url, syntheticJpeg(1200, 1600, "the phone's"));
    await env.DB.prepare("UPDATE photos SET r2_key = ?1, thumbnail_key = NULL")
      .bind(`visits/${TODAY_JOB}/before-front-fsm-file-1.jpg`)
      .run();

    const refused = await putThumbnail(links.small_upload_url, take, syntheticJpeg(300, 400));
    expect(refused.status).toBe(409);
    expect((await heldPhoto())?.thumbnail_key).toBeNull();
    const kept = (await env.CLIENT_PHOTOS.list({ prefix: "visits/" })).objects.map((object) => object.key);
    expect(kept.filter((key) => key.endsWith("-small.jpg"))).toEqual([]);
  });

  it("refuses a small copy that is not a small JPEG", async () => {
    await startJob();
    const links = await uploadLinks();
    const take = await putTake(links.upload_url, syntheticJpeg(1200, 1600));
    for (const wrong of [
      syntheticJpeg(1200, 1600),
      syntheticPng(300, 400),
      jpegOf(MAX_THUMBNAIL_BYTES + 1, 300, 400),
    ]) {
      expect((await putThumbnail(links.small_upload_url, take, wrong)).status).toBe(422);
    }
    expect((await heldPhoto())?.thumbnail_key).toBeNull();
  });

  it("takes a small copy sent again once, as a phone that lost the answer sends it", async () => {
    await startJob();
    const links = await uploadLinks();
    const photo = syntheticJpeg(1200, 1600);
    const small = syntheticJpeg(300, 400);
    const take = await putTake(links.upload_url, photo);
    await putThumbnail(links.small_upload_url, take, small);
    const first = (await heldPhoto())?.thumbnail_key;

    expect((await putThumbnail(links.small_upload_url, take, small)).status).toBe(204);
    expect((await heldPhoto())?.thumbnail_key).toBe(first);
    expect((await readMeter(env.DB)).bytes).toBe(photo.byteLength + small.byteLength);
  });

  it("forgets the small copy of a photograph taken again, which then shows itself until its own arrives", async () => {
    await startJob();
    const links = await uploadLinks();
    const first = await putTake(links.upload_url, syntheticJpeg(1200, 1600, "first take"));
    await putThumbnail(links.small_upload_url, first, syntheticJpeg(300, 400, "first take"));
    await putTake(links.upload_url, syntheticJpeg(1200, 1600, "second take"));
    expect((await heldPhoto())?.thumbnail_key).toBeNull();
    // The first take's small copy cannot be claimed for the second.
    expect((await putThumbnail(links.small_upload_url, first, syntheticJpeg(300, 400))).status).toBe(409);
  });

  // Open point 92: a job given away while its photographs wait names whom it went to, as a refused write does.
  // A job he has begun stays his, so this one was given away before he reached it, from a phone still holding it.
  it("answers an upload link for a job ops gave away as superseded, naming whom, by first name, and when", async () => {
    await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      reason: "technician_unavailable",
    });

    const answer = await askForUploadLink(TODAY_JOB);

    expect(answer.status).toBe(409);
    const { error } = await answer.json<{ error: Record<string, unknown> }>();
    expect(error).toEqual({
      code: "superseded",
      request_id: expect.any(String) as string,
      fields: ["technician"],
      moved: { technician: "Sameer", at: NOW.toISOString() },
    });
  });

  it("answers an upload link for a job cancelled while its photographs wait as superseded, naming nobody", async () => {
    await startJob();
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(TODAY_JOB).run();

    const answer = await askForUploadLink(TODAY_JOB);

    expect(answer.status).toBe(409);
    const { error } = await answer.json<{ error: Record<string, unknown> }>();
    expect(error).toMatchObject({ code: "superseded", fields: ["status"] });
    expect(error).not.toHaveProperty("moved");
  });

  it("answers not found for a job that was never this technician's, and names nobody", async () => {
    await insertJob(OTHER_JOB, { fsmId: "ap-other", start: "2026-09-21T07:30:00.000Z", technician: SAMEER });

    const answer = await askForUploadLink(OTHER_JOB);

    expect(answer.status).toBe(404);
    expect(await answer.json()).toMatchObject({ error: { code: "not_found" } });
  });

  function askForUploadLink(jobId: string): Promise<Response> {
    return request(
      tech,
      `/api/tech/jobs/${jobId}/photos/upload-url`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "before", angle: "front" }),
      },
      bindings(),
    );
  }

  async function uploadLinks(): Promise<{ upload_url: string; small_upload_url: string }> {
    const answer = await request(
      tech,
      `/api/tech/jobs/${TODAY_JOB}/photos/upload-url`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "before", angle: "front" }),
      },
      bindings(),
    );
    return answer.json();
  }

  async function opsFreeUploadLink(): Promise<string> {
    const answer = await request(
      tech,
      `/api/tech/jobs/${TODAY_JOB}/photos/upload-url`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "before", angle: "front" }),
      },
      bindings(),
    );
    const { upload_url: url } = await answer.json<{ upload_url: string }>();
    return url;
  }
});

describe("closing the job", () => {
  it("writes the outcome, the checklist and the duration to FSM", async () => {
    await startJob();
    await beforePhotos();
    await post(`/api/tech/jobs/${TODAY_JOB}/checklist`, { done: ["piece_removed"] }, "event-checklist-01");
    await post(
      `/api/tech/jobs/${TODAY_JOB}/consumables`,
      { items: [{ name: "Adhesive", quantity: 2 }] },
      "event-consumables-01",
    );
    await post(`/api/tech/jobs/${TODAY_JOB}/photos`, { phase: "after" }, "event-afterphotos-01");
    const closed = await post(
      `/api/tech/jobs/${TODAY_JOB}/outcome`,
      { outcome: "partial", reason: "client_stopped_it" },
      "event-outcome-01",
    );
    expect(closed.status).toBe(202);

    await runFsmQueue();
    const summary = fsm.made.appointmentUpdates.at(-1)?.fields.Summary ?? "";
    expect(summary).toContain("Checklist 1/6");
    expect(summary).toContain("Consumables: Adhesive x2");
    expect(summary).toContain("Outcome: partial (client_stopped_it)");
    expect(fsm.made.transitioned.at(-1)).toMatchObject({ appointmentId: "ap-today", name: "Terminate" });
    expect(fsm.made.transitioned.at(-1)?.note).toMatch(/Duration \d+ minutes/);
  });

  // The org calls starting and closing a job "Start Work" and "Complete Work"
  // (docs/verification.md, both staging runs of 23 September 2026). The stub
  // offers each only from the status FSM offers it from, so a wrong name fails here.
  it("closes a job as done in FSM with the org's own transitions", async () => {
    await startJob();
    await beforePhotos();
    await post(`/api/tech/jobs/${TODAY_JOB}/checklist`, { done: ["piece_removed"] }, "event-checklist-01");
    await post(`/api/tech/jobs/${TODAY_JOB}/consumables`, { items: [] }, "event-consumables-01");
    await post(`/api/tech/jobs/${TODAY_JOB}/photos`, { phase: "after" }, "event-afterphotos-01");
    await post(`/api/tech/jobs/${TODAY_JOB}/outcome`, { outcome: "done" }, "event-outcome-01");

    await runFsmQueue();
    expect(fsm.made.transitioned.map(({ name }) => name)).toEqual(["Dispatch", "Start Work", "Complete Work"]);
    expect((await fsm.appointment("ap-today"))?.status).toBe("Completed");
    expect(await writeStatesOf(TODAY_JOB)).toEqual(["written"]);
  });

  it("moves the mirror as FSM takes each step, without waiting for FSM's webhook", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    await runFsmQueue();
    expect(await mirrorStatusOf(TODAY_JOB)).toEqual({ status: "dispatched", fsm_status: "Dispatched" });

    await post(`/api/tech/jobs/${TODAY_JOB}/start`, undefined, "event-start-01");
    await beforePhotos();
    await post(`/api/tech/jobs/${TODAY_JOB}/checklist`, { done: [] }, "event-checklist-01");
    await post(`/api/tech/jobs/${TODAY_JOB}/consumables`, { items: [] }, "event-consumables-01");
    await post(`/api/tech/jobs/${TODAY_JOB}/photos`, { phase: "after" }, "event-afterphotos-01");
    await post(`/api/tech/jobs/${TODAY_JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
    await runFsmQueue();
    expect(await mirrorStatusOf(TODAY_JOB)).toEqual({ status: "completed", fsm_status: "Completed" });
  });

  it("does not count a step as written when FSM refuses its transition, and alerts after the last attempt", async () => {
    // Ops cancelled the job in FSM's own screen; the mirror has not heard yet.
    await fsm.transitionAppointment("ap-today", "Cancel", "Cancelled by ops.");
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    const eventId = await eventRowId("event-checkin-01");

    const first = batchOf(eventId, 1);
    await handleFsmSyncBatch(first as unknown as MessageBatch, queueEnv(), deps, createLogger());
    expect(first.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(await writeStateOf(eventId)).toBe("pending");

    const fifth = batchOf(eventId, 5);
    await handleFsmSyncBatch(fifth as unknown as MessageBatch, queueEnv(), deps, createLogger());
    expect(await writeStateOf(eventId)).toBe("rejected");
    expect(deps.alerts).toEqual([expect.stringMatching(/check_in did not reach FSM after 5 attempts/)]);
  });

  it("counts a step FSM has already taken as written, when ops moved the job in FSM first", async () => {
    await startJob();
    // Ops dispatched and started it in FSM's own screen before the phone's writes arrived.
    await fsm.transitionAppointment("ap-today", "Dispatch", "Dispatched by ops.");
    await fsm.transitionAppointment("ap-today", "Start Work", "Started by ops.");

    await runFsmQueue();
    expect(await writeStatesOf(TODAY_JOB)).toEqual(["written"]);
    expect(deps.alerts).toEqual([]);
  });

  it("retries an FSM write that failed, and leaves the technician's work on the record", async () => {
    await startJob();
    await beforePhotos();
    await runFsmQueue();
    fsm.failNext("updateAppointment", "FSM said 500");

    await post(`/api/tech/jobs/${TODAY_JOB}/checklist`, { done: ["piece_removed"] }, "event-checklist-01");
    const eventId = await eventRowId("event-checklist-01");

    const first = batchOf(eventId, 1);
    await handleFsmSyncBatch(first as unknown as MessageBatch, queueEnv(), deps, createLogger());
    expect(first.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(await writeStateOf(eventId)).toBe("pending");

    // The retry finds FSM willing, and the write lands.
    const second = batchOf(eventId, 2);
    await handleFsmSyncBatch(second as unknown as MessageBatch, queueEnv(), deps, createLogger());
    expect(second.messages[0]?.ack).toHaveBeenCalled();
    expect(await writeStateOf(eventId)).toBe("written");
  });

  it("gives up after five attempts, alerts, and keeps the event", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    await runFsmQueue();
    await post(`/api/tech/jobs/${TODAY_JOB}/start`, undefined, "event-start-01");
    const eventId = await eventRowId("event-start-01");
    fsm.failNext("updateAppointment", "FSM said 500");

    const fifth = batchOf(eventId, 5);
    await handleFsmSyncBatch(fifth as unknown as MessageBatch, queueEnv(), deps, createLogger());

    expect(fifth.messages[0]?.ack).toHaveBeenCalled();
    expect(await writeStateOf(eventId)).toBe("rejected");
    expect(deps.alerts).toEqual([expect.stringMatching(/did not reach FSM after 5 attempts/)]);
  });
});

// "A job's writes reach FSM in the order the technician made them" (ADR 0053).
// Each write is its own message and a failed one is retried later, so the
// order holds only if a write waits for the ones before it.
describe("the order a job reaches FSM in", () => {
  /** Every step of a service job after the before photographs, closed as done. */
  async function finishJob(): Promise<void> {
    await post(`/api/tech/jobs/${TODAY_JOB}/checklist`, { done: ["piece_removed"] }, "event-checklist-01");
    await post(`/api/tech/jobs/${TODAY_JOB}/consumables`, { items: [] }, "event-consumables-01");
    await post(`/api/tech/jobs/${TODAY_JOB}/photos`, { phase: "after" }, "event-afterphotos-01");
    await post(`/api/tech/jobs/${TODAY_JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
  }

  it("holds a job's close back while an earlier step is retried, then writes the rest in order", async () => {
    await startJob();
    await beforePhotos();
    await runFsmQueue();
    await finishJob();
    fsm.failNext("updateAppointment", "FSM said 500");

    // The checklist fails; every step after it waits rather than overtaking it.
    await runFsmQueue();
    expect(fsm.made.transitioned.map(({ name }) => name)).toEqual(["Dispatch", "Start Work"]);
    expect(await writeStateOf(await eventRowId("event-outcome-01"))).toBe("pending");

    // Its retry lands, and each write sends the next one on.
    const retried = batchOf(await eventRowId("event-checklist-01"), 2);
    await handleFsmSyncBatch(retried as unknown as MessageBatch, queueEnv(), deps, createLogger());
    await runFsmQueue();
    expect(fsm.made.transitioned.map(({ name }) => name)).toEqual(["Dispatch", "Start Work", "Complete Work"]);
    expect(await writeStatesOf(TODAY_JOB)).toEqual(["written"]);
  });

  it("closes nothing in FSM after a step it gave up on, and names what is left to enter by hand", async () => {
    await startJob();
    await beforePhotos();
    await runFsmQueue();
    await finishJob();
    fsm.failNext("updateAppointment", "FSM said 500");
    await runFsmQueue();

    const last = batchOf(await eventRowId("event-checklist-01"), 5);
    fsm.failNext("updateAppointment", "FSM said 500");
    await handleFsmSyncBatch(last as unknown as MessageBatch, queueEnv(), deps, createLogger());

    expect(fsm.made.transitioned.map(({ name }) => name)).not.toContain("Complete Work");
    expect(await writeStateOf(await eventRowId("event-outcome-01"))).toBe("rejected");
    expect(deps.alerts).toEqual([
      expect.stringMatching(/checklist did not reach FSM after 5 attempts.*consumables, after_photos, outcome/),
    ]);
  });
});

// A replacement: the old piece comes off, failed, and a new one goes on.
describe("the piece", () => {
  const REPLACEMENT = OTHER_JOB;

  beforeEach(async () => {
    await insertJob(REPLACEMENT, { fsmId: "ap-other", start: TODAY_START.toISOString(), type: "replacement" });
    await env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, fitted_at, replacement_due_at, synced_at)
       VALUES ('piece-old', 'asset-old', ?1, 'MM-STD-4417-B', 'Standard base', '2026-03-25', '2026-09-21', ?2)`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();
  });

  /** Every step of the replacement up to the piece, worked from 13:02, and replayed the next morning. */
  async function upToThePiece(at: Date): Promise<void> {
    const steps: [string, unknown, number][] = [
      ["checkin", AT_THE_DOOR, 2],
      ["start", undefined, 5],
      ["photos", { phase: "before" }, 10],
      ["checklist", { done: [] }, 30],
      ["consumables", { items: [{ name: "Adhesive", quantity: 2 }] }, 40],
    ];
    for (const [step, body, minute] of steps) {
      const answer = await postAt(at, `/api/tech/jobs/${REPLACEMENT}/${step}`, body, uuidv7At(minute));
      expect(answer.status).toBeLessThan(300);
    }
  }

  it("records the new piece with its base and lot, and the old one as failed with its reason, in FSM first", async () => {
    // Sent at 9 am the next day; the piece went on at 23:40 on the visit's day.
    const nextMorning = new Date("2026-09-22T03:30:00.000Z");
    await upToThePiece(nextMorning);
    const answer = await postAt(
      nextMorning,
      `/api/tech/jobs/${REPLACEMENT}/piece`,
      {
        piece_code: "MM-STD-5520-A",
        base: "Standard base",
        supplier_lot: "LOT-2026-09",
        old_piece: { piece_code: "MM-STD-4417-B", failure_reason: "Adhesive lifted at the front" },
      },
      uuidv7At(610),
    );
    expect(answer.status).toBe(202);

    await runFsmQueue();
    expect(fsm.made.assets).toEqual([
      {
        contactId: "contact-1",
        assetNumber: "MM-STD-5520-A",
        productId: "part-standard",
        serialNumber: "LOT-2026-09",
        installedAt: "2026-09-21",
      },
    ]);
    expect(fsm.made.assetUpdates).toEqual([{ assetId: "asset-old", status: "Inactive" }]);
    // The reason reaches FSM too, on the job's summary, not only our copy.
    expect(fsm.made.appointmentUpdates.at(-1)?.fields.Summary).toContain(
      "Piece off: MM-STD-4417-B (Adhesive lifted at the front)",
    );

    const pieces = await env.DB.prepare(
      "SELECT piece_code, fitted_at, replacement_due_at, failure_reason FROM pieces ORDER BY piece_code",
    ).all();
    expect(pieces.results).toEqual([
      {
        piece_code: "MM-STD-4417-B",
        fitted_at: "2026-03-25",
        replacement_due_at: "2026-09-21",
        failure_reason: "Adhesive lifted at the front",
      },
      // Fitted on the 21st in India, whatever day the write arrived; due 180 days on.
      { piece_code: "MM-STD-5520-A", fitted_at: "2026-09-21", replacement_due_at: "2027-03-20", failure_reason: null },
    ]);
  });

  it("refuses a label that is not a piece's, for the old piece as for the new", async () => {
    await upToThePiece(minutesAfterStart(60));
    const answer = await postAt(
      minutesAfterStart(60),
      `/api/tech/jobs/${REPLACEMENT}/piece`,
      { piece_code: "MM-STD-5520-A", old_piece: { piece_code: "MM-STD-4417 B", failure_reason: "Torn" } },
      uuidv7At(50),
    );

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["old_piece"] } });
  });

  it("keeps what was used, with quantities, where ops can count stock", async () => {
    await upToThePiece(minutesAfterStart(60));
    await runFsmQueue();

    const used = await env.DB.prepare("SELECT name, quantity FROM consumables_used WHERE appointment_id = ?1")
      .bind(REPLACEMENT)
      .all();
    expect(used.results).toEqual([{ name: "Adhesive", quantity: 2 }]);
  });
});

describe.each(RECORDS)("the no-show, on %s's record", (record) => {
  beforeEach(() => {
    onRecord(record);
  });

  it("is refused before the wait ends, then closes with its three facts", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    const early = await post(`/api/tech/jobs/${TODAY_JOB}/no-show`, undefined, "event-noshow-01");
    expect(early.status).toBe(425);
    expect(await early.json()).toMatchObject({ error: { code: "too_early_to_close" } });

    // The day-before WhatsApp, delivered: the third fact ops rule on.
    await env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, sent_at,
         delivered_at)
       VALUES ('m1', ?1, ?2, 'visit_reminder', 'appointment', ?3, 'sent', ?1, ?1)`,
    )
      .bind(NOW.toISOString(), PERSON, TODAY_JOB)
      .run();

    // Sixteen minutes later the wait has run.
    const later = new Date(NOW.getTime() + 16 * 60_000);
    const closed = await request(
      techAt(later),
      `/api/tech/jobs/${TODAY_JOB}/no-show`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "X-Client-Event-Id": "event-noshow-01" },
      },
      bindings(),
    );
    expect(closed.status).toBe(200);
    const body = await closed.json<{ closed: boolean; case_id: string | null }>();
    expect(body.closed).toBe(true);
    expect(body.case_id).not.toBeNull();

    const cases = await (
      await request(ops, "/api/no-shows", {}, bindings())
    ).json<{
      cases: { id: string; distance_m: number; message_delivered_at: string | null; decision: string }[];
    }>();
    expect(cases.cases).toHaveLength(1);
    // The three facts, and nothing else: when he arrived, how far away, and the receipt.
    expect(cases.cases[0]).toMatchObject({
      decision: "undecided",
      checked_in_at: NOW.toISOString(),
      message_delivered_at: NOW.toISOString(),
    });
    expect(cases.cases[0]?.distance_m).toBeLessThan(200);

    // Nothing is charged automatically: a person rules on it.
    const ruled = await opsPost(`/api/no-shows/${cases.cases[0]?.id ?? ""}/decision`, {
      decision: "charged",
      reason: "Delivered the evening before, and nobody came to the door",
    });
    expect(ruled.status).toBe(200);
    const after = await env.DB.prepare("SELECT decision, decided_by FROM no_show_cases").first<{
      decision: string;
      decided_by: string;
    }>();
    expect(after?.decision).toBe("charged");
    expect(after?.decided_by).not.toBe("");
  });

  it("is refused once the job has started, and opens no case", async () => {
    await startJob();

    const answer = await postAt(minutesAfterStart(0), `/api/tech/jobs/${TODAY_JOB}/no-show`, undefined, "event-ns-01");

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "already_started" } });
    const cases = await env.DB.prepare("SELECT COUNT(*) AS n FROM no_show_cases").first<{ n: number }>();
    expect(cases?.n).toBe(0);
  });

  // ADR 0036: "An address with no coordinates cannot be measured against ... It is
  // never silently treated as a pass at zero metres." The row names no address and
  // holds no distance (migration 0035), where it once held a filler 0.
  it("carries no distance when the address had no coordinates to measure against", async () => {
    await env.DB.prepare("UPDATE addresses SET lat = NULL, lng = NULL WHERE id = 'addr-1'").run();
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    // Sixteen minutes later the wait has run, and the technician closes the job.
    const later = new Date(NOW.getTime() + 16 * 60_000);
    const closed = await request(
      techAt(later),
      `/api/tech/jobs/${TODAY_JOB}/no-show`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "X-Client-Event-Id": "event-noshow-01" },
      },
      bindings(),
    );
    expect(closed.status).toBe(200);

    const row = await env.DB.prepare("SELECT address_id, distance_m FROM checkins WHERE appointment_id = ?1")
      .bind(TODAY_JOB)
      .first<{ address_id: string | null; distance_m: number | null }>();
    expect(row).toMatchObject({ address_id: null, distance_m: null });

    const body = await (await request(ops, "/api/no-shows", {}, bindings())).text();
    const cases = (JSON.parse(body) as { cases: { distance_m: number | null }[] }).cases;
    expect(cases).toHaveLength(1);
    expect(cases[0]?.distance_m).toBeNull();
    // The 0 in the column must not reach ops as fact two under any spelling.
    expect(body).not.toContain('"distance_m":0');
  });
});

describe("dispatch, when FSM keeps its own technician", () => {
  it("moves nothing, tells the client nothing, and records why", async () => {
    // What the provider throws when its read-back finds the old technician still on the job.
    fsm.failNext("assignVisit", "FSM answered the reassignment and kept the appointment's technician");

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      reason: "zone_rebalance",
    });

    expect(answer.status).toBe(502);
    const job = await env.DB.prepare("SELECT technician_id FROM appointments WHERE id = ?1")
      .bind(TODAY_JOB)
      .first<{ technician_id: string }>();
    expect(job?.technician_id).toBe(IMRAN);
    expect(messageQueue.sent).toEqual([]);
    const move = await env.DB.prepare("SELECT fsm_write_state, fsm_error FROM dispatch_moves").first<{
      fsm_write_state: string;
      fsm_error: string;
    }>();
    expect(move).toEqual({
      fsm_write_state: "rejected",
      fsm_error: "FSM answered the reassignment and kept the appointment's technician",
    });
  });
});

describe.each(RECORDS)("dispatch, on %s's record", (record) => {
  beforeEach(() => {
    onRecord(record);
  });

  it("refuses a move that would give one technician two jobs in one window", async () => {
    // Sameer already has a job in Monday's afternoon window.
    await insertJob(OTHER_JOB, { fsmId: "ap-other", start: "2026-09-21T07:30:00.000Z", technician: SAMEER });

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      date: "2026-09-21",
      window: "afternoon",
      reason: "zone_rebalance",
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "clash" } });
    // The check runs before any write to FSM.
    expect(fsm.made.assigned).toEqual([]);
    expect(fsm.made.rescheduled).toEqual([]);
    const moved = await env.DB.prepare("SELECT technician_id FROM appointments WHERE id = ?1")
      .bind(TODAY_JOB)
      .first<{ technician_id: string }>();
    expect(moved?.technician_id).toBe(IMRAN);
  });

  it.runIf(record === "fsm")(
    "moves the job in FSM, records who moved it and why, and messages the client",
    async () => {
      // The message goes only to a client who agreed to WhatsApp about his visits (ADR 0069).
      await env.DB.prepare(
        `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES ('consent-visits', ?1, 'whatsapp_visits', 'whatsapp-visits-v1', 1, ?2)`,
      )
        .bind(PERSON, NOW.toISOString())
        .run();
      const answer = await opsPost("/api/dispatch/move", {
        appointment_id: TODAY_JOB,
        ...AS_THE_BOARD_SHOWS_IT,
        technician_id: SAMEER,
        date: "2026-09-22",
        window: "morning",
        reason: "technician_unavailable",
      });

      expect(answer.status).toBe(200);
      expect(await answer.json()).toMatchObject({ client_notice: "messaged" });
      expect(fsm.made.assigned).toEqual([{ appointmentId: "ap-today", technicianId: "resource-2" }]);
      expect(fsm.made.rescheduled).toEqual([
        { appointmentId: "ap-today", start: "2026-09-22T09:00:00+05:30", end: "2026-09-22T10:30:00+05:30" },
      ]);

      const move = await env.DB.prepare(
        "SELECT was_technician_id, now_technician_id, reason, actor, fsm_write_state, message_id FROM dispatch_moves",
      ).first<Record<string, string>>();
      expect(move).toMatchObject({
        was_technician_id: IMRAN,
        now_technician_id: SAMEER,
        reason: "technician_unavailable",
        fsm_write_state: "written",
      });
      expect(move?.actor).not.toBe("");
      expect(move?.message_id).not.toBeNull();

      const message = await env.DB.prepare("SELECT kind FROM outbound_messages WHERE subject_id = ?1")
        .bind(TODAY_JOB)
        .first<{ kind: string }>();
      expect(message?.kind).toBe("visit_moved");
      expect(messageQueue.sent).toHaveLength(1);
    },
  );

  it("carries no amount on the board, and no leave where none is recorded", async () => {
    const answer = await request(ops, "/api/dispatch?from=2026-09-21", {}, bindings());
    const body = await answer.text();

    expect(answer.status).toBe(200);
    const board = JSON.parse(body) as {
      dates: string[];
      technicians: { technician_id: string; days: { blocks: unknown[] }[] }[];
      utilisation: { date: string; percent: number }[];
      leave: unknown[];
    };
    expect(board.dates).toHaveLength(7);
    expect(board.technicians.map((row) => row.technician_id)).toEqual([IMRAN, SAMEER]);
    expect(board.utilisation[0]).toEqual({ date: "2026-09-21", percent: 13 });
    expect(board.leave).toEqual([]);
    expect(body).not.toMatch(/amount|"paise"/i);
  });

  it.runIf(record === "fsm")("refuses a move FSM will not take, and moves nothing", async () => {
    fsm.failNext("rescheduleVisit", "FSM said 400");

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      date: "2026-09-22",
      window: "morning",
      reason: "running_over",
    });

    expect(answer.status).toBe(502);
    expect(await answer.json()).toMatchObject({ error: { code: "fsm_refused" } });
    const move = await env.DB.prepare("SELECT fsm_write_state, fsm_error FROM dispatch_moves").first<{
      fsm_write_state: string;
      fsm_error: string;
    }>();
    expect(move?.fsm_write_state).toBe("rejected");
    expect(move?.fsm_error).toContain("FSM said 400");
    const unmoved = await env.DB.prepare("SELECT window_start FROM appointments WHERE id = ?1")
      .bind(TODAY_JOB)
      .first<{ window_start: string }>();
    expect(unmoved?.window_start).toBe("2026-09-21T07:30:00.000Z");
  });

  it.runIf(record === "fsm")(
    "keeps FSM's reason for a refused move without the number or e-mail it echoed",
    async () => {
      fsm.failNext("rescheduleVisit", "FSM said 400: contact +919810000001 (rohit@example.com) is locked");

      await opsPost("/api/dispatch/move", {
        appointment_id: TODAY_JOB,
        ...AS_THE_BOARD_SHOWS_IT,
        date: "2026-09-22",
        window: "morning",
        reason: "running_over",
      });

      const move = await env.DB.prepare("SELECT fsm_error FROM dispatch_moves").first<{ fsm_error: string }>();
      expect(move?.fsm_error).toContain("FSM said 400");
      expect(move?.fsm_error).not.toContain("9810000001");
      expect(move?.fsm_error).not.toContain("rohit@example.com");
    },
  );
});

// A visit the technician has begun stays where he is working it: moved, his phone would carry on with a visit now
// booked for another day or another technician (BK-05, FLD-08).
describe.each(RECORDS)("dispatch, once the technician has begun, on %s's record", (record) => {
  beforeEach(() => {
    onRecord(record);
  });

  const moveToSameerTomorrow = () =>
    opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "morning",
      reason: "running_over",
    });

  const visitNow = () =>
    env.DB.prepare("SELECT technician_id, window_start FROM appointments WHERE id = ?1").bind(TODAY_JOB).first();

  /** Today's job as the board draws it on Imran's row. */
  async function blockOnTheBoard(): Promise<Record<string, unknown> | undefined> {
    const board = await (
      await request(ops, "/api/dispatch?from=2026-09-21", {}, bindings())
    ).json<{ technicians: { technician_id: string; days: { blocks: Record<string, unknown>[] }[] }[] }>();
    const row = board.technicians.find((each) => each.technician_id === IMRAN);
    return row?.days[0]?.blocks.find((block) => block.appointment_id === TODAY_JOB);
  }

  it("refuses to move a visit he has checked in at, and writes nothing", async () => {
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    const answer = await moveToSameerTomorrow();

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "in_progress" } });
    expect(await visitNow()).toEqual({ technician_id: IMRAN, window_start: TODAY_START.toISOString() });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dispatch_moves").first()).toEqual({ n: 0 });
    expect(fsm.made.assigned).toEqual([]);
    expect(fsm.made.rescheduled).toEqual([]);
  });

  it("refuses to move a visit he has started, before FSM has heard of it", async () => {
    await startJob();

    const answer = await moveToSameerTomorrow();

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "in_progress" } });
    expect(await visitNow()).toEqual({ technician_id: IMRAN, window_start: TODAY_START.toISOString() });
  });

  it("offers it no room, and the board says how far he has got", async () => {
    expect(await blockOnTheBoard()).toMatchObject({ begun: null });
    await post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");

    const room = await request(ops, `/api/dispatch/room?appointment_id=${TODAY_JOB}&from=2026-09-21`, {}, bindings());

    expect(room.status).toBe(404);
    expect(await blockOnTheBoard()).toMatchObject({ begun: "arrived" });
    await post(`/api/tech/jobs/${TODAY_JOB}/start`, undefined, "event-start-01");
    expect(await blockOnTheBoard()).toMatchObject({ begun: "started" });
  });
});

// A label is one piece's: typed again for another client, or this client's old piece typed as the new one, it would
// record nothing for this client, or two clients' pieces as one (FLD-21). The technician corrects it on the phone.
describe.each(RECORDS)("a piece label already on record, on %s's record", (record) => {
  const REPLACEMENT = OTHER_JOB;
  const NEIGHBOUR = "11111111-1111-4111-8111-111111111112";

  beforeEach(async () => {
    onRecord(record);
    await insertJob(REPLACEMENT, { fsmId: "ap-other", start: TODAY_START.toISOString(), type: "replacement" });
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000002', 'Vikram Sethi')",
    )
      .bind(NEIGHBOUR, NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, fitted_at, replacement_due_at, synced_at)
       VALUES ('piece-old', 'asset-old', ?1, 'MM-STD-4417-B', 'Standard base', '2026-03-25', '2026-09-21', ?2),
              ('piece-theirs', 'asset-theirs', ?3, 'MM-STD-9999-A', 'Standard base', '2026-05-02', '2026-10-29', ?2)`,
    )
      .bind(PERSON, NOW.toISOString(), NEIGHBOUR)
      .run();
    const sentAt = minutesAfterStart(60);
    const steps: [string, unknown, number][] = [
      ["checkin", AT_THE_DOOR, 2],
      ["start", undefined, 5],
      ["photos", { phase: "before" }, 10],
      ["checklist", { done: [] }, 30],
      ["consumables", { items: [] }, 40],
    ];
    for (const [step, body, minute] of steps) {
      const answer = await postAt(sentAt, `/api/tech/jobs/${REPLACEMENT}/${step}`, body, uuidv7At(minute));
      expect(answer.status).toBeLessThan(300);
    }
  });

  const piece = (body: object) =>
    postAt(minutesAfterStart(60), `/api/tech/jobs/${REPLACEMENT}/piece`, body, uuidv7At(50));

  const pieceSteps = () =>
    env.DB.prepare("SELECT COUNT(*) AS n FROM job_events WHERE appointment_id = ?1 AND kind = 'piece'")
      .bind(REPLACEMENT)
      .first();

  it("is refused when another client's piece carries it, and nothing lands", async () => {
    const answer = await piece({ piece_code: "MM-STD-9999-A", base: "Standard base" });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "piece_code", fields: ["piece_code"] } });
    expect(await pieceSteps()).toEqual({ n: 0 });
  });

  it("is refused when it is the client's own piece from an earlier visit", async () => {
    const answer = await piece({
      piece_code: "MM-STD-4417-B",
      old_piece: { piece_code: "MM-STD-4417-B", failure_reason: "Torn" },
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "piece_code", fields: ["piece_code"] } });
  });

  it("is refused as the piece that came off when it is another client's", async () => {
    const answer = await piece({
      piece_code: "MM-STD-5520-A",
      old_piece: { piece_code: "MM-STD-9999-A", failure_reason: "Torn" },
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "piece_code", fields: ["old_piece"] } });
    expect(await pieceSteps()).toEqual({ n: 0 });
  });

  it("lands once corrected", async () => {
    await piece({ piece_code: "MM-STD-9999-A" });

    const corrected = await postAt(
      minutesAfterStart(60),
      `/api/tech/jobs/${REPLACEMENT}/piece`,
      { piece_code: "MM-STD-5520-A", old_piece: { piece_code: "MM-STD-4417-B", failure_reason: "Torn" } },
      uuidv7At(51),
    );

    expect(corrected.status).toBe(202);
    expect(await pieceSteps()).toEqual({ n: 1 });
  });
});

// Leave is ours because FSM has nowhere to keep it (ADR 0062). The point of
// putting it through the same clash check is that nothing has to remember to
// ask: the board refuses it, and so does the client's own booking.
describe.each(RECORDS)("leave, on %s's record", (record) => {
  beforeEach(() => {
    onRecord(record);
  });

  const recordLeave = (technicianId: string, from: string, to: string, note?: string) =>
    opsPost(`/api/technicians/${technicianId}/leave`, { from, to, ...(note === undefined ? {} : { note }) });

  it("refuses a job on a day the technician is away, and names it as leave, not a clash", async () => {
    // Sameer is away on the 22nd; his day is otherwise empty.
    expect((await recordLeave(SAMEER, "2026-09-22", "2026-09-23", "Family wedding")).status).toBe(200);

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "morning",
      reason: "zone_rebalance",
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "on_leave" } });
    // Refused before any write, here as for a clash.
    expect(fsm.made.assigned).toEqual([]);
    expect(fsm.made.rescheduled).toEqual([]);
    const unmoved = await env.DB.prepare("SELECT technician_id FROM appointments WHERE id = ?1")
      .bind(TODAY_JOB)
      .first<{ technician_id: string }>();
    expect(unmoved?.technician_id).toBe(IMRAN);
  });

  it("draws the leave on the board, clipped to the week it shows", async () => {
    // A fortnight from the 20th: the board's week ends on the 27th.
    expect((await recordLeave(IMRAN, "2026-09-20", "2026-10-03")).status).toBe(200);

    const board = await (
      await request(ops, "/api/dispatch?from=2026-09-21", {}, bindings())
    ).json<{ leave: { technician_id: string; from: string; to: string; note: string | null }[] }>();
    expect(board.leave).toEqual([{ technician_id: IMRAN, from: "2026-09-21", to: "2026-09-27", note: null }]);
  });

  it("takes leave back, and the day can be worked again", async () => {
    const recorded = await recordLeave(SAMEER, "2026-09-22", "2026-09-22");
    const { id } = await recorded.json<{ id: string }>();

    expect((await opsPost(`/api/technicians/${SAMEER}/leave/${id}/cancel`, {})).status).toBe(200);
    // A second cancel finds nothing: the row is already taken back.
    expect((await opsPost(`/api/technicians/${SAMEER}/leave/${id}/cancel`, {})).status).toBe(404);

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "morning",
      reason: "zone_rebalance",
    });
    expect(answer.status).toBe(200);
  });

  it("refuses dates that do not make a period, and records nothing", async () => {
    expect((await recordLeave(SAMEER, "2026-09-23", "2026-09-22")).status).toBe(400);
    expect((await recordLeave(SAMEER, "2026-09-22", "2028-09-22")).status).toBe(400);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM technician_leave").first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("is recorded against the ops user who entered it", async () => {
    await recordLeave(IMRAN, "2026-09-24", "2026-09-24", "Doctor");
    const row = await env.DB.prepare("SELECT technician_id, note, actor FROM technician_leave").first<{
      technician_id: string;
      note: string;
      actor: string;
    }>();
    expect(row).toMatchObject({ technician_id: IMRAN, note: "Doctor" });
    expect(row?.actor).not.toBe("");

    const audit = await env.DB.prepare("SELECT action FROM audit_log WHERE subject_id = ?1").bind(IMRAN).first<{
      action: string;
    }>();
    expect(audit?.action).toBe("technician.leave");
  });

  it("keeps a client from booking the day at all, so the two cannot disagree", async () => {
    await recordLeave(IMRAN, "2026-09-24", "2026-09-24");
    await recordLeave(SAMEER, "2026-09-24", "2026-09-24");

    const board = await (
      await request(ops, "/api/dispatch?from=2026-09-21", {}, bindings())
    ).json<{ leave: { technician_id: string }[] }>();
    expect(board.leave.map((period) => period.technician_id).sort()).toEqual([IMRAN, SAMEER].sort());

    const held = await occupancy(env.DB, "2026-09-24", "2026-09-24", NOW);
    expect(held(IMRAN, "2026-09-24").onLeave).toBe(true);
    // A service visit's two half-slots (src/policy/visit-length.ts).
    expect(placement(held(IMRAN, "2026-09-24"), "morning", 2)).toBeNull();
    expect(placement(held(IMRAN, "2026-09-25"), "morning", 2)).not.toBeNull();
  });
});

describe.each(RECORDS)("the roster, on %s's record", (record) => {
  beforeEach(() => {
    onRecord(record);
  });

  // Read in one query for the whole roster, where it was once a query a technician (OPS-11).
  it("lists each technician's phones, the latest used first, beside their leave", async () => {
    await openTechnicianSession(env.DB, {
      technicianId: SAMEER,
      deviceId: "phone-def-456",
      label: null,
      now: new Date(NOW.getTime() - 60_000),
    });
    const roster = await (
      await request(ops, "/api/technicians", {}, bindings())
    ).json<{
      technicians: { id: string; devices: { device_id: string; label: string | null }[]; leave: unknown[] }[];
    }>();

    expect(roster.technicians.map((each) => [each.id, each.devices, each.leave])).toEqual([
      [IMRAN, [expect.objectContaining({ device_id: DEVICE, label: "Chrome on Android" })], []],
      [SAMEER, [expect.objectContaining({ device_id: "phone-def-456", label: null })], []],
    ]);
  });
});

describe.each(RECORDS)("a revoked phone, on %s's record", (record) => {
  beforeEach(() => {
    onRecord(record);
  });

  it("is told to drop its cached jobs on its next call, and the wipe is recorded", async () => {
    expect((await get("/api/tech/jobs")).status).toBe(200);

    const revoked = await opsPost(`/api/technicians/${IMRAN}/devices/${DEVICE}/revoke`, {});
    expect(revoked.status).toBe(200);

    const answer = await get("/api/tech/jobs");
    expect(answer.status).toBe(401);
    expect(await answer.json()).toMatchObject({ error: { code: "device_revoked" } });
    const device = await env.DB.prepare("SELECT wiped_at FROM technician_devices WHERE device_id = ?1")
      .bind(DEVICE)
      .first<{ wiped_at: string | null }>();
    expect(device?.wiped_at).toBe(NOW.toISOString());
  });
});

// ---------------------------------------------------------------------------
// The fsm-sync queue, driven the way the Worker drives it
// ---------------------------------------------------------------------------

function queueEnv() {
  return { ...env, FSM_QUEUE: fsmQueue, MESSAGE_QUEUE: messageQueue } as unknown as typeof env;
}

function batchOf(jobEventId: string, attempts: number) {
  return {
    queue: "mm-fsm-sync-local",
    messages: [
      {
        id: "m1",
        body: { job_event_id: jobEventId, request_id: "r1" },
        attempts,
        ack: vi.fn(),
        retry: vi.fn(),
      },
    ],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
}

/**
 * Delivers every FSM write queued since the last call, in the order it was
 * queued, including those the consumer itself sends on. A retry is left for
 * the test to deliver.
 */
async function runFsmQueue(): Promise<void> {
  for (; delivered < fsmQueue.sent.length; delivered += 1) {
    const body = fsmQueue.sent[delivered] as { job_event_id?: string };
    if (body.job_event_id === undefined) continue;
    const batch = batchOf(body.job_event_id, 1);
    await handleFsmSyncBatch(batch as unknown as MessageBatch, queueEnv(), deps, createLogger());
  }
}

async function eventRowId(clientEventId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM job_events WHERE event_id = ?1")
    .bind(clientEventId)
    .first<{ id: string }>();
  return row?.id ?? "";
}

async function writeStateOf(id: string): Promise<string> {
  const row = await env.DB.prepare("SELECT fsm_write_state FROM job_events WHERE id = ?1")
    .bind(id)
    .first<{ fsm_write_state: string }>();
  return row?.fsm_write_state ?? "";
}

async function mirrorStatusOf(appointmentId: string) {
  return env.DB.prepare("SELECT status, fsm_status FROM appointments WHERE id = ?1")
    .bind(appointmentId)
    .first<{ status: string; fsm_status: string }>();
}

/** The distinct write states of a job's events. */
async function writeStatesOf(appointmentId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT fsm_write_state AS state FROM job_events WHERE appointment_id = ?1 ORDER BY state",
  )
    .bind(appointmentId)
    .all<{ state: string }>();
  return results.map((row) => row.state);
}

it("offers what the org offers from each status, by the org's own names", () => {
  // The trial, from Scheduled (docs/decisions/fsm-trial.md, question 7).
  expect(STUB_TRANSITIONS.Scheduled).toEqual(["Dispatch", "Reschedule", "Cancel", "Terminate"]);
  // The staging runs (docs/verification.md): Dispatch, then Start Work, then Complete Work.
  expect(STUB_TRANSITIONS.Dispatched).toContain("Start Work");
  expect(STUB_TRANSITIONS["In Progress"]).toContain("Complete Work");
  expect(STUB_TRANSITIONS.Completed).toBeUndefined();
});
