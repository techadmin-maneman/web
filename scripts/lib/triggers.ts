// Whether the triggers Cloudflare has attached are the ones each Worker's
// config asks for: cron schedules and queue consumers. CI deploys code and
// cannot attach triggers (docs/decisions/0010-applying-triggers.md), so after a
// deploy this compares the live account with the configs of the commit now
// serving. It only reads, and says plainly what its token could not read.
// Routes are not compared here: CI's tokens have no zone permission, and the
// smoke suite proves each host reaches its Workers.

import { z } from "zod";
import type { RemoteEnvironmentName } from "../../src/config/environments.ts";
import { callCloudflare, describeAnswer, isRefused, type ApiAnswer } from "./cloudflare-api.ts";
import type { Finding } from "./findings.ts";
import type { JsonObject } from "./wrangler-config-check.ts";

export interface Triggers {
  readonly crons: readonly string[];
  /** The queues this Worker consumes. */
  readonly consumers: readonly string[];
}

const TriggerKeys = z.object({
  triggers: z.object({ crons: z.array(z.string()) }).optional(),
  queues: z.object({ consumers: z.array(z.object({ queue: z.string() })).optional() }).optional(),
});
const WorkerConfig = TriggerKeys.extend({ env: z.record(z.string(), TriggerKeys).optional() });

/** The triggers a Worker's config attaches in one environment. */
export function configuredTriggers(config: JsonObject, environment: RemoteEnvironmentName): Triggers {
  const parsed = WorkerConfig.parse(config);
  const block = parsed.env?.[environment] ?? {};
  // An environment inherits `triggers` from the top level when it names none; `queues` it never inherits.
  const triggers = block.triggers ?? parsed.triggers;
  return {
    crons: triggers?.crons ?? [],
    consumers: (block.queues?.consumers ?? []).map((consumer) => consumer.queue),
  };
}

export interface TriggerCheck {
  readonly environment: RemoteEnvironmentName;
  readonly accountId: string;
  readonly token: string;
  /** Each Worker's name at the top level, as scripts/lib/workers.ts has it, and its parsed config. */
  readonly workers: readonly { readonly name: string; readonly config: JsonObject }[];
  readonly fetch?: typeof fetch;
}

const Schedules = z.object({ result: z.object({ schedules: z.array(z.object({ cron: z.string() })) }) });

const QueueList = z.object({
  result: z.array(
    z.object({
      queue_name: z.string(),
      consumers: z.array(z.object({ script_name: z.string().optional(), script: z.string().optional() })).optional(),
    }),
  ),
});

/** Cloudflare's error code for "This Worker does not exist on your account". */
const WORKER_NOT_FOUND = 10007;

function isMissingWorker(answer: ApiAnswer): boolean {
  return answer.status === 404 || JSON.stringify(answer.body).includes(`"code":${String(WORKER_NOT_FOUND)}`);
}

/** Where a person goes from a difference, or from something CI could not read. */
function remedies(environment: RemoteEnvironmentName) {
  return {
    apply: `An operator runs: npm run apply-triggers -- --env ${environment} (docs/decisions/0010-applying-triggers.md)`,
    check: `Check it with a token that can read it: node --env-file=<file> scripts/check-triggers.ts ${environment}`,
  };
}

function compare(
  subject: string,
  wanted: readonly string[],
  live: readonly string[],
  environment: RemoteEnvironmentName,
): Finding {
  const missing = wanted.filter((item) => !live.includes(item));
  const extra = live.filter((item) => !wanted.includes(item));
  if (missing.length === 0 && extra.length === 0) {
    return { subject, outcome: "matches", detail: wanted.length === 0 ? "none" : wanted.join(", ") };
  }
  const parts = [];
  if (missing.length > 0) parts.push(`configured but not attached: ${missing.join(", ")}`);
  if (extra.length > 0) parts.push(`attached but not configured: ${extra.join(", ")}`);
  return { subject, outcome: "differs", detail: `${parts.join("; ")}. ${remedies(environment).apply}` };
}

function notRead(subject: string, answer: ApiAnswer, environment: RemoteEnvironmentName): Finding {
  const why = isRefused(answer) ? "this token may not read them" : "Cloudflare did not answer";
  return {
    subject,
    outcome: "not read",
    detail: `not compared: ${why} (${describeAnswer(answer)}). ${remedies(environment).check}`,
  };
}

/** The queues whose consumer is this script, from one listing of the account's queues. */
function queuesConsumedBy(script: string, queues: ApiAnswer): readonly string[] {
  return QueueList.parse(queues.body)
    .result.filter((queue) =>
      (queue.consumers ?? []).some((consumer) => (consumer.script_name ?? consumer.script) === script),
    )
    .map((queue) => queue.queue_name);
}

/** A Worker the account does not have: expected only of an app not yet deployed, which attaches nothing. */
function notOnTheAccount(script: string, wanted: Triggers): Finding {
  if (wanted.crons.length === 0 && wanted.consumers.length === 0) {
    return { subject: script, outcome: "not deployed", detail: "not on the account, and attaches nothing" };
  }
  return { subject: script, outcome: "differs", detail: "not on the account, but its config attaches triggers" };
}

function cronFinding(script: string, wanted: Triggers, schedules: ApiAnswer, environment: RemoteEnvironmentName) {
  const subject = `${script} cron schedules`;
  if (!schedules.ok) return notRead(subject, schedules, environment);
  const live = Schedules.parse(schedules.body).result.schedules.map((schedule) => schedule.cron);
  return compare(subject, wanted.crons, live, environment);
}

function consumerFinding(script: string, wanted: Triggers, queues: ApiAnswer, environment: RemoteEnvironmentName) {
  const subject = `${script} queue consumers`;
  if (!queues.ok) return notRead(subject, queues, environment);
  return compare(subject, wanted.consumers, queuesConsumedBy(script, queues), environment);
}

export async function checkTriggers(check: TriggerCheck): Promise<Finding[]> {
  const { environment } = check;
  const call = (path: string) => callCloudflare(check.token, `/accounts/${check.accountId}${path}`, {}, check.fetch);
  const queues = await call("/queues?per_page=100");

  const findings: Finding[] = [];
  for (const worker of check.workers) {
    const script = `${worker.name}-${environment}`;
    const wanted = configuredTriggers(worker.config, environment);
    const schedules = await call(`/workers/scripts/${script}/schedules`);
    if (isMissingWorker(schedules)) {
      findings.push(notOnTheAccount(script, wanted));
      continue;
    }
    findings.push(cronFinding(script, wanted, schedules, environment));
    findings.push(consumerFinding(script, wanted, queues, environment));
  }
  return findings;
}
