// The dispatch board's writes under real conditions: a technician-only change,
// a visit with no room, two moves at once, and a client who cannot be messaged.
// NOW is Monday 21 September 2026, 12 noon in India. Every name, number and
// address here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { recordUtilisation } from "../../../src/domain/dispatch/dispatch-utilisation.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import {
  ROHIT,
  VIKRAM,
  IMRAN,
  SAMEER,
  FIT,
  REPLACEMENT,
  A,
  B,
  WEDNESDAY,
  TUESDAY,
  insertJob,
  shown,
  toSameerWednesdayMorning,
  type BoardBody,
  agreeToVisitMessages,
} from "./dispatch-fixtures.ts";

let ops: App;

let messageQueue: ReturnType<typeof fakeQueue>;

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
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810009902', 'Vikram Sethi')",
  )
    .bind(VIKRAM, NOW.toISOString())
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

/** A move sent from a board that shows the job as it stands, unless the body says otherwise. */
async function move(body: { appointment_id: string } & Record<string, unknown>, app: App = ops): Promise<Response> {
  const job = await shown(body.appointment_id);
  return opsPost(
    "/api/dispatch/move",
    { expected_technician_id: job?.technician_id ?? null, expected_starts_at: job?.window_start, ...body },
    app,
  );
}

const board = async (query: string): Promise<BoardBody> =>
  (await request(ops, `/api/dispatch?${query}`, {}, bindings())).json<BoardBody>();

// "the operating figure for the model's weekend-share assumption, so it
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

// ADR 0068: nothing on the board led to the client, the
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
    // The drawer names what the client bought.
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

  // The brief's "city and week picker"; the route took both, and the board sent neither.
  it("names the city it is narrowed to, and the cities it can be", async () => {
    const week = await board("from=2026-09-22&city=Gurgaon");
    expect(week.city).toBe("Gurgaon");
    expect(week.cities).toEqual(expect.arrayContaining(["Gurgaon", "Delhi"]));
    expect((await board("from=2026-09-22")).city).toBeNull();
  });

  // Mumbai and Bengaluru, on the waitlist alone, were offered and gave an empty board.
  it("offers the cities we serve, and one we do not only once a technician works there", async () => {
    expect((await board("from=2026-09-22")).cities).toEqual(["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad"]);

    await env.DB.prepare("UPDATE technicians SET city = 'Mumbai' WHERE id = ?1").bind(SAMEER).run();
    expect((await board("from=2026-09-22")).cities).toContain("Mumbai");
    expect((await board("from=2026-09-22")).cities).not.toContain("Bengaluru");
  });
});

// The open board read itself in full every minute, hundreds of rows each time, and so spent D1's day of
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
