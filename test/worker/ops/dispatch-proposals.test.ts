// A move to another day that ops ask the client to confirm (docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md):
// the visit stays where it is until the client accepts, accepting moves it as the board would, and ops may take it
// back. NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { composeMoveProposed } from "../../../src/domain/messages/move-proposal-text.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import {
  A,
  B,
  IMRAN,
  ROHIT,
  SAMEER,
  TUESDAY,
  VIKRAM,
  WEDNESDAY,
  agreeToVisitMessages,
  insertJob,
  shown,
  toSameerWednesdayMorning,
} from "./dispatch-fixtures.ts";

let ops: App;
let client: App;
let cookie: string;
let messageQueue: ReturnType<typeof fakeQueue>;

beforeEach(async () => {
  await markDatabase();
  messageQueue = fakeQueue();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  client = appFor("local", fakeDependencies(), {}, "client");
  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, updated_at)
     VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Sec 40–65', ?3), (?2, ?2, 'Sameer Bhatt', 'SB', 1, 'Sec 1–39', ?3)`,
  )
    .bind(IMRAN, SAMEER, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name)
     VALUES (?1, ?3, '+919810000001', 'Rohit Malhotra'), (?2, ?3, '+919810009902', 'Vikram Sethi')`,
  )
    .bind(ROHIT, VIKRAM, NOW.toISOString())
    .run();
  await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: ROHIT, deviceLabel: null, now: NOW })}`;
});

const bindings = () => ({ MESSAGE_QUEUE: messageQueue }) as unknown as Partial<Env>;
const sent = (app: App, path: string, body: unknown, headers: Record<string, string> = {}) =>
  request(
    app,
    path,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    bindings(),
  );

/** Ops' proposal, sent from a board that shows the visit as it stands. */
async function propose(body: { appointment_id: string } & Record<string, unknown>): Promise<Response> {
  const job = await shown(body.appointment_id);
  return sent(ops, "/api/dispatch/propose", {
    expected_technician_id: job?.technician_id ?? null,
    expected_starts_at: job?.window_start,
    ...body,
  });
}

const accept = () => sent(client, `/api/visits/${A}/proposed-move/accept`, {}, { Cookie: cookie });

interface Visit {
  id: string;
  proposed_move: { date: string; window: string; technician: { name: string } | null } | null;
}
const proposedOnVisits = async () => {
  const listed = await request(client, "/api/visits", { headers: { Cookie: cookie } }, bindings());
  const { upcoming } = await listed.json<{ upcoming: Visit[] }>();
  return upcoming.find((visit) => visit.id === A)?.proposed_move ?? null;
};

describe("a move to another day ops ask the client to confirm", () => {
  it("leaves the visit where it is, and messages the client the day proposed", async () => {
    await agreeToVisitMessages(true);
    const before = await shown(A);
    const answer = await propose(toSameerWednesdayMorning(A));
    expect(answer.status).toBe(200);
    const { proposal_id: proposalId, client_notice: notice } = await answer.json<{
      proposal_id: string;
      client_notice: string;
    }>();
    expect(notice).toBe("messaged");
    expect(await shown(A)).toEqual(before);
    expect(await proposedOnVisits()).toMatchObject({
      date: WEDNESDAY,
      window: "morning",
      technician: { name: "Sameer Bhatt" },
    });

    const message = await env.DB.prepare("SELECT id, kind, subject_kind, subject_id FROM outbound_messages").first();
    expect(message).toMatchObject({ kind: "move_proposed", subject_kind: "move_proposal", subject_id: proposalId });
    expect(await composeMoveProposed(env.DB, proposalId, ROHIT, NOW)).toEqual({
      template: "move_proposed_v1",
      params: ["Rohit", "service visit", "Tue 22 Sep", "Wed 23 Sep", "9 am to 12 pm", "Sameer"],
    });
  });

  it("moves the visit as the board would once the client accepts, and the proposal is gone", async () => {
    await propose(toSameerWednesdayMorning(A));
    const answer = await accept();
    expect(answer.status).toBe(200);
    expect(await shown(A)).toMatchObject({ technician_id: SAMEER });
    expect((await shown(A))?.window_start.startsWith(WEDNESDAY)).toBe(true);
    const moved = await env.DB.prepare("SELECT reason FROM dispatch_moves WHERE appointment_id = ?1").bind(A).first();
    expect(moved).toEqual({ reason: "zone_rebalance" });
    expect(await proposedOnVisits()).toBeNull();
    expect((await accept()).status).toBe(404);
  });

  it("answers that the time has gone when it was taken since, and the client picks again", async () => {
    await propose(toSameerWednesdayMorning(A));
    // Vikram's visit takes Sameer's Wednesday morning before Rohit answers.
    await insertJob(B, {
      type: "service",
      start: "2026-09-23T03:30:00.000Z",
      technician: SAMEER,
      person: VIKRAM,
    });
    const answer = await accept();
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "move_gone" } });
    expect(await shown(A)).toMatchObject({ technician_id: IMRAN });
    expect(await proposedOnVisits()).toBeNull();
  });

  it("lets ops take it back, and leaves a move within the visit's own day to the board", async () => {
    await propose(toSameerWednesdayMorning(A));
    const proposal = await env.DB.prepare("SELECT id FROM move_proposals").first<{ id: string }>();
    expect((await sent(ops, `/api/dispatch/proposals/${proposal?.id ?? ""}/withdraw`, {})).status).toBe(204);
    expect(await proposedOnVisits()).toBeNull();
    expect((await accept()).status).toBe(404);

    const sameDay = await propose({ appointment_id: A, window: "afternoon", reason: "zone_rebalance" });
    expect(sameDay.status).toBe(400);
    expect(await sameDay.json()).toMatchObject({ error: { code: "invalid_request", fields: ["date"] } });
  });

  it("sends nothing to a client who has not agreed to WhatsApp about visits, and ops call them", async () => {
    await agreeToVisitMessages(false);
    const answer = await propose(toSameerWednesdayMorning(A));
    expect(await answer.json()).toMatchObject({ client_notice: "call" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_messages").first("n")).toBe(0);
  });
});
