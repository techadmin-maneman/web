// Finance keeps to the caller's cities: once the Staff list is enforced, a grant of one city sees only that city's
// day's money, no-shows and disputes, and a client or visit elsewhere is not found. Codes and prices stay national.
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { captureLogs, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person } from "./staff-fixtures.ts";

interface Client {
  readonly digit: number;
  readonly id: string;
  readonly name: string;
  readonly mobile: string;
  /** Where they live and are visited; null for a client nothing places in a city. */
  readonly pincode: string | null;
  /** A visit they found nobody in, still to rule on. */
  readonly missed: string;
  readonly undecided: string;
  /** A visit charged as a no-show today, which the client disputes. */
  readonly chargedVisit: string;
  readonly charged: string;
  readonly dispute: string;
  /** A service visit still to come, which may take a code. */
  readonly upcoming: string;
  /** A visit the client cancelled late today, which kept part of its payment. */
  readonly cancelled: string;
}

/** A client whose IDs all end in the same digit, and whose amounts are that many rupees of each kind. */
function clientNumbered(digit: number, name: string, pincode: string | null): Client {
  const end = (prefix: string) => `${prefix}${String(digit)}`;
  return {
    digit,
    id: end("11111111-1111-4111-8111-11111111111"),
    name,
    mobile: `+91981000000${String(digit)}`,
    pincode,
    missed: end("22222222-2222-4222-8222-22222222222"),
    undecided: end("33333333-3333-4333-8333-33333333333"),
    chargedVisit: end("44444444-4444-4444-8444-44444444444"),
    charged: end("55555555-5555-4555-8555-55555555555"),
    dispute: end("66666666-6666-4666-8666-66666666666"),
    upcoming: end("77777777-7777-4777-8777-77777777777"),
    cancelled: end("88888888-8888-4888-8888-88888888888"),
  };
}

const IN_DELHI = clientNumbered(1, "Arjun Mehta", "110017");
const IN_GURGAON = clientNumbered(2, "Rohit Mehta", "122018");
const NOWHERE = clientNumbered(3, "Zoya Mehta", null);

/** In paise: what each client paid today, and what a late cancel and a no-show kept of it. */
const paid = (client: Client) => client.digit * 100_000;
const keptByCancel = (client: Client) => client.digit * 1_000;
const keptByNoShow = (client: Client) => client.digit * 100;

const AT = NOW.toISOString();
const ORIGIN = { Origin: "https://maneman.test", "Content-Type": "application/json" };

let queues: { MESSAGE_QUEUE: ReturnType<typeof fakeQueue>; CRM_QUEUE: ReturnType<typeof fakeQueue> };

const get = (app: App, path: string) => request(app, path, undefined, queues);
const post = (app: App, path: string, body: unknown = {}) =>
  request(app, path, { method: "POST", headers: ORIGIN, body: JSON.stringify(body) }, queues);

function visitStatement(client: Client, id: string, status: string, startsAt: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
       service_pincode, synced_at)
     VALUES (?1, ?1, ?2, 'service', ?3, ?4, ?4, 't1', ?5, ?6)`,
  ).bind(id, client.id, status, startsAt, client.pincode, AT);
}

function checkInStatement(visitId: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, distance_m, radius_m, passed, created_at)
     VALUES (?1, ?1, 't1', '2026-09-19T03:31:00.000Z', 28.5, 77.2, 40, 200, 1, '2026-09-19T03:31:00.000Z')`,
  ).bind(visitId);
}

/** The client, their address, two no-shows (one charged today and disputed), a visit to come, and today's money. */
async function seed(client: Client): Promise<void> {
  const db = env.DB;
  const payment = `payment-${String(client.digit)}`;
  const statements = [
    db
      .prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
      .bind(client.id, AT, client.mobile, client.name),
    visitStatement(client, client.missed, "terminated", "2026-09-19T03:30:00.000Z"),
    visitStatement(client, client.chargedVisit, "terminated", "2026-09-18T03:30:00.000Z"),
    visitStatement(client, client.upcoming, "scheduled", "2026-09-23T04:30:00.000Z"),
    visitStatement(client, client.cancelled, "cancelled", "2026-09-21T10:30:00.000Z"),
    checkInStatement(client.missed),
    checkInStatement(client.chargedVisit),
    db
      .prepare(
        `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at, decision,
           created_at)
         VALUES (?1, ?2, ?2, '2026-09-19T03:31:00.000Z', '2026-09-19T03:46:00.000Z', '2026-09-19T03:47:00.000Z',
           'undecided', '2026-09-19T03:47:00.000Z')`,
      )
      .bind(client.undecided, client.missed),
    db
      .prepare(
        `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at, decision,
           decided_by, decided_at, decision_reason, charge, kept_amount, refund_amount, created_at)
         VALUES (?1, ?2, ?2, '2026-09-18T03:31:00.000Z', '2026-09-18T03:46:00.000Z', '2026-09-18T03:47:00.000Z',
           'charged', 'ops@localhost', ?3, 'Nobody came down', 'late_fee', ?4, 0, '2026-09-18T03:47:00.000Z')`,
      )
      .bind(client.charged, client.chargedVisit, AT, keptByNoShow(client)),
    db
      .prepare(
        `INSERT INTO no_show_disputes (id, case_id, person_id, reason, created_at)
         VALUES (?1, ?2, ?3, 'I was in.', ?4)`,
      )
      .bind(client.dispute, client.charged, client.id, AT),
    db
      .prepare(
        `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
           status, captured_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'INR', 'upi', 'captured', ?7, ?7, ?7)`,
      )
      .bind(
        payment,
        `MM-2026-084${String(client.digit)}`,
        client.id,
        client.chargedVisit,
        `pay_${payment}`,
        paid(client),
        AT,
      ),
    db
      .prepare(
        `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'created', ?5, ?5)`,
      )
      .bind(`refund-${String(client.digit)}`, payment, `rfnd_${payment}`, client.digit * 10_000, AT),
    db
      .prepare(
        `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, kept_amount, created_at)
         VALUES (?1, ?1, ?2, 'cancelled', 'late', '2026-09-21T10:30:00.000Z', ?3, ?4)`,
      )
      .bind(client.cancelled, client.id, keptByCancel(client), AT),
  ];
  if (client.pincode !== null) {
    statements.push(
      db
        .prepare(
          `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
           VALUES (?1, ?1, ?2, 'House 7', 'Market Road', 'Delhi NCR', ?3)`,
        )
        .bind(client.id, AT, client.pincode),
    );
  }
  await db.batch(statements);
}

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  queues = { MESSAGE_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue() };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES
         ('110017', 'Saket', 'Delhi', 1), ('122018', 'Sector 65', 'Gurgaon', 1)`,
    ),
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
    ).bind(AT),
    env.DB.prepare(
      `INSERT INTO discount_codes (id, code, kind, value, covers_first_fit, covers_service, covers_replacement,
         once_per_client, created_by, created_at)
       VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TENPC', 'percent', 10, 0, 1, 0, 0, 'ops@localhost', ?1)`,
    ).bind(AT),
  ]);
  for (const client of [IN_DELHI, IN_GURGAON, NOWHERE]) await seed(client);
});

/** The ops console as a member of staff holding these grants, with the Staff list enforced. */
async function staffWith(...grants: `${string}:${string}:${string}`[]): Promise<App> {
  await enforce();
  await listStaff("money@maneman.in", grants);
  return opsAs(person("money@maneman.in"));
}

const idsIn = async (res: Response, key: string): Promise<string[]> =>
  ((await res.json<Record<string, { id: string }[]>>())[key] ?? []).map((row) => row.id).sort();

const errorCode = async (res: Response) => (await res.json<{ error: { code: string } }>()).error.code;

interface DayMoney {
  collected: number;
  refunds_processing: number;
  charged: number;
  charges: { id: string }[];
}

const dayMoney = async (app: App) => (await get(app, "/api/payments")).json<DayMoney>();

const CHARGE = { decision: "charged", reason: "Nobody came down." };
const WAIVE = { decision: "waived", reason: "The lift was out." };
const UPHOLD = { ruling: "upheld", reason: "He waited the full fifteen minutes." };
const REFUND = { ruling: "refunded", reason: "The bell was broken." };

describe("a grant of Finance in one city", () => {
  let delhi: App;

  beforeEach(async () => {
    delhi = await staffWith("finance:manage:city:Delhi");
  });

  it("counts only its city's money for the day, and lists only its city's charges", async () => {
    const money = await dayMoney(delhi);

    expect(money).toMatchObject({
      collected: paid(IN_DELHI),
      refunds_processing: 10_000,
      charged: keptByCancel(IN_DELHI) + keptByNoShow(IN_DELHI),
    });
    expect(money.charges.map((charge) => charge.id).sort()).toEqual([IN_DELHI.charged, IN_DELHI.cancelled].sort());
  });

  it("lists only its city's no-shows", async () => {
    expect(await idsIn(await get(delhi, "/api/no-shows?decision=all"), "cases")).toEqual(
      [IN_DELHI.undecided, IN_DELHI.charged].sort(),
    );
  });

  it("rules on a no-show only in its city", async () => {
    const elsewhere = await post(delhi, `/api/no-shows/${IN_GURGAON.undecided}/decision`, CHARGE);
    expect(elsewhere.status).toBe(404);
    expect(await errorCode(elsewhere)).toBe("not_found");
    expect((await post(delhi, `/api/no-shows/${NOWHERE.undecided}/decision`, WAIVE)).status).toBe(404);
    expect((await post(delhi, `/api/no-shows/${IN_DELHI.undecided}/decision`, CHARGE)).status).toBe(200);

    const undecided = await env.DB.prepare(
      "SELECT id FROM no_show_cases WHERE decision = 'undecided' ORDER BY id",
    ).all();
    expect(undecided.results).toEqual([{ id: IN_GURGAON.undecided }, { id: NOWHERE.undecided }]);
  });

  it("lists only its city's rulings of the day, and shows what a charge would keep only in its city", async () => {
    expect(await idsIn(await get(delhi, "/api/no-shows/decided"), "cases")).toEqual([IN_DELHI.charged]);

    expect((await get(delhi, `/api/no-shows/${IN_GURGAON.undecided}/charge`)).status).toBe(404);
    expect((await get(delhi, `/api/no-shows/${NOWHERE.undecided}/charge`)).status).toBe(404);
    expect((await get(delhi, `/api/no-shows/${IN_DELHI.undecided}/charge`)).status).toBe(200);
  });

  it("lists and rules on only its city's disputes", async () => {
    expect(await idsIn(await get(delhi, "/api/no-shows/disputes"), "disputes")).toEqual([IN_DELHI.dispute]);

    expect((await post(delhi, `/api/no-shows/disputes/${IN_GURGAON.dispute}/ruling`, UPHOLD)).status).toBe(404);
    expect((await post(delhi, `/api/no-shows/disputes/${NOWHERE.dispute}/ruling`, REFUND)).status).toBe(404);
    expect((await post(delhi, `/api/no-shows/disputes/${IN_DELHI.dispute}/ruling`, UPHOLD)).status).toBe(200);

    const open = await env.DB.prepare("SELECT id FROM no_show_disputes WHERE ruling IS NULL ORDER BY id").all();
    expect(open.results).toEqual([{ id: IN_GURGAON.dispute }, { id: NOWHERE.dispute }]);
  });

  it("puts a client's credits right only in its city", async () => {
    const adjust = (client: Client) =>
      post(delhi, `/api/clients/${client.id}/credits`, { visits: 1, reason: "goodwill" });
    expect((await adjust(IN_GURGAON)).status).toBe(404);
    expect((await adjust(NOWHERE)).status).toBe(404);
    expect((await adjust(IN_DELHI)).status).toBe(200);

    const granted = await env.DB.prepare("SELECT person_id FROM credit_ledger").all();
    expect(granted.results).toEqual([{ person_id: IN_DELHI.id }]);
  });

  it("enters a code on a visit, and takes one off, only in its city", async () => {
    const enter = (client: Client) => post(delhi, `/api/visits/${client.upcoming}/discount-code`, { code: "TENPC" });
    expect((await enter(IN_GURGAON)).status).toBe(404);
    expect((await enter(NOWHERE)).status).toBe(404);
    expect((await enter(IN_DELHI)).status).toBe(200);

    await env.DB.prepare(
      `INSERT INTO discount_code_uses (id, code_id, person_id, appointment_id, amount_off, given_by, given_by_id,
         created_at)
       VALUES ('use-gurgaon', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ?1, ?2, 20000, 'ops', 'ops@localhost', ?3)`,
    )
      .bind(IN_GURGAON.id, IN_GURGAON.upcoming, AT)
      .run();
    const remove = (client: Client) => post(delhi, `/api/visits/${client.upcoming}/discount-code/remove`);
    expect((await remove(IN_GURGAON)).status).toBe(404);
    expect((await remove(IN_DELHI)).status).toBe(204);

    const uses = await env.DB.prepare(
      "SELECT appointment_id, removed_at IS NOT NULL AS removed FROM discount_code_uses ORDER BY appointment_id",
    ).all();
    expect(uses.results).toEqual([
      { appointment_id: IN_DELHI.upcoming, removed: 1 },
      { appointment_id: IN_GURGAON.upcoming, removed: 0 },
    ]);
  });

  it("reads every code, the prices and the price book, which are the same in every place", async () => {
    expect((await get(delhi, "/api/discount-codes")).status).toBe(200);
    expect((await get(delhi, "/api/prices")).status).toBe(200);
    expect((await get(delhi, "/api/services")).status).toBe(200);
  });

  it("is not let make a code, which needs a national grant", async () => {
    const code = { code: "FIVEPC", kind: "percent", value: 5, covers: ["service"], once_per_client: true };
    expect((await post(delhi, "/api/discount-codes", code)).status).toBe(403);
  });
});

describe("Finance's reach", () => {
  it("is each level's own: Act nationally charges anywhere, but Manage in one city waives only there", async () => {
    const money = await staffWith("finance:act:national", "finance:manage:city:Delhi");

    expect(await idsIn(await get(money, "/api/no-shows"), "cases")).toHaveLength(3);
    const waivedElsewhere = await post(money, `/api/no-shows/${IN_GURGAON.undecided}/decision`, WAIVE);
    expect(waivedElsewhere.status).toBe(403);
    expect(await errorCode(waivedElsewhere)).toBe("not_permitted");
    expect((await post(money, `/api/no-shows/${IN_GURGAON.undecided}/decision`, CHARGE)).status).toBe(200);
    expect((await post(money, `/api/no-shows/${IN_DELHI.undecided}/decision`, WAIVE)).status).toBe(200);
  });

  it("refunds a disputed charge only where Manage reaches, and upholds one wherever Act does", async () => {
    const money = await staffWith("finance:act:national", "finance:manage:city:Delhi");

    const refundedElsewhere = await post(money, `/api/no-shows/disputes/${IN_GURGAON.dispute}/ruling`, REFUND);
    expect(refundedElsewhere.status).toBe(403);
    expect(await errorCode(refundedElsewhere)).toBe("not_permitted");
    expect((await post(money, `/api/no-shows/disputes/${IN_GURGAON.dispute}/ruling`, UPHOLD)).status).toBe(200);
    expect((await post(money, `/api/no-shows/disputes/${IN_DELHI.dispute}/ruling`, REFUND)).status).toBe(200);
  });

  it("takes in every city of a zone, and a record in no city only nationally", async () => {
    const ncr = await staffWith("finance:view:zone:NCR");
    expect(await idsIn(await get(ncr, "/api/no-shows/disputes"), "disputes")).toEqual(
      [IN_DELHI.dispute, IN_GURGAON.dispute].sort(),
    );
    expect((await dayMoney(ncr)).collected).toBe(paid(IN_DELHI) + paid(IN_GURGAON));
  });

  it("is everywhere for a national grant", async () => {
    const national = await staffWith("finance:view:national");
    expect(await idsIn(await get(national, "/api/no-shows/disputes"), "disputes")).toHaveLength(3);
    expect((await dayMoney(national)).collected).toBe(paid(IN_DELHI) + paid(IN_GURGAON) + paid(NOWHERE));
  });

  it("narrows nothing while the Staff list is not enforced", async () => {
    await listStaff("delhi@maneman.in", ["finance:act:city:Delhi"]);
    const delhi = opsAs(person("delhi@maneman.in"));

    expect(await idsIn(await get(delhi, "/api/no-shows"), "cases")).toHaveLength(3);
    expect((await dayMoney(delhi)).charges).toHaveLength(6);
    expect((await post(delhi, `/api/no-shows/${IN_GURGAON.undecided}/decision`, CHARGE)).status).toBe(200);
  });
});
