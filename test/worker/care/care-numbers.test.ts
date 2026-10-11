// The Care numbers (src/domain/care/care-numbers.ts, src/routes/ops/care-numbers.ts;
// docs/decisions/0144-care-numbers.md): first replies counted in Care hours, the share on time, same-day closes, the
// backlog now, reasons and remedies, and each Care person's replies. NOW is noon on Monday 21 September, in India.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { indiaInstant } from "../../../src/lib/india-time.ts";
import { captureLogs, markDatabase, request } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";
import { listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const ASHA = "asha@maneman.test";
const at = (time: string, date = "2026-09-21") => indiaInstant(date, time).toISOString();

async function chat(id: string, personId: string, opened: string, closed: { at: string; reason: string } | null) {
  await env.DB.prepare(
    `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, last_inbound_at,
       closed_at, close_reason, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5, ?6, ?7, ?5, ?5)`,
  )
    .bind(
      id,
      personId,
      `+9198100000${id.slice(-2)}`,
      closed === null ? "open" : "closed",
      opened,
      closed?.at ?? null,
      closed?.reason ?? null,
    )
    .run();
}

async function reply(conversationId: string, sentAt: string) {
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at, delivery)
     VALUES (?1, ?2, 'out', ?3, 'On it.', ?4, ?4, 'sent')`,
  )
    .bind(crypto.randomUUID(), conversationId, ASHA, sentAt)
    .run();
}

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await listStaff(ASHA, ["customer_care:act:national"]);
  for (const id of ["p1", "p2", "p3"]) await insertPerson(id, `+91981000000${id.slice(1)}`, "A Client");
  await env.DB.prepare("INSERT INTO care_owners (person_id, email, since, assigned_by) VALUES ('p1', ?1, ?2, 'system')")
    .bind(ASHA, at("09:00"))
    .run();
  // Answered in 30 minutes, closed the same day about a fit problem.
  await chat("cv-01", "p1", at("10:00"), { at: at("11:00"), reason: "fit_problem" });
  await reply("cv-01", at("10:30"));
  // Written at 8:50 pm, answered at 9:20 am: 30 minutes in Care hours, and before its reply-by time of 10 am.
  await chat("cv-02", "p2", at("20:50", "2026-09-20"), { at: at("09:30"), reason: "booking" });
  await reply("cv-02", at("09:20"));
  // Not answered yet, and past its reply-by time.
  await chat("cv-03", "p3", at("09:30"), null);
});

describe("the Care numbers", () => {
  it("count first replies in Care hours, the share on time, same-day closes, the backlog and reasons", async () => {
    const answer = await request(opsAs(person(ASHA)), "/api/care-numbers?days=7");
    expect(await answer.json()).toMatchObject({
      replies: { chats: 3, median_minutes: 30, within_target: 2 / 3 },
      same_day: 1 / 3,
      backlog: { waiting_on_us: 1, overdue: 1, waiting_on_client: 0 },
      reasons: expect.arrayContaining([
        { reason: "fit_problem", chats: 1 },
        { reason: "booking", chats: 1 },
      ]) as unknown,
      by_person: [{ email: ASHA, chats: 1, median_minutes: 30, within_target: 1 }],
    });
  });
});
