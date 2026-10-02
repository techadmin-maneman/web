// What the Cloudflare account has used today of its daily allowances, from Cloudflare's GraphQL analytics, read with
// a token that can read analytics and nothing else. The figures are the whole account's: every database and every
// queue in it, staging's and production's together.

import { z } from "zod";
import { failureReason } from "../log.ts";
import type { Allowance } from "../policy/daily-allowances.ts";

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const TIMEOUT_MS = 10_000;

const QUERY = `query DailyUsage($accountTag: string!, $date: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date_geq: $date, date_leq: $date }) {
        sum { rowsRead rowsWritten }
      }
      queueMessageOperationsAdaptiveGroups(limit: 1000, filter: { date_geq: $date, date_leq: $date }) {
        sum { billableOperations }
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
            d1AnalyticsAdaptiveGroups: z.array(
              z.object({ sum: z.object({ rowsRead: z.number(), rowsWritten: z.number() }) }),
            ),
            queueMessageOperationsAdaptiveGroups: z.array(
              z.object({ sum: z.object({ billableOperations: z.number() }) }),
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

export type DailyUsage = Readonly<Record<Allowance, number>>;

export type UsageReading = { readonly usage: DailyUsage } | { readonly unreadable: string };

export interface UsageQuery {
  readonly token: string;
  readonly accountId: string;
  /** The UTC day, "2026-10-02": the day the allowances count. */
  readonly date: string;
  readonly fetch: typeof fetch;
}

function total(figures: readonly number[]): number {
  return figures.reduce((sum, figure) => sum + figure, 0);
}

async function askAnalytics(query: UsageQuery): Promise<Response> {
  return query.fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${query.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { accountTag: query.accountId, date: query.date } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function readDailyUsage(query: UsageQuery): Promise<UsageReading> {
  let response: Response;
  try {
    response = await askAnalytics(query);
  } catch (error) {
    return { unreadable: `analytics did not answer: ${failureReason(error)}` };
  }
  if (!response.ok) return { unreadable: `analytics answered HTTP ${String(response.status)}` };

  const parsed = Answer.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { unreadable: "analytics answered in a shape this code does not know" };
  const refusal = parsed.data.errors?.[0]?.message;
  if (refusal !== undefined) return { unreadable: `analytics refused: ${refusal.slice(0, 300)}` };
  const account = parsed.data.data?.viewer.accounts[0];
  if (account === undefined) return { unreadable: "analytics answered for no account" };

  const d1 = account.d1AnalyticsAdaptiveGroups;
  const queues = account.queueMessageOperationsAdaptiveGroups;
  return {
    usage: {
      queueOperations: total(queues.map((group) => group.sum.billableOperations)),
      d1RowsRead: total(d1.map((group) => group.sum.rowsRead)),
      d1RowsWritten: total(d1.map((group) => group.sum.rowsWritten)),
    },
  };
}
