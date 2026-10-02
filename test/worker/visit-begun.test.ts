// A visit that has begun, by our own records rather than FSM's status (src/domain/visit-begun.ts): the client can no
// longer cancel or move it, and the app reads it as under way or done. FSM's status lags behind the visit, or never
// arrives when FSM refuses a write, so the mirror here stays at "scheduled" throughout. NOW is Monday 21 September
// 2026, 12 noon in India; the visit is at 13:00. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { appFor, captureLogs, markDatabase, NOW, request } from "./helpers.ts";
import { IMRAN, JOB, PERSON, working, type Working } from "./job-fixtures.ts";

/** About 90 m from the client's door: inside the geofence. */
const AT_THE_DOOR = { lat: 28.3988, lng: 77.07 };

let job: Working;
let client: App;
let cookie: string;

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  job = await working("service");
  client = appFor("local", job.deps, {}, "client");
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

const clientPost = (path: string, body: object) =>
  request(client, path, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
    body: JSON.stringify(body),
  });

const clientGet = (path: string) => request(client, path, { headers: { Cookie: cookie } });

/** What the client is answered on asking to cancel, to see the move's terms, and for the days to move it to. */
async function changeAnswers(): Promise<number[]> {
  const cancel = await clientPost(`/api/appointments/${JOB}/cancel`, { confirm: false });
  const move = await clientPost(`/api/appointments/${JOB}/reschedule`, {});
  const days = await clientGet(`/api/availability?type=service&moving=${JOB}`);
  return [cancel.status, move.status, days.status];
}

async function nextVisitStage(): Promise<string | null> {
  const me = await (await clientGet("/api/me")).json<{ next_visit: { stage: string | null } | null }>();
  return me.next_visit?.stage ?? null;
}

const mirrorStatus = async () =>
  (await env.DB.prepare("SELECT status FROM appointments WHERE id = ?1").bind(JOB).first<{ status: string }>())?.status;

/** An event as the phone's outbox lands it, written straight to the table. */
async function landed(kind: string, options: { body?: object; superseded?: boolean } = {}) {
  const at = NOW.toISOString();
  await env.DB.prepare(
    `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
       fsm_write_state, superseded, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?7)`,
  )
    .bind(
      crypto.randomUUID(),
      JOB,
      `event-${kind}-01`,
      IMRAN,
      kind,
      JSON.stringify(options.body ?? {}),
      at,
      options.superseded === true ? "rejected" : "pending",
      options.superseded === true ? 1 : 0,
    )
    .run();
}

async function paidLink(paidAt: string | null) {
  const at = NOW.toISOString();
  await env.DB.prepare(
    `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, created_at, updated_at,
       paid_at)
     VALUES ('link-1', ?1, 'standard', 2900000, 2900000, 0, ?2, ?2, ?3)`,
  )
    .bind(JOB, at, paidAt)
    .run();
}

const oneVisitClosedAs = (state: string) =>
  env.DB.prepare("UPDATE appointments SET one_visit = ?2 WHERE id = ?1").bind(JOB, state).run();

describe("a visit the technician has checked in to", () => {
  it("can no longer be cancelled or moved, and reads as in progress, though FSM still has it scheduled", async () => {
    expect(await changeAnswers()).toEqual([200, 200, 200]);
    expect(await nextVisitStage()).toBe("booked");

    const checkIn = await job.post(`/api/tech/jobs/${JOB}/checkin`, AT_THE_DOOR, "event-checkin-01");
    expect(checkIn.status).toBe(200);

    expect(await mirrorStatus()).toBe("scheduled");
    expect(await changeAnswers()).toEqual([409, 409, 409]);
    const cancel = await clientPost(`/api/appointments/${JOB}/cancel`, { confirm: true, notice: "late" });
    expect(await cancel.json()).toMatchObject({ error: { code: "not_changeable" } });
    expect(job.fsm.made.cancelled).toEqual([]);
    expect(await nextVisitStage()).toBe("in_progress");
  });

  it("reads as done once the technician closes it as done, and gives way on Home to a visit still to come", async () => {
    await job.workTo("outcome");
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
    expect(await mirrorStatus()).toBe("scheduled");
    expect(await nextVisitStage()).toBe("done");
    const visits = await (await clientGet("/api/visits")).json<{ upcoming: { id: string; stage: string }[] }>();
    expect(visits.upcoming).toMatchObject([{ id: JOB, stage: "done" }]);
    expect(await changeAnswers()).toEqual([409, 409, 409]);

    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
         window_end, technician_id, fsm_modified_at, synced_at)
       VALUES ('later-visit', 'ap-later', 'wo-ap-later', ?1, 'service', 'scheduled', 'Scheduled',
         '2026-10-21T07:30:00.000Z', '2026-10-21T09:00:00.000Z', ?2, ?3, ?3)`,
    )
      .bind(PERSON, IMRAN, NOW.toISOString())
      .run();
    expect(await nextVisitStage()).toBe("booked");
  });

  it("is being closed, not done, when the client was not home", async () => {
    await landed("check_in");
    await landed("outcome", { body: { outcome: "no_show" } });
    expect(await nextVisitStage()).toBe("closing");
  });
});

describe("what else says a visit has begun", () => {
  it.each([
    ["the start", () => landed("start")],
    ["the outcome", () => landed("outcome", { body: { outcome: "partial" } })],
    ["a paid payment link", () => paidLink("2026-09-21T06:10:00.000Z")],
    ["a one visit closed as fitted", () => oneVisitClosedAs("fitted")],
    ["a one visit closed as declined", () => oneVisitClosedAs("declined")],
  ])("%s refuses a cancel and a move", async (_, begin) => {
    await begin();
    expect(await changeAnswers()).toEqual([409, 409, 409]);
  });

  it("counts no event the phone sent after ops took the job from it, and no link still unpaid", async () => {
    await landed("check_in", { superseded: true });
    await paidLink(null);
    expect(await changeAnswers()).toEqual([200, 200, 200]);
    expect(await nextVisitStage()).toBe("booked");
  });
});
