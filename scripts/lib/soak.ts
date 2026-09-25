// The production canary's soak, judged on real visitors' requests as well as
// the smoke's. Workers analytics counts each version's invocations and the ones
// that errored (an uncaught exception, a limit exceeded), so while the new
// version serves its share, its error rate is compared with the old one's.
//
// Reading analytics needs Account Analytics: Read, which a CI token may not
// have. Then the soak says so and the smoke checks stand alone, as before
// (docs/decisions/0006-deployment-pipeline.md).

import { z } from "zod";
import { callCloudflare, describeAnswer, type ApiAnswer } from "./cloudflare-api.ts";

export interface Invocations {
  readonly requests: number;
  readonly errors: number;
}

/** Fewer of the new version's requests than this say nothing either way. */
const MIN_REQUESTS = 50;
/** An error rate the new version may always have: a little noise is not a failed release. */
const ALLOWED_ERROR_RATE = 0.01;
/** Beyond that, the new version fails once it errors this many times as often as the old one. */
const TIMES_THE_OLD_RATE = 2;

export interface Verdict {
  readonly outcome: "passed" | "failed" | "not judged";
  readonly detail: string;
}

function rate({ requests, errors }: Invocations): number {
  return requests === 0 ? 0 : errors / requests;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function judgeSoak(newVersion: Invocations, oldVersion: Invocations): Verdict {
  const counts = `new ${String(newVersion.errors)} of ${String(newVersion.requests)}, old ${String(oldVersion.errors)} of ${String(oldVersion.requests)}`;
  if (newVersion.requests < MIN_REQUESTS) {
    return { outcome: "not judged", detail: `too few requests to judge (${counts}); the smoke checks stand alone` };
  }
  const limit = Math.max(ALLOWED_ERROR_RATE, TIMES_THE_OLD_RATE * rate(oldVersion));
  const detail = `new version errored on ${percent(rate(newVersion))}, old on ${percent(rate(oldVersion))} (${counts})`;
  return { outcome: rate(newVersion) > limit ? "failed" : "passed", detail };
}

const QUERY = `query SoakInvocations($accountTag: string!, $script: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(
        limit: 1000
        filter: { scriptName: $script, datetime_geq: $since, datetime_leq: $until }
      ) {
        sum { requests errors }
        dimensions { scriptVersion }
      }
    }
  }
}`;

const Answer = z.object({
  data: z
    .object({
      viewer: z.object({
        accounts: z.array(
          z.object({
            workersInvocationsAdaptive: z.array(
              z.object({
                sum: z.object({ requests: z.number(), errors: z.number() }),
                dimensions: z.object({ scriptVersion: z.string() }),
              }),
            ),
          }),
        ),
      }),
    })
    .nullable(),
  errors: z
    .array(z.object({ message: z.string() }))
    .nullable()
    .optional(),
});

export interface InvocationQuery {
  readonly token: string;
  readonly accountId: string;
  /** The deployed Worker's name, e.g. mm-api-production. */
  readonly script: string;
  readonly since: Date;
  readonly until: Date;
  readonly fetch?: typeof fetch;
}

export type Reading = { readonly byVersion: Readonly<Record<string, Invocations>> } | { readonly unreadable: string };

export async function readInvocations(query: InvocationQuery): Promise<Reading> {
  const variables = {
    accountTag: query.accountId,
    script: query.script,
    since: query.since.toISOString(),
    until: query.until.toISOString(),
  };
  let answer: ApiAnswer;
  try {
    answer = await callCloudflare(
      query.token,
      "/graphql",
      { method: "POST", body: JSON.stringify({ query: QUERY, variables }) },
      query.fetch,
    );
  } catch (error) {
    // Analytics going quiet is no reason to roll back a release.
    return { unreadable: `Workers analytics did not answer: ${error instanceof Error ? error.message : ""}` };
  }
  const parsed = Answer.safeParse(answer.body);
  if (answer.status !== 200 || !parsed.success) return { unreadable: `Workers analytics: ${describeAnswer(answer)}` };

  const refusal = parsed.data.errors?.[0]?.message;
  if (refusal !== undefined) return { unreadable: `Workers analytics refused: "${refusal}"` };

  const byVersion: Record<string, Invocations> = {};
  for (const row of parsed.data.data?.viewer.accounts[0]?.workersInvocationsAdaptive ?? []) {
    const sum = byVersion[row.dimensions.scriptVersion] ?? { requests: 0, errors: 0 };
    byVersion[row.dimensions.scriptVersion] = {
      requests: sum.requests + row.sum.requests,
      errors: sum.errors + row.sum.errors,
    };
  }
  return { byVersion };
}
