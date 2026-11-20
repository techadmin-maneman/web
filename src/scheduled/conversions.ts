// The cron's attribution jobs (docs/decisions/0288-attribution-and-conversions.md): the conversions waiting, sent to
// each platform that is on; and each hour, old leads given their touches and what retention lets go of let go.

import { letAttributionGo, touchOldLeads } from "../domain/attribution/backfill.ts";
import { sendConversions } from "../domain/attribution/conversion-sends.ts";
import { createConversionPlatforms } from "../providers/conversions/index.ts";
import type { CronContext } from "./cron.ts";

export async function conversionsJob({ env, deps, config, log, budget }: CronContext): Promise<void> {
  const platforms = createConversionPlatforms(config.providers, config.settings.conversions, {
    fetch: deps.fetch,
    log,
    now: deps.now,
  });
  await sendConversions(env.DB, platforms, { now: deps.now(), budget, log });
}

export async function attributionUpkeepJob({ env, deps, log }: CronContext): Promise<void> {
  const touched = await touchOldLeads(env.DB);
  if (touched > 0) log.info("old_leads_touched", { leads: touched });
  await letAttributionGo(env.DB, deps.now());
}
