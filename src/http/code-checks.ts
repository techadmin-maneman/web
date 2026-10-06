// How often a discount code may be checked (src/policy/discount-codes.ts, CODE_CHECKS;
// docs/decisions/0108-discount-codes.md): every check is counted, right or wrong, against whoever is entering it and
// against the address it comes from, so a code cannot be found by guessing. The site's form needs none of its own:
// its Turnstile check and daily limits already hold each number and address to a few bookings a day.

import type { Context } from "hono";
import { takeOne } from "../domain/sign-in/rate-limit.ts";
import type { AppEnv } from "./context.ts";
import { visitorOf } from "./visitor.ts";

/** Counts one check by this client or technician, by their ID; false once either limit is spent. */
export async function mayCheckCode(c: Context<AppEnv>, who: string): Promise<boolean> {
  const db = c.env.DB;
  const now = c.var.deps.now();
  const { ipHash } = await visitorOf(c);
  const at = { now, settings: c.var.config.settings };
  if (!(await takeOne(db, "discount_code:ip", ipHash, at))) return false;
  return takeOne(db, "discount_code:person", who, at);
}
