// The unanswered-lead pushes (src/domain/leads/lead-alerts.ts, src/routes/ops/waiting-leads.ts;
// docs/decisions/0323-the-unanswered-lead-alert.md): a Care person turns the alerts on for a phone, and each minute a
// lead newly past its alert time is pushed once to the phones of whoever is on Care shift. NOW is noon on Monday
// 21 September in India. Every name, number and address is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { pushLeadAlerts } from "../../../src/domain/leads/lead-alerts.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";
import { CARE_HOURS } from "../../../src/policy/care-hours.ts";
import type { Push } from "../../../src/providers/web-push.ts";
import { captureLogs, markDatabase, NOW, request } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";
import { enforce, listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const ASHA = "asha@maneman.test";
const RAVI = "ravi@maneman.test";
const ASHA_PHONE = "https://fcm.googleapis.com/fcm/send/asha-phone";
const RAVI_PHONE = "https://web.push.apple.com/ravi-phone";
const at = (time: string) => indiaInstant("2026-09-21", time).toISOString();

let pushed: string[] = [];
let gone = new Set<string>();
const push: Push = (endpoint) => {
  pushed.push(endpoint);
  return Promise.resolve(gone.has(endpoint) ? "gone" : "sent");
};
const run = (now = NOW, calls = 10) =>
  pushLeadAlerts(env.DB, { push, budget: createCallBudget(calls), now, hours: CARE_HOURS });

async function onShift(email: string, phone: string) {
  await env.DB.batch([
    env.DB.prepare("UPDATE staff SET on_shift_since = ?1 WHERE email = ?2").bind(at("09:30"), email),
    env.DB.prepare("INSERT INTO staff_push_subscriptions (endpoint, email, subscribed_at) VALUES (?1, ?2, ?3)").bind(
      phone,
      email,
      at("09:30"),
    ),
  ]);
}

/** A chat from a number we don't know, its first message at `time`, nobody at Care having written. */
async function chatFrom(id: string, time: string) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, last_inbound_at,
         created_at, updated_at)
       VALUES (?1, NULL, ?2, 'open', ?3, ?3, ?3, ?3, ?3)`,
    ).bind(id, `+9198111${id.padStart(5, "0").slice(-5)}`, at(time)),
    env.DB.prepare(
      `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at)
       VALUES (?1, ?2, 'in', 'client', 'Hello', ?3, ?3)`,
    ).bind(`${id}-in`, id, at(time)),
  ]);
}

const subscriptions = async () =>
  (await env.DB.prepare("SELECT endpoint, email FROM staff_push_subscriptions ORDER BY endpoint").all()).results;

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  pushed = [];
  gone = new Set();
  await listStaff(ASHA, ["customer_care:act:national"]);
  await listStaff(RAVI, ["customer_care:act:national"]);
  await insertPerson("p1", "+919810000001", "Arjun Mehta");
});

describe("a lead past its alert time", () => {
  it("is pushed once, to the phones of each Care person on shift", async () => {
    await onShift(ASHA, ASHA_PHONE);
    await env.DB.prepare("INSERT INTO staff_push_subscriptions (endpoint, email, subscribed_at) VALUES (?1, ?2, ?3)")
      .bind(RAVI_PHONE, RAVI, at("09:30"))
      .run();
    await chatFrom("l1", "11:50");
    expect(await run()).toBe(1);
    expect(pushed).toEqual([ASHA_PHONE]);
    expect(await run()).toBe(0);
    expect(pushed).toEqual([ASHA_PHONE]);
  });

  it("waits for its alert time, and is never pushed an hour after it", async () => {
    await onShift(ASHA, ASHA_PHONE);
    await chatFrom("l1", "11:58");
    expect(await run()).toBe(0);
    expect(await run(indiaInstant("2026-09-21", "13:10"))).toBe(0);
    expect(pushed).toEqual([]);
  });

  it("goes to nobody on shift whose Customer Care grant is a city's, not the nation's", async () => {
    await listStaff("city@maneman.test", ["customer_care:act:city:Delhi"]);
    await onShift("city@maneman.test", "https://fcm.googleapis.com/fcm/send/city-phone");
    await chatFrom("l1", "11:50");
    expect(await run()).toBe(0);
  });

  it("goes to nobody on shift whose Customer Care grant was taken away", async () => {
    await onShift(ASHA, ASHA_PHONE);
    await env.DB.prepare("DELETE FROM staff_grants WHERE email = ?1").bind(ASHA).run();
    await chatFrom("l1", "11:50");
    expect(await run()).toBe(0);
    expect(pushed).toEqual([]);
  });

  it("forgets a phone the push service says is gone", async () => {
    await onShift(ASHA, ASHA_PHONE);
    gone.add(ASHA_PHONE);
    await chatFrom("l1", "11:50");
    expect(await run()).toBe(1);
    expect(await subscriptions()).toEqual([]);
  });

  it("is pushed again by the next run where the calls ran out", async () => {
    await onShift(ASHA, ASHA_PHONE);
    await onShift(RAVI, RAVI_PHONE);
    await chatFrom("l1", "11:50");
    expect(await run(NOW, 1)).toBe(1);
    expect(await run()).toBe(2);
  });
});

describe("turning the alerts on for a phone", () => {
  const post = (email: string, endpoint: string) =>
    request(opsAs(person(email)), "/api/leads/alerts-phone", {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });

  it("keeps the phone as the caller's, and a phone handed on as its new holder's", async () => {
    expect((await post(ASHA, ASHA_PHONE)).status).toBe(204);
    expect(await subscriptions()).toEqual([{ endpoint: ASHA_PHONE, email: ASHA }]);
    await post(RAVI, ASHA_PHONE);
    expect(await subscriptions()).toEqual([{ endpoint: ASHA_PHONE, email: RAVI }]);
  });

  it("refuses an address that is no push service's", async () => {
    const refused = await post(ASHA, "https://example.com/not-a-push-service");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "invalid_request", fields: ["endpoint"] } });
    expect(await subscriptions()).toEqual([]);
  });

  it("keeps a person's three newest phones", async () => {
    for (const n of [1, 2, 3, 4]) {
      await post(ASHA, `${ASHA_PHONE}-${String(n)}`);
    }
    expect((await subscriptions()).map((row) => row.endpoint)).toEqual(
      [2, 3, 4].map((n) => `${ASHA_PHONE}-${String(n)}`),
    );
  });

  it("is refused for a caller not on the Staff list", async () => {
    const refused = await post("stranger@maneman.test", ASHA_PHONE);
    expect(refused.status).toBe(403);
    expect(await subscriptions()).toEqual([]);
  });

  it("is for those who answer Care's chats", async () => {
    await listStaff("viewer@maneman.test", ["customer_care:view:national"]);
    await enforce();
    expect((await post("viewer@maneman.test", ASHA_PHONE)).status).toBe(403);
  });
});
