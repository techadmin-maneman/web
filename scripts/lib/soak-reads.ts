// What the soak (./soak.ts) reads besides Workers analytics. From Workers Logs, the request line each answer logs
// (src/app.ts): each version's answers by status, and the new version's by route, with d1_rows_read summed and
// duration_ms at the 95th percentile. Querying Workers Logs needs Workers Observability on the token. From the
// environment's D1, the visits in each day of the weeks the dispatch board shows, which its read ceiling grows with.

import { z } from "zod";
import { callCloudflare, describeAnswer, type ApiAnswer } from "./cloudflare-api.ts";
import type { InvocationQuery, Invocations, Reading, RouteLatency, RouteReads } from "./soak.ts";

/** The calculations asked of Workers Logs for each route, in this order. */
const CALCULATIONS = [
  { operator: "count", alias: "requests" },
  { operator: "sum", key: "d1_rows_read", keyType: "number", alias: "rows_read" },
  { operator: "p95", key: "duration_ms", keyType: "number", alias: "p95_ms" },
] as const;

const VERSION_KEY = "$workers.scriptVersion.id";

function logsQuery(
  query: InvocationQuery,
  id: string,
  extra: { filters: unknown[]; calculations: unknown; groupBys: unknown },
) {
  return {
    queryId: id,
    timeframe: { from: query.since.getTime(), to: query.until.getTime() },
    view: "calculations",
    limit: 200,
    parameters: {
      datasets: ["cloudflare-workers"],
      filters: [
        { key: "$workers.scriptName", operation: "eq", type: "string", value: query.script },
        { key: "event", operation: "eq", type: "string", value: "request" },
        ...extra.filters,
      ],
      calculations: extra.calculations,
      groupBys: extra.groupBys,
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
type Aggregate = Calculation["aggregates"][number];

const TelemetryAnswer = z.object({
  result: z.object({ calculations: z.array(Calculation).optional() }).nullable(),
});

/** The calculations Workers Logs answered with, or why there are none. */
async function askLogs(
  query: InvocationQuery,
  body: unknown,
): Promise<readonly Calculation[] | { unreadable: string }> {
  let answer: ApiAnswer;
  try {
    answer = await callCloudflare(
      query.token,
      `/accounts/${query.accountId}/workers/observability/telemetry/query`,
      { method: "POST", body: JSON.stringify(body) },
      query.fetch,
    );
  } catch (error) {
    return { unreadable: `Workers Logs did not answer: ${error instanceof Error ? error.message : ""}` };
  }
  const parsed = TelemetryAnswer.safeParse(answer.body);
  if (answer.status !== 200 || !parsed.success) return { unreadable: `Workers Logs: ${describeAnswer(answer)}` };
  return parsed.data.result?.calculations ?? [];
}

const groupOf = (aggregate: Aggregate, key: string) => aggregate.groups?.find((group) => group.key === key)?.value;

/** One calculation's value for each route, found by its alias, or by its place where the answer leaves that out. */
function valuesByRoute(calculations: readonly Calculation[], place: number): Map<string, number> {
  const alias = CALCULATIONS[place]?.alias;
  const calculation = calculations.find((each) => each.alias === alias) ?? calculations[place];
  const values = new Map<string, number>();
  for (const aggregate of calculation?.aggregates ?? []) {
    const route = groupOf(aggregate, "route");
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
  const calculations = await askLogs(
    query,
    logsQuery(query, "mm-soak-d1-reads-by-route", {
      filters: [{ key: VERSION_KEY, operation: "eq", type: "string", value: query.version }],
      calculations: CALCULATIONS,
      groupBys: [{ type: "string", value: "route" }],
    }),
  );
  if ("unreadable" in calculations) return calculations;
  const requests = valuesByRoute(calculations, 0);
  const rowsRead = valuesByRoute(calculations, 1);
  const p95Ms = valuesByRoute(calculations, 2);
  const byRoute: Record<string, RouteReads & RouteLatency> = {};
  for (const [route, count] of requests) {
    byRoute[route] = { requests: count, rowsRead: rowsRead.get(route) ?? 0, p95Ms: p95Ms.get(route) ?? 0 };
  }
  return { byRoute };
}

/**
 * Each version's answers, and the ones that were a 5xx: a 500 the app's error handler returns is an invocation that
 * did not error, so analytics alone never counts it.
 */
export async function readAnswers(query: InvocationQuery): Promise<Reading> {
  const calculations = await askLogs(
    query,
    logsQuery(query, "mm-soak-answers-by-version", {
      filters: [],
      calculations: [{ operator: "count", alias: "requests" }],
      groupBys: [
        { type: "string", value: VERSION_KEY },
        { type: "number", value: "status" },
      ],
    }),
  );
  if ("unreadable" in calculations) return calculations;
  const byVersion: Record<string, Invocations> = {};
  for (const aggregate of calculations[0]?.aggregates ?? []) {
    const version = groupOf(aggregate, VERSION_KEY);
    if (typeof version !== "string") continue;
    const sum = byVersion[version] ?? { requests: 0, errors: 0 };
    const failed = Number(groupOf(aggregate, "status")) >= 500;
    byVersion[version] = {
      requests: sum.requests + aggregate.value,
      errors: sum.errors + (failed ? aggregate.value : 0),
    };
  }
  return { byVersion };
}

/** The board shows any week; these are the days around the release it is likeliest to be asked for. */
const DAYS_BEFORE = 7;
const DAYS_AFTER = 35;

const VISITS_BY_DAY = `SELECT substr(datetime(window_start, '+330 minutes'), 1, 10) AS day, COUNT(*) AS visits
  FROM appointments WHERE deleted_at IS NULL AND window_start >= ?1 AND window_start < ?2 GROUP BY day`;

const D1Answer = z.object({
  result: z.array(z.object({ results: z.array(z.object({ day: z.string(), visits: z.number() })) })),
});

export type VisitsReading = { readonly byDay: Readonly<Record<string, number>> } | { readonly unreadable: string };

/** Each India day's visits, from a week before the soak to five weeks after, in the environment's database. */
export async function readVisitsByDay(
  query: InvocationQuery & { readonly databaseId: string },
): Promise<VisitsReading> {
  const day = 24 * 60 * 60 * 1000;
  const params = [
    new Date(query.since.getTime() - DAYS_BEFORE * day).toISOString(),
    new Date(query.since.getTime() + DAYS_AFTER * day).toISOString(),
  ];
  let answer: ApiAnswer;
  try {
    answer = await callCloudflare(
      query.token,
      `/accounts/${query.accountId}/d1/database/${query.databaseId}/query`,
      { method: "POST", body: JSON.stringify({ sql: VISITS_BY_DAY, params }) },
      query.fetch,
    );
  } catch (error) {
    return { unreadable: `D1 did not answer: ${error instanceof Error ? error.message : ""}` };
  }
  const parsed = D1Answer.safeParse(answer.body);
  if (!answer.ok || !parsed.success) return { unreadable: `D1: ${describeAnswer(answer)}` };
  const byDay: Record<string, number> = {};
  for (const row of parsed.data.result[0]?.results ?? []) byDay[row.day] = row.visits;
  return { byDay };
}
