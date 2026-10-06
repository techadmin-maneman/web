// The dispatch board's writes under real conditions: a technician-only change,
// a visit with no room, two moves at once, and a client who cannot be messaged.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and
// address here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import {
  ROHIT,
  VIKRAM,
  IMRAN,
  SAMEER,
  FIT,
  REPLACEMENT,
  A,
  B,
  WEDNESDAY,
  TUESDAY,
  insertJob,
  shown,
  toSameerWednesdayMorning,
} from "./dispatch-fixtures.ts";

let ops: App;

let messageQueue: ReturnType<typeof fakeQueue>;

beforeEach(async () => {
  await markDatabase();
  messageQueue = fakeQueue();
  ops = appFor("local", fakeDependencies(), {}, "ops");

  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, updated_at)
     VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Sec 40–65', ?3),
            (?2, ?2, 'Sameer Bhatt', 'SB', 1, 'Sec 1–39', ?3)`,
  )
    .bind(IMRAN, SAMEER, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(ROHIT, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810009902', 'Vikram Sethi')",
  )
    .bind(VIKRAM, NOW.toISOString())
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

/** A move sent from a board that shows the job as it stands, unless the body says otherwise. */
async function move(body: { appointment_id: string } & Record<string, unknown>, app: App = ops): Promise<Response> {
  const job = await shown(body.appointment_id);
  return opsPost(
    "/api/dispatch/move",
    { expected_technician_id: job?.technician_id ?? null, expected_starts_at: job?.window_start, ...body },
    app,
  );
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
    ).bind(
      id,
      VIKRAM,
      WEDNESDAY,
      SAMEER,
      options.expiresAt,
      NOW.toISOString(),
      options.paid ? NOW.toISOString() : null,
    ),
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

const minutesBeforeNow = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const holdState = async (id: string) =>
  (await env.DB.prepare("SELECT state FROM slot_holds WHERE id = ?1").bind(id).first<{ state: string }>())?.state;

describe("a change of technician alone", () => {
  // A first fit at 12:00 given to a technician whose replacement runs from 10:30 to 12:45.
  // His afternoon window is free, but the first fit's own half-slots are not.
  it("keeps the visit's own time, and refuses it where that time is taken, as not fitting", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });
    await insertJob(REPLACEMENT, { type: "replacement", start: TUESDAY["10:30"], technician: SAMEER, person: VIKRAM });

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
    expect(await shown(FIT)).toEqual({ technician_id: IMRAN, window_start: TUESDAY["12:00"] });
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
    // The time does not move, so the client has nothing to be told.
    expect(await shown(FIT)).toEqual({ technician_id: SAMEER, window_start: TUESDAY["12:00"] });
    expect(messageQueue.sent).toEqual([]);
    const messages = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_messages").first<{ n: number }>();
    expect(messages?.n).toBe(0);
  });
});

describe("a visit with no room", () => {
  // A first fit takes four half-slots, and the evening has two.
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
    expect(await shown(FIT)).toEqual({ technician_id: IMRAN, window_start: TUESDAY["12:00"] });
  });

  it("places a visit moved to another day wherever that window has room", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });
    // Sameer's Wednesday replacement runs from 10:30 to 12:45, into the afternoon's first two half-slots.
    await insertJob(REPLACEMENT, {
      type: "replacement",
      start: "2026-09-23T05:00:00.000Z",
      technician: SAMEER,
      person: VIKRAM,
    });

    const answer = await move({
      appointment_id: FIT,
      technician_id: SAMEER,
      date: "2026-09-23",
      window: "afternoon",
      reason: "client_asked",
    });

    expect(answer.status).toBe(200);
    expect(await shown(FIT)).toEqual({ technician_id: SAMEER, window_start: "2026-09-23T08:30:00.000Z" });
    expect((await claims()).results).toEqual([]);
  });
});

describe("a move and the time it goes to", () => {
  beforeEach(async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
    await insertJob(B, { type: "service", start: TUESDAY["12:00"], technician: IMRAN });
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
});

// Two ops users on the same board, the second working from what he loaded a while ago.
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
    expect(await shown(A)).toEqual({ technician_id: IMRAN, window_start: TUESDAY["09:00"] });
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
