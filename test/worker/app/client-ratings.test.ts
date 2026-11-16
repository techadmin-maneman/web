// A client's rating of a visit done (docs/decisions/0260-ratings.md): one to five stars, once, on a visit of theirs that
// closed with something done; under four, a Tasks row for Care; and the technician's average over 90 days on Me. NOW is
// Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { qualityOf } from "../../../src/domain/field/quality.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import type { App } from "../../../src/http/context.ts";
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

/** A visit closed as the technician's outcome closes it. */
async function closed(appointmentId: string, outcome: "done" | "partial" | "no_show") {
  await env.DB.prepare(
    `INSERT INTO visit_outcomes (id, appointment_id, started_at, ended_at, duration_minutes, outcome, updated_at)
     VALUES (?1, ?2, ?3, ?3, 90, ?4, ?3)`,
  )
    .bind(crypto.randomUUID(), appointmentId, "2026-09-14T07:00:00.000Z", outcome)
    .run();
}

/** A service visit of the client's, closed as `outcome`. */
async function serviceVisit(personId: string, outcome: "done" | "partial" | "no_show" = "done"): Promise<string> {
  const id = await visit(personId, "service", "completed", "2026-09-14T06:30:00.000Z", IMRAN);
  await closed(id, outcome);
  return id;
}

const rate = (who: { cookie: string }, visitId: string, stars: unknown) =>
  request(app, `/api/visits/${visitId}/rating`, {
    method: "POST",
    headers: { Cookie: who.cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
    body: JSON.stringify({ stars }),
  });

const codeOf = async (response: Response) => (await response.json<{ error: { code: string } }>()).error.code;

describe("a client's rating", () => {
  it("is kept once for a visit done, and read with the visit", async () => {
    const rohit = await client();
    const done = await serviceVisit(rohit.id);
    const rated = await rate(rohit, done, 5);
    expect(rated.status).toBe(201);
    expect(await rated.json()).toEqual({ stars: 5, at: NOW.toISOString() });
    const again = await rate(rohit, done, 2);
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("already_rated");
    const read = await (await request(app, `/api/visits/${done}`, { headers: { Cookie: rohit.cookie } })).json();
    expect(read).toMatchObject({ rating: { stars: 5, at: NOW.toISOString() } });
  });

  it("is taken for a visit partly done, and kept with its technician", async () => {
    const rohit = await client();
    const partly = await serviceVisit(rohit.id, "partial");
    expect((await rate(rohit, partly, 4)).status).toBe(201);
    const kept = await env.DB.prepare("SELECT technician_id, person_id FROM visit_ratings").first();
    expect(kept).toEqual({ technician_id: IMRAN, person_id: rohit.id });
  });

  it("is refused for a visit not closed, or one the client was not home for", async () => {
    const rohit = await client();
    const coming = await visit(rohit.id, "service", "scheduled", "2026-09-24T06:30:00.000Z", IMRAN);
    const missed = await serviceVisit(rohit.id, "no_show");
    for (const id of [coming, missed]) {
      const refused = await rate(rohit, id, 5);
      expect(refused.status).toBe(409);
      expect(await codeOf(refused)).toBe("visit_not_done");
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM visit_ratings").first("n")).toBe(0);
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
    await rate(rohit, low, 2);
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
  it("is the average of their ratings over the last 90 days, to one place", async () => {
    const add = (visitId: string, personId: string, stars: number, at: string, technicianId = IMRAN) =>
      env.DB.prepare(
        "INSERT INTO visit_ratings (appointment_id, person_id, technician_id, stars, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
        .bind(visitId, personId, technicianId, stars, at)
        .run();
    const rohit = await client();
    for (const [stars, at] of [
      [5, "2026-09-20T06:30:00.000Z"],
      [4, "2026-08-01T06:30:00.000Z"],
      [4, "2026-06-25T06:30:00.000Z"],
      // Over 90 days before NOW: not counted.
      [1, "2026-06-20T06:30:00.000Z"],
    ] as const) {
      await add(await visit(rohit.id, "service", "completed", at, IMRAN), rohit.id, stars, at);
    }
    await add(
      await visit(rohit.id, "service", "completed", NOW.toISOString(), SANA),
      rohit.id,
      1,
      NOW.toISOString(),
      SANA,
    );
    expect(await qualityOf(env.DB, IMRAN, NOW)).toMatchObject({ ratings: 3, rating: 4.3 });
  });

  it("is none before any client rates them", async () => {
    expect(await qualityOf(env.DB, IMRAN, NOW)).toMatchObject({ ratings: 0, rating: null });
  });
});
