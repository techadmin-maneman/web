// Each queue consumer gives up, and tells ops, on a delivery its max_retries in wrangler.jsonc still allows.
// A consumer that waits for a later delivery than Cloudflare makes drops a failure without a word.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pollsPerRender } from "../../scripts/lib/free-tier-budget.ts";
import { readJsonc } from "../../scripts/lib/jsonc.ts";
import { DOWNLOAD_QUEUE_RETRIES, MAX_SEND_ATTEMPTS, SUBMIT_ATTEMPTS } from "../../src/config/pipeline.ts";
import { MAX_CONTACT_UPDATE_ATTEMPTS } from "../../src/queues/crm-sync.ts";

/** The most deliveries one render takes: its submits, its polls to the give-up time and one past it, its downloads. */
const RENDER_DELIVERIES = SUBMIT_ATTEMPTS + pollsPerRender() + 1 + DOWNLOAD_QUEUE_RETRIES;

/** The delivery each consumer gives up on, by the queue's name without "mm-" and the environment. */
const LAST_DELIVERY: Readonly<Record<string, number>> = {
  // A contact update's; a lead or an erasure is tried once more on the queue, then by the sweeper.
  "crm-sync": MAX_CONTACT_UPDATE_ATTEMPTS,
  render: RENDER_DELIVERIES,
  messaging: MAX_SEND_ATTEMPTS,
};

const REDELIVERY_DELAY_SECONDS = 30;

const Consumer = z.object({ queue: z.string(), max_retries: z.number(), retry_delay: z.number().optional() });
const Queues = z.object({ queues: z.object({ consumers: z.array(Consumer) }) });
const Config = Queues.extend({ env: z.record(z.string(), Queues) });

/** Every consumer in wrangler.jsonc, the top level's as "local". */
function consumers() {
  const config = Config.parse(readJsonc("wrangler.jsonc"));
  const blocks = [["local", config] as const, ...Object.entries(config.env)];
  return blocks.flatMap(([environment, block]) =>
    block.queues.consumers.map((consumer) => ({ environment, ...consumer })),
  );
}

function lastDeliveryOf(queue: string): number {
  const name = queue.replace(/^mm-/, "").replace(/-(local|staging|prod)$/, "");
  const last = LAST_DELIVERY[name];
  if (last === undefined) throw new Error(`${queue}: no ceiling here for its consumer`);
  return last;
}

describe("queue consumers' delivery ceilings", () => {
  it.each(consumers())("$environment: $queue gives up on a delivery its max_retries allows", (consumer) => {
    const deliveries = consumer.max_retries + 1;
    expect(lastDeliveryOf(consumer.queue)).toBeLessThanOrEqual(deliveries);
  });

  it.each(consumers())("$environment: $queue waits before a redelivery the code did not time", (consumer) => {
    expect(consumer.retry_delay).toBe(REDELIVERY_DELAY_SECONDS);
  });

  it("covers every consumer in all three environments", () => {
    const environments = new Set(consumers().map((consumer) => consumer.environment));
    expect([...environments]).toEqual(["local", "staging", "production"]);
  });

  it("lets a CRM contact update reach its fifth try, where ops are told", () => {
    expect(MAX_CONTACT_UPDATE_ATTEMPTS).toBe(5);
    const crmSync = consumers().filter((consumer) => consumer.queue.startsWith("mm-crm-sync-"));
    expect(crmSync.map((consumer) => consumer.max_retries)).toEqual([5, 5, 5]);
  });
});
