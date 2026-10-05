// What each technician has done, on the ops surface (src/routes/ops/technicians.ts),
// Ops Console D3. NOW is Monday 21 September 2026, 12 noon in India. Nothing
// here is a real person or number.
//
// Nothing counts jobs anywhere: the figures are read from the appointments
// themselves, and the service time from the technician's own Start and outcome,
// so the tests put those rows down and read the board back.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";

const IMRAN = "88888888-8888-4888-8888-888888888881";
const SANDEEP = "88888888-8888-4888-8888-888888888882";
const PERSON = "11111111-1111-4111-8111-111111111111";

let ops: App;

interface Row {
  technician_id: string;
  jobs: number;
  timed_jobs: number;
  average_minutes: number | null;
  average_planned_minutes: number | null;
  runs_over: boolean;
  skill: null;
}

interface Body {
  from: string;
  to: string;
  technicians: Row[];
}

const work = async (query = ""): Promise<Body> => (await request(ops, `/api/technicians/work${query}`)).json<Body>();
const of = (body: Body, id: string) => body.technicians.find((each) => each.technician_id === id);

async function technician(id: string, name: string, active = 1) {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, ?2, ?3, 'XX', ?4, ?5)",
  )
    .bind(id, `fsm-${id}`, name, active, NOW.toISOString())
    .run();
}

let jobs = 0;

/** A visit of `technicianId`, in the state FSM left it. */
async function visit(options: {
  id: string;
  technicianId: string | null;
  type: string | null;
  start: string;
  status?: string;
  deleted?: boolean;
}) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, technician_id,
       fsm_modified_at, synced_at, deleted_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'Completed', ?6, ?7, ?8, ?8, ?9)`,
  )
    .bind(
      options.id,
      `fsm-job-${String(++jobs)}`,
      PERSON,
      options.type,
      options.status ?? "completed",
      options.start,
      options.technicianId,
      NOW.toISOString(),
      options.deleted === true ? NOW.toISOString() : null,
    )
    .run();
}

/** One of the phone's outbox events, as src/domain/job-events.ts lands it. */
async function event(jobId: string, technicianId: string, kind: string, occurredAt: string, superseded = 0) {
  await env.DB.prepare(
    `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
       superseded, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, '{}', ?6, ?6, ?7, ?6)`,
  )
    .bind(crypto.randomUUID(), jobId, `${jobId}-${kind}-${occurredAt}`, technicianId, kind, occurredAt, superseded)
    .run();
}

/** A job of `type` that ran from `start` for `minutes`, as the phone timed it. */
async function timedJob(id: string, technicianId: string, type: string, day: string, minutes: number) {
  const startedAt = `${day}T04:00:00.000Z`;
  const endedAt = new Date(Date.parse(startedAt) + minutes * 60_000).toISOString();
  await visit({ id, technicianId, type, start: `${day}T03:30:00.000Z` });
  await event(id, technicianId, "start", startedAt);
  await event(id, technicianId, "outcome", endedAt);
}

beforeEach(async () => {
  captureLogs();
  jobs = 0;
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, '2026-08-01T06:00:00.000Z', '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON)
    .run();
  await technician(IMRAN, "Imran Qureshi");
  await technician(SANDEEP, "Sandeep Yadav");
});

describe("GET /api/technicians/work", () => {
  it("counts a technician's completed visits, and answers a nought for one who finished none", async () => {
    await timedJob("aaaaaaaa-0000-4000-8000-000000000001", IMRAN, "service", "2026-09-18", 90);
    await timedJob("aaaaaaaa-0000-4000-8000-000000000002", IMRAN, "service", "2026-09-19", 90);

    const body = await work();
    expect(of(body, IMRAN)).toMatchObject({ jobs: 2, timed_jobs: 2 });
    expect(of(body, SANDEEP)).toMatchObject({ jobs: 0, timed_jobs: 0, average_minutes: null });
  });

  it("averages the time from Start to the outcome, against what the visits were planned for", async () => {
    // A service visit is planned for 90 minutes; these ran 108 and 90, so the average is 99.
    await timedJob("aaaaaaaa-0000-4000-8000-000000000001", IMRAN, "service", "2026-09-18", 108);
    await timedJob("aaaaaaaa-0000-4000-8000-000000000002", IMRAN, "service", "2026-09-19", 90);
    expect(of(await work(), IMRAN)).toMatchObject({
      timed_jobs: 2,
      average_minutes: 99,
      average_planned_minutes: 90,
    });
  });

  it("weighs each kind against its own planned length, not against one average length", async () => {
    // A first fit is planned for 180 minutes and a service for 90; both ran to time.
    await timedJob("aaaaaaaa-0000-4000-8000-000000000001", IMRAN, "first_fit", "2026-09-18", 180);
    await timedJob("aaaaaaaa-0000-4000-8000-000000000002", IMRAN, "service", "2026-09-19", 90);
    expect(of(await work(), IMRAN)).toMatchObject({ average_minutes: 135, average_planned_minutes: 135 });
  });

  it("counts a job the phone never timed, and leaves it out of the average", async () => {
    await timedJob("aaaaaaaa-0000-4000-8000-000000000001", IMRAN, "service", "2026-09-18", 108);
    // Started and never closed on the phone: FSM completed it, so it is a job done and not a duration.
    await visit({
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      technicianId: IMRAN,
      type: "service",
      start: "2026-09-19T03:30:00.000Z",
    });
    await event("aaaaaaaa-0000-4000-8000-000000000002", IMRAN, "start", "2026-09-19T04:00:00.000Z");

    expect(of(await work(), IMRAN)).toMatchObject({ jobs: 2, timed_jobs: 1, average_minutes: 108 });
  });

  it("says nothing rather than nought when the phone timed none of the jobs", async () => {
    await visit({
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      technicianId: IMRAN,
      type: "service",
      start: "2026-09-19T03:30:00.000Z",
    });
    expect(of(await work(), IMRAN)).toMatchObject({
      jobs: 1,
      timed_jobs: 0,
      average_minutes: null,
      average_planned_minutes: null,
    });
  });

  it("ignores an outcome that stands before its start, which a phone with a wrong clock can send", async () => {
    const id = "aaaaaaaa-0000-4000-8000-000000000001";
    await visit({ id, technicianId: IMRAN, type: "service", start: "2026-09-19T03:30:00.000Z" });
    await event(id, IMRAN, "start", "2026-09-19T06:00:00.000Z");
    await event(id, IMRAN, "outcome", "2026-09-19T04:00:00.000Z");
    expect(of(await work(), IMRAN)).toMatchObject({ jobs: 1, timed_jobs: 0, average_minutes: null });
  });

  it("ignores an event the phone sent after FSM had moved the job underneath it", async () => {
    const id = "aaaaaaaa-0000-4000-8000-000000000001";
    await visit({ id, technicianId: IMRAN, type: "service", start: "2026-09-19T03:30:00.000Z" });
    await event(id, IMRAN, "start", "2026-09-19T04:00:00.000Z");
    await event(id, IMRAN, "outcome", "2026-09-19T05:48:00.000Z", 1);
    expect(of(await work(), IMRAN)).toMatchObject({ jobs: 1, timed_jobs: 0 });
  });

  it("counts a visit of none of our four kinds as a job, and leaves it out of the average", async () => {
    await timedJob("aaaaaaaa-0000-4000-8000-000000000001", IMRAN, "service", "2026-09-18", 108);
    const other = "aaaaaaaa-0000-4000-8000-000000000002";
    await visit({ id: other, technicianId: IMRAN, type: null, start: "2026-09-19T03:30:00.000Z" });
    await event(other, IMRAN, "start", "2026-09-19T04:00:00.000Z");
    await event(other, IMRAN, "outcome", "2026-09-19T09:00:00.000Z");

    expect(of(await work(), IMRAN)).toMatchObject({ jobs: 2, timed_jobs: 1, average_minutes: 108 });
  });

  it("counts only a visit that was completed, and never one FSM deleted", async () => {
    await visit({
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      technicianId: IMRAN,
      type: "service",
      start: "2026-09-19T03:30:00.000Z",
      status: "cancelled",
    });
    await visit({
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      technicianId: IMRAN,
      type: "service",
      start: "2026-09-19T03:30:00.000Z",
      deleted: true,
    });
    expect(of(await work(), IMRAN)).toMatchObject({ jobs: 0 });
  });

  it("counts the days asked for, and no others", async () => {
    await timedJob("aaaaaaaa-0000-4000-8000-000000000001", IMRAN, "service", "2026-09-18", 90);
    await timedJob("aaaaaaaa-0000-4000-8000-000000000002", IMRAN, "service", "2026-09-20", 90);

    expect(of(await work("?from=2026-09-19&to=2026-09-21"), IMRAN)).toMatchObject({ jobs: 1 });
    expect(await work("?from=2026-09-19&to=2026-09-21")).toMatchObject({ from: "2026-09-19", to: "2026-09-21" });
  });

  it("counts a quarter back from tomorrow when no period is asked for, so a job finished today is in", async () => {
    await timedJob("aaaaaaaa-0000-4000-8000-000000000001", IMRAN, "service", "2026-09-21", 90);
    // 90 days back from the 22nd, and an older job that falls outside it.
    await timedJob("aaaaaaaa-0000-4000-8000-000000000002", IMRAN, "service", "2026-06-01", 90);

    const body = await work();
    expect(body).toMatchObject({ from: "2026-06-24", to: "2026-09-22" });
    expect(of(body, IMRAN)).toMatchObject({ jobs: 1 });
  });

  // Board D3's two figures are ops' (docs/open-points.md, item 59; docs/decisions/0088-every-policy-in-the-console.md).
  const opsSet = (figures: { period: number; over_by: number }) =>
    env.DB.prepare("INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('technician_work', ?1, 'ops', ?2)")
      .bind(JSON.stringify(figures), NOW.toISOString())
      .run();

  it("counts back as many days as ops set", async () => {
    await opsSet({ period: 30, over_by: 15 });
    await timedJob("aaaaaaaa-0000-4000-8000-000000000001", IMRAN, "service", "2026-08-01", 90);
    const body = await work();
    expect(body).toMatchObject({ from: "2026-08-23", to: "2026-09-22" });
    expect(of(body, IMRAN)).toMatchObject({ jobs: 0 });
  });

  it("says an average runs over from 15 minutes past what the visits were planned for, and no sooner", async () => {
    await timedJob("aaaaaaaa-0000-4000-8000-000000000001", IMRAN, "service", "2026-09-18", 105);
    await timedJob("aaaaaaaa-0000-4000-8000-000000000002", SANDEEP, "service", "2026-09-18", 104);
    const body = await work();
    expect(of(body, IMRAN)).toMatchObject({ average_minutes: 105, runs_over: true });
    expect(of(body, SANDEEP)).toMatchObject({ average_minutes: 104, runs_over: false });
  });

  it("says it from as far over as ops set, and never of an average the phone never timed", async () => {
    await opsSet({ period: 90, over_by: 30 });
    await timedJob("aaaaaaaa-0000-4000-8000-000000000001", IMRAN, "service", "2026-09-18", 105);
    const body = await work();
    expect(of(body, IMRAN)).toMatchObject({ runs_over: false });
    expect(of(body, SANDEEP)).toMatchObject({ average_minutes: null, runs_over: false });
  });

  it("refuses a period that ends before it starts", async () => {
    const refused = await request(ops, "/api/technicians/work?from=2026-09-21&to=2026-09-21");
    expect(refused.status).toBe(400);
  });

  it("leaves out a technician FSM no longer lists as active", async () => {
    await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SANDEEP).run();
    expect((await work()).technicians.map((each) => each.technician_id)).toEqual([IMRAN]);
  });

  it("never answers a skill, because nothing records one", async () => {
    await timedJob("aaaaaaaa-0000-4000-8000-000000000001", IMRAN, "service", "2026-09-18", 90);
    for (const each of (await work()).technicians) expect(each.skill).toBeNull();
  });

  it("belongs to the ops surface alone", async () => {
    const client = appFor("local", fakeDependencies(), {}, "client");
    expect((await request(client, "/api/technicians/work")).status).toBe(404);
  });
});
