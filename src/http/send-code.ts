// Sends a one-time code after the response has gone (docs/decisions/0030-one-time-codes.md),
// so a real send takes no longer to answer than a challenge that sends nothing. The answer
// is the same either way, so a code that is not sent says why in the log, and only there.
//
// A code that does not go leaves nobody able to sign in, so failures are counted
// by the hour, and the third in an hour tells ops; the next code that does go
// closes the alert (docs/decisions/0067-alerts-and-silent-failures.md).
//
// Only a code that is sent counts against the day's ceiling, which clients,
// technicians and number changes share. A number nobody here knows costs its
// address instead, so asking for random numbers cannot lock everyone out.
//
// A code is always asked for by the phone that receives it, so staging's messaging allowlist never holds one back
// (docs/decisions/0025-phase-2-conflicts-register.md, item 84; ADR 0097). Production's allowlist is empty, so
// this changes nothing there.

import type { Context } from "hono";
import type { AppEnv } from "./context.ts";
import { alertCeilingReached, ceilingReached, takeFromCeiling } from "../domain/ceilings.ts";
import { countOne, isSpent, takeOne } from "../domain/rate-limit.ts";
import { saltedHash } from "../lib/hash.ts";
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
 * Whether a new login code may be asked for this number, before anyone is looked up: the gate above, then the
 * address's codes this hour and the number's today, each counted under its surface's own scope
 * (docs/decisions/0030-one-time-codes.md). A code resent on its challenge answers to the gate alone.
 */
export async function mayAskForCode(
  c: Context<AppEnv>,
  input: {
    readonly surface: "login" | "tech";
    readonly mobileE164: string;
    readonly ipHash: string;
    readonly now: Date;
  },
): Promise<CodeGate> {
  const gate = await codeGate(c, input.ipHash, input.now);
  if (gate !== "open") return gate;
  const { login: limits, ipHashSalt } = c.var.config.settings;
  const db = c.env.DB;
  const withinAddress = await takeOne(db, {
    scope: `${input.surface}:code:ip`,
    key: input.ipHash,
    window: indiaHour(input.now),
    limit: limits.codeIpHourlyLimit,
  });
  const withinNumber =
    withinAddress &&
    (await takeOne(db, {
      scope: `${input.surface}:code:mobile`,
      key: await saltedHash(ipHashSalt, `mobile:${input.mobileE164}`),
      window: indiaDate(input.now),
      limit: limits.codeMobileDailyLimit,
    }));
  return withinNumber ? "open" : "rate_limited";
}

/**
 * Counts what this request's code costs: one from the day's ceiling if it will
 * be sent, false once the ceiling is reached; one from its address's day if the
 * number is nobody's.
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
  return withinCodeCeiling(c, now);
}

/**
 * Nothing is sent when no account here holds the number, and the caller passes none. That is logged as
 * `login_code_not_sent` with its reason. Neither the code nor the number is ever logged.
 */
export async function sendCodeAfterResponse(
  c: Context<AppEnv>,
  mobileE164: string | null,
  channel: CodeChannel,
  code: string,
): Promise<void> {
  const { log, deps } = c.var;
  const work = (async () => {
    if (mobileE164 === null) {
      log.info("login_code_not_sent", { channel, reason: "no account holds the number" });
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
