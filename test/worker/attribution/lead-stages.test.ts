// A lead's stages and a lead lost (docs/decisions/0320-lead-stages.md): each stage read from what happened, Care's
// first written reply that went among them and an automatic one never; and a lead lost, with one of the job sheet's
// reasons and the client's words, its day kept while it stays lost, taken back, audited, and its words gone on an
// erasure. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { AUTO_REPLY } from "../../../src/domain/care/after-hours.ts";
import type { App } from "../../../src/http/context.ts";
import { captureLogs, eraseByMobile, fakeQueue, markDatabase, request } from "../helpers.ts";
import { aVisit } from "../fixtures/visits.ts";
import { listStaff, opsAs, person } from "../ops/staff-fixtures.ts";
import { insertPerson } from "../tryon-fixtures.ts";

const CARE = "care@maneman.test";
const KNOWN = "11111111-1111-4111-8111-111111111111";
const MOBILE = "+919810000001";

const post = (app: App, path: string, body: unknown) =>
  request(
    app,
    path,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() },
  );

const care = () => opsAs(person(CARE));
const read = async () => (await request(care(), `/api/clients/${KNOWN}/attribution`)).json();
const rows = async (sql: string) => (await env.DB.prepare(sql).all()).results;

/** A chat with the client, and its messages: theirs, our automatic ones, and Care's, sent or refused. */
async function chat(
  messages: readonly { direction: "in" | "out"; author: string; at: string; delivery?: "sent" | "failed" }[],
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO conversations (id, person_id, mobile_e164, opened_at, last_message_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?4, ?4, ?4)`,
  )
    .bind(id, KNOWN, MOBILE, messages[0]?.at ?? "2026-09-20T04:00:00.000Z")
    .run();
  for (const message of messages) {
    await env.DB.prepare(
      `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at, delivery)
       VALUES (?1, ?2, ?3, ?4, 'Hello', ?5, ?5, ?6)`,
    )
      .bind(crypto.randomUUID(), id, message.direction, message.author, message.at, message.delivery ?? null)
      .run();
  }
}

const conversion = (event: "consult_booked" | "consult_done", at: string) =>
  env.DB.prepare(
    `INSERT INTO conversions (event_id, event, subject_id, person_id, occurred_at, attributed_channel,
       last_touch_channel, meta_state, google_state, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'direct', 'direct', 'skipped', 'skipped', ?5)`,
  )
    .bind(crypto.randomUUID(), event, crypto.randomUUID(), KNOWN, at)
    .run();

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await listStaff(CARE, ["customer_care:manage:national"]);
  await insertPerson(KNOWN, MOBILE, "Arjun Mehta");
});

describe("a lead's stages", () => {
  it("are each when first reached, read from what happened, and not yet where none has", async () => {
    expect(await read()).toMatchObject({
      became_lead_at: expect.any(String) as string,
      first_reply_at: null,
      qualified_at: null,
      attended_at: null,
      fitted_at: null,
      lost_reason: null,
    });

    await chat([
      { direction: "in", author: "client", at: "2026-09-20T04:00:00.000Z" },
      { direction: "out", author: AUTO_REPLY, at: "2026-09-20T04:00:05.000Z" },
      { direction: "out", author: CARE, at: "2026-09-20T04:03:00.000Z", delivery: "failed" },
      { direction: "out", author: CARE, at: "2026-09-20T04:07:00.000Z", delivery: "sent" },
      { direction: "out", author: CARE, at: "2026-09-20T05:00:00.000Z" },
    ]);
    await conversion("consult_booked", "2026-09-20T06:00:00.000Z");
    await conversion("consult_done", "2026-09-22T05:00:00.000Z");
    await aVisit({
      person_id: KNOWN,
      type: "first_fit",
      status: "completed",
      window_start: "2026-09-29T05:00:00.000Z",
    });

    expect(await read()).toMatchObject({
      first_reply_at: "2026-09-20T04:07:00.000Z",
      qualified_at: "2026-09-20T06:00:00.000Z",
      attended_at: "2026-09-22T05:00:00.000Z",
      fitted_at: "2026-09-29T05:00:00.000Z",
    });
  });

  it("count a consultation and fit in one visit as fitted, and never a fit not yet done", async () => {
    await aVisit({
      person_id: KNOWN,
      type: "first_fit",
      status: "scheduled",
      window_start: "2026-10-01T05:00:00.000Z",
    });
    expect(await read()).toMatchObject({ fitted_at: null });
    await aVisit({
      person_id: KNOWN,
      type: "consultation",
      one_visit: "fitted",
      status: "completed",
      window_start: "2026-09-25T05:00:00.000Z",
    });
    expect(await read()).toMatchObject({ fitted_at: "2026-09-25T05:00:00.000Z" });
  });
});

describe("a lead lost", () => {
  it("keeps why and the client's words, is taken back, and is audited each time", async () => {
    const lost = await post(care(), `/api/clients/${KNOWN}/lost`, {
      lost_reason: "price",
      lost_objection: "Wants to wait for the replacement price",
    });
    expect(lost.status).toBe(204);
    expect(await read()).toMatchObject({
      lost_reason: "price",
      lost_objection: "Wants to wait for the replacement price",
      lost_at: expect.any(String) as string,
    });

    // A reason changed later keeps the day the lead was first lost.
    await env.DB.prepare("UPDATE person_attribution SET lost_at = '2026-09-01T06:00:00.000Z'").run();
    expect((await post(care(), `/api/clients/${KNOWN}/lost`, { lost_reason: "not_ready" })).status).toBe(204);
    expect(await read()).toMatchObject({ lost_reason: "not_ready", lost_at: "2026-09-01T06:00:00.000Z" });

    expect((await post(care(), `/api/clients/${KNOWN}/lost`, { lost_reason: null })).status).toBe(204);
    expect(await read()).toMatchObject({ lost_reason: null, lost_objection: null, lost_at: null });

    expect(
      await rows("SELECT action FROM audit_log WHERE action IN ('client.lost', 'client.lost_taken_back') ORDER BY id"),
    ).toEqual([{ action: "client.lost" }, { action: "client.lost" }, { action: "client.lost_taken_back" }]);
  });

  it("takes back a lead never lost as nothing at all: no row, and nothing audited", async () => {
    expect((await post(care(), `/api/clients/${KNOWN}/lost`, { lost_reason: null })).status).toBe(204);
    expect(await rows("SELECT person_id FROM person_attribution")).toEqual([]);
    expect(await rows("SELECT action FROM audit_log WHERE action LIKE 'client.lost%'")).toEqual([]);
  });

  it("refuses a reason the job sheet never listed, an objection too long, and a client out of reach", async () => {
    expect((await post(care(), `/api/clients/${KNOWN}/lost`, { lost_reason: "budget" })).status).toBe(400);
    const long = { lost_reason: "other", lost_objection: "x".repeat(201) };
    expect((await post(care(), `/api/clients/${KNOWN}/lost`, long)).status).toBe(400);
    expect((await post(care(), `/api/clients/${crypto.randomUUID()}/lost`, { lost_reason: "price" })).status).toBe(404);
  });

  it("loses the client's words on an erasure, and keeps the reason", async () => {
    await post(care(), `/api/clients/${KNOWN}/lost`, {
      lost_reason: "not_suited",
      lost_objection: "Unsure about the bond",
    });
    await eraseByMobile(MOBILE);
    expect(await rows("SELECT lost_reason, lost_objection FROM person_attribution")).toEqual([
      { lost_reason: "not_suited", lost_objection: null },
    ]);
  });
});
