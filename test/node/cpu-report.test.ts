// Nothing recorded the Worker's CPU time, so runs over the free plan's 10 ms went unseen until the audit.

import { describe, expect, it } from "vitest";
import { judgeCpu, readCpu, type CpuReading } from "../../scripts/lib/cpu-report.ts";

function analytics(status: number, body: unknown, seen: unknown[] = []): typeof fetch {
  return (_input: string | URL | Request, init?: RequestInit) => {
    seen.push(JSON.parse(typeof init?.body === "string" ? init.body : "null"));
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

const read = (doFetch: typeof fetch) =>
  readCpu({
    token: "t",
    accountId: "acct",
    script: "mm-api-staging",
    since: new Date("2026-10-01T06:00:00Z"),
    until: new Date("2026-10-02T06:00:00Z"),
    fetch: doFetch,
  });

const ACCOUNT = {
  cronRuns: [
    { cpuTimeUs: 39_503, status: "success" },
    { cpuTimeUs: 8_100, status: "success" },
    { cpuTimeUs: 47_224, status: "success" },
    { cpuTimeUs: 61_000, status: "exceededCpu" },
  ],
  everyInvocation: [{ sum: { requests: 7224 }, quantiles: { cpuTimeP50: 3504, cpuTimeP99: 51_348 } }],
  byStatus: [
    { sum: { requests: 7203 }, dimensions: { status: "success" } },
    { sum: { requests: 20 }, dimensions: { status: "clientDisconnected" } },
    { sum: { requests: 1 }, dimensions: { status: "exceededResources" } },
  ],
};

describe("reading mm-api's CPU time", () => {
  it("takes each cron run's own figure, every invocation's together, and what Cloudflare stopped", async () => {
    const seen: unknown[] = [];
    const answer = await read(analytics(200, { data: { viewer: { accounts: [ACCOUNT] } }, errors: null }, seen));

    expect(answer).toEqual({
      reading: {
        cron: { invocations: 4, p50Ms: 39.503, p99Ms: 61 },
        all: { invocations: 7224, p50Ms: 3.504, p99Ms: 51.348 },
        stopped: { exceededResources: 1, "cron exceededCpu": 1 },
      },
    });
    expect(JSON.stringify(seen[0])).toContain("mm-api-staging");
  });

  it("says why when the token may not read analytics", async () => {
    const body = { data: null, errors: [{ message: "not authorized for that account" }] };
    expect(await read(analytics(200, body))).toEqual({
      unreadable: 'Workers analytics refused: "not authorized for that account"',
    });
  });

  it("says why when the API does not answer as expected", async () => {
    expect(await read(analytics(502, null))).toEqual({ unreadable: "Workers analytics: HTTP 502" });
  });
});

describe("judging mm-api's CPU time", () => {
  const within = { invocations: 100, p50Ms: 2.5, p99Ms: 9.9 };

  it("is quiet while every p99 is within the free plan's 10 ms", () => {
    const reading: CpuReading = { cron: within, all: within, stopped: {} };
    expect(judgeCpu("mm-api-staging", reading).map((line) => line.level)).toEqual(["ok", "ok"]);
  });

  it("warns where a p99 is over 10 ms, and errs where Cloudflare stopped an invocation", () => {
    const reading: CpuReading = {
      cron: { invocations: 288, p50Ms: 42.1, p99Ms: 99.6 },
      all: within,
      stopped: { exceededCpu: 2 },
    };
    expect(judgeCpu("mm-api-staging", reading)).toEqual([
      {
        level: "warning",
        text: "mm-api-staging cron runs: 288, CPU p50 42.1 ms, p99 99.6 ms, over the free plan's 10 ms",
      },
      {
        level: "ok",
        text: "mm-api-staging invocations (requests, queue batches and cron runs): 100, CPU p50 2.5 ms, p99 9.9 ms",
      },
      { level: "error", text: "mm-api-staging: Cloudflare stopped 2 invocation(s) as exceededCpu" },
    ]);
  });
});
