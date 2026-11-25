// Leads who wrote to us and wait on Care's first reply (src/domain/leads/waiting-leads.ts, src/routes/ops/waiting-leads.ts;
// docs/decisions/0323-the-unanswered-lead-alert.md): a chat from a number we don't know, or from someone not yet fitted,
// whom no Care person has written to, waits from their first message since the chat opened, and reaches the banner
// once past five minutes of Care hours, for a Care person on shift. A lead who never wrote waits on nothing. NOW is noon
// on Monday 21 September in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { waitingLeads } from "../../../src/domain/leads/waiting-leads.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";
import { CARE_HOURS } from "../../../src/policy/care-hours.ts";
import { captureLogs, markDatabase, request } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";
import { aTechnician, aVisit } from "../fixtures/index.ts";
import { listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const ASHA = "asha@maneman.test";
const at = (time: string) => indiaInstant("2026-09-21", time).toISOString();
const DAY_BEFORE = indiaInstant("2026-09-20", "12:00");

async function chat(id: string, personId: string | null, mobile: string, time: string, opened = time) {
  await env.DB.prepare(
    `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, last_inbound_at,
       created_at, updated_at)
     VALUES (?1, ?2, ?3, 'open', ?4, ?5, ?5, ?4, ?5)`,
  )
    .bind(id, personId, mobile, at(opened), at(time))
    .run();
  await wrote(id, time);
}

async function wrote(conversationId: string, time: string) {
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at)
     VALUES (?1, ?2, 'in', 'client', 'Hello, is the consultation free?', ?3, ?3)`,
  )
    .bind(`${conversationId}-in-${time}`, conversationId, at(time))
    .run();
}

async function answered(conversationId: string, author: string, time: string) {
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at, delivery)
     VALUES (?1, ?2, 'out', ?3, 'Thanks for writing to us.', ?4, ?4, 'sent')`,
  )
    .bind(`${conversationId}-${author}-${time}`, conversationId, author, at(time))
    .run();
}

const waiting = () => waitingLeads(env.DB, { from: DAY_BEFORE, hours: CARE_HOURS });

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await insertPerson("p1", "+919810000001", "Arjun Mehta");
});

describe("a lead who wrote", () => {
  it("waits from their first message, alerted once it has waited five minutes of Care hours", async () => {
    await chat("cv1", null, "+919811112222", "11:45");
    await wrote("cv1", "11:48");
    expect(await waiting()).toMatchObject([
      { conversation_id: "cv1", person_id: null, mobile: "+919811112222", since: at("11:45"), alert_at: at("11:50") },
    ]);
  });

  it("waits no more once a Care person writes, never for the after-hours answer", async () => {
    await chat("cv1", "p1", "+919810000001", "11:50");
    await answered("cv1", "auto", "11:50");
    expect(await waiting()).toMatchObject([{ person_id: "p1", name: "Arjun Mehta" }]);
    await answered("cv1", ASHA, "11:56");
    expect(await waiting()).toEqual([]);
  });

  it("is not waiting on a first reply where Care have written to them before, or they are fitted", async () => {
    await insertPerson("p2", "+919810000002", "Kabir Sethi");
    await chat("cv-old", "p2", "+919810000099", "09:40");
    await answered("cv-old", ASHA, "09:45");
    await chat("cv2", "p2", "+919810000002", "11:40");
    await insertPerson("p3", "+919810000003", "Dev Arora");
    await aVisit({ person_id: "p3", type: "first_fit", status: "completed", window_start: at("09:00") });
    await chat("cv3", "p3", "+919810000003", "11:41");
    expect(await waiting()).toEqual([]);
  });

  it("counts a chat closed unanswered and opened again from its new first message", async () => {
    await chat("cv1", null, "+919811112222", "11:55", "11:50");
    await env.DB.prepare(
      "INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at) VALUES ('old', 'cv1', 'in', 'client', 'Hi', ?1, ?1)",
    )
      .bind(indiaInstant("2026-09-01", "10:00").toISOString())
      .run();
    expect(await waiting()).toMatchObject([{ since: at("11:55"), alert_at: at("12:00") }]);
  });

  it("is never a technician writing to the office, whose number we know", async () => {
    await aTechnician({ mobile_e164: "+919811110000" });
    await chat("cv-tech", null, "+919811110000", "11:40");
    expect(await waiting()).toEqual([]);
  });

  it("is never a lead who only filled in the booking form", async () => {
    await env.DB.prepare(
      "INSERT INTO leads (id, person_id, created_at, source, request_id) VALUES ('l1', 'p1', ?1, 'form', 'r')",
    )
      .bind(at("11:30"))
      .run();
    expect(await waiting()).toEqual([]);
  });
});

describe("the banner's read", () => {
  it("names the leads past their alert time, and whether the caller is on shift", async () => {
    await listStaff(ASHA, ["customer_care:act:national"]);
    await chat("cv1", "p1", "+919810000001", "11:50");
    await chat("cv2", null, "+919811112222", "11:58");
    const answer = await request(opsAs(person(ASHA)), "/api/leads/waiting");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      on_shift: false,
      leads: [
        {
          conversation_id: "cv1",
          person_id: "p1",
          name: "Arjun Mehta",
          mobile: "+919810000001",
          since: at("11:50"),
          alert_at: at("11:55"),
        },
      ],
      push_key: null,
    });
    await env.DB.prepare("UPDATE staff SET on_shift_since = ?1 WHERE email = ?2").bind(at("09:30"), ASHA).run();
    expect(await (await request(opsAs(person(ASHA)), "/api/leads/waiting")).json()).toMatchObject({ on_shift: true });
  });
});
