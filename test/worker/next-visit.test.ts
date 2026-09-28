// The next visit, offered and reminded of (src/domain/next-visit.ts, src/policy/next-visit.ts;
// docs/decisions/0086-the-next-visit-is-offered.md): what GET /api/me offers the client next, the first fit's lead
// time and the horizon a visit may be booked within, and the WhatsApp reminder of the next service. NOW is Monday
// 21 September 2026, 12 noon in India, so tomorrow is Tuesday the 22nd. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../src/config/message-templates.ts";
import type { Settings } from "../../src/config/settings.ts";
import { queueNextServiceReminders } from "../../src/domain/next-visit.ts";
import { openSession } from "../../src/domain/sessions.ts";
import type { StaticConfig } from "../../src/guard.ts";
import type { App } from "../../src/http/context.ts";
import { createLogger } from "../../src/log.ts";
import { NEXT_VISIT_DAYS, type NextVisitDays } from "../../src/policy/next-visit.ts";
import type { MessagingProvider } from "../../src/providers/messaging.ts";
import { sendMessage } from "../../src/queues/messaging.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
  savedAddress,
} from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const MOBILE = "+919810000001";
/** 6 pm in India on Monday 21 September, when the evening's reminders begin. */
const EVENING = new Date("2026-09-21T12:30:00Z");

const log = createLogger();

let client: App;
let cookie: string;

/** A visit of the client's: done, or still to happen. Its start is an instant; 04:30 UTC is 10 am in India. */
async function visit(type: string, start: string, status = "completed"): Promise<string> {
  const id = crypto.randomUUID();
  const end = new Date(Date.parse(start) + 90 * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
       window_end, technician_id, fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8, 't1', ?9, ?9)`,
  )
    .bind(id, `fsm-${id}`, `wo-${id}`, PERSON, type, status, start, end, NOW.toISOString())
    .run();
  return id;
}

/** A hold the client has paid for, on its way to FSM (docs/decisions/0068-a-paid-hold-is-kept.md). */
async function paidHold() {
  await env.DB.prepare(
    `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
       gst_percent, state, expires_at, created_at, updated_at, confirmed_at)
     VALUES (?1, ?2, 'service', '2026-09-30', 'morning', 't1', 0, 200000, 200000, 0, 'held', ?3, ?3, ?3, ?3)`,
  )
    .bind(crypto.randomUUID(), PERSON, NOW.toISOString())
    .run();
}

async function pieceDue(day: string) {
  await env.DB.prepare(
    `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, replacement_due_at, synced_at)
     VALUES (?1, ?1, ?2, 'MM-STD-4417-B', '2026-03-01', ?3, ?4)`,
  )
    .bind(crypto.randomUUID(), PERSON, day, NOW.toISOString())
    .run();
}

/** The figures ops set in Settings · Rules, written as the console's save writes them. */
async function opsSet(days: Partial<NextVisitDays>) {
  await env.DB.prepare(
    "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('booking_days', ?1, 'ops@localhost', ?2)",
  )
    .bind(JSON.stringify({ ...NEXT_VISIT_DAYS, ...days }), NOW.toISOString())
    .run();
}

async function consent(granted: boolean) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, 'whatsapp_visits', 'whatsapp-visits-v1', ?3, ?4)`,
  )
    .bind(crypto.randomUUID(), PERSON, granted ? 1 : 0, NOW.toISOString())
    .run();
}

interface Me {
  booking: { types: string[]; next: { type: string; date: string; window: string | null } | null };
  prompt: Record<string, unknown> | null;
}

const me = async (): Promise<Me> => (await request(client, "/api/me", { headers: { Cookie: cookie } })).json<Me>();

const availability = async (query: string) =>
  (await request(client, `/api/availability?${query}`, { headers: { Cookie: cookie } })).json<{
    days: { date: string; windows: { window: string; with: string | null }[] }[];
  }>();

const hold = (body: object) =>
  request(client, "/api/holds", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
    body: JSON.stringify(body),
  });

const reminders = () =>
  env.DB.prepare("SELECT kind, subject_kind, subject_id, state FROM outbound_messages ORDER BY created_at").all();

function recordingProvider() {
  const sent: { to: string; template: string; params: readonly string[] }[] = [];
  const provider: MessagingProvider = {
    send: ({ to, template, params }) => {
      sent.push({ to, template, params });
      return Promise.resolve({ ok: true, providerMessageId: "wa-1" });
    },
    connection: () => Promise.resolve({ open: true }),
  };
  return { provider, sent };
}

function config(messaging: Partial<Settings["messaging"]> = {}): StaticConfig {
  return { ...LOCAL_CONFIG, settings: { ...LOCAL_SETTINGS, messaging: { ...LOCAL_SETTINGS.messaging, ...messaging } } };
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Rohit Malhotra')")
    .bind(PERSON, NOW.toISOString(), MOBILE)
    .run();
  await savedAddress(PERSON);
  client = appFor("local", fakeDependencies(), {}, "client");
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

describe("what the app offers next (GET /api/me)", () => {
  it("offers the next service a month after the last visit, in its window, while nothing is booked", async () => {
    await visit("first_fit", "2026-08-11T04:30:00.000Z");
    await visit("service", "2026-09-10T04:30:00.000Z");
    const home = await me();
    expect(home.booking.next).toEqual({ type: "service", tier: "standard", date: "2026-10-10", window: "morning" });
    expect(home.prompt).toEqual({
      kind: "next_visit",
      type: "service",
      tier: "standard",
      date: "2026-10-10",
      window: "morning",
    });
  });

  it("offers it for tomorrow once the day it fell due has passed", async () => {
    await visit("service", "2026-08-01T08:30:00.000Z");
    expect((await me()).booking.next).toEqual({
      type: "service",
      tier: "standard",
      date: "2026-09-22",
      window: "afternoon",
    });
  });

  it("offers the replacement where the piece falls due first, and not in the evening, where it cannot start", async () => {
    await visit("service", "2026-09-10T11:30:00.000Z"); // 5 pm in India
    await pieceDue("2026-10-05");
    expect((await me()).booking.next).toEqual({
      type: "replacement",
      tier: "standard",
      date: "2026-10-10",
      window: null,
    });
  });

  // ADR 0086, amended by ADR 0085: the visit offered is one of the services ops keep.
  it("offers it as the service the last visit of its kind was, while that is offered, else the kind's first", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
         VALUES ('service', 'premium', 'Premium service visit', 120, 1, 'ops@maneman.in', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('service', 'premium', 300000, 0, '2026-01-01')",
      ),
    ]);
    const last = await visit("service", "2026-09-10T04:30:00.000Z");
    await env.DB.prepare("UPDATE appointments SET tier = 'premium' WHERE id = ?1").bind(last).run();
    expect((await me()).booking.next).toEqual({
      type: "service",
      tier: "premium",
      date: "2026-10-10",
      window: "morning",
    });

    // Retired by the day it would be offered on, it is offered as the kind's first service in the console's order.
    await env.DB.prepare(
      "UPDATE services SET retired_date = '2026-10-01' WHERE kind = 'service' AND tier = 'premium'",
    ).run();
    expect((await me()).booking.next).toMatchObject({ type: "service", tier: "standard" });
  });

  it("offers the service where the piece falls due after it", async () => {
    await visit("service", "2026-09-10T04:30:00.000Z");
    await pieceDue("2026-10-11");
    expect((await me()).booking.next).toMatchObject({ type: "service", date: "2026-10-10" });
  });

  it("offers nothing while a visit is booked, or paid for and on its way to FSM", async () => {
    await visit("service", "2026-09-10T04:30:00.000Z");
    const booked = await visit("service", "2026-10-09T04:30:00.000Z", "scheduled");
    expect((await me()).booking.next).toBeNull();
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(booked).run();
    await paidHold();
    expect((await me()).booking.next).toBeNull();
  });

  it("counts the due day from the cadence ops set", async () => {
    await visit("service", "2026-09-10T04:30:00.000Z");
    await opsSet({ service_cadence: 45 });
    expect((await me()).booking.next).toMatchObject({ type: "service", date: "2026-10-25" });
  });

  it("offers the first fit once the consultation is done, in the window the site's request asked for", async () => {
    await visit("consultation", "2026-09-18T04:30:00.000Z");
    await env.DB.prepare(
      "INSERT INTO first_fit_requests (id, person_id, preferred_window, created_at) VALUES ('f1', ?1, 'afternoon', ?2)",
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    const home = await me();
    expect(home.booking.next).toEqual({ type: "first_fit", tier: "standard", date: "2026-09-22", window: "afternoon" });
    // The first fit is Home's own card, "Book your first fit", and never the prompt beneath it.
    expect(home.prompt).toBeNull();
  });

  it("offers it no sooner than the lead time ops set after the consultation, and no window without a request", async () => {
    await visit("consultation", "2026-09-18T04:30:00.000Z");
    await opsSet({ first_fit_lead: 10 });
    expect((await me()).booking.next).toEqual({
      type: "first_fit",
      tier: "standard",
      date: "2026-09-28",
      window: null,
    });
  });
});

describe("the days a visit may be booked on", () => {
  it("opens a first fit no sooner than the lead time after the consultation, in the strip and in a hold", async () => {
    await visit("consultation", "2026-09-18T04:30:00.000Z");
    await opsSet({ first_fit_lead: 10 });
    const strip = await availability("type=first_fit");
    expect(strip.days[0]?.date).toBe("2026-09-28");
    expect((await hold({ type: "first_fit", date: "2026-09-25", window: "morning" })).status).toBe(422);
    expect((await hold({ type: "first_fit", date: "2026-09-28", window: "morning" })).status).toBe(201);
  });

  it("reaches 45 days from tomorrow, and a strip asked for further on ends there", async () => {
    await visit("service", "2026-09-10T04:30:00.000Z");
    const strip = await availability("type=service&from=2026-11-01");
    expect(strip.days).toHaveLength(14);
    expect(strip.days[0]?.date).toBe("2026-10-23");
    expect(strip.days.at(-1)?.date).toBe("2026-11-05");
    expect(strip.days.at(-1)?.windows.some((each) => each.with !== null)).toBe(true);
    expect((await hold({ type: "service", date: "2026-11-06", window: "morning" })).status).toBe(422);
    expect((await hold({ type: "service", date: "2026-11-05", window: "morning" })).status).toBe(201);
  });

  it("starts the strip on the day asked for, which the app asks for a week before the day it offers", async () => {
    await visit("service", "2026-09-10T04:30:00.000Z");
    const strip = await availability("type=service&from=2026-10-03");
    expect(strip.days.map((day) => day.date).slice(0, 8)).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
    ]);
  });

  it("reaches as far as ops set, and closes the days past it", async () => {
    await visit("service", "2026-09-10T04:30:00.000Z");
    await opsSet({ horizon: 14 });
    const strip = await availability("type=service&from=2026-10-01");
    expect(strip.days[0]?.date).toBe("2026-09-22");
    expect(strip.days.at(-1)?.date).toBe("2026-10-05");
    expect((await hold({ type: "service", date: "2026-10-06", window: "morning" })).status).toBe(422);
  });
});

describe("the reminder of the next service", () => {
  it("is written from 6 pm for a last visit whose service falls due in a week, once", async () => {
    const done = await visit("service", "2026-08-29T04:30:00.000Z"); // due Monday 28 September
    expect(await queueNextServiceReminders(env.DB, NOW, NEXT_VISIT_DAYS)).toEqual([]);
    expect(await queueNextServiceReminders(env.DB, EVENING, NEXT_VISIT_DAYS)).toHaveLength(1);
    expect(await queueNextServiceReminders(env.DB, new Date(EVENING.getTime() + 60 * 60_000), NEXT_VISIT_DAYS)).toEqual(
      [],
    );
    expect((await reminders()).results).toEqual([
      { kind: "next_service_reminder", subject_kind: "appointment", subject_id: done, state: "queued" },
    ]);
  });

  it("is written for none due in eight days, none already past due, and none with a visit booked or paid for", async () => {
    await visit("service", "2026-08-30T04:30:00.000Z"); // due in eight days
    expect(await queueNextServiceReminders(env.DB, EVENING, NEXT_VISIT_DAYS)).toEqual([]);
    await env.DB.prepare("DELETE FROM appointments").run();
    await visit("service", "2026-08-20T04:30:00.000Z"); // due Saturday, two days ago
    expect(await queueNextServiceReminders(env.DB, EVENING, NEXT_VISIT_DAYS)).toEqual([]);
    await env.DB.prepare("DELETE FROM appointments").run();
    await visit("service", "2026-08-29T04:30:00.000Z");
    const booked = await visit("service", "2026-09-26T04:30:00.000Z", "scheduled");
    expect(await queueNextServiceReminders(env.DB, EVENING, NEXT_VISIT_DAYS)).toEqual([]);
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(booked).run();
    await paidHold();
    expect(await queueNextServiceReminders(env.DB, EVENING, NEXT_VISIT_DAYS)).toEqual([]);
    expect((await reminders()).results).toEqual([]);
  });

  it("is written from the hour ops set for reminders, not before it", async () => {
    await visit("service", "2026-08-29T04:30:00.000Z");
    expect(await queueNextServiceReminders(env.DB, EVENING, NEXT_VISIT_DAYS, 19)).toEqual([]);
    const seven = new Date(EVENING.getTime() + 60 * 60_000);
    expect(await queueNextServiceReminders(env.DB, seven, NEXT_VISIT_DAYS, 19)).toHaveLength(1);
  });

  it("follows the days ops set before the due day", async () => {
    await visit("service", "2026-08-29T04:30:00.000Z"); // due in seven days
    expect(await queueNextServiceReminders(env.DB, EVENING, { ...NEXT_VISIT_DAYS, reminder_before_due: 5 })).toEqual(
      [],
    );
    expect(
      await queueNextServiceReminders(env.DB, EVENING, { ...NEXT_VISIT_DAYS, reminder_before_due: 7 }),
    ).toHaveLength(1);
  });

  it("is sent with the client's consent to WhatsApp about their visits, saying what falls due when", async () => {
    await visit("service", "2026-08-29T04:30:00.000Z");
    await consent(true);
    const [id = ""] = await queueNextServiceReminders(env.DB, EVENING, NEXT_VISIT_DAYS);
    const { provider, sent } = recordingProvider();
    await sendMessage(env.DB, config({ allowlist: [MOBILE] }), fakeDependencies({ messaging: provider }), log, id);
    expect(sent).toEqual([
      { to: MOBILE, template: "next_visit_due_v1", params: ["Rohit", "service visit", "Mon 28 Sep"] },
    ]);
    expect(renderMessage("next_visit_due_v1", sent[0]?.params ?? [])).toBe(
      "Hello Rohit, your next service visit is due on Mon 28 Sep. You can book it in the Mane Man app.",
    );
  });

  it("names the replacement where the piece falls due first", async () => {
    await visit("service", "2026-08-29T04:30:00.000Z");
    await pieceDue("2026-09-25");
    await consent(true);
    const [id = ""] = await queueNextServiceReminders(env.DB, EVENING, NEXT_VISIT_DAYS);
    const { provider, sent } = recordingProvider();
    await sendMessage(env.DB, config({ allowlist: [MOBILE] }), fakeDependencies({ messaging: provider }), log, id);
    expect(sent[0]?.params).toEqual(["Rohit", "replacement", "Mon 28 Sep"]);
  });

  it("is not sent without that consent, or once it is switched off, and says why", async () => {
    await visit("service", "2026-08-29T04:30:00.000Z");
    await consent(true);
    await consent(false);
    const [id = ""] = await queueNextServiceReminders(env.DB, EVENING, NEXT_VISIT_DAYS);
    const { provider, sent } = recordingProvider();
    await sendMessage(env.DB, config({ allowlist: [MOBILE] }), fakeDependencies({ messaging: provider }), log, id);
    expect(sent).toEqual([]);
    const row = await env.DB.prepare("SELECT state, last_error FROM outbound_messages").first();
    expect(row).toEqual({ state: "skipped", last_error: "no consent to WhatsApp about visits" });
  });

  it("is not sent once a visit is booked after it was written", async () => {
    await visit("service", "2026-08-29T04:30:00.000Z");
    await consent(true);
    const [id = ""] = await queueNextServiceReminders(env.DB, EVENING, NEXT_VISIT_DAYS);
    await visit("service", "2026-09-26T04:30:00.000Z", "scheduled");
    const { provider, sent } = recordingProvider();
    await sendMessage(env.DB, config({ allowlist: [MOBILE] }), fakeDependencies({ messaging: provider }), log, id);
    expect(sent).toEqual([]);
    const row = await env.DB.prepare("SELECT state, last_error FROM outbound_messages").first();
    expect(row).toEqual({ state: "skipped", last_error: "a visit is booked" });
  });

  it("rides the five-minute cron, which queues what it wrote", async () => {
    await visit("service", "2026-08-29T04:30:00.000Z");
    const job = CRON_JOBS.find((each) => each.name === "next_service_reminders");
    if (job === undefined) throw new Error("the cron has no next_service_reminders job");
    const messages = fakeQueue();
    const outcomes = await runCronJobs([job], {
      env: { ...env, MESSAGE_QUEUE: messages },
      deps: fakeDependencies({ now: () => EVENING }),
      config: LOCAL_CONFIG,
      log,
    });
    expect(outcomes).toEqual([{ job: "next_service_reminders", ok: true }]);
    expect(messages.sent).toEqual([{ message_id: expect.any(String) as string, request_id: "next-service-reminders" }]);
  });
});
