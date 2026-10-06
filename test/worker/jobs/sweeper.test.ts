import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { checkAilabCredits, sweep } from "../../../src/scheduled/sweeper.ts";
import { NOW, captureLogs, fakeDependencies, markDatabase } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";
import { MAX_SYNC_ATTEMPTS } from "../../../src/config/pipeline.ts";
import { minutesAgo, minutesAhead, sweepEnv, OPTIONS } from "./sweeper-fixtures.ts";

async function insertLead(id: string, state: string, attempts: number, createdAt: string): Promise<void> {
  await insertPerson("p", "+919810000001");
  await env.DB.prepare(
    `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, sync_state, sync_attempts, request_id)
     VALUES (?, 'p', ?, 'form', 'Gurgaon', 'weekday_am', 'crown', ?, ?, 'r')`,
  )
    .bind(id, createdAt, state, attempts)
    .run();
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("sweeper: leads", () => {
  it("lets go each hour of a hold nobody is paying for once its grace is past, with its claims", async () => {
    await insertPerson("p", "+919810000001");
    const hold = (id: string, expiresAt: string, unit: number) => [
      env.DB.prepare(
        `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
           amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at)
         VALUES (?1, 'p', 'service', '2026-09-22', 'morning', 't1', ?2, 200000, 200000, 0, 'held', ?3, ?4, ?4)`,
      ).bind(id, unit, expiresAt, minutesAgo(30)),
      env.DB.prepare(
        "INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES ('t1', '2026-09-22', ?1, ?2)",
      ).bind(`unit:${String(unit)}`, id),
    ];
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'fsm-t1', 'Imran Qureshi', 'IQ', 1, ?1)",
      ).bind(NOW.toISOString()),
      // Ten minutes and two of grace, both past; and one still counting down.
      ...hold("dead", minutesAgo(13), 0),
      ...hold("live", minutesAhead(5), 2),
    ]);

    await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);

    const holds = await env.DB.prepare("SELECT id, state FROM slot_holds ORDER BY id").all();
    expect(holds.results).toEqual([
      { id: "dead", state: "released" },
      { id: "live", state: "held" },
    ]);
    expect((await env.DB.prepare("SELECT hold_id FROM slot_claims").all()).results).toEqual([{ hold_id: "live" }]);
  });

  it("re-enqueues pending leads older than two minutes and failed leads with attempts left", async () => {
    await insertLead("pending-old", "pending", 0, minutesAgo(3));
    await insertLead("pending-new", "pending", 0, minutesAgo(1)); // its queue message is probably still on the way
    await insertLead("failed-retry", "failed", 4, minutesAgo(30));
    await insertLead("failed-final", "failed", MAX_SYNC_ATTEMPTS, minutesAgo(90));
    await insertLead("synced", "synced", 1, minutesAgo(60));
    const { bindings, queues } = sweepEnv();

    const summary = await sweep(bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect(summary.leadsRequeued).toBe(2);
    expect(queues.crm.sent).toEqual([
      { lead_id: "failed-retry", request_id: "sweeper" },
      { lead_id: "pending-old", request_id: "sweeper" },
    ]);
  });

  it("sends nothing when there is nothing to retry", async () => {
    const { bindings, queues } = sweepEnv();
    const summary = await sweep(bindings, fakeDependencies(), createLogger(), OPTIONS);
    expect(summary).toMatchObject({ leadsRequeued: 0, messagesRequeued: 0, rendersRequeued: 0, downloadsRequeued: 0 });
    expect([...queues.crm.sent, ...queues.render.sent, ...queues.messages.sent]).toEqual([]);
  });

  it("removes idempotency records older than a day, counters older than three days, and expired sessions", async () => {
    await insertPerson("p", "+919810000001");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO idempotency (key, route, request_hash, created_at) VALUES ('old', 'r', 'h', ?)").bind(
        minutesAgo(25 * 60),
      ),
      env.DB.prepare("INSERT INTO idempotency (key, route, request_hash, created_at) VALUES ('new', 'r', 'h', ?)").bind(
        minutesAgo(60),
      ),
      env.DB.prepare("INSERT INTO counters (scope, key, window_start, count) VALUES ('s', 'k', '2026-09-17', 1)"),
      env.DB.prepare("INSERT INTO counters (scope, key, window_start, count) VALUES ('s', 'k', '2026-09-20T10', 1)"),
      env.DB.prepare(
        "INSERT INTO tryon_sessions (id, person_id, created_at, expires_at) VALUES ('gone', 'p', ?, ?)",
      ).bind(minutesAgo(40), minutesAgo(10)),
      env.DB.prepare(
        "INSERT INTO tryon_sessions (id, person_id, created_at, expires_at) VALUES ('live', 'p', ?, ?)",
      ).bind(minutesAgo(10), minutesAhead(20)),
    ]);

    await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect((await env.DB.prepare("SELECT key FROM idempotency").all()).results).toEqual([{ key: "new" }]);
    expect((await env.DB.prepare("SELECT window_start FROM counters").all()).results).toEqual([
      { window_start: "2026-09-20T10" },
    ]);
    expect((await env.DB.prepare("SELECT id FROM tryon_sessions").all()).results).toEqual([{ id: "live" }]);
  });

  it("removes login codes and the site's number codes a day past expiry, and client sessions 30 days after they end", async () => {
    const day = 24 * 60;
    const challenge = (id: string, expiredMinutesAgo: number) =>
      env.DB.prepare(
        `INSERT INTO otp_challenges (id, created_at, purpose, channel, last_sent_at, expires_at)
         VALUES (?1, ?2, 'login', 'whatsapp', ?2, ?3)`,
      ).bind(id, minutesAgo(expiredMinutesAgo + 10), minutesAgo(expiredMinutesAgo));
    const numberCode = (id: string, expiredMinutesAgo: number) =>
      env.DB.prepare(
        `INSERT INTO number_codes (id, created_at, mobile_hash, code_hash, expires_at)
         VALUES (?1, ?2, 'mobile-hash', 'code-hash', ?3)`,
      ).bind(id, minutesAgo(expiredMinutesAgo + 10), minutesAgo(expiredMinutesAgo));
    const session = (id: string, expires: string, revoked: string | null) =>
      env.DB.prepare(
        `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at, revoked_at)
         VALUES (?1, 'client', 'p', ?2, ?2, ?3, ?4)`,
      ).bind(id, minutesAgo(100 * day), expires, revoked);
    await env.DB.batch([
      challenge("old-code", day + 1),
      challenge("recent-code", 60),
      numberCode("old-number-code", day + 1),
      numberCode("recent-number-code", 60),
      session("long-expired", minutesAgo(31 * day), null),
      session("long-revoked", minutesAhead(day), minutesAgo(31 * day)),
      session("recently-revoked", minutesAhead(day), minutesAgo(day)),
      session("live", minutesAhead(day), null),
    ]);

    await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect((await env.DB.prepare("SELECT id FROM otp_challenges").all()).results).toEqual([{ id: "recent-code" }]);
    expect((await env.DB.prepare("SELECT id FROM number_codes").all()).results).toEqual([{ id: "recent-number-code" }]);
    expect((await env.DB.prepare("SELECT id FROM sessions ORDER BY id").all()).results).toEqual([
      { id: "live" },
      { id: "recently-revoked" },
    ]);
  });

  // A revoked phone keeps pointing at its last session; deleting that session
  // under it failed the whole batch, and the cron with it.
  it("frees a phone from a technician session before deleting the session", async () => {
    const day = 24 * 60;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at)
         VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)`,
      ).bind(minutesAgo(40 * day)),
      env.DB.prepare(
        `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at, revoked_at)
         VALUES ('revoked-long-ago', 'technician', 't1', ?1, ?2, ?3, ?2)`,
      ).bind(minutesAgo(40 * day), minutesAgo(31 * day), minutesAhead(50 * day)),
      env.DB.prepare(
        `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at)
         VALUES ('expired-long-ago', 'technician', 't1', ?1, ?2, ?2)`,
      ).bind(minutesAgo(130 * day), minutesAgo(31 * day)),
      env.DB.prepare(
        `INSERT INTO technician_devices (id, technician_id, device_id, session_id, label, created_at, last_seen_at, revoked_at)
         VALUES ('d1', 't1', 'phone-1', 'revoked-long-ago', 'Chrome on Android', ?1, ?2, ?2)`,
      ).bind(minutesAgo(40 * day), minutesAgo(31 * day)),
      env.DB.prepare(
        `INSERT INTO technician_devices (id, technician_id, device_id, session_id, label, created_at, last_seen_at)
         VALUES ('d2', 't1', 'phone-2', 'expired-long-ago', 'Safari on iPhone', ?1, ?2)`,
      ).bind(minutesAgo(130 * day), minutesAgo(31 * day)),
    ]);

    await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect((await env.DB.prepare("SELECT id FROM sessions").all()).results).toEqual([]);
    expect(
      (await env.DB.prepare("SELECT id, session_id, revoked_at FROM technician_devices ORDER BY id").all()).results,
    ).toEqual([
      { id: "d1", session_id: null, revoked_at: minutesAgo(31 * day) },
      { id: "d2", session_id: null, revoked_at: null },
    ]);
  });
});

describe("sweeper: AILabTools credits", () => {
  /** The balance check, as the cron's hourly job runs it. */
  const check = (deps: ReturnType<typeof fakeDependencies>, floor: number, budget = createCallBudget(Infinity)) =>
    checkAilabCredits({ env: sweepEnv().bindings, deps, log: createLogger(), budget }, floor);

  it("reads the balance and alerts below the floor", async () => {
    const deps = fakeDependencies();
    expect(await check(deps, 5000)).toBe(1000); // the stub's two pools, summed
    expect(deps.alerts).toEqual([expect.stringContaining("credits are down to 1000") as string]);
  });

  it("tells ops once, not every hour, until a top-up lifts the balance over the floor", async () => {
    const deps = fakeDependencies();
    await check(deps, 5000);
    await check(deps, 5000);
    expect(deps.alerts).toHaveLength(1);

    await check(deps, 200);
    await check(deps, 5000);
    expect(deps.alerts).toHaveLength(2);
  });

  it("stays quiet above the floor", async () => {
    const deps = fakeDependencies();
    expect(await check(deps, 200)).toBe(1000);
    expect(deps.alerts).toEqual([]);
  });

  it("leaves the balance to the next hour when the cron run has no call left for it", async () => {
    expect(await check(fakeDependencies(), 200, createCallBudget(0))).toBeUndefined();
  });

  it("logs, and does not alert, when the balance cannot be read", async () => {
    const deps = fakeDependencies({ image: { ...fakeDependencies().image, credits: () => Promise.resolve(null) } });
    expect(await check(deps, 200)).toBeNull();
    expect(deps.alerts).toEqual([]);
  });
});

describe("sweeper: erasures", () => {
  it("re-enqueues erased people whose CRM record is not yet blanked, after two minutes, until the last attempt", async () => {
    const people = [
      { id: "pending", erasedAt: minutesAgo(3), crmErasedAt: null, attempts: 1 },
      { id: "just-erased", erasedAt: minutesAgo(1), crmErasedAt: null, attempts: 0 },
      { id: "done", erasedAt: minutesAgo(30), crmErasedAt: minutesAgo(29), attempts: 1 },
      { id: "given-up", erasedAt: minutesAgo(90), crmErasedAt: null, attempts: MAX_SYNC_ATTEMPTS },
    ];
    for (const person of people) {
      await insertPerson(person.id, `erased:${person.id}`);
      await env.DB.prepare("UPDATE people SET erased_at = ?, crm_erased_at = ?, crm_erasure_attempts = ? WHERE id = ?")
        .bind(person.erasedAt, person.crmErasedAt, person.attempts, person.id)
        .run();
    }
    const { bindings, queues } = sweepEnv();

    const summary = await sweep(bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect(summary.erasuresRequeued).toBe(1);
    expect(queues.crm.sent).toEqual([{ erase_person_id: "pending", request_id: "sweeper" }]);
  });
});
