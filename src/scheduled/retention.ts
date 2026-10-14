// The cron's retention job (src/policy/retention.ts): each hour, a few dormant people erased as any erasure is, old
// check-in coordinates blanked, waitlist entries of areas launched a year ago deleted, and the rows past their periods
// of the tables that only grew.

import { eraseAndQueue } from "../domain/privacy/erasure.ts";
import { blankOldCoordinates, dormantPeople, dropExpired, dropLaunchedWaitlist } from "../domain/privacy/retention.ts";
import { ERASED_PER_RUN } from "../policy/retention.ts";
import type { CronContext } from "./cron.ts";

export async function retentionJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  const blanked = await blankOldCoordinates(env.DB, now, (await inputs()).disputeWindowDays);
  const dropped = await dropLaunchedWaitlist(env.DB, now);
  const expired = await dropExpired(env.DB, now);
  let erased = 0;
  for (const personId of await dormantPeople(env.DB, now, ERASED_PER_RUN)) {
    const summary = await eraseAndQueue(env, personId, {
      audit: {
        surface: "public",
        actor: { kind: "system", id: "retention" },
        action: "person.erase",
        subject: { kind: "person", id: personId },
        requestId: null,
        detail: { reason: "dormant" },
      },
      payments: deps.payments,
      alertOnce: deps.alertOnce,
      requestId: "retention",
      now,
      log,
    });
    if (summary !== null) erased += 1;
  }
  if (blanked + dropped + erased + expired > 0)
    log.info("retention", { erased, coordinates_blanked: blanked, waitlist_dropped: dropped, rows_expired: expired });
}
