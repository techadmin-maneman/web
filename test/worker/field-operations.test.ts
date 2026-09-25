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

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "../../apps/tech/src/store/uuidv7.ts";
import type { App } from "../../src/app.ts";
import { occupancy, placement } from "../../src/domain/scheduling.ts";
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
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request, type TestDependencies } from "./helpers.ts";
import { syntheticJpeg } from "./tryon-fixtures.ts";

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

let tech: App;
let ops: App;
let deps: TestDependencies;
let fsm: StubFsm;
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
  items: [{ id: "part-standard", name: "Standard base", type: "Part" as const }],
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
  deps = fakeDependencies({ fsm });
  tech = appFor("local", deps, {}, "tech");
  ops = appFor("local", deps, {}, "ops");

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
    appFor("local", fakeDependencies({ fsm, now: () => at }), {}, "tech"),
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

describe("the day's jobs", () => {
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

describe("checking in", () => {
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

describe("the outbox", () => {
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
    // And only the first put an FSM write on the queue: check-in, start, photos, checklist.
    expect(fsmQueue.sent).toHaveLength(4);
  });

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
    expect(await answer.json()).toMatchObject({ error: { code: "superseded", fields: ["technician"] } });
    const row = await env.DB.prepare(
      "SELECT superseded, fsm_write_state FROM job_events WHERE event_id = 'event-late-01'",
    ).first<{ superseded: number; fsm_write_state: string }>();
    expect(row).toEqual({ superseded: 1, fsm_write_state: "rejected" });
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
    expect(put.status).toBe(204);

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

describe("the no-show", () => {
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
    const lateDeps = fakeDependencies({ fsm, now: () => later });
    const lateTech = appFor("local", lateDeps, {}, "tech");
    const closed = await request(
      lateTech,
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
      appFor("local", fakeDependencies({ fsm, now: () => later }), {}, "tech"),
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

describe("dispatch", () => {
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

  it("moves the job in FSM, records who moved it and why, and messages the client", async () => {
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
  });

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

  it("refuses a move FSM will not take, and moves nothing", async () => {
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
});

// Leave is ours because FSM has nowhere to keep it (ADR 0062). The point of
// putting it through the same clash check is that nothing has to remember to
// ask: the board refuses it, and so does the client's own booking.
describe("leave", () => {
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
    expect(placement(held(IMRAN, "2026-09-24"), "morning", "service")).toBeNull();
    expect(placement(held(IMRAN, "2026-09-25"), "morning", "service")).not.toBeNull();
  });
});

describe("a revoked phone", () => {
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
