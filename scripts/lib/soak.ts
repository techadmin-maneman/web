// The production canary's soak, judged on real visitors' requests as well as
// the smoke's. Workers analytics counts each version's invocations and the ones
// that errored (an uncaught exception, a limit exceeded), so while the new
// version serves its share, its error rate is compared with the old one's.
// What each route read from D1 is judged too, against its ceiling, and how long
// the routes clients and technicians wait on most took, against their budgets.
//
// Reading analytics needs Account Analytics: Read, which a CI token may not
// have. Then the soak says so and the smoke checks stand alone, as before
// (docs/decisions/0006-deployment-pipeline.md).

import { z } from "zod";
import { callCloudflare, describeAnswer, type ApiAnswer } from "./cloudflare-api.ts";
import { OTHER_ROUTE_ROWS_READ, ROUTE_ROWS_READ } from "./free-tier-budget.ts";

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

// ---------------------------------------------------------------------------
// What each route read from D1 while the new version served, and how long it took: each request's log line carries
// d1_rows_read and duration_ms (src/app.ts), and Workers Logs sums the one and takes the 95th percentile of the other
// by route. Querying Workers Logs needs Workers Observability on the token; without it the soak says so and judges
// errors alone.
// ---------------------------------------------------------------------------

export interface RouteReads {
  readonly requests: number;
  readonly rowsRead: number;
}

export interface RouteLatency {
  readonly requests: number;
  /** How long the route took to answer, in milliseconds, for 95 of every 100 of its requests. */
  readonly p95Ms: number;
}

/** Fewer of a route's requests than this say nothing of what it reads, or how long it takes. */
const MIN_ROUTE_REQUESTS = 20;

/**
 * The longest the routes clients and technicians wait on most may take, at the 95th percentile, before the release is
 * rolled back: Home, each time the app opens, and a job's card. Each D1 read is a round trip of about 95 ms from
 * India to the database, and Home waits on four to six, a card on six to eight.
 */
export const ROUTE_P95_MS: Readonly<Record<string, number>> = {
  "/api/me": 800,
  "/api/tech/jobs/:id": 1000,
};

const ceilingOf = (route: string): number => ROUTE_ROWS_READ[route] ?? OTHER_ROUTE_ROWS_READ;

const perRequest = ({ requests, rowsRead }: RouteReads): number => rowsRead / requests;

/** Fails when a route the new version served often enough read more rows a request than its ceiling. */
export function judgeRouteReads(byRoute: Readonly<Record<string, RouteReads>>): Verdict {
  const judged = Object.entries(byRoute).filter(([, reads]) => reads.requests >= MIN_ROUTE_REQUESTS);
  if (judged.length === 0) {
    return { outcome: "not judged", detail: "no route had enough requests to judge what it reads from D1" };
  }
  const over = judged
    .filter(([route, reads]) => perRequest(reads) > ceilingOf(route))
    .map(
      ([route, reads]) =>
        `${route} read ${perRequest(reads).toFixed(0)} rows a request, past its ${String(ceilingOf(route))}`,
    );
  if (over.length > 0) return { outcome: "failed", detail: over.join("; ") };
  return { outcome: "passed", detail: `${String(judged.length)} routes each read within their rows a request` };
}

/** Fails when a route with a budget, served often enough by the new version, took longer than it at p95. */
export function judgeRouteLatency(byRoute: Readonly<Record<string, RouteLatency>>): Verdict {
  const judged = Object.entries(ROUTE_P95_MS).flatMap(([route, budgetMs]) => {
    const latency = byRoute[route];
    if (latency === undefined || latency.requests < MIN_ROUTE_REQUESTS) return [];
    return [{ route, budgetMs, p95Ms: latency.p95Ms }];
  });
  if (judged.length === 0) {
    return { outcome: "not judged", detail: "no route with a latency budget had enough requests to judge" };
  }
  const took = (each: (typeof judged)[number]) => `${each.route} took ${each.p95Ms.toFixed(0)} ms at p95`;
  const over = judged.filter((each) => each.p95Ms > each.budgetMs);
  if (over.length > 0) {
    return {
      outcome: "failed",
      detail: over.map((each) => `${took(each)}, past its ${String(each.budgetMs)}`).join("; "),
    };
  }
  return { outcome: "passed", detail: judged.map(took).join("; ") };
}

/** The calculations asked of Workers Logs, in this order. */
const CALCULATIONS = [
  { operator: "count", alias: "requests" },
  { operator: "sum", key: "d1_rows_read", keyType: "number", alias: "rows_read" },
  { operator: "p95", key: "duration_ms", keyType: "number", alias: "p95_ms" },
] as const;

function routeReadsQuery(query: RouteReadsQuery): unknown {
  return {
    queryId: "mm-soak-d1-reads-by-route",
    timeframe: { from: query.since.getTime(), to: query.until.getTime() },
    view: "calculations",
    limit: 200,
    parameters: {
      datasets: ["cloudflare-workers"],
      filters: [
        { key: "$workers.scriptName", operation: "eq", type: "string", value: query.script },
        { key: "$workers.scriptVersion.id", operation: "eq", type: "string", value: query.version },
        { key: "event", operation: "eq", type: "string", value: "request" },
      ],
      calculations: CALCULATIONS,
      groupBys: [{ type: "string", value: "route" }],
    },
  };
}

const Calculation = z.object({
  alias: z.string().optional(),
  aggregates: z.array(
    z.object({
      value: z.number(),
      groups: z.array(z.object({ key: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) })).optional(),
    }),
  ),
});
type Calculation = z.infer<typeof Calculation>;

const TelemetryAnswer = z.object({
  result: z.object({ calculations: z.array(Calculation).optional() }).nullable(),
});

/** One calculation's value for each route, found by its alias, or by its place where the answer leaves that out. */
function valuesByRoute(calculations: readonly Calculation[], place: number): Map<string, number> {
  const alias = CALCULATIONS[place]?.alias;
  const calculation = calculations.find((each) => each.alias === alias) ?? calculations[place];
  const values = new Map<string, number>();
  for (const aggregate of calculation?.aggregates ?? []) {
    const route = aggregate.groups?.find((group) => group.key === "route")?.value;
    if (typeof route === "string") values.set(route, aggregate.value);
  }
  return values;
}

export interface RouteReadsQuery extends InvocationQuery {
  /** The new version's ID. */
  readonly version: string;
}

export type RouteReading =
  { readonly byRoute: Readonly<Record<string, RouteReads & RouteLatency>> } | { readonly unreadable: string };

export async function readRouteReads(query: RouteReadsQuery): Promise<RouteReading> {
  let answer: ApiAnswer;
  try {
    answer = await callCloudflare(
      query.token,
      `/accounts/${query.accountId}/workers/observability/telemetry/query`,
      { method: "POST", body: JSON.stringify(routeReadsQuery(query)) },
      query.fetch,
    );
  } catch (error) {
    return { unreadable: `Workers Logs did not answer: ${error instanceof Error ? error.message : ""}` };
  }
  const parsed = TelemetryAnswer.safeParse(answer.body);
  if (answer.status !== 200 || !parsed.success) return { unreadable: `Workers Logs: ${describeAnswer(answer)}` };

  const calculations = parsed.data.result?.calculations ?? [];
  const requests = valuesByRoute(calculations, 0);
  const rowsRead = valuesByRoute(calculations, 1);
  const p95Ms = valuesByRoute(calculations, 2);
  const byRoute: Record<string, RouteReads & RouteLatency> = {};
  for (const [route, count] of requests) {
    byRoute[route] = { requests: count, rowsRead: rowsRead.get(route) ?? 0, p95Ms: p95Ms.get(route) ?? 0 };
  }
  return { byRoute };
}
