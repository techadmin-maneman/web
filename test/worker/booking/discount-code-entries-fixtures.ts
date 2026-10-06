// What the discount code entry tests share (discount-code-entries*.test.ts): a code made, a fitted client signed in, a
// service held for them, a code entered on the hold, and the uses each reads back.

import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { makeCodes, type NewCodes } from "../../../src/domain/money/discount-codes.ts";
import { NOW } from "../helpers.ts";
import { asClient, client, fittedInAugust, signedIn, type Call } from "../clients.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";

export const MINUTE = 60_000;

export const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

/** Ten per cent off service visits and first fits, any number of times, once a client. */
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

export const make = (code: Partial<NewCodes> = {}) =>
  makeCodes(
    env.DB,
    { ...TEN_OFF, ...code },
    { actor: { kind: "staff", id: "ops@localhost" }, requestId: "r", now: NOW },
  );

export const cookies = new Map<string, string>();

/** A fitted client, with an address and a session in the app. */
export async function fittedClient(id: string, mobile: string) {
  await client(id, mobile);
  await fittedInAugust(id, `fit-${id}`);
  cookies.set(id, await signedIn(id));
}

export const call = (personId: string, path: string, init: Call = {}, now = NOW) =>
  asClient(cookies.get(personId) ?? "", path, init, { now });

export interface HoldAnswer {
  id: string;
  price: { amount_ex_gst: number; amount: number; gst_percent: number };
  discount: { code: string; amount_ex_gst: number | null; list_price: { amount: number } | null } | null;
}

/** A service visit held on Thursday, in the afternoon unless another window is named: one technician comes. */
export async function heldService(personId: string, now = NOW, window = "afternoon"): Promise<HoldAnswer> {
  const held = await call(
    personId,
    "/api/holds",
    { method: "POST", body: { type: "service", date: "2026-09-24", window } },
    now,
  );
  expect(held.status).toBe(201);
  return held.json<HoldAnswer>();
}

export const enter = (personId: string, holdId: string, code: string, now = NOW) =>
  call(personId, `/api/holds/${holdId}/discount-code`, { method: "POST", body: { code } }, now);

export const uses = () =>
  env.DB.prepare(
    "SELECT hold_id, appointment_id, amount_off, given_by, removed_at IS NOT NULL AS removed FROM discount_code_uses",
  ).all();
