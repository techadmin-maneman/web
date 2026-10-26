// The local stand-in for closing a visit without the technician app (src/routes/dev-visits.ts), so what follows a
// close can be run locally. It exists only where DEV_ROUTES is on, which the guard allows only locally; on
// any other environment's app it is not there at all. NOW is Monday 21 September 2026, 12 noon in India.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { EnvironmentName } from "../../../src/config/environments.ts";
import { EXPECTED_DATABASE_NAME } from "../../../src/config/environments.ts";
import { aVisit } from "../fixtures/index.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";

const VISIT = "22222222-2222-4222-8222-222222222222";
const START = "2026-09-21T04:30:00.000Z";
const END = "2026-09-21T06:00:00.000Z";

async function booked(status = "scheduled"): Promise<void> {
  await aVisit({ id: VISIT, window_start: START, window_end: END, status, synced_at: NOW.toISOString() });
}

const close = (environment: EnvironmentName, body: object, devRoutes = true) =>
  request(appFor(environment, fakeDependencies(), { devRoutes }), `/api/dev/appointments/${VISIT}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const closed = () =>
  env.DB.prepare(
    `SELECT a.status, v.outcome, v.started_at, v.ended_at, v.duration_minutes
     FROM appointments a LEFT JOIN visit_outcomes v ON v.appointment_id = a.id WHERE a.id = ?1`,
  )
    .bind(VISIT)
    .first();

describe("POST /api/dev/appointments/:id/close, locally", () => {
  beforeEach(async () => {
    await markDatabase();
  });

  it("closes the visit as done over its booked window", async () => {
    await booked();
    const answer = await close("local", { outcome: "done" });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ appointment_id: VISIT, status: "completed" });
    expect(await closed()).toEqual({
      status: "completed",
      outcome: "done",
      started_at: START,
      ended_at: END,
      duration_minutes: 90,
    });
  });

  it("ends it partly done", async () => {
    await booked();
    const answer = await close("local", { outcome: "partial" });

    expect(await answer.json()).toEqual({ appointment_id: VISIT, status: "terminated" });
    expect(await closed()).toMatchObject({ status: "terminated", outcome: "partial" });
  });

  it("refuses a visit that is not there, or one already closed or cancelled", async () => {
    expect((await close("local", { outcome: "done" })).status).toBe(404);
    await booked("cancelled");
    const refused = await close("local", { outcome: "done" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "not_changeable" } });
  });

  it("is not there without DEV_ROUTES, even locally", async () => {
    await booked();
    expect((await close("local", { outcome: "done" }, false)).status).toBe(404);
    expect((await closed())?.status).toBe("scheduled");
  });
});

describe("POST /api/dev/appointments/:id/close, anywhere but locally", () => {
  it.each(["staging", "production"] as const)(
    "answers nothing on %s, even were the switch somehow on, and closes nothing",
    async (environment) => {
      await markDatabase(EXPECTED_DATABASE_NAME[environment]);
      await booked();

      const answer = await close(environment, { outcome: "done" });

      expect(answer.status).toBe(404);
      expect(await answer.json()).toMatchObject({ error: { code: "not_found" } });
      expect((await closed())?.status).toBe("scheduled");
    },
  );
});

const write = (environment: EnvironmentName, devRoutes = true) =>
  request(appFor(environment, fakeDependencies(), { devRoutes }), "/api/dev/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: "+919810000001", text: "Is my visit still on?" }),
  });

const threads = () =>
  env.DB.prepare(
    `SELECT c.mobile_e164, c.state, m.direction, m.text FROM conversations c
     JOIN chat_messages m ON m.conversation_id = c.id`,
  ).all();

describe("POST /api/dev/messages, the local stand-in for a number writing to us", () => {
  beforeEach(async () => {
    await markDatabase();
  });

  it("files the message in the number's thread, as the bridge's hook does", async () => {
    expect((await write("local")).status).toBe(204);
    expect((await threads()).results).toEqual([
      { mobile_e164: "+919810000001", state: "open", direction: "in", text: "Is my visit still on?" },
    ]);
  });

  it("is not there without DEV_ROUTES, even locally", async () => {
    expect((await write("local", false)).status).toBe(404);
    expect((await threads()).results).toEqual([]);
  });
});

describe("POST /api/dev/messages, anywhere but locally", () => {
  it("answers nothing on staging, even were the switch somehow on, and files nothing", async () => {
    await markDatabase(EXPECTED_DATABASE_NAME.staging);
    expect((await write("staging")).status).toBe(404);
    expect((await threads()).results).toEqual([]);
  });
});

const clock = (environment: EnvironmentName, devRoutes = true, init: RequestInit = {}) =>
  request(appFor(environment, fakeDependencies(), { devRoutes }), "/api/dev/clock", init);

describe("/api/dev/clock, the local clock a timelapse moves", () => {
  beforeEach(async () => {
    await markDatabase();
  });

  it("sets the clock and says what it reads, and the Date header follows the API's clock", async () => {
    const set = await clock("local", true, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ at: "2027-01-15T04:30:00.000Z" }),
    });
    expect(set.status).toBe(200);
    expect(Date.parse((await set.json<{ at: string }>()).at)).toBeGreaterThanOrEqual(
      Date.parse("2027-01-15T04:30:00.000Z"),
    );
    // The apps set their clocks by the Date header: here it is the injected clock's, as the moved clock's is locally.
    expect((await clock("local")).headers.get("Date")).toBe(NOW.toUTCString());
  });

  it("is not there without DEV_ROUTES, even locally, and leaves the Date header the runtime's", async () => {
    const answer = await clock("local", false);
    expect(answer.status).toBe(404);
    expect(answer.headers.get("Date")).not.toBe(NOW.toUTCString());
  });
});

describe("/api/dev/clock, anywhere but locally", () => {
  it("answers nothing on staging, even were the switch somehow on", async () => {
    await markDatabase(EXPECTED_DATABASE_NAME.staging);
    expect((await clock("staging")).status).toBe(404);
  });
});

const whoami = (environment: EnvironmentName, devRoutes: boolean) =>
  request(appFor(environment, fakeDependencies(), { devRoutes }, "ops"), "/api/whoami", {
    headers: { "X-Dev-Staff": "care@maneman.test" },
  }).then((answer) => answer.json<{ signed_in_as: string }>());

describe("X-Dev-Staff, a local run signing a console call in as another member of staff", () => {
  beforeEach(async () => {
    await markDatabase();
  });

  it("is taken locally with DEV_ROUTES on, over the stub's own identity", async () => {
    expect((await whoami("local", true)).signed_in_as).toBe("care@maneman.test");
  });

  it("is ignored without DEV_ROUTES", async () => {
    expect((await whoami("local", false)).signed_in_as).toBe("ops@localhost");
  });
});
