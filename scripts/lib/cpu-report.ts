// What mm-api's invocations spent of CPU time, from Workers analytics (scripts/ops/cpu-report.ts). Workers Paid allows
// 30 seconds an invocation (ADR 0112), and Cloudflare stops one that runs over; the report warns at a tenth of that. Analytics gives each
// cron run's own figure, and one for every invocation together: it does not tell a request from a queue batch.
//
// Reading analytics needs Account Analytics: Read, which a CI token may not have; then the report says so.

import { z } from "zod";
import { callCloudflare, describeAnswer, type ApiAnswer } from "./cloudflare-api.ts";

/** Workers Paid's CPU time for a request, and for a cron run that comes more often than hourly. */
export const CPU_LIMIT_MS = 30_000;
const WARN_AT_MS = CPU_LIMIT_MS / 10;

export interface CpuFigures {
  readonly invocations: number;
  readonly p50Ms: number;
  readonly p99Ms: number;
}

export interface CpuReading {
  /** Each cron run. */
  readonly cron: CpuFigures;
  /** Every invocation: requests, queue batches and cron runs together. */
  readonly all: CpuFigures;
  /** Invocations Cloudflare stopped for a limit, by status: "exceededCpu", "exceededMemory" and the like. */
  readonly stopped: Readonly<Record<string, number>>;
}

export type Level = "ok" | "warning" | "error";

export interface ReportLine {
  readonly level: Level;
  readonly text: string;
}

const QUERY = `query CpuReport($accountTag: string!, $script: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      cronRuns: workersInvocationsScheduled(
        limit: 2000
        filter: { scriptName: $script, datetime_geq: $since, datetime_leq: $until }
      ) {
        cpuTimeUs
        status
      }
      everyInvocation: workersInvocationsAdaptive(
        limit: 1
        filter: { scriptName: $script, datetime_geq: $since, datetime_leq: $until }
      ) {
        sum { requests }
        quantiles { cpuTimeP50 cpuTimeP99 }
      }
      byStatus: workersInvocationsAdaptive(
        limit: 50
        filter: { scriptName: $script, datetime_geq: $since, datetime_leq: $until }
      ) {
        sum { requests }
        dimensions { status }
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
            cronRuns: z.array(z.object({ cpuTimeUs: z.number(), status: z.string() })),
            everyInvocation: z.array(
              z.object({
                sum: z.object({ requests: z.number() }),
                quantiles: z.object({ cpuTimeP50: z.number(), cpuTimeP99: z.number() }),
              }),
            ),
            byStatus: z.array(
              z.object({ sum: z.object({ requests: z.number() }), dimensions: z.object({ status: z.string() }) }),
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

export interface CpuQuery {
  readonly token: string;
  readonly accountId: string;
  /** The deployed Worker's name, e.g. mm-api-staging. */
  readonly script: string;
  readonly since: Date;
  readonly until: Date;
  readonly fetch?: typeof fetch;
}

export type CpuAnswer = { readonly reading: CpuReading } | { readonly unreadable: string };

const MICROSECONDS_A_MS = 1_000;

/** The value at quantile q of the figures, by nearest rank; 0 for none. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1] ?? 0;
}

function cronFigures(runs: readonly { cpuTimeUs: number }[]): CpuFigures {
  const sorted = runs.map((run) => run.cpuTimeUs / MICROSECONDS_A_MS).sort((a, b) => a - b);
  return { invocations: sorted.length, p50Ms: quantile(sorted, 0.5), p99Ms: quantile(sorted, 0.99) };
}

function isStopped(status: string): boolean {
  return status.startsWith("exceeded");
}

export async function readCpu(query: CpuQuery): Promise<CpuAnswer> {
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
    return { unreadable: `Workers analytics did not answer: ${error instanceof Error ? error.message : ""}` };
  }
  const parsed = Answer.safeParse(answer.body);
  if (answer.status !== 200 || !parsed.success) return { unreadable: `Workers analytics: ${describeAnswer(answer)}` };

  const refusal = parsed.data.errors?.[0]?.message;
  if (refusal !== undefined) return { unreadable: `Workers analytics refused: "${refusal}"` };
  const account = parsed.data.data?.viewer.accounts[0];
  if (account === undefined) return { unreadable: "Workers analytics answered for no account" };

  const every = account.everyInvocation[0];
  const stopped: Record<string, number> = {};
  for (const row of account.byStatus) {
    if (isStopped(row.dimensions.status)) stopped[row.dimensions.status] = row.sum.requests;
  }
  for (const run of account.cronRuns) {
    if (isStopped(run.status)) stopped[`cron ${run.status}`] = (stopped[`cron ${run.status}`] ?? 0) + 1;
  }
  return {
    reading: {
      cron: cronFigures(account.cronRuns),
      all: {
        invocations: every?.sum.requests ?? 0,
        p50Ms: (every?.quantiles.cpuTimeP50 ?? 0) / MICROSECONDS_A_MS,
        p99Ms: (every?.quantiles.cpuTimeP99 ?? 0) / MICROSECONDS_A_MS,
      },
      stopped,
    },
  };
}

function describe(subject: string, figures: CpuFigures): ReportLine {
  const text =
    `${subject}: ${String(figures.invocations)}, CPU p50 ${figures.p50Ms.toFixed(1)} ms, ` +
    `p99 ${figures.p99Ms.toFixed(1)} ms`;
  if (figures.p99Ms <= WARN_AT_MS) return { level: "ok", text };
  return { level: "warning", text: `${text}, over a tenth of the ${String(CPU_LIMIT_MS / 1000)} s Cloudflare allows` };
}

/** A line for each figure: a warning where a p99 nears the limit, an error where Cloudflare stopped one. */
export function judgeCpu(script: string, reading: CpuReading): ReportLine[] {
  const lines = [
    describe(`${script} cron runs`, reading.cron),
    describe(`${script} invocations (requests, queue batches and cron runs)`, reading.all),
  ];
  for (const [status, count] of Object.entries(reading.stopped)) {
    lines.push({ level: "error", text: `${script}: Cloudflare stopped ${String(count)} invocation(s) as ${status}` });
  }
  return lines;
}
