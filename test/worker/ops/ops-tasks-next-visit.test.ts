// What ops still have to do, on the ops surface (src/routes/ops/tasks.ts), Ops
// Console D2. NOW is Monday 21 September 2026, 12 noon in India. Nothing here
// is a real person, number or piece.
//
// There is no tasks table: each group is a queue read at the moment ops look,
// so a task appears when its row starts waiting and is gone once the row is
// decided. The tests put rows in those queues and read the board back.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { NEXT_VISIT_DAYS } from "../../../src/policy/next-visit.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { PERSON, REFERRED, VISIT, REQUEST, CONSULTATION, person, consultationRequest } from "./ops-tasks-fixtures.ts";

let ops: App;

interface Body {
  overdue: number;
  truncated: boolean;
  staff: string[];
  groups: {
    group: string;
    count: number;
    closable: boolean;
    tasks: { id: string; person: unknown; detail: string | null; owner: string | null }[];
  }[];
}

const tasks = async (): Promise<Body> => (await request(ops, "/api/tasks")).json<Body>();

const groupNames = (body: Body) => body.groups.map((each) => each.group);

const tasksIn = (body: Body, group: string) => body.groups.find((each) => each.group === group)?.tasks ?? [];

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await person(PERSON, "Rohit Malhotra", "+919810000001");
  await person(REFERRED, "Vikram Sethi", "+919810000002");
});

// The next visit, offered to the client and booked by them (docs/decisions/0086-the-next-visit-is-offered.md): ops
// step in when a fitted client is days past their next service with nothing booked, and when a client consulted and
// not fitted has nothing booked days after the consultation. Both are counted from the figures ops set.
describe("GET /api/tasks, the next visit", () => {
  /** A visit of Rohit's; 04:30 UTC is 10 am in India. */
  async function visitOf(id: string, type: string, start: string, status: string) {
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
         fsm_modified_at, synced_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?6, ?7, ?7)`,
    )
      .bind(id, `fsm-${id}`, PERSON, type, start, status, NOW.toISOString())
      .run();
  }

  async function firstFitAsked(window: string | null) {
    await env.DB.prepare(
      "INSERT INTO first_fit_requests (id, person_id, preferred_window, created_at) VALUES (?1, ?2, ?3, ?4)",
    )
      .bind(REQUEST, PERSON, window, "2026-09-01T06:00:00.000Z")
      .run();
  }

  /** The figures ops set in Settings · Rules, read by a fresh console, whose settings no earlier look has cached. */
  async function opsSet(days: Record<string, number>): Promise<Body> {
    await env.DB.prepare(
      "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('booking_days', ?1, 'ops@localhost', ?2)",
    )
      .bind(JSON.stringify({ ...NEXT_VISIT_DAYS, ...days }), NOW.toISOString())
      .run();
    return (await request(appFor("local", fakeDependencies(), {}, "ops"), "/api/tasks")).json<Body>();
  }

  it("lists an At-risk client a week past their next service with nothing booked, naming the visit and the day", async () => {
    // Done 1 August, due 31 August, at risk from 7 September.
    await visitOf(VISIT, "service", "2026-08-01T04:30:00.000Z", "completed");
    expect(tasksIn(await tasks(), "at_risk_client")).toEqual([
      {
        id: VISIT,
        person: { id: PERSON, name: "Rohit Malhotra" },
        detail: "2026-08-01T04:30:00.000Z 2026-08-31",
        since: "2026-09-06T18:30:00.000Z",
        due: "2026-09-08T18:30:00.000Z",
        owner: null,
      },
    ]);
  });

  it("lists one on the day they fall at risk, and none the day before", async () => {
    await visitOf(VISIT, "service", "2026-08-16T04:30:00.000Z", "completed"); // at risk from 22 September
    expect(groupNames(await tasks())).toEqual([]);
    await env.DB.prepare("UPDATE appointments SET window_start = '2026-08-15T04:30:00.000Z'").run();
    expect(groupNames(await tasks())).toEqual(["at_risk_client"]);
  });

  it("drops an At-risk client as soon as a visit is booked, or paid for and on its way to FSM", async () => {
    await visitOf(VISIT, "service", "2026-08-01T04:30:00.000Z", "completed");
    await visitOf("later-visit", "service", "2026-09-25T04:30:00.000Z", "scheduled");
    // The visit booked has no address to go to, which is a task of its own.
    expect(groupNames(await tasks())).toEqual(["address_to_confirm"]);
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = 'later-visit'").run();
    expect(groupNames(await tasks())).toEqual(["at_risk_client"]);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'fsm-t1', 'Imran Qureshi', 'IQ', 1, ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
           amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at, confirmed_at)
         VALUES ('paid-hold', ?1, 'service', '2026-09-30', 'morning', 't1', 0, 200000, 200000, 0, 'held', ?2, ?2, ?2,
           ?2)`,
      ).bind(PERSON, NOW.toISOString()),
    ]);
    expect(groupNames(await tasks())).toEqual([]);
  });

  it("counts from the cadence and the days ops set, and never lists a client who has not been fitted as at risk", async () => {
    await visitOf(VISIT, "service", "2026-08-01T04:30:00.000Z", "completed");
    expect((await opsSet({ service_cadence: 45 })).groups).toEqual([]);
    await env.DB.prepare("DELETE FROM ops_settings").run();
    // Only consulted, they are a First fit to book instead.
    await env.DB.prepare("UPDATE appointments SET type = 'consultation'").run();
    expect(groupNames(await tasks())).toEqual(["first_fit_to_book"]);
  });

  // The site's form asks for no first fit since 1 October 2026, so a consultation done is enough.
  it("lists a client consulted a week ago and not fitted, in the consultation's window, until the fit is booked", async () => {
    await visitOf(CONSULTATION, "consultation", "2026-09-10T04:30:00.000Z", "completed");
    expect(tasksIn(await tasks(), "first_fit_to_book")).toEqual([
      {
        id: PERSON,
        person: { id: PERSON, name: "Rohit Malhotra" },
        detail: "2026-09-10T04:30:00.000Z morning",
        since: "2026-09-16T18:30:00.000Z",
        due: "2026-09-18T18:30:00.000Z",
        owner: null,
      },
    ]);
    await visitOf("the-fit", "first_fit", "2026-09-29T03:30:00.000Z", "scheduled");
    expect(groupNames(await tasks())).toEqual(["address_to_confirm"]);
  });

  it("waits the days ops set after the consultation, and lists nobody before it is done", async () => {
    await visitOf(CONSULTATION, "consultation", "2026-09-10T04:30:00.000Z", "scheduled");
    expect(groupNames(await tasks())).toEqual([]);
    await env.DB.prepare("UPDATE appointments SET status = 'completed'").run();
    expect(groupNames(await tasks())).toEqual(["first_fit_to_book"]);
    expect((await opsSet({ first_fit_to_book: 14 })).groups).toEqual([]);
  });

  it("names no window after a consultation in the evening, which a first fit cannot start in", async () => {
    // 6 pm in India.
    await visitOf(CONSULTATION, "consultation", "2026-09-10T12:30:00.000Z", "completed");
    expect(tasksIn(await tasks(), "first_fit_to_book")[0]?.detail).toBe("2026-09-10T12:30:00.000Z any");
  });

  it("lists a client who declined the fit at a one visit, which ends as a consultation", async () => {
    await visitOf(CONSULTATION, "first_fit", "2026-09-10T04:30:00.000Z", "in_progress");
    await env.DB.prepare(
      "UPDATE appointments SET one_visit = 'declined', type = 'consultation', status = 'completed'",
    ).run();
    expect(tasksIn(await tasks(), "first_fit_to_book")).toMatchObject([{ id: PERSON }]);
  });

  it("lists a fitted client consulted again and not fitted since, and not as at risk", async () => {
    await visitOf(VISIT, "first_fit", "2026-07-01T04:30:00.000Z", "completed");
    expect(groupNames(await tasks())).toEqual(["at_risk_client"]);
    await visitOf(CONSULTATION, "consultation", "2026-09-10T04:30:00.000Z", "completed");
    expect(groupNames(await tasks())).toEqual(["first_fit_to_book"]);
  });

  it("says a consultation asked for came with a first fit asked for, and its window", async () => {
    await consultationRequest();
    await firstFitAsked("afternoon");
    expect(tasksIn(await tasks(), "consultation_request")[0]?.detail).toBe("2026-09-23 morning first_fit afternoon");
    await env.DB.prepare("UPDATE first_fit_requests SET preferred_window = NULL").run();
    expect(tasksIn(await tasks(), "consultation_request")[0]?.detail).toBe("2026-09-23 morning first_fit any");
  });
});
