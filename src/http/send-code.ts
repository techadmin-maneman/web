// Sends a one-time code after the response has gone (docs/decisions/0030-one-time-codes.md),
// so a real send takes no longer to answer than a challenge that sends nothing. The answer
// is the same either way, so a code that is not sent says why in the log, and only there.
//
// A code that does not go leaves nobody able to sign in, so failures are counted
// by the hour, and the third in an hour tells ops; the next code that does go
// closes the alert (docs/decisions/0067-alerts-and-silent-failures.md).
//
// Every code asked for, a first one or one sent again, counts against its number's day and its address's hour,
// whoever holds the number. Only a code that is sent counts against the day's ceiling, so a number nobody here
// knows costs nothing more and is answered like any other. The client app, the technician app and the site's
// forms each have a ceiling of their own, so none of them can stop another's codes.
//
// A code is always asked for by the phone that receives it, so staging's messaging allowlist never holds one back
// (docs/decisions/0025-phase-2-conflicts-register.md, item 84; ADR 0097) — unless the account is a test record one
// of our own scripts made, marked on the person (people.test_record), which is messaged only on the allowlist like
// any other (src/policy/staging-test-records.ts). Production's allowlist is empty, and production marks no test
// record, so neither changes anything there.

import type { Context } from "hono";
import type { AppEnv } from "./context.ts";
import { onAllowlist, type LoginSettings } from "../config/settings.ts";
import { alertCeilingReached, ceilingReached, takeFromCeiling, type Ceiling } from "../domain/ceilings.ts";
import { countOne, takeOne } from "../domain/rate-limit.ts";
import { indiaDate, indiaHour } from "../lib/india-time.ts";
import { scrubString } from "../log.ts";
import { skipsAddressLimits } from "../policy/staging-test-records.ts";
import type { CodeChannel } from "../providers/codes.ts";
import { afterResponse } from "./after-response.ts";

/** Failed sends in one hour before ops are told: one is a mistyped number, three is the bridge. */
const FAILURES_PER_HOUR_TO_ALERT = 3;

/** Where a code is asked for: the client app's login, the technician app's, or a form on the site. */
export type CodeSurface = "login" | "tech" | "form";

/** How a request for a code is answered: open, or refused because the address, the number or the day is spent. */
export type CodeGate = "open" | "address_spent" | "number_spent" | "busy";

/** The day's ceiling a code counts against: each surface has its own. */
export type CodeCeiling = Extract<Ceiling, "login_code" | "tech_code" | "form_code">;

const CEILING_OF: Readonly<Record<CodeSurface, CodeCeiling>> = {
  login: "login_code",
  tech: "tech_code",
  form: "form_code",
};

function ceilingLimit(login: LoginSettings, ceiling: CodeCeiling): number {
  return ceiling === "tech_code" ? login.techCodeDailyCeiling : login.codeDailyCeiling;
}

/** Whether today's ceiling is reached already; the first refusal of the day tells ops. Counts nothing. */
async function ceilingSpent(c: Context<AppEnv>, ceiling: CodeCeiling, now: Date): Promise<boolean> {
  const limit = ceilingLimit(c.var.config.settings.login, ceiling);
  if (!(await ceilingReached(c.env.DB, ceiling, limit, now))) return false;
  await alertCeilingReached(c.env.DB, c.var.deps.alert, ceiling, limit, now);
  return true;
}

/**
 * Whether one more code may be asked for this number: the surface's ceiling, then the address's codes this hour and
 * the number's today, each counted under the surface's own scope. The answer is the same whoever holds the number,
 * except a staging test record, which skips the address's limit.
 */
export async function mayAskForCode(
  c: Context<AppEnv>,
  input: {
    readonly surface: CodeSurface;
    /** The number as the limits key it (mobileHashOf). */
    readonly mobileHash: string;
    readonly ipHash: string;
    readonly now: Date;
    /** Whether the number is a test record's (src/domain/test-records.ts). */
    readonly testRecord: boolean;
  },
): Promise<CodeGate> {
  if (await ceilingSpent(c, CEILING_OF[input.surface], input.now)) return "busy";
  const { login: limits } = c.var.config.settings;
  const db = c.env.DB;
  const withinAddress =
    skipsAddressLimits(c.var.config.environment, input.testRecord) ||
    (await takeOne(db, {
      scope: `${input.surface}:code:ip`,
      key: input.ipHash,
      window: indiaHour(input.now),
      limit: limits.codeIpHourlyLimit,
    }));
  if (!withinAddress) return "address_spent";
  const withinNumber = await takeOne(db, {
    scope: `${input.surface}:code:mobile`,
    key: input.mobileHash,
    window: indiaDate(input.now),
    limit: limits.codeMobileDailyLimit,
  });
  return withinNumber ? "open" : "number_spent";
}

/**
 * The code a new challenge is made with when it is not a random one: staging's known code for one of our own test
 * records, or locally the fixed code for everyone. Null means a fresh random code.
 */
export function knownCode(login: LoginSettings, testRecord: boolean): string | null {
  if (login.testRecordCode !== null && testRecord) return login.testRecordCode;
  return login.fixedCode;
}

/** A number change's two codes: the known code proves only the number a test record already has, never the new one (PS-35). */
export function numberChangeCodes(
  login: LoginSettings,
  testRecord: boolean,
): { old: string | null; new: string | null } {
  return { old: knownCode(login, testRecord), new: knownCode(login, false) };
}

/**
 * Whether this account's code would be held back by staging's allowlist: only ever true for one of our own
 * scripts' test records (ADR 0097). A real account's code is never held back by it.
 */
function heldBackByAllowlist(c: Context<AppEnv>, sendsTo: string, testRecord: boolean): boolean {
  return testRecord && !onAllowlist(c.var.config.settings.messaging, sendsTo);
}

/**
 * Counts this request's code against the surface's ceiling if it will be sent; false once the ceiling is reached.
 * A number nobody holds is sent nothing and costs nothing, nor does a test record's code the allowlist holds back.
 */
export async function countCode(
  c: Context<AppEnv>,
  surface: CodeSurface,
  sendsTo: string | null,
  testRecord: boolean,
  now: Date,
): Promise<boolean> {
  if (sendsTo === null) return true;
  if (heldBackByAllowlist(c, sendsTo, testRecord)) return true;
  return withinCodeCeiling(c, now, CEILING_OF[surface]);
}

/**
 * Nothing is sent when no account here holds the number, and the caller passes none; nor to a test record one of
 * our own scripts made, off the allowlist. Each is logged as `login_code_not_sent` with its reason. Neither the
 * code nor the number is ever logged.
 */
export async function sendCodeAfterResponse(
  c: Context<AppEnv>,
  mobileE164: string | null,
  testRecord: boolean,
  channel: CodeChannel,
  code: string,
): Promise<void> {
  const { log, deps } = c.var;
  const work = (async () => {
    if (mobileE164 === null) {
      log.info("login_code_not_sent", { channel, reason: "no account holds the number" });
      return;
    }
    if (heldBackByAllowlist(c, mobileE164, testRecord)) {
      log.info("login_code_not_sent", { channel, reason: "number not on the allowlist" });
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
export async function withinCodeCeiling(
  c: Context<AppEnv>,
  now: Date,
  ceiling: CodeCeiling = "login_code",
): Promise<boolean> {
  const limit = ceilingLimit(c.var.config.settings.login, ceiling);
  if (await takeFromCeiling(c.env.DB, ceiling, limit, now)) return true;
  await alertCeilingReached(c.env.DB, c.var.deps.alert, ceiling, limit, now);
  return false;
}
