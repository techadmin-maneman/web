// The cron's hourly look at what the Cloudflare account has used today of the free plan's daily allowances.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { checkDailyAllowances } from "../../../src/scheduled/daily-allowances.ts";
import { captureLogs, fakeDependencies, fakeFetch, json, NOW, type RecordedCall } from "../helpers.ts";

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
const TOKEN = "analytics-read-token";

interface Groups {
  readonly queueOperations?: readonly number[];
  readonly d1Rows?: readonly { read: number; written: number }[];
}

/** Analytics' answer: one group for each queue and database figure given. */
function usage({ queueOperations = [], d1Rows = [] }: Groups): Response {
  return json({
    data: {
      viewer: {
        accounts: [
          {
            d1AnalyticsAdaptiveGroups: d1Rows.map((rows) => ({
              sum: { rowsRead: rows.read, rowsWritten: rows.written },
            })),
            queueMessageOperationsAdaptiveGroups: queueOperations.map((operations) => ({
              sum: { billableOperations: operations },
            })),
          },
        ],
      },
    },
    errors: null,
  });
}

function analytics(answer: () => Response, now: Date = NOW) {
  const { fetch, calls } = fakeFetch({ [GRAPHQL]: answer });
  const deps = fakeDependencies({ fetch, now: () => now });
  return { deps, calls };
}

type Analytics = ReturnType<typeof analytics>;

const check = ({ deps }: Analytics, calls = Infinity) =>
  checkDailyAllowances({ db: env.DB, deps, token: TOKEN, log: createLogger(), budget: createCallBudget(calls) });

async function openAlerts(): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT key FROM alerts WHERE resolved_at IS NULL ORDER BY key").all<{
    key: string;
  }>();
  return results.map((row) => row.key);
}

function variablesOf(call: RecordedCall | undefined): unknown {
  return (JSON.parse(call?.body ?? "{}") as { variables?: unknown }).variables;
}

beforeEach(() => {
  captureLogs();
});

describe("the daily allowances", () => {
  it("tells ops once when queue operations reach 70% of the day's 10,000, however many hours see it", async () => {
    const busy = analytics(() => usage({ queueOperations: [4_000, 3_140] }));
    for (let hour = 0; hour < 12; hour += 1) await check(busy);

    expect(busy.deps.alerts).toEqual([
      "Cloudflare's free queue operations are 71% used today: 7,140 of 10,000, staging and production together. " +
        "Past the limit, until 05:30 IST, every queue send fails, and bookings, payment confirmations, CRM updates " +
        'and messages stall. Find what is spending them (runbook, "The daily allowances").',
    ]);
    expect(await openAlerts()).toEqual(["daily_allowance:queueOperations"]);
  });

  it("says nothing below 70%, adding up every database and every queue in the account", async () => {
    const quiet = analytics(() =>
      usage({
        queueOperations: [2_000, 602],
        d1Rows: [
          { read: 600_000, written: 20_000 },
          { read: 81_036, written: 3_250 },
        ],
      }),
    );
    await check(quiet);
    expect(quiet.deps.alerts).toEqual([]);
    expect(await openAlerts()).toEqual([]);
  });

  it("tells of D1's rows read and rows written each on its own", async () => {
    const d1 = analytics(() => usage({ d1Rows: [{ read: 3_600_000, written: 70_000 }] }));
    await check(d1);
    expect(d1.deps.alerts).toEqual([
      expect.stringContaining("free D1 rows read are 72% used today: 3,600,000 of 5,000,000"),
      expect.stringContaining("free D1 rows written are 70% used today: 70,000 of 100,000"),
    ]);
  });

  it("closes the alert when a new day starts the figures again, so the next day that reaches 70% is told", async () => {
    await check(analytics(() => usage({ queueOperations: [8_000] })));

    await check(analytics(() => usage({ queueOperations: [40] })));
    expect(await openAlerts()).toEqual([]);

    const nextBusyDay = analytics(() => usage({ queueOperations: [7_500] }));
    await check(nextBusyDay);
    expect(nextBusyDay.deps.alerts).toEqual([expect.stringContaining("75% used today")]);
  });

  // 01:45 on 22 September in India is still 21 September for Cloudflare, whose allowances start at midnight UTC.
  it("asks for the account's figures for the UTC day, with the read-only token", async () => {
    const lateEvening = analytics(() => usage({}), new Date("2026-09-21T20:15:00Z"));
    await check(lateEvening);

    const [call] = lateEvening.calls;
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(variablesOf(call)).toEqual({ accountTag: "a2e185075b1b8eef3bee24b72f45ace3", date: "2026-09-21" });
  });

  it("tells ops when the figures cannot be read three hours running, and closes that once they can", async () => {
    const refused = analytics(() => json({ data: null, errors: [{ message: "not authorized for that account" }] }));
    await check(refused);
    await check(refused);
    expect(refused.deps.alerts).toEqual([]);

    await check(refused);
    expect(refused.deps.alerts).toEqual([
      "Cloudflare's usage figures could not be read three hours running (analytics refused: not authorized for " +
        "that account), so nobody is told as the daily free allowances run low. Check the token (runbook, " +
        '"The daily allowances").',
    ]);

    await check(analytics(() => usage({})));
    expect(await openAlerts()).toEqual([]);
  });

  it("counts only failed reads in a row", async () => {
    const down = analytics(() => new Response("Bad Gateway", { status: 502 }));
    await check(down);
    await check(down);
    await check(analytics(() => usage({})));
    await check(down);
    await check(down);
    expect(down.deps.alerts).toEqual([]);
  });

  it("is not asked when the cron run has no call left", async () => {
    const busy = analytics(() => usage({ queueOperations: [9_000] }));
    await check(busy, 0);
    expect(busy.calls).toEqual([]);
    expect(busy.deps.alerts).toEqual([]);
  });
});
