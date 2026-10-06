// What the no-show dispute tests share (no-show-disputes*.test.ts): the clients, the visit, its case and technician,
// the console, a ruling sent, and a visit paid with a credit.

import { env } from "cloudflare:workers";
import type { App } from "../../../src/http/context.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { appFor, fakeDependencies, fakeQueue, NOW, request } from "../helpers.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";

export const OTHER = "11111111-1111-4111-8111-111111111112";

export const VISIT = "22222222-2222-4222-8222-222222222222";

export const CASE = "33333333-3333-4333-8333-333333333333";

export const TECHNICIAN = "44444444-4444-4444-8444-444444444444";

export const MOBILE = "+919810000001";

export function opsApp(payments = createStubPayments()) {
  return { app: appFor("local", fakeDependencies({ payments }), {}, "ops"), payments };
}

export function rule(ops: App, id: string, body: unknown, queue = fakeQueue()) {
  return request(
    ops,
    `/api/no-shows/disputes/${id}/ruling`,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { MESSAGE_QUEUE: queue },
  );
}

/** The visit paid for with a credit instead, which the charge spent: it kept no money. */
export const onCredit = (grantExpires = "2027-09-21T06:30:00.000Z") =>
  env.DB.batch([
    env.DB.prepare("DELETE FROM payments"),
    env.DB.prepare("UPDATE no_show_cases SET charge = 'visit', kept_amount = 0, refund_amount = 0"),
    env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
       VALUES ('grant-1', ?1, 'grant', 3, 'referral', 'referral-1', ?2, ?3)`,
    ).bind(PERSON, grantExpires, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       VALUES ('redeem-1', ?1, 'redeem', -1, 'grant-1', 'appointment', ?2, ?3)`,
    ).bind(PERSON, VISIT, NOW.toISOString()),
  ]);
