// The read-only check that the triggers Cloudflare has attached are the ones
// each Worker's config asks for (scripts/check-triggers.ts,
// docs/decisions/0010-applying-triggers.md), against a fake account.

import { describe, expect, it } from "vitest";
import { readJsonc } from "../../scripts/lib/jsonc.ts";
import type { Finding } from "../../scripts/lib/findings.ts";
import { checkTriggers, configuredTriggers } from "../../scripts/lib/triggers.ts";
import { WORKERS } from "../../scripts/lib/workers.ts";

const API = readJsonc("wrangler.jsonc");
const APP = readJsonc("apps/app/wrangler.jsonc");
const CONSUMERS = ["mm-crm-sync-staging", "mm-render-staging", "mm-messaging-staging", "mm-fsm-sync-staging"];

describe("what each Worker's config attaches", () => {
  it("mm-api: the sweeper's cron and a consumer for each queue it reads", () => {
    const triggers = configuredTriggers(API, "staging");
    expect(triggers.crons).toEqual(["*/5 * * * *"]);
    expect([...triggers.consumers].sort()).toEqual([...CONSUMERS].sort());
    expect(configuredTriggers(API, "production").consumers).toContain("mm-fsm-sync-prod");
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

function queuesConsumedBy(script: string, queues: readonly string[]): Answer {
  return ok(queues.map((queue) => ({ queue_name: queue, consumers: [{ type: "worker", script_name: script }] })));
}

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
  const cron = ok({ schedules: [{ cron: "*/5 * * * *" }] });

  it("matches when every cron and consumer the configs ask for is attached, and nothing else", async () => {
    const findings = await check({
      [QUEUES]: queuesConsumedBy("mm-api-staging", CONSUMERS),
      "/workers/scripts/mm-api-staging/schedules": cron,
      "/workers/scripts/mm-app-staging/schedules": ok({ schedules: [] }),
    });
    expect(outcomes(findings)).toEqual([
      "mm-api-staging cron schedules: matches",
      "mm-api-staging queue consumers: matches",
      "mm-app-staging cron schedules: matches",
      "mm-app-staging queue consumers: matches",
    ]);
  });

  it("names a consumer the config added that no one has attached, and says how to attach it", async () => {
    const findings = await check({
      [QUEUES]: queuesConsumedBy("mm-api-staging", CONSUMERS.slice(0, 3)),
      "/workers/scripts/mm-api-staging/schedules": cron,
      "/workers/scripts/mm-app-staging/schedules": ok({ schedules: [] }),
    });
    const consumers = findings.find((finding) => finding.subject === "mm-api-staging queue consumers");
    expect(consumers?.outcome).toBe("differs");
    expect(consumers?.detail).toContain("configured but not attached: mm-fsm-sync-staging");
    expect(consumers?.detail).toContain("npm run apply-triggers -- --env staging");
  });

  it("names a cron still attached that the config no longer has", async () => {
    const findings = await check({
      [QUEUES]: queuesConsumedBy("mm-api-staging", CONSUMERS),
      "/workers/scripts/mm-api-staging/schedules": ok({ schedules: [{ cron: "*/5 * * * *" }, { cron: "0 3 * * *" }] }),
      "/workers/scripts/mm-app-staging/schedules": ok({ schedules: [] }),
    });
    expect(findings[0]?.outcome).toBe("differs");
    expect(findings[0]?.detail).toContain("attached but not configured: 0 3 * * *");
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
