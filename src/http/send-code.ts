// Sends a one-time code after the response has gone (docs/decisions/0030-one-time-codes.md),
// so a real send takes no longer to answer than a challenge that sends nothing.
//
// A code that does not go leaves nobody able to sign in, so failures are counted
// by the hour, and the third in an hour tells ops; the next code that does go
// closes the alert (docs/decisions/0067-alerts-and-silent-failures.md).
//
// Only a code that is sent counts against the day's ceiling, which clients,
// technicians and number changes share. A number nobody here knows costs its
// address instead, so asking for random numbers cannot lock everyone out.

import type { Context } from "hono";
import type { AppEnv } from "../app.ts";
import { onAllowlist } from "../config/settings.ts";
import { alertCeilingReached, ceilingReached, takeFromCeiling } from "../domain/ceilings.ts";
import { countOne, isSpent } from "../domain/rate-limit.ts";
import { indiaDate, indiaHour } from "../lib/india-time.ts";
import { scrubString } from "../log.ts";
import type { CodeChannel } from "../providers/codes.ts";
import { afterResponse } from "./after-response.ts";

/** Failed sends in one hour before ops are told: one is a mistyped number, three is the bridge. */
const FAILURES_PER_HOUR_TO_ALERT = 3;

/**
 * Numbers nobody here knows that one address may ask a code for in a day. Past
 * them the address is refused every number until midnight in India, so the
 * refusal never says whether the number asked for is a real one.
 */
export const UNKNOWN_NUMBERS_PER_ADDRESS_DAILY = 20;

const unknownNumbers = (ipHash: string, now: Date) => ({
  scope: "login:unknown:ip",
  key: ipHash,
  window: indiaDate(now),
  limit: UNKNOWN_NUMBERS_PER_ADDRESS_DAILY,
});

/** How a request for a code is answered before anyone is looked up. */
export type CodeGate = "open" | "rate_limited" | "busy";

/**
 * Asked before the number is looked up, so every number gets the same answer:
 * refused while the address has spent its day of unknown numbers, and busy
 * while the day's ceiling is reached.
 */
export async function codeGate(c: Context<AppEnv>, ipHash: string, now: Date): Promise<CodeGate> {
  if (await isSpent(c.env.DB, unknownNumbers(ipHash, now))) return "rate_limited";
  const { codeDailyCeiling } = c.var.config.settings.login;
  if (!(await ceilingReached(c.env.DB, "login_code", codeDailyCeiling, now))) return "open";
  await alertCeilingReached(c.env.DB, c.var.deps.alert, "login_code", codeDailyCeiling, now);
  return "busy";
}

/**
 * Counts what this request's code costs: one from the day's ceiling if it will
 * be sent, false once the ceiling is reached; one from its address's day if the
 * number is nobody's. A code the staging allowlist holds back costs nothing.
 */
export async function countCode(
  c: Context<AppEnv>,
  sendsTo: string | null,
  ipHash: string,
  now: Date,
): Promise<boolean> {
  if (sendsTo === null) {
    await countOne(c.env.DB, unknownNumbers(ipHash, now));
    return true;
  }
  if (!onAllowlist(c.var.config.settings.messaging, sendsTo)) return true;
  return withinCodeCeiling(c, now);
}

/** Nothing is sent without a number, nor, on staging, to a number off the allowlist. The code is never logged. */
export async function sendCodeAfterResponse(
  c: Context<AppEnv>,
  mobileE164: string | null,
  channel: CodeChannel,
  code: string,
): Promise<void> {
  if (mobileE164 === null) return;
  const { log, deps, config } = c.var;
  const work = (async () => {
    if (!onAllowlist(config.settings.messaging, mobileE164)) {
      log.info("login_code_skipped", { channel, reason: "number not on the allowlist" });
      return;
    }
    const result = await deps.codes.send(channel, mobileE164, code);
    if (result.ok) {
      log.info("login_code_sent", { channel });
      await deps.resolveAlert("login_codes_failing");
      return;
    }
    const detail = scrubString(result.detail).slice(0, 200);
    log.warn("login_code_failed", { channel, detail });
    await countFailure(c, detail);
  })().catch((error: unknown) => {
    log.error("login_code_error", { channel, error });
  });
  await afterResponse(c, work);
}

async function countFailure(c: Context<AppEnv>, detail: string): Promise<void> {
  const window = indiaHour(c.var.deps.now());
  const failed = await countOne(c.env.DB, { scope: "login_code_failed", key: "all", window });
  if (failed < FAILURES_PER_HOUR_TO_ALERT) return;
  await c.var.deps.alertOnce({
    key: "login_codes_failing",
    message:
      `${String(failed)} login codes failed to send in the last hour, the latest with ${detail}. Clients and ` +
      'technicians cannot sign in. Check the WhatsApp bridge (runbook, "WhatsApp (Evolution) is down").',
  });
}

/** One more code today, counted across every number; false, with one alert a day, once the ceiling is reached. */
export async function withinCodeCeiling(c: Context<AppEnv>, now: Date): Promise<boolean> {
  const { login } = c.var.config.settings;
  if (await takeFromCeiling(c.env.DB, "login_code", login.codeDailyCeiling, now)) return true;
  await alertCeilingReached(c.env.DB, c.var.deps.alert, "login_code", login.codeDailyCeiling, now);
  return false;
}
