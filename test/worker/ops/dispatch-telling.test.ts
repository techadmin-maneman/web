// The dispatch board's writes under real conditions: a technician-only change,
// a visit with no room, two moves at once, and a client who cannot be messaged.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and
// address here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { NO_VISITS_CONSENT } from "../../../src/domain/messages/visit-message-text.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import {
  ROHIT,
  VIKRAM,
  IMRAN,
  SAMEER,
  A,
  TUESDAY,
  insertJob,
  shown,
  toSameerWednesdayMorning,
  type BoardBody,
  agreeToVisitMessages,
  type TaskGroupBody,
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

const board = async (query: string): Promise<BoardBody> =>
  (await request(ops, `/api/dispatch?${query}`, {}, bindings())).json<BoardBody>();

const untoldTasks = async () => {
  const body = await (await request(ops, "/api/tasks", {}, bindings())).json<{ groups: TaskGroupBody[] }>();
  return body.groups.find((group) => group.group === "untold_move")?.tasks ?? [];
};

// "The client has been messaged" was shown after every move, while the
// message went only to a client who had agreed to WhatsApp about their visits.
describe("telling the client of a move", () => {
  beforeEach(async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
  });

  it("messages a client who agreed to WhatsApp about his visits, and says so", async () => {
    await agreeToVisitMessages(true);

    const answer = await move(toSameerWednesdayMorning(A));

    expect(await answer.json()).toMatchObject({ client_notice: "messaged" });
    expect(messageQueue.sent).toHaveLength(1);
    expect(await untoldTasks()).toEqual([]);
  });

  it("messages nobody who has not agreed, says ops must call, and keeps a task until they have", async () => {
    await agreeToVisitMessages(true);
    await agreeToVisitMessages(false);

    const answer = await move(toSameerWednesdayMorning(A));
    const { move_id: moveId, client_notice: notice } = await answer.json<{ move_id: string; client_notice: string }>();

    expect(notice).toBe("call");
    expect(messageQueue.sent).toEqual([]);
    const messages = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_messages").first<{ n: number }>();
    expect(messages?.n).toBe(0);
    // The task carries the number to call and the visit, so it is settled from the task itself.
    expect(await untoldTasks()).toEqual([
      expect.objectContaining({
        id: moveId,
        person: { id: ROHIT, name: "Rohit Malhotra", mobile: "+919810000001" },
        detail: "2026-09-23T03:30:00.000Z no_consent",
        visit: { id: A, starts_at: "2026-09-23T03:30:00.000Z" },
      }),
    ]);

    const told = await opsPost(`/api/dispatch/moves/${moveId}/told`, {});
    expect(told.status).toBe(200);
    expect(await untoldTasks()).toEqual([]);
    const audit = await env.DB.prepare(
      "SELECT action, subject_id FROM audit_log WHERE action = 'dispatch.client_told'",
    ).first<{ action: string; subject_id: string }>();
    expect(audit?.subject_id).toBe(moveId);
  });

  it("treats a client who never answered the question as one who has not agreed", async () => {
    const answer = await move(toSameerWednesdayMorning(A));
    expect(await answer.json()).toMatchObject({ client_notice: "call" });
  });

  it("counts a message that was never sent as the client not told", async () => {
    await agreeToVisitMessages(true);
    const { move_id: moveId } = await (await move(toSameerWednesdayMorning(A))).json<{ move_id: string }>();

    // The consumer found the consent withdrawn by the time it sent.
    await env.DB.prepare("UPDATE outbound_messages SET state = 'skipped', last_error = ?1")
      .bind(NO_VISITS_CONSENT)
      .run();

    expect(await untoldTasks()).toEqual([
      expect.objectContaining({ id: moveId, detail: "2026-09-23T03:30:00.000Z no_consent" }),
    ]);
  });

  // A WhatsApp that failed read as "not on WhatsApp", for a client who had agreed to it.
  it("says the WhatsApp did not go, not that the client never agreed, where it failed", async () => {
    await agreeToVisitMessages(true);
    const { move_id: moveId } = await (await move(toSameerWednesdayMorning(A))).json<{ move_id: string }>();

    await env.DB.prepare("UPDATE outbound_messages SET state = 'failed', last_error = 'the bridge is down'").run();

    expect(await untoldTasks()).toEqual([
      expect.objectContaining({ id: moveId, detail: "2026-09-23T03:30:00.000Z not_sent" }),
    ]);
    const block = (await board("from=2026-09-22")).technicians[1]?.days[1]?.blocks[0];
    expect(block?.untold).toEqual({ move_id: moveId, starts_at: "2026-09-23T03:30:00.000Z", reason: "not_sent" });
  });

  it("drops the task when a later move tells the client, or the visit has gone", async () => {
    const { move_id: first } = await (await move(toSameerWednesdayMorning(A))).json<{ move_id: string }>();
    expect((await untoldTasks()).map((task) => task.id)).toEqual([first]);

    await agreeToVisitMessages(true);
    await move({ ...toSameerWednesdayMorning(A), date: "2026-09-24" });
    expect(await untoldTasks()).toEqual([]);

    await agreeToVisitMessages(false);
    await move({ ...toSameerWednesdayMorning(A), date: "2026-09-25" });
    expect(await untoldTasks()).toHaveLength(1);
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(A).run();
    expect(await untoldTasks()).toEqual([]);
  });

  it("refuses to record a call for a move nobody needed to call about", async () => {
    await agreeToVisitMessages(true);
    const { move_id: moveId } = await (await move(toSameerWednesdayMorning(A))).json<{ move_id: string }>();

    expect((await opsPost(`/api/dispatch/moves/${moveId}/told`, {})).status).toBe(404);
    expect((await opsPost(`/api/dispatch/moves/${crypto.randomUUID()}/told`, {})).status).toBe(404);
  });
});
