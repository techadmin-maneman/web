// Sends a one-time code after the response has gone (docs/decisions/0030-one-time-codes.md),
// so a real send takes no longer to answer than a challenge that sends nothing.
//
// A code that does not go leaves nobody able to sign in, so failures are counted
// by the hour, and the third in an hour tells ops; the next code that does go
// closes the alert (docs/decisions/0067-alerts-and-silent-failures.md).

import type { Context } from "hono";
import type { AppEnv } from "../app.ts";
import { onAllowlist } from "../config/settings.ts";
import { alertCeilingReached, takeFromCeiling } from "../domain/ceilings.ts";
import { countOne } from "../domain/rate-limit.ts";
import { indiaHour } from "../lib/india-time.ts";
import { scrubString } from "../log.ts";
import type { CodeChannel } from "../providers/codes.ts";
import { afterResponse } from "./after-response.ts";

/** Failed sends in one hour before ops are told: one is a mistyped number, three is the bridge. */
const FAILURES_PER_HOUR_TO_ALERT = 3;

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
