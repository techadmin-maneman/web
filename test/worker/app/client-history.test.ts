// One client's history (src/domain/client-history.ts), counted from their
// visits, payments and pieces, and read by both surfaces from the one
// derivation. NOW is Monday 21 September 2026, 12 noon in India. Every name,
// number and piece here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { clientHistory } from "../../../src/domain/client-history.ts";
import { openSession } from "../../../src/domain/sessions.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const MOBILE = "+919810000001";

let ops: App;
let client: App;
let cookie: string;

let visits = 0;
async function visit(type: string, date: string, status = "completed"): Promise<string> {
  const id = `22222222-2222-4222-8222-${String(++visits).padStart(12, "0")}`;
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       service_city, service_pincode, fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'x', ?6, ?7, 'Gurgaon', '122018', ?8, ?8)`,
  )
    .bind(id, `fsm-${id}`, PERSON, type, status, `${date}T04:30:00.000Z`, `${date}T06:00:00.000Z`, NOW.toISOString())
    .run();
  return id;
}

let payments = 0;
async function payment(amount: number, refunded = 0, captured = true): Promise<void> {
  const id = `55555555-5555-4555-8555-${String(++payments).padStart(12, "0")}`;
  await env.DB.prepare(
    `INSERT INTO payments (id, person_id, razorpay_payment_id, amount, currency, status, refunded_amount,
       captured_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'INR', ?5, ?6, ?7, ?8, ?8)`,
  )
    .bind(
      id,
      PERSON,
      `pay_${id}`,
      amount,
      refunded === 0 ? "captured" : "partially_refunded",
      refunded,
      captured ? "2026-09-01T06:00:00.000Z" : null,
      "2026-09-01T06:00:00.000Z",
    )
    .run();
}

let pieces = 0;
async function piece(code: string, fitted: string, due: string | null, failed: string | null = null): Promise<void> {
  const id = `66666666-6666-4666-8666-${String(++pieces).padStart(12, "0")}`;
  await env.DB.prepare(
    `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, supplier_lot, fitted_at, replacement_due_at,
       failed_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, 'Mono', 'L-1109', ?5, ?6, ?7, ?8)`,
  )
    .bind(id, `fsm-${id}`, PERSON, code, fitted, due, failed, NOW.toISOString())
    .run();
}

/** The client the design draws: a first fit, two services, a replacement, and a piece in wear. */
async function record(): Promise<void> {
  await visit("first_fit", "2026-01-14");
  await visit("service", "2026-04-02");
  await visit("service", "2026-07-11");
  await visit("replacement", "2026-08-22");
  await piece("MM-STD-4417-B", "2026-01-14", "2026-07-13", "2026-08-20T06:00:00.000Z");
  await piece("MM-STD-4417-C", "2026-08-22", "2027-02-18");
  await payment(3_540_000);
  await payment(236_000);
}

async function signIn(): Promise<void> {
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
}

const opsRecord = () =>
  request(ops, `/api/clients/${PERSON}`).then((response) => response.json<{ history: Record<string, unknown> }>());

const clientVisits = () =>
  request(client, "/api/visits", { headers: { Cookie: cookie } }).then((response) =>
    response.json<{ history: Record<string, unknown> }>(),
  );

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  client = appFor("local", fakeDependencies(), {}, "client");
  await markDatabase();
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Rohit Malhotra')")
    .bind(PERSON, "2026-01-01T06:00:00.000Z", MOBILE)
    .run();
});

describe("the derivation", () => {
  it("counts the visits done, dates the first and the last, and adds up what was paid", async () => {
    await record();
    expect(await clientHistory(env.DB, PERSON)).toEqual({
      visits: 4,
      services: 2,
      replacements: 1,
      first_fit_on: "2026-01-14",
      last_visit_on: "2026-08-22",
      spend: 3_776_000,
      replacement_due: { on: "2027-02-18", month: "2027-02", piece_code: "MM-STD-4417-C" },
    });
  });

  it("is every figure at nought for a client with nothing, and no replacement date at all", async () => {
    expect(await clientHistory(env.DB, PERSON)).toEqual({
      visits: 0,
      services: 0,
      replacements: 0,
      first_fit_on: null,
      last_visit_on: null,
      spend: 0,
      replacement_due: null,
    });
  });

  it("counts only the visits that happened: a terminated or cancelled one did not", async () => {
    await visit("service", "2026-04-02");
    await visit("service", "2026-05-02", "terminated");
    await visit("service", "2026-06-02", "cancelled");
    await visit("service", "2026-07-02", "scheduled");
    const history = await clientHistory(env.DB, PERSON);
    expect(history).toMatchObject({ visits: 1, services: 1, last_visit_on: "2026-04-02" });
  });

  it("has no first fit for a client fitted before FSM held their visits", async () => {
    await visit("service", "2026-04-02");
    expect(await clientHistory(env.DB, PERSON)).toMatchObject({ first_fit_on: null, services: 1 });
  });

  it("falls due on the piece in wear, never on one that has failed and been replaced", async () => {
    await piece("MM-STD-4417-A", "2025-06-01", "2025-11-28", "2026-01-13T06:00:00.000Z");
    expect((await clientHistory(env.DB, PERSON)).replacement_due).toBeNull();

    await piece("MM-STD-4417-B", "2026-01-14", "2026-07-13");
    expect((await clientHistory(env.DB, PERSON)).replacement_due).toMatchObject({ piece_code: "MM-STD-4417-B" });
  });

  it("takes off what went back, and leaves out a payment Razorpay never captured", async () => {
    await payment(236_000, 100_000);
    await payment(500_000, 0, false);
    expect((await clientHistory(env.DB, PERSON)).spend).toBe(136_000);
  });
});

describe("the two surfaces", () => {
  it("gives ops the day a piece falls due, beside the piece it is for", async () => {
    await record();
    expect((await opsRecord()).history).toMatchObject({
      services: 2,
      replacements: 1,
      replacement_due: { on: "2027-02-18", month: "2027-02", piece_code: "MM-STD-4417-C" },
    });
  });

  it("gives the client the month and never the day, because the day can move under them", async () => {
    await record();
    await signIn();
    const { history } = await clientVisits();
    expect(history.replacement_due).toEqual({ month: "2027-02" });
  });

  it("tells the client a piece they are not wearing falls due on nothing", async () => {
    await visit("service", "2026-04-02");
    await signIn();
    expect((await clientVisits()).history).toMatchObject({ visits: 1, replacement_due: null });
  });

  it("answers both surfaces with the same figures, so no client is told one thing and ops another", async () => {
    await record();
    await signIn();
    const [opsSide, clientSide] = [(await opsRecord()).history, (await clientVisits()).history];
    const shared = ({ replacement_due: _due, ...figures }: Record<string, unknown>) => figures;
    expect(shared(clientSide)).toEqual(shared(opsSide));
  });
});
