// Sends a one-time code after the response has gone (docs/decisions/0030-one-time-codes.md),
// so a real send takes no longer to answer than a challenge that sends nothing.

import type { Context } from "hono";
import type { AppEnv } from "../app.ts";
import { alertCeilingReached, takeFromCeiling } from "../domain/ceilings.ts";
import { scrubString } from "../log.ts";
import type { CodeChannel } from "../providers/codes.ts";
import { afterResponse } from "./after-response.ts";

/** Nothing is sent without a number, nor, on staging, to a number off the allowlist. The code is never logged. */
export async function sendCodeAfterResponse(
  c: Context<AppEnv>,
  mobileE164: string | null,
  channel: CodeChannel,
  code: string,
): Promise<void> {
  if (mobileE164 === null) return;
  const { log, deps, config } = c.var;
  const { allowlist } = config.settings.messaging;
  const work = (async () => {
    if (allowlist.length > 0 && !allowlist.includes(mobileE164)) {
      log.info("login_code_skipped", { channel, reason: "number not on the allowlist" });
      return;
    }
    const result = await deps.codes.send(channel, mobileE164, code);
    if (result.ok) log.info("login_code_sent", { channel });
    else log.warn("login_code_failed", { channel, detail: scrubString(result.detail).slice(0, 200) });
  })().catch((error: unknown) => {
    log.error("login_code_error", { channel, error });
  });
  await afterResponse(c, work);
}

/** One more code today, counted across every number; false, with one alert a day, once the ceiling is reached. */
export async function withinCodeCeiling(c: Context<AppEnv>, now: Date): Promise<boolean> {
  const { login } = c.var.config.settings;
  if (await takeFromCeiling(c.env.DB, "login_code", login.codeDailyCeiling, now)) return true;
  await alertCeilingReached(c.env.DB, c.var.deps.alert, "login_code", login.codeDailyCeiling, now);
  return false;
}
