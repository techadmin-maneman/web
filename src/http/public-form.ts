// What the site's booking and waitlist forms check of the person sending them: their number, their Turnstile
// token, and the day's limits per number and address (docs/decisions/0051-booking-from-the-site.md). The booking
// itself is src/domain/public-booking.ts, handed this request as a FormRequest.

import type { Context } from "hono";
import type { Checked, FormRequest } from "../domain/public-booking.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { isTestNumber } from "../domain/test-records.ts";
import { saltedHash } from "../lib/hash.ts";
import { indiaDate } from "../lib/india-time.ts";
import { toE164 } from "../lib/mobile.ts";
import { skipsAddressLimits } from "../policy/staging-test-records.ts";
import { bookHold } from "./book-hold.ts";
import { queueContactSync } from "./contact-sync.ts";
import type { AppEnv } from "./context.ts";
import { provedNumber } from "./number-proof.ts";
import { checkTurnstile, visitorOf } from "./visitor.ts";

/** The number, the Turnstile check and the daily limits, the same for both pages. */
async function checkPerson(c: Context<AppEnv>, mobile: string, token: string, name: string): Promise<Checked> {
  const mobileE164 = toE164(mobile);
  if (mobileE164 === null) return { ok: false, status: 400, code: "invalid_request", fields: ["mobile"] };
  const visitor = await visitorOf(c);
  const turnstile = await checkTurnstile(c, token, visitor);
  if (turnstile === "rejected") return { ok: false, status: 403, code: "turnstile_failed" };
  if (turnstile === "unavailable") return { ok: false, status: 503, code: "unavailable" };
  const { settings, environment } = c.var.config;
  const today = indiaDate(c.var.deps.now());
  const db = c.env.DB;
  // The address first: a refusal of the address costs the number nothing. Only staging lets a test record past it.
  const testRecord = environment === "staging" && (await isTestNumber(db, environment, mobileE164, name));
  const within =
    (skipsAddressLimits(environment, testRecord) ||
      (await takeOne(db, {
        scope: "booking:ip",
        key: visitor.ipHash,
        window: today,
        limit: settings.leadIpDailyLimit,
      }))) &&
    (await takeOne(db, {
      scope: "booking:mobile",
      key: await saltedHash(settings.ipHashSalt, `mobile:${mobileE164}`),
      window: today,
      limit: settings.leadMobileDailyLimit,
    }));
  if (!within) return { ok: false, status: 429, code: "rate_limited" };
  return { ok: true, mobile: mobileE164, ipHash: visitor.ipHash };
}

/** What src/domain/public-booking.ts needs of this request. */
export function formRequest(c: Context<AppEnv>): FormRequest {
  return {
    db: c.env.DB,
    queues: { crm: c.env.CRM_QUEUE, messages: c.env.MESSAGE_QUEUE },
    log: c.var.log,
    requestId: c.var.requestId,
    now: c.var.deps.now(),
    environment: c.var.config.environment,
    selfServeBooking: c.var.config.settings.selfServeBooking,
    checkPerson: (mobile, token, name) => checkPerson(c, mobile, token, name),
    provedNumber: (codeId, mobileE164) => provedNumber(c, codeId, mobileE164),
    syncContact: (personId) => queueContactSync(c, personId),
    bookHold: (holdId) => bookHold(c, holdId),
  };
}
