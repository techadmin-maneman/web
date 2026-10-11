// A chat past its reply-by time on Tasks (src/domain/care/chat-tasks.ts, src/domain/ops/tasks.ts;
// docs/decisions/0132-the-reply-clock.md): it shows once the reply clock runs out, due by it, and goes when Care reply.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { captureLogs, markDatabase } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";

const WRITTEN = indiaInstant("2026-10-12", "10:00");
const DUE = indiaInstant("2026-10-12", "11:00");

async function chat(id: string, personId: string | null, mobile: string) {
  await env.DB.prepare(
    `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, last_inbound_at,
       created_at, updated_at)
     VALUES (?1, ?2, ?3, 'open', ?4, ?4, ?4, ?4, ?4)`,
  )
    .bind(id, personId, mobile, WRITTEN.toISOString())
    .run();
}

const chatTasks = async (at: Date) =>
  (await outstandingTasks(env.DB, at, TASK_SLA_HOURS)).tasks.filter((task) => task.group === "unanswered_chat");

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await insertPerson("p1", "+919810000001", "Arjun Mehta");
  await chat("cv1", "p1", "+919810000001");
});

describe("an unanswered chat on Tasks", () => {
  it("waits off the board until its reply-by time, then shows due by it", async () => {
    expect(await chatTasks(indiaInstant("2026-10-12", "10:59"))).toEqual([]);
    expect(await chatTasks(indiaInstant("2026-10-12", "11:05"))).toMatchObject([
      { id: "cv1", person: { name: "Arjun Mehta" }, since: WRITTEN.toISOString(), due: DUE.toISOString() },
    ]);
  });

  it("goes once Care reply", async () => {
    await env.DB.prepare(
      `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at, delivery)
       VALUES ('m1', 'cv1', 'out', 'care@maneman.test', 'On it.', ?1, ?1, 'sent')`,
    )
      .bind(indiaInstant("2026-10-12", "11:30").toISOString())
      .run();
    expect(await chatTasks(indiaInstant("2026-10-12", "12:00"))).toEqual([]);
  });

  it("names a number we don't know by the number", async () => {
    await chat("cv2", null, "+919811112222");
    const tasks = await chatTasks(indiaInstant("2026-10-12", "12:00"));
    expect(tasks.find((task) => task.id === "cv2")).toMatchObject({ person: null, detail: "+919811112222" });
  });
});
