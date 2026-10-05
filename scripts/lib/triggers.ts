// Whether the triggers Cloudflare has attached are the ones each Worker's
// config asks for: cron schedules, and queue consumers with their settings.
// CI deploys code and cannot attach triggers (docs/decisions/0010-applying-triggers.md),
// so after a deploy this compares the live account with the configs of the commit now
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

const ConfiguredConsumer = z.object({
  queue: z.string(),
  max_batch_size: z.number().optional(),
  max_batch_timeout: z.number().optional(),
  max_retries: z.number().optional(),
  max_concurrency: z.number().optional(),
  retry_delay: z.number().optional(),
});
type ConfiguredConsumer = z.infer<typeof ConfiguredConsumer>;

const TriggerKeys = z.object({
  triggers: z.object({ crons: z.array(z.string()) }).optional(),
  queues: z.object({ consumers: z.array(ConfiguredConsumer).optional() }).optional(),
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

/** Each queue consumer a Worker's config attaches in one environment, with its settings. */
function configuredConsumers(config: JsonObject, environment: RemoteEnvironmentName): readonly ConfiguredConsumer[] {
  return WorkerConfig.parse(config).env?.[environment]?.queues?.consumers ?? [];
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

const LiveSettings = z.object({
  batch_size: z.number().nullish(),
  max_wait_time_ms: z.number().nullish(),
  max_retries: z.number().nullish(),
  max_concurrency: z.number().nullish(),
  retry_delay: z.number().nullish(),
});
type LiveSettings = z.infer<typeof LiveSettings>;

const LiveConsumer = z.object({
  script_name: z.string().optional(),
  script: z.string().optional(),
  settings: LiveSettings.optional(),
});

const QueueList = z.object({
  result: z.array(z.object({ queue_name: z.string(), consumers: z.array(LiveConsumer).optional() })),
});

/** Each consumer setting: its name in wrangler.jsonc, its name in the Queues API, and the API's units in one of ours. */
const SETTINGS = [
  { config: "max_batch_size", live: "batch_size", scale: 1 },
  { config: "max_batch_timeout", live: "max_wait_time_ms", scale: 1000 },
  { config: "max_retries", live: "max_retries", scale: 1 },
  { config: "max_concurrency", live: "max_concurrency", scale: 1 },
  { config: "retry_delay", live: "retry_delay", scale: 1 },
] as const;

/** Cloudflare's error code for "This Worker does not exist on your account". */
const WORKER_NOT_FOUND = 10007;

function isMissingWorker(answer: ApiAnswer): boolean {
  return answer.status === 404 || JSON.stringify(answer.body).includes(`"code":${String(WORKER_NOT_FOUND)}`);
}

/** Where a person goes from a difference, or from something CI could not read. */
function remedies(environment: RemoteEnvironmentName) {
  return {
    apply: `An operator runs: npm run apply-triggers -- --env ${environment} (docs/decisions/0010-applying-triggers.md)`,
    check: `Check it with a token that can read it: node --env-file=<file> scripts/release/check-triggers.ts ${environment}`,
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

/** The settings of each queue this script consumes, by queue, from one listing of the account's queues. */
function liveConsumersOf(script: string, queues: ApiAnswer): ReadonlyMap<string, LiveSettings> {
  const consumers = new Map<string, LiveSettings>();
  for (const queue of QueueList.parse(queues.body).result) {
    const consumer = (queue.consumers ?? []).find((each) => (each.script_name ?? each.script) === script);
    if (consumer !== undefined) consumers.set(queue.queue_name, consumer.settings ?? {});
  }
  return consumers;
}

/** "max_retries 5, attached 2" for each setting the config gives that the attached consumer does not have. */
function settingDifferences(wanted: ConfiguredConsumer, live: LiveSettings): string[] {
  const differences: string[] = [];
  for (const setting of SETTINGS) {
    const configured = wanted[setting.config];
    if (configured === undefined) continue;
    const liveValue = live[setting.live];
    const attached = liveValue === null || liveValue === undefined ? "unset" : liveValue / setting.scale;
    if (attached === configured) continue;
    differences.push(`${setting.config} ${String(configured)}, attached ${String(attached)}`);
  }
  return differences;
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
  return compare(subject, wanted.consumers, [...liveConsumersOf(script, queues).keys()], environment);
}

/** Compares each attached consumer's settings with its config; one not attached at all is named by consumerFinding. */
function consumerSettingsFinding(
  script: string,
  wanted: readonly ConfiguredConsumer[],
  queues: ApiAnswer,
  environment: RemoteEnvironmentName,
): Finding {
  const subject = `${script} queue consumer settings`;
  if (!queues.ok) return notRead(subject, queues, environment);
  const live = liveConsumersOf(script, queues);
  const differences: string[] = [];
  for (const consumer of wanted) {
    const liveSettings = live.get(consumer.queue);
    if (liveSettings === undefined) continue;
    const differing = settingDifferences(consumer, liveSettings);
    if (differing.length > 0) differences.push(`${consumer.queue}: ${differing.join(", ")}`);
  }
  if (differences.length === 0) return { subject, outcome: "matches", detail: "as configured" };
  return { subject, outcome: "differs", detail: `${differences.join("; ")}. ${remedies(environment).apply}` };
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
    const consumers = configuredConsumers(worker.config, environment);
    if (consumers.length > 0) findings.push(consumerSettingsFinding(script, consumers, queues, environment));
  }
  return findings;
}
