// A client's rating of a visit done (docs/decisions/0260-ratings.md): one to five stars, once, on a visit of theirs that
// ended with something done, within the days ops set; a low one, under ops' setting when given, a Tasks row for Care;
// and the technician's average over ops' days on Me, once enough clients have rated them. NOW is Monday 21 September
// 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { qualityOf } from "../../../src/domain/field/quality.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import type { App } from "../../../src/http/context.ts";
import { RATINGS } from "../../../src/policy/ratings.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, SANA, client, technician, visit } from "../booking/client-booking-fixtures.ts";

let app: App;

beforeEach(async () => {
  await markDatabase();
  app = appFor("local", fakeDependencies(), {}, "client");
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANA, "Sana Mirza", "SM");
});

const setRule = (name: string, value: unknown) =>
  env.DB.prepare("INSERT INTO ops_settings (name, value, set_by, set_at) VALUES (?1, ?2, 'ops@localhost', ?3)")
    .bind(name, JSON.stringify(value), NOW.toISOString())
    .run();

type Outcome = "done" | "partial" | "no_show";

/** As a visit ends: done closes it completed; partly done and a no-show close it terminated (visit-status.ts). */
const ENDS_AS: Readonly<Record<Outcome, string>> = { done: "completed", partial: "terminated", no_show: "terminated" };

/** A service visit of the client's, ended as `outcome`, booked to start at `startsAt`. */
async function serviceVisit(
  personId: string,
  outcome: Outcome = "done",
  startsAt = "2026-09-14T06:30:00.000Z",
): Promise<string> {
  const id = await visit(personId, "service", ENDS_AS[outcome], startsAt, IMRAN);
  await env.DB.prepare(
    `INSERT INTO visit_outcomes (id, appointment_id, started_at, ended_at, duration_minutes, outcome, updated_at)
     VALUES (?1, ?2, ?3, ?3, 90, ?4, ?3)`,
  )
    .bind(crypto.randomUUID(), id, startsAt, outcome)
    .run();
  return id;
}

const rate = (who: { cookie: string }, visitId: string, stars: unknown) =>
  request(app, `/api/visits/${visitId}/rating`, {
    method: "POST",
    headers: { Cookie: who.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
    body: JSON.stringify({ stars }),
  });

const read = async (who: { cookie: string }, visitId: string) =>
  (await request(app, `/api/visits/${visitId}`, { headers: { Cookie: who.cookie } })).json<Record<string, unknown>>();

const codeOf = async (response: Response) => (await response.json<{ error: { code: string } }>()).error.code;

describe("a client's rating", () => {
  it("is kept once for a visit done, and read with the visit, which takes no other", async () => {
    const rohit = await client();
    const done = await serviceVisit(rohit.id);
    expect(await read(rohit, done)).toMatchObject({ rating: null, rateable: true });
    const rated = await rate(rohit, done, 5);
    expect(rated.status).toBe(201);
    expect(await rated.json()).toEqual({ stars: 5, at: NOW.toISOString(), low: false });
    const again = await rate(rohit, done, 2);
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("already_rated");
    expect(await read(rohit, done)).toMatchObject({ rating: { stars: 5, low: false }, rateable: false });
  });

  it("is taken for a visit partly done, which ends terminated, and kept with its technician", async () => {
    const rohit = await client();
    const partly = await serviceVisit(rohit.id, "partial");
    expect((await rate(rohit, partly, 4)).status).toBe(201);
    const kept = await env.DB.prepare("SELECT technician_id, person_id FROM visit_ratings").first();
    expect(kept).toEqual({ technician_id: IMRAN, person_id: rohit.id });
  });

  it("is refused for a visit not ended, or one the client was not home for", async () => {
    const rohit = await client();
    const coming = await visit(rohit.id, "service", "scheduled", "2026-09-24T06:30:00.000Z", IMRAN);
    const missed = await serviceVisit(rohit.id, "no_show");
    for (const id of [coming, missed]) {
      expect(await read(rohit, id)).toMatchObject({ rateable: false });
      const refused = await rate(rohit, id, 5);
      expect(refused.status).toBe(409);
      expect(await codeOf(refused)).toBe("visit_not_done");
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM visit_ratings").first("n")).toBe(0);
  });

  it("is refused past the days ops set after the visit, 30 until they set others", async () => {
    const rohit = await client();
    const old = await serviceVisit(rohit.id, "done", "2026-08-20T06:30:00.000Z");
    expect(await read(rohit, old)).toMatchObject({ rateable: false });
    const refused = await rate(rohit, old, 5);
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe("rating_closed");

    await setRule("ratings", { ...RATINGS, rate_within_days: 45 });
    app = appFor("local", fakeDependencies(), {}, "client");
    expect((await rate(rohit, old, 5)).status).toBe(201);
  });

  it("is refused for another client's visit, and for stars outside one to five", async () => {
    const rohit = await client();
    const other = await client();
    const theirs = await serviceVisit(other.id);
    expect((await rate(rohit, theirs, 5)).status).toBe(404);
    const mine = await serviceVisit(rohit.id);
    for (const stars of [0, 6, 3.5, "5"]) expect((await rate(rohit, mine, stars)).status).toBe(400);
  });
});

describe("a low rating", () => {
  it("opens a Tasks row for Care under four stars, with the stars, the visit and its technician", async () => {
    const rohit = await client();
    const low = await serviceVisit(rohit.id);
    expect(await (await rate(rohit, low, 2)).json()).toMatchObject({ low: true });
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks).toContainEqual(
      expect.objectContaining({
        group: "low_rating",
        id: low,
        facts: {
          group: "low_rating",
          kind: "service",
          stars: 2,
          technician: "Imran Qureshi",
          visited_on: "2026-09-14",
        },
      }),
    );
  });

  it("is none at four stars or more", async () => {
    const rohit = await client();
    const good = await serviceVisit(rohit.id);
    await rate(rohit, good, 4);
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.filter((task) => task.group === "low_rating")).toEqual([]);
  });

  it("is judged by ops' setting when given, and a later change of the setting moves no rating", async () => {
    const rohit = await client();
    await setRule("ratings", { ...RATINGS, low_below: 5 });
    app = appFor("local", fakeDependencies(), {}, "client");
    const four = await serviceVisit(rohit.id);
    expect(await (await rate(rohit, four, 4)).json()).toMatchObject({ low: true });
    // Kept as low, so the queue reads the rating as it was judged, whatever ops set after.
    expect(
      await env.DB.prepare("SELECT low FROM visit_ratings WHERE appointment_id = ?1").bind(four).first("low"),
    ).toBe(1);
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.filter((task) => task.group === "low_rating").map((task) => task.id)).toEqual([four]);
  });

  it("leaves Tasks once Care close it with what the client said", async () => {
    const rohit = await client();
    const low = await serviceVisit(rohit.id);
    await rate(rohit, low, 1);
    await env.DB.prepare(
      `INSERT INTO task_closures (id, task_group, subject_id, closed_at, closed_by, reason)
       VALUES (?3, 'low_rating', ?1, ?2, 'care@localhost', 'Called: the cut was rushed; a free service booked')`,
    )
      .bind(low, NOW.toISOString(), crypto.randomUUID())
      .run();
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.filter((task) => task.group === "low_rating")).toEqual([]);
  });
});

describe("the technician's rating on Me", () => {
  const add = (visitId: string, personId: string, stars: number, at: string, technicianId = IMRAN) =>
    env.DB.prepare(
      `INSERT INTO visit_ratings (appointment_id, person_id, technician_id, stars, low, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(visitId, personId, technicianId, stars, stars < 4 ? 1 : 0, at)
      .run();

  /** Ratings for Imran on visits of their own, one each. */
  async function rated(stars: readonly (readonly [number, string])[]) {
    const rohit = await client();
    for (const [given, at] of stars) {
      await add(await visit(rohit.id, "service", "completed", at, IMRAN), rohit.id, given, at);
    }
    return rohit;
  }

  it("is the average of their ratings over ops' days, to one place, once there are five, and not the count", async () => {
    const rohit = await rated([
      [5, "2026-09-20T06:30:00.000Z"],
      [4, "2026-09-01T06:30:00.000Z"],
      [4, "2026-08-01T06:30:00.000Z"],
      [5, "2026-07-10T06:30:00.000Z"],
      [4, "2026-06-25T06:30:00.000Z"],
      // Over 90 days before NOW: not counted.
      [1, "2026-06-20T06:30:00.000Z"],
    ]);
    const sana = await visit(rohit.id, "service", "completed", NOW.toISOString(), SANA);
    await add(sana, rohit.id, 1, NOW.toISOString(), SANA);
    expect(await qualityOf(env.DB, IMRAN, NOW, RATINGS)).toMatchObject({ rating: 4.4, rating_days: 90 });
  });

  it("is none with fewer than ops' fewest, and never says how many rated them", async () => {
    await rated([
      [5, "2026-09-20T06:30:00.000Z"],
      [2, "2026-09-01T06:30:00.000Z"],
    ]);
    expect(await qualityOf(env.DB, IMRAN, NOW, RATINGS)).toMatchObject({ rating: null });
    expect(await qualityOf(env.DB, IMRAN, NOW, { ...RATINGS, shown_from: 2 })).toMatchObject({ rating: 3.5 });
  });

  it("is none before any client rates them", async () => {
    expect(await qualityOf(env.DB, IMRAN, NOW, RATINGS)).toMatchObject({ rating: null });
  });
});
