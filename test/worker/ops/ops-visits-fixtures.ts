// What the tests of a visit ops book share (ops-visits*.test.ts): the technicians and the client, the service's price
// and day, a discount code made, and the holds each reads back.

import { env } from "cloudflare:workers";
import { makeCodes, type NewCodes } from "../../../src/domain/money/discount-codes.ts";
import { fakeQueue, NOW, savedAddress } from "../helpers.ts";

export const IMRAN = "t1";

export const SANDEEP = "t2";

export const ROHIT = "11111111-1111-4111-8111-111111111111";

export const NATURAL = { tier: "natural", name: "Mane Man Natural", amount: 4_500_000 };

export const SERVICE_PRICE = 200_000;

export const WEDNESDAY = "2026-09-23";

/** The queue a booking's messages go on, kept rather than delivered. */
export const bindings = () => ({ MESSAGE_QUEUE: fakeQueue() });

export async function technician(id: string, name: string, initials: string) {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
  )
    .bind(id, id, name, initials, NOW.toISOString())
    .run();
}

export async function visit(
  personId: string | null,
  type: string,
  status: string,
  startsAt: string,
  technicianId: string,
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
     VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)`,
  )
    .bind(id, personId, type, status, startsAt, technicianId, NOW.toISOString())
    .run();
  return id;
}

/** Rohit, with his address saved: new to us, consulted, or fitted. */
export async function rohit(stage: "new" | "consulted" | "fitted" = "new") {
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(ROHIT, NOW.toISOString())
    .run();
  await savedAddress(ROHIT, "122018");
  if (stage === "consulted") await visit(ROHIT, "consultation", "completed", "2026-09-01T06:30:00.000Z", IMRAN);
  if (stage === "fitted") await visit(ROHIT, "first_fit", "completed", "2026-08-01T03:30:00.000Z", IMRAN);
}

/** Ten per cent off service visits and first fits. */
export const TEN_OFF: NewCodes = {
  code: "TENPC",
  count: 1,
  kind: "percent",
  value: 10,
  cap: null,
  covers: ["first_fit", "service"],
  expiresOn: null,
  maxUses: null,
  oncePerClient: true,
};

export const makeCode = () =>
  makeCodes(env.DB, TEN_OFF, { actor: { kind: "staff", id: "ops@localhost" }, requestId: "r", now: NOW });

export interface HoldRow {
  state: string;
  type: string;
  tier: string;
  technician_id: string;
  amount: number;
  confirmed_at: string | null;
  use_credit: number;
  one_visit: number;
  pay_by_link: number;
  payment_link_id: string | null;
  payment_link_url: string | null;
  reference: string | null;
  razorpay_order_id: string | null;
  expires_at: string;
  no_show_charge: string | null;
}

export const holdOf = (id: string) =>
  env.DB.prepare(
    `SELECT state, type, tier, technician_id, amount, confirmed_at, use_credit, one_visit, pay_by_link, payment_link_id,
       payment_link_url, reference, razorpay_order_id, expires_at, no_show_charge
     FROM slot_holds WHERE id = ?1`,
  )
    .bind(id)
    .first<HoldRow>();

export const holdsCount = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_holds WHERE state = 'held'").first<{ n: number }>())?.n;
