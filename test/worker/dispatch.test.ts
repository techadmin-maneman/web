// The dispatch board's writes under real conditions: a technician-only change,
// a visit with no room, two moves at once, and a client who cannot be messaged.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and
// address here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { recordUtilisation } from "../../src/domain/dispatch.ts";
import { NO_VISITS_CONSENT } from "../../src/domain/visit-messages.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const ROHIT = "11111111-1111-4111-8111-111111111111";
const IMRAN = "33333333-3333-4333-8333-333333333331";
const SAMEER = "33333333-3333-4333-8333-333333333332";

const FIT = "22222222-2222-4222-8222-222222222221";
const REPLACEMENT = "22222222-2222-4222-8222-222222222222";
/** Two service visits, for the moves that meet each other. */
const A = "22222222-2222-4222-8222-2222222222a1";
const B = "22222222-2222-4222-8222-2222222222b1";

const WEDNESDAY = "2026-09-23";

/** Tuesday 22 September in India, as UTC: each half-slot's start (docs/decisions/0035-window-slot-map.md). */
const TUESDAY = {
  "09:00": "2026-09-22T03:30:00.000Z",
  "10:30": "2026-09-22T05:00:00.000Z",
  "12:00": "2026-09-22T06:30:00.000Z",
  "14:00": "2026-09-22T08:30:00.000Z",
} as const;

const MINUTES = { consultation: 60, service: 90, replacement: 135, first_fit: 180 } as const;
type Kind = keyof typeof MINUTES;

let ops: App;
let messageQueue: ReturnType<typeof fakeQueue>;

async function insertJob(
  id: string,
  options: {
    type: Kind;
    start: string;
    technician: string | null;
    person?: string | null;
    status?: string;
    city?: string;
    pincode?: string;
    /** A visit FSM never held, whose record is our own database. */
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
       service_city, service_pincode, synced_at)
     VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  )
    .bind(
      id,
      options.person === undefined ? ROHIT : options.person,
      options.type,
      options.status ?? "scheduled",
      options.start,
      new Date(Date.parse(options.start) + MINUTES[options.type] * 60_000).toISOString(),
      options.technician,
      options.city ?? "Gurgaon",
      options.pincode ?? "122018",
      NOW.toISOString(),
    )
    .run();
}

beforeEach(async () => {
  await markDatabase();
  messageQueue = fakeQueue();
  ops = appFor("local", fakeDependencies(), {}, "ops");

  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, updated_at)
     VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Sec 40–65', ?3),
            (?2, ?2, 'Sameer Bhatt', 'SB', 1, 'Sec 1–39', ?3)`,
  )
    .bind(IMRAN, SAMEER, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(ROHIT, NOW.toISOString())
    .run();
});

const bindings = () => ({ MESSAGE_QUEUE: messageQueue }) as unknown as Partial<Env>;

const opsPost = (path: string, body: unknown, app: App = ops) =>
  request(
    app,
    path,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    bindings(),
  );

/** The job as it stands now, which is what a board loaded now would show. */
const shown = (id: string) =>
  env.DB.prepare("SELECT technician_id, window_start FROM appointments WHERE id = ?1")
    .bind(id)
    .first<{ technician_id: string | null; window_start: string }>();

/** A move sent from a board that shows the job as it stands, unless the body says otherwise. */
async function move(body: { appointment_id: string } & Record<string, unknown>, app: App = ops): Promise<Response> {
  const job = await shown(body.appointment_id);
  return opsPost(
    "/api/dispatch/move",
    { expected_technician_id: job?.technician_id ?? null, expected_starts_at: job?.window_start, ...body },
    app,
  );
}

describe("a change of technician alone", () => {
  // BIZ-18: a first fit at 12:00 given to a technician whose replacement runs from 10:30 to 12:45.
  // His afternoon window is free, but the first fit's own half-slots are not.
  it("keeps the visit's own time, and refuses it where that time is taken, as not fitting", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });
    await insertJob(REPLACEMENT, { type: "replacement", start: TUESDAY["10:30"], technician: SAMEER });

    const sameWindow = await move({
      appointment_id: FIT,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "afternoon",
      reason: "zone_rebalance",
    });
    const noTime = await move({
      appointment_id: FIT,
      technician_id: SAMEER,
      reason: "zone_rebalance",
    });

    for (const answer of [sameWindow, noTime]) {
      expect(answer.status).toBe(409);
      expect(await answer.json()).toMatchObject({ error: { code: "does_not_fit" } });
    }
    expect(await shown(FIT)).toEqual({ technician_id: IMRAN, window_start: TUESDAY["12:00"] });
  });

  it("gives the visit to the other technician at the same time, and messages nobody", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });

    const answer = await move({
      appointment_id: FIT,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "afternoon",
      reason: "zone_rebalance",
    });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ client_notice: "unchanged" });
    // The time does not move, so the client has nothing to be told.
    expect(await shown(FIT)).toEqual({ technician_id: SAMEER, window_start: TUESDAY["12:00"] });
    expect(messageQueue.sent).toEqual([]);
    const messages = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_messages").first<{ n: number }>();
    expect(messages?.n).toBe(0);
  });
});

describe("a visit with no room", () => {
  // OPS-06: a first fit takes four half-slots, and the evening has two.
  it("refuses a first fit in an empty evening as not fitting, not as a clash", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });

    const answer = await move({
      appointment_id: FIT,
      technician_id: SAMEER,
      date: "2026-09-23",
      window: "evening",
      reason: "client_asked",
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "does_not_fit" } });
    expect(await shown(FIT)).toEqual({ technician_id: IMRAN, window_start: TUESDAY["12:00"] });
  });

  it("places a visit moved to another day wherever that window has room", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });
    // Sameer's Wednesday replacement runs from 10:30 to 12:45, into the afternoon's first two half-slots.
    await insertJob(REPLACEMENT, { type: "replacement", start: "2026-09-23T05:00:00.000Z", technician: SAMEER });

    const answer = await move({
      appointment_id: FIT,
      technician_id: SAMEER,
      date: "2026-09-23",
      window: "afternoon",
      reason: "client_asked",
    });

    expect(answer.status).toBe(200);
    expect(await shown(FIT)).toEqual({ technician_id: SAMEER, window_start: "2026-09-23T08:30:00.000Z" });
    expect((await claims()).results).toEqual([]);
  });
});

const claims = () =>
  env.DB.prepare("SELECT technician_id, date, claim, hold_id, move_id FROM slot_claims ORDER BY claim").all<{
    technician_id: string;
    date: string;
    claim: string;
    hold_id: string | null;
    move_id: string | null;
  }>();

/** A client's hold on Sameer's Wednesday morning from 09:00, paid for or not, with its claims. */
async function holdOnWednesday(options: { paid: boolean; expiresAt: string }): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
         gst_percent, state, expires_at, created_at, updated_at, confirmed_at)
       VALUES (?1, ?2, 'service', ?3, 'morning', ?4, 0, 210000, 200000, 5, 'held', ?5, ?6, ?6, ?7)`,
    ).bind(id, ROHIT, WEDNESDAY, SAMEER, options.expiresAt, NOW.toISOString(), options.paid ? NOW.toISOString() : null),
    ...["unit:0", "unit:1", "window:morning"].map((claim) =>
      env.DB.prepare("INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES (?1, ?2, ?3, ?4)").bind(
        SAMEER,
        WEDNESDAY,
        claim,
        id,
      ),
    ),
  ]);
  return id;
}

const toSameerWednesdayMorning = (id: string) => ({
  appointment_id: id,
  technician_id: SAMEER,
  date: WEDNESDAY,
  window: "morning",
  reason: "zone_rebalance",
});

const minutesBeforeNow = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const holdState = async (id: string) =>
  (await env.DB.prepare("SELECT state FROM slot_holds WHERE id = ?1").bind(id).first<{ state: string }>())?.state;

describe("a move and the time it goes to", () => {
  beforeEach(async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
    await insertJob(B, { type: "service", start: TUESDAY["12:00"], technician: IMRAN });
  });

  // ADR 0068: a paid hold keeps its time until it is booked or refunded, whatever else happens.
  it("never lets go of a paid hold's time, nor writes over it", async () => {
    const hold = await holdOnWednesday({ paid: true, expiresAt: minutesBeforeNow(60) });

    const answer = await move(toSameerWednesdayMorning(A));

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "clash" } });
    expect((await claims()).results.map((claim) => claim.hold_id)).toEqual([hold, hold, hold]);
    expect(await holdState(hold)).toBe("held");
  });

  it("lets go of a hold nobody paid for, whose time ran out, to make the move", async () => {
    const hold = await holdOnWednesday({ paid: false, expiresAt: minutesBeforeNow(10) });

    const answer = await move(toSameerWednesdayMorning(A));

    expect(answer.status).toBe(200);
    expect(await holdState(hold)).toBe("released");
  });
});

// FEO-05: two ops users on the same board, the second working from what he loaded a while ago.
describe("a move made from a board that has gone stale", () => {
  beforeEach(async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
  });

  it("is refused before anything is written, naming what changed", async () => {
    const technician = await move({ ...toSameerWednesdayMorning(A), expected_technician_id: SAMEER });
    const time = await move({ ...toSameerWednesdayMorning(A), expected_starts_at: TUESDAY["12:00"] });
    const both = await move({
      ...toSameerWednesdayMorning(A),
      expected_technician_id: SAMEER,
      expected_starts_at: TUESDAY["12:00"],
    });

    expect(technician.status).toBe(409);
    expect(await technician.json()).toMatchObject({ error: { code: "superseded", fields: ["technician"] } });
    expect(await time.json()).toMatchObject({ error: { code: "superseded", fields: ["time"] } });
    expect(await both.json()).toMatchObject({ error: { code: "superseded", fields: ["technician", "time"] } });
    expect(await shown(A)).toEqual({ technician_id: IMRAN, window_start: TUESDAY["09:00"] });
  });

  it("assigns a job from the tray only while it is still in the tray", async () => {
    await insertJob(B, { type: "service", start: TUESDAY["12:00"], technician: null });
    const assign = (technician: string) =>
      opsPost("/api/dispatch/assign", {
        appointment_id: B,
        technician_id: technician,
        date: "2026-09-22",
        window: "afternoon",
        reason: "client_asked",
        expected_technician_id: null,
        expected_starts_at: TUESDAY["12:00"],
      });

    expect((await assign(SAMEER)).status).toBe(200);
    const again = await assign(IMRAN);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "superseded", fields: ["technician"] } });
    expect(await shown(B)).toEqual({ technician_id: SAMEER, window_start: TUESDAY["12:00"] });
  });
});

interface BoardBody {
  from: string;
  technicians: {
    technician_id: string;
    days: { date: string; blocks: Record<string, unknown>[] }[];
  }[];
  unassigned: Record<string, unknown>[];
  utilisation: { date: string; percent: number }[];
  city: string | null;
  cities: string[];
}

const board = async (query: string): Promise<BoardBody> =>
  (await request(ops, `/api/dispatch?${query}`, {}, bindings())).json<BoardBody>();

// BIZ-20: "the operating figure for the model's weekend-share assumption, so it
// is also written to events daily". Finished jobs fell out of it, a technician
// on leave still counted as a day's capacity, and the city asked for was ignored.
describe("the utilisation at each column's head", () => {
  it("counts the jobs worked and in hand, over the technicians working that day, in the city asked for", async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN, status: "completed" });
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN, status: "in_progress" });
    await insertJob(B, {
      type: "service",
      start: "2026-09-22T10:30:00.000Z",
      technician: IMRAN,
      city: "Delhi",
      pincode: "110017",
    });
    await insertJob(REPLACEMENT, {
      type: "replacement",
      start: TUESDAY["10:30"],
      technician: SAMEER,
      status: "cancelled",
    });
    expect((await opsPost(`/api/technicians/${SAMEER}/leave`, { from: "2026-09-22", to: "2026-09-22" })).status).toBe(
      200,
    );

    const gurgaon = await board("from=2026-09-22&city=Gurgaon");
    const everywhere = await board("from=2026-09-22");

    // Imran alone works on Tuesday, four slots. Gurgaon's jobs take three of them; the Delhi visit is the fourth.
    expect(gurgaon.utilisation[0]).toEqual({ date: "2026-09-22", percent: 75 });
    expect(everywhere.utilisation[0]).toEqual({ date: "2026-09-22", percent: 100 });
  });

  it("draws a finished job where it was worked, and writes the day's figure as it was worked", async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN, status: "completed" });

    const tuesday = (await board("from=2026-09-22")).technicians[0]?.days[0]?.blocks;
    expect(tuesday).toMatchObject([{ appointment_id: A, status: "completed" }]);

    // Written the day after: one slot of the eight two technicians have.
    expect(await recordUtilisation(env.DB, new Date("2026-09-23T06:30:00.000Z"))).toBe("2026-09-22");
    const event = await env.DB.prepare("SELECT payload_json FROM events WHERE name = 'dispatch_utilisation'").first<{
      payload_json: string;
    }>();
    expect(JSON.parse(event?.payload_json ?? "{}")).toMatchObject({ percent: 13, technicians: 2 });
  });
});

/** Rohit's word on WhatsApp about his visits, as the app's switch records it. */
const agreeToVisitMessages = (granted: boolean) =>
  env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, 'whatsapp_visits', 'whatsapp-visits-v1', ?3, ?4)`,
  )
    .bind(crypto.randomUUID(), ROHIT, granted ? 1 : 0, NOW.toISOString())
    .run();

interface TaskGroupBody {
  group: string;
  tasks: {
    id: string;
    person: { id: string; name: string; mobile?: string } | null;
    detail: string | null;
    visit?: { id: string; starts_at: string };
  }[];
}

const untoldTasks = async () => {
  const body = await (await request(ops, "/api/tasks", {}, bindings())).json<{ groups: TaskGroupBody[] }>();
  return body.groups.find((group) => group.group === "untold_move")?.tasks ?? [];
};

// OPS-01: "The client has been messaged" was shown after every move, while the
// message went only to a client who had agreed to WhatsApp about his visits.
describe("telling the client of a move", () => {
  beforeEach(async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
  });

  it("messages a client who agreed to WhatsApp about his visits, and says so", async () => {
    await agreeToVisitMessages(true);

    const answer = await move(toSameerWednesdayMorning(A));

    expect(await answer.json()).toMatchObject({ client_notice: "messaged" });
    expect(messageQueue.sent).toHaveLength(1);
    expect(await untoldTasks()).toEqual([]);
  });

  it("messages nobody who has not agreed, says ops must call, and keeps a task until they have", async () => {
    await agreeToVisitMessages(true);
    await agreeToVisitMessages(false);

    const answer = await move(toSameerWednesdayMorning(A));
    const { move_id: moveId, client_notice: notice } = await answer.json<{ move_id: string; client_notice: string }>();

    expect(notice).toBe("call");
    expect(messageQueue.sent).toEqual([]);
    const messages = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_messages").first<{ n: number }>();
    expect(messages?.n).toBe(0);
    // OIA-03, BK-21: the task carries the number to call and the visit, so it is settled from the task itself.
    expect(await untoldTasks()).toEqual([
      expect.objectContaining({
        id: moveId,
        person: { id: ROHIT, name: "Rohit Malhotra", mobile: "+919810000001" },
        detail: "2026-09-23T03:30:00.000Z no_consent",
        visit: { id: A, starts_at: "2026-09-23T03:30:00.000Z" },
      }),
    ]);

    const told = await opsPost(`/api/dispatch/moves/${moveId}/told`, {});
    expect(told.status).toBe(200);
    expect(await untoldTasks()).toEqual([]);
    const audit = await env.DB.prepare(
      "SELECT action, subject_id FROM audit_log WHERE action = 'dispatch.client_told'",
    ).first<{ action: string; subject_id: string }>();
    expect(audit?.subject_id).toBe(moveId);
  });

  it("treats a client who never answered the question as one who has not agreed", async () => {
    const answer = await move(toSameerWednesdayMorning(A));
    expect(await answer.json()).toMatchObject({ client_notice: "call" });
  });

  it("counts a message that was never sent as the client not told", async () => {
    await agreeToVisitMessages(true);
    const { move_id: moveId } = await (await move(toSameerWednesdayMorning(A))).json<{ move_id: string }>();

    // The consumer found the consent withdrawn by the time it sent.
    await env.DB.prepare("UPDATE outbound_messages SET state = 'skipped', last_error = ?1")
      .bind(NO_VISITS_CONSENT)
      .run();

    expect(await untoldTasks()).toEqual([
      expect.objectContaining({ id: moveId, detail: "2026-09-23T03:30:00.000Z no_consent" }),
    ]);
  });

  // BK-20: a WhatsApp that failed read as "not on WhatsApp", for a client who had agreed to it.
  it("says the WhatsApp did not go, not that the client never agreed, where it failed", async () => {
    await agreeToVisitMessages(true);
    const { move_id: moveId } = await (await move(toSameerWednesdayMorning(A))).json<{ move_id: string }>();

    await env.DB.prepare("UPDATE outbound_messages SET state = 'failed', last_error = 'the bridge is down'").run();

    expect(await untoldTasks()).toEqual([
      expect.objectContaining({ id: moveId, detail: "2026-09-23T03:30:00.000Z not_sent" }),
    ]);
    const block = (await board("from=2026-09-22")).technicians[1]?.days[1]?.blocks[0];
    expect(block?.untold).toEqual({ move_id: moveId, starts_at: "2026-09-23T03:30:00.000Z", reason: "not_sent" });
  });

  it("drops the task when a later move tells the client, or the visit has gone", async () => {
    const { move_id: first } = await (await move(toSameerWednesdayMorning(A))).json<{ move_id: string }>();
    expect((await untoldTasks()).map((task) => task.id)).toEqual([first]);

    await agreeToVisitMessages(true);
    await move({ ...toSameerWednesdayMorning(A), date: "2026-09-24" });
    expect(await untoldTasks()).toEqual([]);

    await agreeToVisitMessages(false);
    await move({ ...toSameerWednesdayMorning(A), date: "2026-09-25" });
    expect(await untoldTasks()).toHaveLength(1);
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(A).run();
    expect(await untoldTasks()).toEqual([]);
  });

  it("refuses to record a call for a move nobody needed to call about", async () => {
    await agreeToVisitMessages(true);
    const { move_id: moveId } = await (await move(toSameerWednesdayMorning(A))).json<{ move_id: string }>();

    expect((await opsPost(`/api/dispatch/moves/${moveId}/told`, {})).status).toBe(404);
    expect((await opsPost(`/api/dispatch/moves/${crypto.randomUUID()}/told`, {})).status).toBe(404);
  });
});

// OPS-05, OPS-12 and ADR 0068: nothing on the board led to the client, the
// drawer had no badge, and the area came from the address, not the visit.
describe("what the board carries of each visit", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Sector 65', 'Gurgaon', 1)",
      ),
      env.DB.prepare(
        `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('referrer-1', ?1, '+919810000002', 'Vikram Sethi')`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        "INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('VIKRAM1', 'referrer-1', ?1, ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, created_at, updated_at)
         VALUES ('attr-1', 'VIKRAM1', ?1, ?2, 'consultation', ?2, ?2)`,
      ).bind(ROHIT, NOW.toISOString()),
    ]);
  });

  it("names the client in full, with his number, his word on WhatsApp, who referred him, and the badge", async () => {
    await agreeToVisitMessages(true);
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
    await insertJob(B, { type: "service", start: TUESDAY["12:00"], technician: null });

    const week = await board("from=2026-09-22");
    const person = {
      id: ROHIT,
      name: "Rohit Malhotra",
      mobile: "+919810000001",
      whatsapp_visits: true,
      referred_by: "Vikram Sethi",
    };
    expect(week.technicians[0]?.days[0]?.blocks[0]).toMatchObject({
      appointment_id: A,
      client: "Rohit M.",
      sector: "Sector 65",
      pincode: "122018",
      badge: "prepaid",
      person,
      untold: null,
    });
    expect(week.unassigned[0]).toMatchObject({ appointment_id: B, client: "Rohit M.", badge: "prepaid", person });
  });

  // The move panel says the visit is inside its notice, which each booking keeps as it was sold
  // (docs/decisions/0088-every-policy-in-the-console.md); a visit no hold sold takes the notice in force.
  it("carries the notice each visit was sold under, or the one in force for a visit no hold sold", async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
    await insertJob(B, { type: "service", start: TUESDAY["12:00"], technician: IMRAN });
    await env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at, appointment_id, change_notice_hours)
       VALUES ('hold-1', ?1, 'service', '2026-09-22', 'morning', ?2, 0, 200000, 200000, 0, 'booked', ?3, ?3, ?3, ?4, 12)`,
    )
      .bind(ROHIT, IMRAN, NOW.toISOString(), A)
      .run();
    await env.DB.prepare(
      "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('change_notice_hours', '48', 'ops', ?1)",
    )
      .bind(NOW.toISOString())
      .run();
    ops = appFor("local", fakeDependencies(), {}, "ops");

    const blocks = (await board("from=2026-09-22")).technicians[0]?.days[0]?.blocks;
    expect(blocks?.map((block) => block.notice_hours)).toEqual([12, 48]);
  });

  it("marks a visit spent from a credit, and one the price book charges nothing for", async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
    await insertJob(B, { type: "consultation", start: TUESDAY["12:00"], technician: IMRAN });
    await env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, created_at)
       VALUES ('redeem-1', ?1, 'redeem', -1, 'appointment', ?2, ?3)`,
    )
      .bind(ROHIT, A, NOW.toISOString())
      .run();

    const blocks = (await board("from=2026-09-22")).technicians[0]?.days[0]?.blocks;
    expect(blocks?.map((block) => block.badge)).toEqual(["credit", "free"]);
  });

  // docs/decisions/0085-services-ops-can-edit.md: a visit is its own service, priced and timed as that.
  it("reads a visit's badge from its own service's price on its day, and sizes it by its own length", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
         VALUES ('consultation', 'at_home', 'Consultation at home', 60, 1, 'ops@localhost', ?1),
                ('first_fit', 'premium', 'Premium first fit', 300, 1, 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
         VALUES ('consultation', 'at_home', 50000, 0, '2026-01-01'), ('first_fit', 'premium', 4000000, 0, '2026-01-01')`,
      ),
    ]);
    await insertJob(A, { type: "consultation", start: TUESDAY["09:00"], technician: IMRAN, person: null });
    await insertJob(B, { type: "first_fit", start: TUESDAY["12:00"], technician: SAMEER, person: null });
    await env.DB.batch([
      env.DB.prepare("UPDATE appointments SET tier = 'at_home' WHERE id = ?1").bind(A),
      env.DB.prepare("UPDATE appointments SET tier = 'premium' WHERE id = ?1").bind(B),
    ]);

    const week = await board("from=2026-09-22");
    // Charged for, so not free, though the standard consultation is.
    expect(week.technicians[0]?.days[0]?.blocks[0]).toMatchObject({ appointment_id: A, badge: "prepaid", slots: 1 });
    // Seven half-slots: three slots and a half.
    expect(week.technicians[1]?.days[0]?.blocks[0]).toMatchObject({ appointment_id: B, slots: 3.5 });
    // MON-10: the drawer names what the client bought.
    expect(week.technicians[1]?.days[0]?.blocks[0]).toMatchObject({ service: "Premium first fit" });
  });

  it("names no service for a visit of its kind's standard one", async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
    const block = (await board("from=2026-09-22")).technicians[0]?.days[0]?.blocks[0];
    expect(block).toMatchObject({ appointment_id: A, service: null });
  });

  it("names the move the client was not told of on the visit it moved", async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
    const { move_id: moveId } = await (await move(toSameerWednesdayMorning(A))).json<{ move_id: string }>();

    const block = (await board("from=2026-09-22")).technicians[1]?.days[1]?.blocks[0];
    expect(block?.untold).toEqual({ move_id: moveId, starts_at: "2026-09-23T03:30:00.000Z", reason: "no_consent" });
  });

  it("carries no client for one who has been erased", async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), ROHIT).run();

    const block = (await board("from=2026-09-22")).technicians[0]?.days[0]?.blocks[0];
    expect(block?.person).toBeNull();
  });

  // FEO-09: the brief's "city and week picker"; the route took both, and the board sent neither.
  it("names the city it is narrowed to, and the cities it can be", async () => {
    const week = await board("from=2026-09-22&city=Gurgaon");
    expect(week.city).toBe("Gurgaon");
    expect(week.cities).toEqual(expect.arrayContaining(["Gurgaon", "Delhi"]));
    expect((await board("from=2026-09-22")).city).toBeNull();
  });

  // OIA-05 and BK-54: Mumbai and Bengaluru, on the waitlist alone, were offered and gave an empty board.
  it("offers the cities we serve, and one we do not only once a technician works there", async () => {
    expect((await board("from=2026-09-22")).cities).toEqual(["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad"]);

    await env.DB.prepare("UPDATE technicians SET city = 'Mumbai' WHERE id = ?1").bind(SAMEER).run();
    expect((await board("from=2026-09-22")).cities).toContain("Mumbai");
    expect((await board("from=2026-09-22")).cities).not.toContain("Bengaluru");
  });
});

interface RoomBody {
  appointment_id: string;
  rooms: { technician_id: string; date: string; windows: string[]; starts: { window: string; starts_at: string }[] }[];
  blackouts: string[];
}

const roomFor = (id: string, from: string) =>
  request(ops, `/api/dispatch/room?appointment_id=${id}&from=${from}`, {}, bindings());

// FEO-10 and REQ-S9-02: "Drop it on a cell with room", and "a cell that would
// clash is refused before the sheet opens". The board offered every window of
// every day and learnt of a clash only after a reason had been picked.
describe("where a job in hand can go", () => {
  it("offers each window the job would land in, and none it would be refused", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });
    await insertJob(REPLACEMENT, { type: "replacement", start: TUESDAY["10:30"], technician: SAMEER });
    expect((await opsPost(`/api/technicians/${SAMEER}/leave`, { from: "2026-09-24", to: "2026-09-24" })).status).toBe(
      200,
    );

    const answer = await roomFor(FIT, "2026-09-22");
    expect(answer.status).toBe(200);
    const { rooms } = await answer.json<RoomBody>();
    const windowsOf = (technician: string, date: string) =>
      rooms.find((room) => room.technician_id === technician && room.date === date)?.windows ?? [];

    // Imran's afternoon is where it already is; his morning has room, and no evening has room for a first fit.
    expect(windowsOf(IMRAN, "2026-09-22")).toEqual(["morning"]);
    // Sameer's replacement holds his morning and runs into the first fit's own 12:00.
    expect(windowsOf(SAMEER, "2026-09-22")).toEqual([]);
    expect(windowsOf(SAMEER, "2026-09-23")).toEqual(["morning", "afternoon"]);
    // Away on Thursday.
    expect(windowsOf(SAMEER, "2026-09-24")).toEqual([]);
    expect(rooms.every((room) => room.windows.length > 0)).toBe(true);
  });

  it("answers not found for a job no longer live", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN, status: "completed" });
    expect((await roomFor(FIT, "2026-09-22")).status).toBe(404);
  });
});

/** Monday 21 September, today, in India, as UTC: each half-slot's start. NOW is 12:00. */
const TODAY = {
  date: "2026-09-21",
  "09:00": "2026-09-21T03:30:00.000Z",
  "12:00": "2026-09-21T06:30:00.000Z",
  "13:00": "2026-09-21T07:30:00.000Z",
  "16:00": "2026-09-21T10:30:00.000Z",
} as const;

const dispatchMoves = () =>
  env.DB.prepare("SELECT appointment_id, now_start, blackout_reason FROM dispatch_moves").all<{
    appointment_id: string;
    now_start: string;
    blackout_reason: string | null;
  }>();

// BK-17, FLD-23: at 09:58 four visits moved to that morning all landed at 09:00, at 10:02 one landed at 09:00 to
// 10:00, and a move to yesterday answered 200. The technician and the client were told a time nobody could meet.
describe("a move lands only at a start still ahead", () => {
  beforeEach(async () => {
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
  });

  it("takes today's window at its first start still to come, not one already under way", async () => {
    const answer = await move({
      appointment_id: A,
      technician_id: SAMEER,
      date: TODAY.date,
      window: "afternoon",
      reason: "client_asked",
    });

    expect(answer.status).toBe(200);
    // 12:00 is now, so the afternoon's next start, 13:00, is where it lands.
    expect(await shown(A)).toEqual({ technician_id: SAMEER, window_start: TODAY["13:00"] });
  });

  it("refuses today's window once every start in it has passed, and a day gone, writing nothing", async () => {
    const morning = await move({ appointment_id: A, date: TODAY.date, window: "morning", reason: "client_asked" });
    const yesterday = await move({ appointment_id: A, date: "2026-09-20", window: "evening", reason: "client_asked" });

    expect(morning.status).toBe(409);
    expect(await morning.json()).toMatchObject({ error: { code: "window_passed" } });
    expect(yesterday.status).toBe(409);
    expect(await yesterday.json()).toMatchObject({ error: { code: "past_day" } });
    expect((await dispatchMoves()).results).toEqual([]);
    expect(await shown(A)).toEqual({ technician_id: IMRAN, window_start: TUESDAY["09:00"] });
  });

  it("moves a visit whose own start has come to the window's next start, and tells the client of it", async () => {
    await insertJob(B, { type: "service", start: TODAY["12:00"], technician: IMRAN });

    const answer = await move({ appointment_id: B, date: TODAY.date, window: "afternoon", reason: "running_over" });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ client_notice: "call" });
    expect(await shown(B)).toEqual({ technician_id: IMRAN, window_start: TODAY["13:00"] });
  });

  it("gives a visit whose window has passed to another technician only at a later start", async () => {
    await insertJob(B, { type: "service", start: TODAY["09:00"], technician: IMRAN });

    const sameTime = await move({
      appointment_id: B,
      technician_id: SAMEER,
      date: TODAY.date,
      window: "morning",
      reason: "technician_unavailable",
    });

    expect(sameTime.status).toBe(409);
    expect(await sameTime.json()).toMatchObject({ error: { code: "window_passed" } });
    expect(await shown(B)).toEqual({ technician_id: IMRAN, window_start: TODAY["09:00"] });
  });

  it("offers today only at starts still ahead, with the start each window would take, and no day gone", async () => {
    const answer = await roomFor(A, "2026-09-20");
    expect(answer.status).toBe(200);
    const { rooms } = await answer.json<RoomBody>();
    const roomOf = (technician: string, date: string) =>
      rooms.find((room) => room.technician_id === technician && room.date === date);

    expect(roomOf(SAMEER, "2026-09-20")).toBeUndefined();
    expect(roomOf(SAMEER, TODAY.date)).toEqual({
      technician_id: SAMEER,
      date: TODAY.date,
      windows: ["afternoon", "evening"],
      starts: [
        { window: "afternoon", starts_at: TODAY["13:00"] },
        { window: "evening", starts_at: TODAY["16:00"] },
      ],
    });
    // Imran's Tuesday morning is where it already is.
    expect(roomOf(IMRAN, "2026-09-22")?.starts).toEqual([
      { window: "afternoon", starts_at: TUESDAY["12:00"] },
      { window: "evening", starts_at: "2026-09-22T10:30:00.000Z" },
    ]);
  });
});

// Owner decision 16: a move onto a blacked-out day is allowed, with a warning and a typed reason kept with the move.
describe("a move onto a blacked-out day", () => {
  const ontoWednesday = (id: string, extra: Record<string, unknown> = {}) =>
    move({ appointment_id: id, date: WEDNESDAY, window: "morning", reason: "client_asked", ...extra });

  beforeEach(async () => {
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES (?1, 'Dussehra')").bind(WEDNESDAY).run();
    await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN });
  });

  it("is refused without a reason, and nothing is written", async () => {
    const answer = await ontoWednesday(A);

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "blackout" } });
    expect((await dispatchMoves()).results).toEqual([]);
  });

  it("refuses a reason of nothing but spaces", async () => {
    const answer = await ontoWednesday(A, { blackout_reason: "   " });
    expect(answer.status).toBe(400);
  });

  it("goes ahead with a reason, kept with the move", async () => {
    const reason = "The client's only free day; Imran agreed to work it";

    const answer = await ontoWednesday(A, { blackout_reason: reason });

    expect(answer.status).toBe(200);
    expect((await dispatchMoves()).results).toEqual([
      expect.objectContaining({ appointment_id: A, blackout_reason: reason }),
    ]);
    expect(await shown(A)).toEqual({ technician_id: IMRAN, window_start: "2026-09-23T03:30:00.000Z" });
  });

  it("keeps no reason for a move onto any other day", async () => {
    const answer = await move({
      appointment_id: A,
      date: "2026-09-24",
      window: "morning",
      reason: "client_asked",
      blackout_reason: "Sent by habit",
    });

    expect(answer.status).toBe(200);
    expect((await dispatchMoves()).results[0]?.blackout_reason).toBeNull();
  });

  it("is offered on the board, which is told the day is blacked out", async () => {
    const { rooms, blackouts } = await (await roomFor(A, "2026-09-22")).json<RoomBody>();

    expect(blackouts).toEqual([WEDNESDAY]);
    expect(rooms.find((room) => room.technician_id === SAMEER && room.date === WEDNESDAY)?.windows).toEqual([
      "morning",
      "afternoon",
      "evening",
    ]);
  });
});

// OPS-07: leave recorded over jobs already booked flagged nothing. Chetan's Wednesday job sat unmarked on his Away
// cell, stayed on his phone, and waited for nobody.
describe("leave recorded over jobs already booked", () => {
  /** Wednesday at 10:30 in India. */
  const WEDNESDAY_MORNING = "2026-09-23T05:00:00.000Z";

  interface LeaveAnswer {
    id: string;
    jobs: { appointment_id: string; starts_at: string; type: string; client: string | null }[];
  }

  const tasksOf = async (group: string) => {
    const body = await (
      await request(ops, "/api/tasks", {}, bindings())
    ).json<{
      groups: { group: string; tasks: { id: string; detail: string | null; since: string; due: string }[] }[];
    }>();
    return body.groups.find((each) => each.group === group)?.tasks ?? [];
  };

  it("names the jobs it falls on, and only those", async () => {
    await insertJob(A, { type: "service", start: WEDNESDAY_MORNING, technician: SAMEER });
    await insertJob(B, { type: "service", start: WEDNESDAY_MORNING, technician: IMRAN });
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["09:00"], technician: SAMEER });

    const answer = await opsPost(`/api/technicians/${SAMEER}/leave`, { from: WEDNESDAY, to: WEDNESDAY });

    expect(answer.status).toBe(200);
    expect((await answer.json<LeaveAnswer>()).jobs).toEqual([
      { appointment_id: A, starts_at: WEDNESDAY_MORNING, type: "service", client: "Rohit Malhotra" },
    ]);
  });

  it("puts each on the Tasks board, due by the job, until it is moved or the leave taken back", async () => {
    await insertJob(A, { type: "service", start: WEDNESDAY_MORNING, technician: SAMEER });
    const { id: leave } = await (
      await opsPost(`/api/technicians/${SAMEER}/leave`, { from: WEDNESDAY, to: WEDNESDAY })
    ).json<LeaveAnswer>();

    expect(await tasksOf("leave_conflict")).toEqual([
      expect.objectContaining({
        id: A,
        detail: `${WEDNESDAY_MORNING} Sameer Bhatt`,
        since: NOW.toISOString(),
        // Two days on would be after the job itself.
        due: WEDNESDAY_MORNING,
      }),
    ]);

    await opsPost(`/api/technicians/${SAMEER}/leave/${leave}/cancel`, {});
    expect(await tasksOf("leave_conflict")).toEqual([]);

    await opsPost(`/api/technicians/${SAMEER}/leave`, { from: WEDNESDAY, to: WEDNESDAY });
    await env.DB.prepare("UPDATE appointments SET technician_id = ?1 WHERE id = ?2").bind(IMRAN, A).run();
    expect(await tasksOf("leave_conflict")).toEqual([]);
  });
});

// PLAT-12: the open board read itself in full every minute, hundreds of rows each time, and so spent D1's day of
// reads at a few hundred clients. It now asks for this number every minute and reads itself only when it has moved.
describe("the board's version", () => {
  const version = async (): Promise<number> => {
    const answer = await request(ops, "/api/dispatch/version");
    expect(answer.status).toBe(200);
    return (await answer.json<{ version: number }>()).version;
  };
  const write =
    (sql: string, ...values: unknown[]) =>
    async (): Promise<void> => {
      await env.DB.prepare(sql)
        .bind(...values)
        .run();
    };

  it("is the one the board was read at, until something on it changes", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });
    const before = await version();

    const board = await (await request(ops, "/api/dispatch")).json<{ version: number }>();

    expect(board.version).toBe(before);
    expect(await version()).toBe(before);
  });

  it("moves for a visit booked, moved or cancelled, leave, a technician changed and new slot times", async () => {
    const changes: [string, () => Promise<unknown>][] = [
      ["visit booked", () => insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN })],
      ["visit moved", () => move({ appointment_id: FIT, technician_id: SAMEER, reason: "zone_rebalance" })],
      ["leave given", () => opsPost(`/api/technicians/${SAMEER}/leave`, { from: WEDNESDAY, to: WEDNESDAY })],
      [
        "leave taken back",
        write("UPDATE technician_leave SET cancelled_at = ?1, cancelled_by = 'ops'", NOW.toISOString()),
      ],
      ["technician renamed", write("UPDATE technicians SET name = 'Imran Q.' WHERE id = ?1", IMRAN)],
      ["technician switched off", write("UPDATE technicians SET active = 0 WHERE id = ?1", IMRAN)],
      [
        "slot times set",
        write(
          `INSERT INTO slot_times (id, applies_from, unit_starts, day_end, set_by, set_at)
           VALUES ('st-1', '2026-10-01', '["09:00","10:00","11:00","12:00","14:00","15:00","16:00","17:00"]', '19:00',
             'ops', ?1)`,
          NOW.toISOString(),
        ),
      ],
      ["visit cancelled", write("UPDATE appointments SET status = 'cancelled' WHERE id = ?1", FIT)],
    ];

    const unmoved: string[] = [];
    for (const [change, make] of changes) {
      const before = await version();
      await make();
      if ((await version()) <= before) unmoved.push(change);
    }

    expect(unmoved).toEqual([]);
  });

  it("stays where it is when the sync or the invoice passes write what the board does not draw", async () => {
    await insertJob(FIT, { type: "first_fit", start: TUESDAY["12:00"], technician: IMRAN });
    const before = await version();

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE appointments SET synced_at = ?2, fsm_modified_at = ?2, invoice_checked_at = ?2, client_note = 'Gate 2',
           status = status, technician_id = technician_id, window_start = window_start
         WHERE id = ?1`,
      ).bind(FIT, NOW.toISOString()),
      env.DB.prepare("UPDATE technicians SET updated_at = ?2, name = name, active = active WHERE id = ?1").bind(
        IMRAN,
        NOW.toISOString(),
      ),
    ]);

    expect(await version()).toBe(before);
  });

  it("is asked for without a line in the audit log, since it names nobody", async () => {
    const entries = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>())?.n;
    const before = await entries();

    await version();

    expect(await entries()).toBe(before);
  });
});
