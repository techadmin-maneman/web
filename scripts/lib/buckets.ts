// Whether each R2 bucket an environment's Workers bind exists, and keeps its
// objects as long as it should. The try-on buckets expire everything within 30
// days by a rule set by hand at provisioning (docs/runbook.md, step 1); the
// photograph and referral-card buckets expire nothing. It only reads.
//
// CI's Cloudflare tokens may not touch R2, by design (docs/decisions/0008): a
// token that can read a bucket's settings can read the photographs in it too.
// So in CI this says it checked nothing, and an operator runs it with a token
// of their own (scripts/check-buckets.ts).

import { z } from "zod";
import type { RemoteEnvironmentName } from "../../src/config/environments.ts";
import { callCloudflare, describeAnswer, isRefused, type ApiAnswer } from "./cloudflare-api.ts";
import type { Finding, Outcome } from "./findings.ts";
import type { JsonObject } from "./wrangler-config-check.ts";

export type Retention = "expires within 30 days" | "never expires";

/** Each R2 binding's retention, by binding name. A new binding fails the check until it has one here. */
export const RETENTION: Readonly<Record<string, Retention>> = {
  // Try-on photographs and results. The sweeper deletes them sooner; the rule is its backstop, and what the
  // consent notices promise (docs/decisions/0039-phase-2-budget.md).
  UPLOADS: "expires within 30 days",
  RESULTS: "expires within 30 days",
  // A visit's photographs are deleted only on purpose (docs/decisions/0028-photographs-from-the-app.md).
  CLIENT_PHOTOS: "never expires",
  // A referral card serves its invite until the referrer or a revoke takes it down (docs/decisions/0048-referrals.md).
  REFERRAL_CARDS: "never expires",
};

const THIRTY_DAYS = 30 * 24 * 60 * 60;

const R2Bindings = z.object({
  r2_buckets: z.array(z.object({ binding: z.string(), bucket_name: z.string() })).optional(),
});
const WorkerConfig = z.object({ env: z.record(z.string(), R2Bindings).optional() });

/** The buckets a Worker's config binds in one environment. */
export function boundBuckets(
  config: JsonObject,
  environment: RemoteEnvironmentName,
): { binding: string; bucket: string }[] {
  const block = WorkerConfig.parse(config).env?.[environment];
  return (block?.r2_buckets ?? []).map((entry) => ({ binding: entry.binding, bucket: entry.bucket_name }));
}

const Lifecycle = z.object({
  result: z.object({
    rules: z
      .array(
        z.object({
          enabled: z.boolean(),
          conditions: z.object({ prefix: z.string() }).optional(),
          deleteObjectsTransition: z
            .object({ condition: z.object({ type: z.string(), maxAge: z.number().optional() }) })
            .optional(),
        }),
      )
      .optional(),
  }),
});
type Rule = NonNullable<z.infer<typeof Lifecycle>["result"]["rules"]>[number];

/** An enabled rule that deletes objects at all. */
function deletes(rule: Rule): boolean {
  return rule.enabled && rule.deleteObjectsTransition !== undefined;
}

/** An enabled rule that deletes every object in the bucket once it is at most 30 days old. */
function expiresEverythingWithin30Days(rule: Rule): boolean {
  const condition = rule.deleteObjectsTransition?.condition;
  const wholeBucket = (rule.conditions?.prefix ?? "") === "";
  return deletes(rule) && wholeBucket && condition?.type === "Age" && (condition.maxAge ?? Infinity) <= THIRTY_DAYS;
}

function judge(bucket: string, retention: Retention, rules: readonly Rule[]): Finding {
  const finding = (outcome: Outcome, detail: string): Finding => ({ subject: bucket, outcome, detail });
  if (retention === "expires within 30 days") {
    if (rules.some(expiresEverythingWithin30Days)) return finding("matches", "expires every object within 30 days");
    return finding("differs", "has no enabled rule expiring every object within 30 days (docs/runbook.md, step 1)");
  }
  if (rules.some(deletes))
    return finding("differs", "has a rule that deletes objects, but its objects must never expire");
  return finding("matches", "expires nothing");
}

export interface BucketCheck {
  readonly environment: RemoteEnvironmentName;
  readonly accountId: string;
  readonly token: string;
  /** Every Worker's parsed config; the buckets checked are those they bind. */
  readonly configs: readonly JsonObject[];
  readonly fetch?: typeof fetch;
}

function notRead(check: BucketCheck, answer: ApiAnswer): Finding {
  const why = isRefused(answer) ? "this token may not read R2" : "Cloudflare did not answer";
  return {
    subject: "R2 buckets",
    outcome: "not read",
    detail:
      `not checked: ${why} (${describeAnswer(answer)}). CI's tokens never may (docs/decisions/0008). ` +
      `Check them with an operator's token: node --env-file=<file> scripts/check-buckets.ts ${check.environment}`,
  };
}

export async function checkBuckets(check: BucketCheck): Promise<Finding[]> {
  const call = (path: string) =>
    callCloudflare(check.token, `/accounts/${check.accountId}/r2/buckets/${path}`, {}, check.fetch);
  const bound = check.configs.flatMap((config) => boundBuckets(config, check.environment));

  const findings: Finding[] = [];
  for (const { binding, bucket } of bound) {
    const retention = RETENTION[binding];
    if (retention === undefined) {
      findings.push({
        subject: bucket,
        outcome: "differs",
        detail: `binding ${binding} has no retention in scripts/lib/buckets.ts`,
      });
      continue;
    }

    const exists = await call(bucket);
    if (exists.status === 404) {
      findings.push({
        subject: bucket,
        outcome: "differs",
        detail: "does not exist, and a deploy that binds it fails: create it (docs/runbook.md, step 1)",
      });
      continue;
    }
    if (!exists.ok) return [...findings, notRead(check, exists)];

    const lifecycle = await call(`${bucket}/lifecycle`);
    if (!lifecycle.ok) return [...findings, notRead(check, lifecycle)];
    findings.push(judge(bucket, retention, Lifecycle.parse(lifecycle.body).result.rules ?? []));
  }
  return findings;
}
