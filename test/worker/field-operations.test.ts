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
import type { App } from "../../src/app.ts";
import { openTechnicianSession } from "../../src/domain/technicians.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, STUB_TRANSITIONS, type StubFsm } from "../../src/providers/fsm.ts";
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

const world = () => ({
  ...EMPTY_FSM,
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
      unlocks_at: "2026-09-23T18:30:00.000Z",
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

  it("retries an FSM write that failed, and leaves the technician's work on the record", async () => {
    await startJob();
    await beforePhotos();
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
    await startJob();
    const eventId = await eventRowId("event-start-01");
    fsm.failNext("updateAppointment", "FSM said 500");

    const fifth = batchOf(eventId, 5);
    await handleFsmSyncBatch(fifth as unknown as MessageBatch, queueEnv(), deps, createLogger());

    expect(fifth.messages[0]?.ack).toHaveBeenCalled();
    expect(await writeStateOf(eventId)).toBe("rejected");
    expect(deps.alerts).toEqual([expect.stringMatching(/did not reach FSM after 5 attempts/)]);
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
    const ruled = await opsPost(`/api/no-shows/${cases.cases[0]?.id ?? ""}/decision`, { decision: "charged" });
    expect(ruled.status).toBe(200);
    const after = await env.DB.prepare("SELECT decision, decided_by FROM no_show_cases").first<{
      decision: string;
      decided_by: string;
    }>();
    expect(after?.decision).toBe("charged");
    expect(after?.decided_by).not.toBe("");
  });
});

describe("dispatch", () => {
  it("refuses a move that would give one technician two jobs in one window", async () => {
    // Sameer already has a job in Monday's afternoon window.
    await insertJob(OTHER_JOB, { fsmId: "ap-other", start: "2026-09-21T07:30:00.000Z", technician: SAMEER });

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
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
    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "morning",
      reason: "technician_unavailable",
    });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ messaged: true });
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

  it("carries no amount on the board, and leaves leave empty while FSM answers 48 hours", async () => {
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

/** Runs every FSM write the routes queued, in the order they were queued. */
async function runFsmQueue(): Promise<void> {
  for (const message of [...fsmQueue.sent]) {
    const body = message as { job_event_id?: string };
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

it("offers the transitions the trial found, so the stub matches FSM", () => {
  expect(STUB_TRANSITIONS).toContain("Dispatch");
  expect(STUB_TRANSITIONS).toContain("Terminate");
});
