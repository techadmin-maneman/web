// The read-only check that the triggers Cloudflare has attached are the ones
// each Worker's config asks for (scripts/check-triggers.ts,
// docs/decisions/0010-applying-triggers.md), against a fake account.

import { describe, expect, it } from "vitest";
import { EVERY_MINUTE } from "../../src/scheduled/schedule.ts";
import { readJsonc } from "../../scripts/lib/jsonc.ts";
import type { Finding } from "../../scripts/lib/findings.ts";
import { checkTriggers, configuredTriggers } from "../../scripts/lib/triggers.ts";
import { WORKERS } from "../../scripts/lib/workers.ts";

const API = readJsonc("wrangler.jsonc");
const APP = readJsonc("apps/app/wrangler.jsonc");
const CONSUMERS = ["mm-crm-sync-staging", "mm-render-staging", "mm-messaging-staging"];

describe("what each Worker's config attaches", () => {
  it("mm-api: the every-minute cron and a consumer for each queue it reads", () => {
    const triggers = configuredTriggers(API, "staging");
    expect(triggers.crons).toEqual([EVERY_MINUTE]);
    expect(configuredTriggers(API, "production").crons).toEqual([EVERY_MINUTE]);
    expect([...triggers.consumers].sort()).toEqual([...CONSUMERS].sort());
    expect(configuredTriggers(API, "production").consumers).toContain("mm-messaging-prod");
  });

  it.each(WORKERS.filter((worker) => worker.kind !== "api"))("$name: nothing", (worker) => {
    const config = readJsonc(worker.config);
    for (const environment of ["staging", "production"] as const) {
      expect(configuredTriggers(config, environment)).toEqual({ crons: [], consumers: [] });
    }
  });
});

type Answer = { status: number; body: unknown };

const ok = (result: unknown): Answer => ({ status: 200, body: { success: true, errors: [], result } });
const refused: Answer = {
  status: 403,
  body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
};
const missing: Answer = {
  status: 404,
  body: { success: false, errors: [{ code: 10007, message: "This Worker does not exist on your account." }] },
};

/** A fake account answering each path from `answers`; any other path is a Worker that does not exist. */
function account(answers: Record<string, Answer>): typeof fetch {
  return (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    const path = url.replace("https://api.cloudflare.com/client/v4/accounts/acct", "");
    const answer = answers[path] ?? missing;
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
  };
}

const QUEUES = "/queues?per_page=100";

interface ConfiguredConsumer {
  queue: string;
  max_batch_size: number;
  max_batch_timeout: number;
  max_retries: number;
  max_concurrency?: number;
  retry_delay: number;
}
type StagingConfig = { env: { staging: { queues: { consumers: ConfiguredConsumer[] } } } };
const STAGING_CONSUMERS = (API as unknown as StagingConfig).env.staging.queues.consumers;

/** A consumer's settings as the Queues API lists them once it is attached as the config asks. */
function settingsAsConfigured(queue: string) {
  const consumer = STAGING_CONSUMERS.find((each) => each.queue === queue);
  if (consumer === undefined) throw new Error(`${queue} is not in the staging config`);
  return {
    batch_size: consumer.max_batch_size,
    max_wait_time_ms: consumer.max_batch_timeout * 1000,
    max_retries: consumer.max_retries,
    max_concurrency: consumer.max_concurrency,
    retry_delay: consumer.retry_delay,
  };
}

function queuesConsumedBy(script: string, queues: readonly string[]): Answer {
  return ok(
    queues.map((queue) => ({
      queue_name: queue,
      consumers: [{ type: "worker", script_name: script, settings: settingsAsConfigured(queue) }],
    })),
  );
}

function liveQueue(queue: string, settings: Record<string, number>) {
  return { queue_name: queue, consumers: [{ type: "worker", script: "mm-api-staging", settings }] };
}

/** What staging's queues answered on 4 Oct 2026, before crm-sync's retries were raised and retry_delay was set. */
const STAGING_ON_4_OCTOBER = ok([
  liveQueue("mm-crm-sync-staging", {
    batch_size: 10,
    max_retries: 2,
    max_wait_time_ms: 5000,
    max_concurrency: 1,
    retry_delay: 0,
  }),
  liveQueue("mm-fsm-sync-staging", {
    batch_size: 10,
    max_retries: 5,
    max_wait_time_ms: 5000,
    max_concurrency: 1,
    retry_delay: 0,
  }),
  liveQueue("mm-messaging-staging", {
    batch_size: 5,
    max_retries: 5,
    max_wait_time_ms: 5000,
    max_concurrency: 1,
    retry_delay: 0,
  }),
  liveQueue("mm-render-staging", { batch_size: 5, max_retries: 100, max_wait_time_ms: 1000, retry_delay: 0 }),
]);

async function check(answers: Record<string, Answer>): Promise<Finding[]> {
  return checkTriggers({
    environment: "staging",
    accountId: "acct",
    token: "t",
    workers: [
      { name: "mm-api", config: API },
      { name: "mm-app", config: APP },
    ],
    fetch: account(answers),
  });
}

const outcomes = (findings: Finding[]) => findings.map((finding) => `${finding.subject}: ${finding.outcome}`);

describe("the live account against the configs", () => {
  const cron = ok({ schedules: [{ cron: EVERY_MINUTE }] });

  it("matches when every cron and consumer the configs ask for is attached, and nothing else", async () => {
    const findings = await check({
      [QUEUES]: queuesConsumedBy("mm-api-staging", CONSUMERS),
      "/workers/scripts/mm-api-staging/schedules": cron,
      "/workers/scripts/mm-app-staging/schedules": ok({ schedules: [] }),
    });
    expect(outcomes(findings)).toEqual([
      "mm-api-staging cron schedules: matches",
      "mm-api-staging queue consumers: matches",
      "mm-api-staging queue consumer settings: matches",
      "mm-app-staging cron schedules: matches",
      "mm-app-staging queue consumers: matches",
    ]);
  });

  it("names a consumer the config added that no one has attached, and says how to attach it", async () => {
    const findings = await check({
      [QUEUES]: queuesConsumedBy("mm-api-staging", CONSUMERS.slice(0, 2)),
      "/workers/scripts/mm-api-staging/schedules": cron,
      "/workers/scripts/mm-app-staging/schedules": ok({ schedules: [] }),
    });
    const consumers = findings.find((finding) => finding.subject === "mm-api-staging queue consumers");
    expect(consumers?.outcome).toBe("differs");
    expect(consumers?.detail).toContain("configured but not attached: mm-messaging-staging");
    expect(consumers?.detail).toContain("npm run apply-triggers -- --env staging");
    const settings = findings.find((finding) => finding.subject === "mm-api-staging queue consumer settings");
    expect(settings?.outcome).toBe("matches");
  });

  it("names each setting an attached consumer does not have yet, in the config's own terms", async () => {
    const findings = await check({
      [QUEUES]: STAGING_ON_4_OCTOBER,
      "/workers/scripts/mm-api-staging/schedules": cron,
      "/workers/scripts/mm-app-staging/schedules": ok({ schedules: [] }),
    });
    expect(findings.find((finding) => finding.subject === "mm-api-staging queue consumers")?.outcome).toBe("matches");
    const settings = findings.find((finding) => finding.subject === "mm-api-staging queue consumer settings");
    expect(settings?.outcome).toBe("differs");
    expect(settings?.detail).toContain("mm-crm-sync-staging: max_retries 5, attached 2, retry_delay 30, attached 0");
    expect(settings?.detail).toContain("mm-render-staging: retry_delay 30, attached 0");
    expect(settings?.detail).not.toContain("max_batch_timeout");
    expect(settings?.detail).not.toContain("max_concurrency");
    expect(settings?.detail).toContain("npm run apply-triggers -- --env staging");
  });

  // The five-minute cron stays attached after the deploy that moved to every minute, until an operator applies it.
  it("names a cron still attached that the config no longer has", async () => {
    const findings = await check({
      [QUEUES]: queuesConsumedBy("mm-api-staging", CONSUMERS),
      "/workers/scripts/mm-api-staging/schedules": ok({ schedules: [{ cron: "*/5 * * * *" }] }),
      "/workers/scripts/mm-app-staging/schedules": ok({ schedules: [] }),
    });
    expect(findings[0]?.outcome).toBe("differs");
    expect(findings[0]?.detail).toContain("configured but not attached: * * * * *");
    expect(findings[0]?.detail).toContain("attached but not configured: */5 * * * *");
  });

  it("says plainly what it could not read, rather than calling it a match or a failure", async () => {
    const findings = await check({
      [QUEUES]: refused,
      "/workers/scripts/mm-api-staging/schedules": cron,
      "/workers/scripts/mm-app-staging/schedules": ok({ schedules: [] }),
    });
    const consumers = findings.find((finding) => finding.subject === "mm-api-staging queue consumers");
    expect(consumers?.outcome).toBe("not read");
    expect(consumers?.detail).toContain("HTTP 403");
    expect(consumers?.detail).toContain("scripts/check-triggers.ts staging");
    const settings = findings.find((finding) => finding.subject === "mm-api-staging queue consumer settings");
    expect(settings?.outcome).toBe("not read");
  });

  it("passes over an app that is not deployed and attaches nothing", async () => {
    const findings = await check({
      [QUEUES]: queuesConsumedBy("mm-api-staging", CONSUMERS),
      "/workers/scripts/mm-api-staging/schedules": cron,
    });
    expect(outcomes(findings).at(-1)).toBe("mm-app-staging: not deployed");
  });

  it("reports a Worker whose config attaches triggers but which is not on the account", async () => {
    const findings = await check({ [QUEUES]: ok([]) });
    expect(outcomes(findings)[0]).toBe("mm-api-staging: differs");
  });
});
