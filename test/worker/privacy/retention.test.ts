// What the retention periods let go of (src/domain/privacy/retention.ts, src/scheduled/retention.ts). NOW is Monday
// 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  blankOldCoordinates,
  dormantPeople,
  dropExpired,
  dropLaunchedWaitlist,
} from "../../../src/domain/privacy/retention.ts";
import { createLogger } from "../../../src/log.ts";
import { CRON_JOBS } from "../../../src/scheduled/cron.ts";
import { runCronJobs } from "../../../src/scheduled/cron-runner.ts";
import { fakeDependencies, fakeQueue, LOCAL_CONFIG, markDatabase, NOW } from "../helpers.ts";
import { aVisit } from "../fixtures/index.ts";

const LONG_AGO = "2025-08-01T06:30:00.000Z";
const LAST_MONTH = "2026-08-21T06:30:00.000Z";

async function person(id: string, createdAt = LONG_AGO): Promise<void> {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Staging test')")
    .bind(id, createdAt, `+9198100${id.padStart(5, "0").slice(-5)}`)
    .run();
}

beforeEach(async () => {
  await markDatabase();
});

// Names and numbers from the site's forms, the waitlist and check-in coordinates were kept for ever.
describe("a person who never became a client", () => {
  it("is erased a year after their last sign of life, and not before", async () => {
    await person("10001");
    await person("10002", LAST_MONTH);
    await person("10003");
    await env.DB.prepare(
      `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at)
       VALUES ('s-1', 'client', '10003', ?1, ?2, ?3)`,
    )
      .bind(LONG_AGO, LAST_MONTH, "2026-12-01T00:00:00.000Z")
      .run();

    expect(await dormantPeople(env.DB, NOW, 10)).toEqual(["10001"]);
  });

  it("is never one who had a visit or a payment, or waits on a waitlist", async () => {
    await person("20001");
    await person("20002");
    await aVisit({
      id: "ap-1",
      person_id: "20001",
      type: "consultation",
      status: "completed",
      window_start: LONG_AGO,
      window_end: LONG_AGO,
      synced_at: LONG_AGO,
    });
    await env.DB.prepare(
      `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, created_at)
       VALUES ('w-1', '122018', '20002', ?1, ?1)`,
    )
      .bind(LONG_AGO)
      .run();

    expect(await dormantPeople(env.DB, NOW, 10)).toEqual([]);
  });
});

describe("the hourly retention job", () => {
  it("erases a dormant person as any erasure does, in the system's name", async () => {
    await person("50001");
    const crm = fakeQueue();
    const job = CRON_JOBS.filter((each) => each.name === "retention");

    await runCronJobs(job, {
      env: { ...env, CRM_QUEUE: crm },
      deps: fakeDependencies(),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });

    const erased = await env.DB.prepare("SELECT name, mobile_e164, erased_at FROM people WHERE id = '50001'").first();
    expect(erased).toMatchObject({ erased_at: NOW.toISOString() });
    expect(erased?.name).not.toBe("Staging test");
    const audit = await env.DB.prepare(
      "SELECT actor_kind, actor, action FROM audit_log WHERE subject_id = '50001'",
    ).first();
    expect(audit).toEqual({ actor_kind: "system", actor: "retention", action: "person.erase" });
  });
});

describe("a waitlist entry", () => {
  it("goes a year after its area launched, and stays while the area is newer or unserved", async () => {
    await person("30001");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR REPLACE INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES
           ('110001', 'Old area', 'Delhi', 1, '2025-06-01'), ('110002', 'New area', 'Delhi', 1, '2026-06-01'),
           ('110003', 'Not yet', 'Delhi', 0, NULL)`,
      ),
      env.DB.prepare(
        `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, created_at) VALUES
           ('w-old', '110001', '30001', ?1, ?1), ('w-new', '110002', '30001', ?1, ?1), ('w-not', '110003', '30001', ?1, ?1)`,
      ).bind(LONG_AGO),
    ]);

    expect(await dropLaunchedWaitlist(env.DB, NOW)).toBe(1);
    const left = await env.DB.prepare("SELECT id FROM waitlist_entries ORDER BY id").all();
    expect(left.results).toEqual([{ id: "w-new" }, { id: "w-not" }]);
  });
});

describe("a check-in's coordinates", () => {
  async function checkIn(id: string, at: string): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, accuracy_m, distance_m, radius_m, passed,
         created_at) VALUES (?1, 'ap-c', 't1', ?2, 28.4, 77.07, 12, 40, 200, 1, ?2)`,
    )
      .bind(id, at)
      .run();
  }

  beforeEach(async () => {
    await person("40001");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, synced_at)
         VALUES ('ap-c', 'ap-c', '40001', 'service', 'completed', ?1, ?1, ?1)`,
      ).bind(LONG_AGO),
    ]);
  });

  it("are blanked once no charge can be disputed over them, and the distance stays", async () => {
    await checkIn("c-old", "2026-07-01T06:30:00.000Z");
    await checkIn("c-recent", LAST_MONTH);

    expect(await blankOldCoordinates(env.DB, NOW, 30)).toBe(1);
    const rows = await env.DB.prepare("SELECT id, lat, lng, accuracy_m, distance_m FROM checkins ORDER BY id").all();
    expect(rows.results).toEqual([
      { id: "c-old", lat: null, lng: null, accuracy_m: null, distance_m: 40 },
      { id: "c-recent", lat: 28.4, lng: 77.07, accuracy_m: 12, distance_m: 40 },
    ]);
  });

  it("stay while they are the evidence of a no-show still to rule on", async () => {
    await checkIn("c-case", "2026-07-01T06:30:00.000Z");
    await env.DB.prepare(
      `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, created_at)
       VALUES ('n-1', 'c-case', 'ap-c', ?1, ?1, ?1)`,
    )
      .bind("2026-07-01T06:30:00.000Z")
      .run();

    expect(await blankOldCoordinates(env.DB, NOW, 30)).toBe(0);
  });
});

// Resolved alerts, Razorpay's event IDs, strangers' chats, sent messages and the audit log grew for ever.
describe("the tables that only grew", () => {
  const OLD = "2024-06-01T06:30:00.000Z";
  const ids = async (sql: string) =>
    (await env.DB.prepare(sql).all<{ id: string | number }>()).results.map((row) => row.id);

  it("lose their rows past their periods, and keep the rest", async () => {
    await person("1");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO alerts (id, key, message, count, first_seen_at, last_seen_at, resolved_at) VALUES
           ('gone', 'k1', 'm', 1, ?1, ?1, ?1), ('kept', 'k2', 'm', 1, ?2, ?2, ?2), ('open', 'k3', 'm', 1, ?1, ?1, NULL)`,
      ).bind(OLD, LAST_MONTH),
      env.DB.prepare(
        "INSERT INTO razorpay_events (event_id, event, received_at) VALUES ('gone', 'payment.captured', ?1), ('kept', 'payment.captured', ?2)",
      ).bind(OLD, LAST_MONTH),
      env.DB.prepare(
        `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, created_at, updated_at)
         VALUES ('gone', NULL, '+919811100001', 'closed', ?1, ?1, ?1, ?1),
                ('open', NULL, '+919811100002', 'open', ?1, ?1, ?1, ?1),
                ('client', '1', '+919811100003', 'closed', ?1, ?1, ?1, ?1)`,
      ).bind(OLD),
      env.DB.prepare(
        `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at)
         VALUES ('m1', 'gone', 'in', 'client', 'Hello', ?1, ?1), ('m2', 'client', 'in', 'client', 'Hello', ?1, ?1)`,
      ).bind(OLD),
      env.DB.prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state)
         VALUES ('gone', ?1, '1', 'visit_reminder', 'appointment', 'a1', 'sent'),
                ('kept', ?2, '1', 'visit_reminder', 'appointment', 'a2', 'sent')`,
      ).bind(OLD, LAST_MONTH),
      env.DB.prepare(
        `INSERT INTO audit_log (id, at, surface, actor_kind, actor, action) VALUES
           (900001, ?1, 'ops', 'system', 'test', 'test.old'), (900002, ?2, 'ops', 'system', 'test', 'test.new')`,
      ).bind(OLD, LAST_MONTH),
    ]);

    expect(await dropExpired(env.DB, NOW)).toBe(6);
    expect(await ids("SELECT id FROM alerts ORDER BY id")).toEqual(["kept", "open"]);
    expect(await ids("SELECT event_id AS id FROM razorpay_events")).toEqual(["kept"]);
    expect(await ids("SELECT id FROM conversations ORDER BY id")).toEqual(["client", "open"]);
    expect(await ids("SELECT id FROM chat_messages")).toEqual(["m2"]);
    expect(await ids("SELECT id FROM outbound_messages")).toEqual(["kept"]);
    expect(await ids("SELECT id FROM audit_log WHERE id >= 900001")).toEqual([900002]);
  });

  it("keeps the audit log append-only for its two years", async () => {
    await env.DB.prepare(
      "INSERT INTO audit_log (id, at, surface, actor_kind, actor, action) VALUES (900003, ?1, 'ops', 'system', 'test', 'test.new')",
    )
      .bind(LAST_MONTH)
      .run();
    await expect(env.DB.prepare("DELETE FROM audit_log WHERE id = 900003").run()).rejects.toThrow(/append-only/);
  });
});
