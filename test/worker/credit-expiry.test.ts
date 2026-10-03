// Free service visits running out: the WhatsApp reminders a month and a week before their last day (MON-35, PS-38,
// CP-40), and the pass that closes them once they have, however long the cron was down (MON-54). NOW is Monday
// 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../src/config/message-templates.ts";
import { composeCreditsExpiring, queueCreditReminders } from "../../src/domain/credit-reminders.ts";
import { clawBack, expireCredits, grantCredits } from "../../src/domain/credits.ts";
import { createLogger } from "../../src/log.ts";
import { creditExpiry } from "../../src/policy/referral-reward.ts";
import type { MessagingProvider } from "../../src/providers/messaging.ts";
import { sendMessage } from "../../src/queues/messaging.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import { captureLogs, fakeDependencies, fakeQueue, LOCAL_CONFIG, markDatabase, NOW } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const DAY = 86_400_000;
/** 6 pm in India, the reminder hour, on the day given: "2026-09-21". */
const evening = (date: string) => new Date(`${date}T12:30:00.000Z`);
/** Their last day is 21 October 2026, a month after NOW. */
const LAST_DAY_EXPIRY = creditExpiry(NOW, 30);
const A_YEAR_AGO = new Date(NOW.getTime() - 335 * DAY);

async function grant(input: { visits: number; expiresAt: Date; givenAt?: Date; sourceId?: string; person?: string }) {
  await grantCredits(env.DB, {
    personId: input.person ?? PERSON,
    visits: input.visits,
    source: "ops",
    sourceId: input.sourceId ?? "o1",
    now: input.givenAt ?? A_YEAR_AGO,
    expiresAt: input.expiresAt,
  }).run();
}

async function told(messageId: string, now: Date) {
  const message = await env.DB.prepare("SELECT subject_id, person_id FROM outbound_messages WHERE id = ?1")
    .bind(messageId)
    .first<{ subject_id: string; person_id: string }>();
  if (message === null) throw new Error("no such message");
  const composed = await composeCreditsExpiring(env.DB, message.subject_id, message.person_id, now);
  return "skip" in composed ? composed : renderMessage(composed.template, composed.params);
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON, A_YEAR_AGO.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES ('c1', ?1, 'whatsapp_visits', 'whatsapp-visits-v1', 1, ?2)`,
  )
    .bind(PERSON, A_YEAR_AGO.toISOString())
    .run();
});

describe("the reminder that free service visits are running out", () => {
  it("goes a month before their last day, and again a week before, once each", async () => {
    await grant({ visits: 3, expiresAt: LAST_DAY_EXPIRY });
    const [month] = await queueCreditReminders(env.DB, evening("2026-09-21"));
    expect(await told(month ?? "", evening("2026-09-21"))).toBe(
      "Hello Rohit, you have 3 service visits free to book by 21 Oct 2026. A visit booked by then is covered, even " +
        "one on a later date. Book in the Mane Man app.",
    );
    expect(await queueCreditReminders(env.DB, evening("2026-09-21"))).toEqual([]);
    expect(await queueCreditReminders(env.DB, evening("2026-10-13"))).toEqual([]);
    expect(await queueCreditReminders(env.DB, evening("2026-10-14"))).toHaveLength(1);
    expect(await queueCreditReminders(env.DB, evening("2026-10-21"))).toEqual([]);
  });

  it("is one message for visits from several grants that end the same day, counting them all", async () => {
    await grant({ visits: 2, expiresAt: LAST_DAY_EXPIRY, sourceId: "o1" });
    await grant({ visits: 1, expiresAt: LAST_DAY_EXPIRY, sourceId: "o2" });
    const queued = await queueCreditReminders(env.DB, evening("2026-09-21"));
    expect(queued).toHaveLength(1);
    expect(await told(queued[0] ?? "", evening("2026-09-21"))).toMatch(/^Hello Rohit, you have 3 service visits free/);
  });

  it("says how many are left as it is sent, and is not sent once none are, or without consent", async () => {
    await grant({ visits: 3, expiresAt: LAST_DAY_EXPIRY });
    const [queued] = await queueCreditReminders(env.DB, evening("2026-09-21"));
    await clawBack(env.DB, "ops", "o1", evening("2026-09-21"));
    expect(await told(queued ?? "", evening("2026-09-21"))).toEqual({ skip: "no free service visits left to book" });
    await env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES ('c2', ?1, 'whatsapp_visits', 'whatsapp-visits-v1', 0, ?2)`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    expect(await told(queued ?? "", evening("2026-09-21"))).toEqual({ skip: "no consent to WhatsApp about visits" });
  });

  it("is not written before the reminder hour, for visits spent or given inside the month, or to an erased client", async () => {
    await grant({ visits: 3, expiresAt: LAST_DAY_EXPIRY });
    expect(await queueCreditReminders(env.DB, NOW)).toEqual([]);
    expect(await queueCreditReminders(env.DB, evening("2026-09-21"), 19)).toEqual([]);
    await clawBack(env.DB, "ops", "o1", NOW);
    expect(await queueCreditReminders(env.DB, evening("2026-09-21"))).toEqual([]);

    // Given on 11 September to use by 1 October: the message giving them said so, and the week's reminder follows.
    await grant({
      visits: 1,
      expiresAt: creditExpiry(NOW, 10),
      givenAt: new Date(NOW.getTime() - 10 * DAY),
      sourceId: "o2",
    });
    expect(await queueCreditReminders(env.DB, evening("2026-09-21"))).toEqual([]);
    expect(await queueCreditReminders(env.DB, evening("2026-09-24"))).toHaveLength(1);

    await grant({ visits: 1, expiresAt: LAST_DAY_EXPIRY, sourceId: "o3" });
    await env.DB.prepare("UPDATE people SET erased_at = ?1").bind(NOW.toISOString()).run();
    expect(await queueCreditReminders(env.DB, evening("2026-09-21"))).toEqual([]);
  });

  it("rides the cron, and the messaging consumer sends it", async () => {
    await grant({ visits: 3, expiresAt: LAST_DAY_EXPIRY });
    const job = CRON_JOBS.filter((each) => each.name === "credit_reminders");
    const messages = fakeQueue();
    const outcomes = await runCronJobs(job, {
      env: { ...env, MESSAGE_QUEUE: messages },
      deps: fakeDependencies({ now: () => evening("2026-09-21") }),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });
    expect(outcomes).toEqual([{ job: "credit_reminders", ok: true }]);
    expect(messages.sent).toEqual([{ message_id: expect.any(String) as string, request_id: "credit-reminders" }]);

    const sent: { template: string; params: readonly string[] }[] = [];
    const messaging: MessagingProvider = {
      send: ({ template, params }) => {
        sent.push({ template, params });
        return Promise.resolve({ ok: true, providerMessageId: "wa-1" });
      },
      connection: () => Promise.resolve({ open: true }),
    };
    const { message_id: messageId } = messages.sent[0] as { message_id: string };
    const deps = fakeDependencies({ messaging, now: () => evening("2026-09-21") });
    await sendMessage(env.DB, LOCAL_CONFIG, deps, createLogger(), messageId);
    expect(sent).toEqual([{ template: "credits_expiring_v1", params: ["Rohit", "3 service visits", "21 Oct 2026"] }]);
  });
});

describe("the pass that closes expired credits", () => {
  const expireEntries = () =>
    env.DB.prepare("SELECT grant_id, visits FROM credit_ledger WHERE kind = 'expire' ORDER BY grant_id").all();

  it("closes a grant that expired weeks ago, as after a long outage of the cron", async () => {
    await grant({ visits: 3, expiresAt: new Date(NOW.getTime() - 20 * DAY) });
    expect(await expireCredits(env.DB, NOW)).toBe(1);
    expect((await expireEntries()).results).toEqual([{ grant_id: expect.any(String) as string, visits: -3 }]);
  });

  it("works through a backlog in turns, each pass reading on from where the last left off", async () => {
    for (let day = 1; day <= 25; day += 1) {
      await grant({ visits: 1, expiresAt: new Date(NOW.getTime() - day * DAY), sourceId: `o${String(day)}` });
    }
    expect(await expireCredits(env.DB, NOW)).toBe(20);
    const cursor = () => env.DB.prepare("SELECT open_from_at FROM credit_expiry_cursor").first();
    // The five that expired last are still open, so the next pass reads from the earliest of them.
    expect(await cursor()).toEqual({ open_from_at: new Date(NOW.getTime() - 5 * DAY).toISOString() });
    expect(await expireCredits(env.DB, NOW)).toBe(5);
    expect(await cursor()).toEqual({ open_from_at: NOW.toISOString() });
    expect(await expireCredits(env.DB, NOW)).toBe(0);
    expect((await expireEntries()).results).toHaveLength(25);

    await grant({ visits: 2, expiresAt: new Date(NOW.getTime() + DAY), sourceId: "later" });
    expect(await expireCredits(env.DB, new Date(NOW.getTime() + 2 * DAY))).toBe(1);
  });
});
