// The dispatch board's writes under real conditions: a technician-only change,
// a visit with no room, two moves at once, and a client who cannot be messaged.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and
// address here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.ts";
import { occupancy, type Day } from "../../src/domain/scheduling.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { sweep } from "../../src/scheduled/sweeper.ts";
import {
  createStubFsm,
  EMPTY_FSM,
  type FsmAppointment,
  type FsmProvider,
  type StubFsm,
} from "../../src/providers/fsm.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const ROHIT = "11111111-1111-4111-8111-111111111111";
const IMRAN = "33333333-3333-4333-8333-333333333331";
const SAMEER = "33333333-3333-4333-8333-333333333332";

const FIT = "22222222-2222-4222-8222-222222222221";
const REPLACEMENT = "22222222-2222-4222-8222-222222222222";
/** Two service visits, for the moves that meet each other. */
const A = "22222222-2222-4222-8222-2222222222a1";
const B = "22222222-2222-4222-8222-2222222222b1";

const WEDNESDAY = "2026-09-23";

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
    appointments: [FIT, REPLACEMENT, A, B].map((id) => fsmAppointment(`ap-${id}`)),
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

const opsPost = (path: string, body: unknown, app: App = ops) =>
  request(
    app,
    path,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    bindings(),
  );

/** The job as the mirror has it now, which is what a board loaded now would show. */
const shown = (id: string) =>
  env.DB.prepare("SELECT technician_id, window_start FROM appointments WHERE id = ?1")
    .bind(id)
    .first<{ technician_id: string | null; window_start: string }>();

/** A move sent from a board that shows the job as it stands, unless the body says otherwise. */
async function move(body: { appointment_id: string } & Record<string, unknown>, app: App = ops): Promise<Response> {
  const job = await shown(body.appointment_id);
  return opsPost(
    "/api/dispatch/move",
    { expected_technician_id: job?.technician_id ?? null, expected_starts_at: job?.window_start, ...body },
    app,
  );
}

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

    const sameWindow = await move({
      appointment_id: FIT,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "afternoon",
      reason: "zone_rebalance",
    });
    const noTime = await move({
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

    const answer = await move({
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

    const answer = await move({
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

    const answer = await move({
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

/** Ops' console, on an FSM that runs `during` before its first write, as a slow FSM leaves a move open. */
function slowOps(during: () => Promise<void>): App {
  let ran = false;
  const once = async () => {
    if (ran) return;
    ran = true;
    await during();
  };
  const slow: FsmProvider = {
    ...fsm,
    assignVisit: async (appointmentId, technicianId) => {
      await once();
      await fsm.assignVisit(appointmentId, technicianId);
    },
    rescheduleVisit: async (appointmentId, times) => {
      await once();
      await fsm.rescheduleVisit(appointmentId, times);
    },
  };
  return appFor("local", fakeDependencies({ fsm: slow }), {}, "ops");
}

const claims = () =>
  env.DB.prepare("SELECT technician_id, date, claim, hold_id, move_id FROM slot_claims ORDER BY claim").all<{
    technician_id: string;
    date: string;
    claim: string;
    hold_id: string | null;
    move_id: string | null;
  }>();

/** A client's hold on Sameer's Wednesday morning from 09:00, paid for or not, with its claims. */
async function holdOnWednesday(options: { paid: boolean; expiresAt: string }): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
         gst_percent, state, expires_at, created_at, updated_at, confirmed_at)
       VALUES (?1, ?2, 'service', ?3, 'morning', ?4, 0, 210000, 200000, 5, 'held', ?5, ?6, ?6, ?7)`,
    ).bind(id, ROHIT, WEDNESDAY, SAMEER, options.expiresAt, NOW.toISOString(), options.paid ? NOW.toISOString() : null),
    ...["unit:0", "unit:1", "window:morning"].map((claim) =>
      env.DB.prepare("INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES (?1, ?2, ?3, ?4)").bind(
        SAMEER,
        WEDNESDAY,
        claim,
        id,
      ),
    ),
  ]);
  return id;
}

const toSameerWednesdayMorning = (id: string) => ({
  appointment_id: id,
  technician_id: SAMEER,
  date: WEDNESDAY,
  window: "morning",
  reason: "zone_rebalance",
});

const minutesBeforeNow = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const holdState = async (id: string) =>
  (await env.DB.prepare("SELECT state FROM slot_holds WHERE id = ?1").bind(id).first<{ state: string }>())?.state;

describe("a move and the time it goes to", () => {
  beforeEach(async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
    await insertJob(B, { type: "service", start: TUESDAY["12:00"], technician: IMRAN });
  });

  // BIZ-19: the check, FSM and the mirror were three steps with nothing holding the time between them.
  it("claims the new time before FSM is written, and lets it go once FSM has it", async () => {
    let during: Awaited<ReturnType<typeof claims>>["results"] = [];
    const answer = await move(
      toSameerWednesdayMorning(A),
      slowOps(async () => {
        during = (await claims()).results;
      }),
    );

    expect(answer.status).toBe(200);
    expect(during.map(({ technician_id, date, claim, hold_id }) => ({ technician_id, date, claim, hold_id }))).toEqual([
      { technician_id: SAMEER, date: WEDNESDAY, claim: "unit:0", hold_id: null },
      { technician_id: SAMEER, date: WEDNESDAY, claim: "unit:1", hold_id: null },
      { technician_id: SAMEER, date: WEDNESDAY, claim: "window:morning", hold_id: null },
    ]);
    expect(during.every((claim) => claim.move_id !== null)).toBe(true);
    expect((await claims()).results).toEqual([]);
    expect(await shown(A)).toEqual({ technician_id: SAMEER, window_start: "2026-09-23T03:30:00.000Z" });
  });

  it("keeps that time from a client's booking while FSM is written", async () => {
    let day: Day | undefined;
    await move(
      toSameerWednesdayMorning(A),
      slowOps(async () => {
        day = (await occupancy(env.DB, WEDNESDAY, WEDNESDAY, NOW))(SAMEER, WEDNESDAY);
      }),
    );

    expect(day?.windows.has("morning")).toBe(true);
    expect([...(day?.units ?? [])].sort()).toEqual([0, 1]);
  });

  it("refuses a second move onto that time while the first is still with FSM", async () => {
    let second: Response | undefined;
    const first = await move(
      toSameerWednesdayMorning(A),
      slowOps(async () => {
        second = await move(toSameerWednesdayMorning(B));
      }),
    );

    expect(first.status).toBe(200);
    expect(second?.status).toBe(409);
    expect(await second?.json()).toMatchObject({ error: { code: "clash" } });
    expect(fsm.made.assigned).toEqual([{ appointmentId: `ap-${A}`, technicianId: "resource-2" }]);
    expect(await shown(B)).toEqual({ technician_id: IMRAN, window_start: TUESDAY["12:00"] });
  });

  it("answers a second move of the same job, made while the first is with FSM, as superseded", async () => {
    let second: Response | undefined;
    await move(
      toSameerWednesdayMorning(A),
      slowOps(async () => {
        second = await move({ ...toSameerWednesdayMorning(A), date: "2026-09-24" });
      }),
    );

    expect(second?.status).toBe(409);
    expect(await second?.json()).toMatchObject({ error: { code: "superseded", fields: ["moving"] } });
    expect(fsm.made.rescheduled).toHaveLength(1);
  });

  it("lets the time go when FSM refuses the move", async () => {
    fsm.failNext("assignVisit", "FSM said 400");

    const answer = await move(toSameerWednesdayMorning(A));

    expect(answer.status).toBe(502);
    expect((await claims()).results).toEqual([]);
    expect(await shown(A)).toEqual({ technician_id: IMRAN, window_start: TUESDAY["09:00"] });
  });

  // ADR 0068: a paid hold keeps its time until it is booked or refunded, whatever else happens.
  it("never lets go of a paid hold's time, nor writes over it", async () => {
    const hold = await holdOnWednesday({ paid: true, expiresAt: minutesBeforeNow(60) });

    const answer = await move(toSameerWednesdayMorning(A));

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "clash" } });
    expect((await claims()).results.map((claim) => claim.hold_id)).toEqual([hold, hold, hold]);
    expect(await holdState(hold)).toBe("held");
  });

  it("lets go of a hold nobody paid for, whose time ran out, to make the move", async () => {
    const hold = await holdOnWednesday({ paid: false, expiresAt: minutesBeforeNow(10) });

    const answer = await move(toSameerWednesdayMorning(A));

    expect(answer.status).toBe(200);
    expect(await holdState(hold)).toBe("released");
  });

  it("has the sweeper take back the time of a move that never finished, for the next client's hold", async () => {
    const open = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO dispatch_moves (id, appointment_id, was_technician_id, now_technician_id, was_start, now_start,
           reason, actor, fsm_write_state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'zone_rebalance', 'ops@example.test', 'pending', ?7, ?7)`,
      ).bind(open, B, IMRAN, SAMEER, TUESDAY["12:00"], "2026-09-23T03:30:00.000Z", minutesBeforeNow(6)),
      env.DB.prepare(
        "INSERT INTO slot_claims (technician_id, date, claim, move_id) VALUES (?1, ?2, 'window:morning', ?3)",
      ).bind(SAMEER, WEDNESDAY, open),
    ]);
    const queues = {
      CRM_QUEUE: fakeQueue(),
      RENDER_QUEUE: fakeQueue(),
      MESSAGE_QUEUE: fakeQueue(),
      FSM_QUEUE: fakeQueue(),
    };

    await sweep(
      { DB: env.DB, UPLOADS: env.UPLOADS, RESULTS: env.RESULTS, ...queues },
      fakeDependencies(),
      createLogger(),
      {
        creditFloor: 0,
        budget: createCallBudget(Infinity),
      },
    );

    expect((await claims()).results).toEqual([]);
    const closed = await env.DB.prepare("SELECT fsm_write_state FROM dispatch_moves WHERE id = ?1")
      .bind(open)
      .first<{ fsm_write_state: string }>();
    expect(closed?.fsm_write_state).toBe("rejected");
  });

  it("takes back the time of a move that never finished, five minutes on, and not before", async () => {
    const open = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO dispatch_moves (id, appointment_id, was_technician_id, now_technician_id, was_start, now_start,
           reason, actor, fsm_write_state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'zone_rebalance', 'ops@example.test', 'pending', ?7, ?7)`,
      ).bind(open, B, IMRAN, SAMEER, TUESDAY["12:00"], "2026-09-23T03:30:00.000Z", minutesBeforeNow(2)),
      ...["unit:0", "unit:1", "window:morning"].map((claim) =>
        env.DB.prepare("INSERT INTO slot_claims (technician_id, date, claim, move_id) VALUES (?1, ?2, ?3, ?4)").bind(
          SAMEER,
          WEDNESDAY,
          claim,
          open,
        ),
      ),
    ]);

    expect((await move(toSameerWednesdayMorning(A))).status).toBe(409);

    await env.DB.prepare("UPDATE dispatch_moves SET created_at = ?1 WHERE id = ?2")
      .bind(minutesBeforeNow(6), open)
      .run();
    expect((await move(toSameerWednesdayMorning(A))).status).toBe(200);
    const abandoned = await env.DB.prepare("SELECT fsm_write_state, fsm_error FROM dispatch_moves WHERE id = ?1")
      .bind(open)
      .first<{ fsm_write_state: string; fsm_error: string }>();
    expect(abandoned?.fsm_write_state).toBe("rejected");
    expect(abandoned?.fsm_error).toContain("never finished");
  });
});

// FEO-05: two ops users on the same board, the second working from what he loaded a while ago.
describe("a move made from a board that has gone stale", () => {
  beforeEach(async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
  });

  it("is refused before anything is written, naming what changed", async () => {
    const technician = await move({ ...toSameerWednesdayMorning(A), expected_technician_id: SAMEER });
    const time = await move({ ...toSameerWednesdayMorning(A), expected_starts_at: TUESDAY["12:00"] });
    const both = await move({
      ...toSameerWednesdayMorning(A),
      expected_technician_id: SAMEER,
      expected_starts_at: TUESDAY["12:00"],
    });

    expect(technician.status).toBe(409);
    expect(await technician.json()).toMatchObject({ error: { code: "superseded", fields: ["technician"] } });
    expect(await time.json()).toMatchObject({ error: { code: "superseded", fields: ["time"] } });
    expect(await both.json()).toMatchObject({ error: { code: "superseded", fields: ["technician", "time"] } });
    expect(fsm.made.assigned).toEqual([]);
    expect(fsm.made.rescheduled).toEqual([]);
  });

  it("assigns a job from the tray only while it is still in the tray", async () => {
    await insertJob(B, { type: "service", start: TUESDAY["12:00"], technician: null });
    const assign = (technician: string) =>
      opsPost("/api/dispatch/assign", {
        appointment_id: B,
        technician_id: technician,
        date: "2026-09-22",
        window: "afternoon",
        reason: "client_asked",
        expected_technician_id: null,
        expected_starts_at: TUESDAY["12:00"],
      });

    expect((await assign(SAMEER)).status).toBe(200);
    const again = await assign(IMRAN);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "superseded", fields: ["technician"] } });
    expect(await shown(B)).toEqual({ technician_id: SAMEER, window_start: TUESDAY["12:00"] });
  });
});
