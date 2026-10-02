// The canary's soak judged on real visitors' requests, not only the smoke's
// (scripts/soak.ts): Workers analytics counts each version's invocations and
// the ones that errored, and Workers Logs sums what each route read from D1.

import { describe, expect, it } from "vitest";
import { OTHER_ROUTE_ROWS_READ, ROUTE_ROWS_READ } from "../../scripts/lib/free-tier-budget.ts";
import { judgeRouteReads, judgeSoak, readInvocations, readRouteReads } from "../../scripts/lib/soak.ts";

const NEW = "22222222-2222-4222-8222-222222222222";
const OLD = "11111111-1111-4111-8111-111111111111";

describe("the soak's verdict", () => {
  it("passes a new version that errors no more than the old one", () => {
    expect(judgeSoak({ requests: 400, errors: 1 }, { requests: 3600, errors: 9 }).outcome).toBe("passed");
  });

  it("fails a new version whose invocations error far more often than the old one's", () => {
    const verdict = judgeSoak({ requests: 400, errors: 40 }, { requests: 3600, errors: 9 });
    expect(verdict.outcome).toBe("failed");
    expect(verdict.detail).toContain("10.0%");
  });

  it("tolerates a little noise while the old version errors hardly at all", () => {
    expect(judgeSoak({ requests: 400, errors: 2 }, { requests: 3600, errors: 0 }).outcome).toBe("passed");
  });

  it("does not judge on too few requests to say anything", () => {
    expect(judgeSoak({ requests: 12, errors: 6 }, { requests: 100, errors: 0 }).outcome).toBe("not judged");
  });
});

type GraphQlAnswer = { status: number; body: unknown };

function analytics(answer: GraphQlAnswer, seen: unknown[] = []): typeof fetch {
  return (_input: string | URL | Request, init?: RequestInit) => {
    seen.push(JSON.parse(typeof init?.body === "string" ? init.body : "null"));
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
  };
}

const read = (doFetch: typeof fetch) =>
  readInvocations({
    token: "t",
    accountId: "acct",
    script: "mm-api-production",
    since: new Date("2026-09-25T10:00:00Z"),
    until: new Date("2026-09-25T10:05:00Z"),
    fetch: doFetch,
  });

describe("reading each version's invocations", () => {
  it("adds up every row for each version", async () => {
    const seen: unknown[] = [];
    const rows = [
      { sum: { requests: 100, errors: 1 }, dimensions: { scriptVersion: NEW } },
      { sum: { requests: 50, errors: 0 }, dimensions: { scriptVersion: NEW } },
      { sum: { requests: 900, errors: 2 }, dimensions: { scriptVersion: OLD } },
    ];
    const body = { data: { viewer: { accounts: [{ workersInvocationsAdaptive: rows }] } }, errors: null };
    const readings = await read(analytics({ status: 200, body }, seen));
    expect(readings).toEqual({
      byVersion: {
        [NEW]: { requests: 150, errors: 1 },
        [OLD]: { requests: 900, errors: 2 },
      },
    });
    expect(JSON.stringify(seen[0])).toContain("mm-api-production");
  });

  it("says why when the token may not read analytics, rather than failing the release", async () => {
    const body = { data: null, errors: [{ message: "not authorized for that account" }] };
    expect(await read(analytics({ status: 200, body }))).toEqual({
      unreadable: 'Workers analytics refused: "not authorized for that account"',
    });
  });

  it("says why when the API does not answer as expected", async () => {
    expect(await read(analytics({ status: 502, body: null }))).toEqual({ unreadable: "Workers analytics: HTTP 502" });
  });
});

describe("what each route read from D1 while the new version served", () => {
  it("passes routes that read within their ceilings", () => {
    const verdict = judgeRouteReads({
      "/api/dispatch": { requests: 60, rowsRead: 60 * 480 },
      "/api/me": { requests: 200, rowsRead: 200 * 35 },
    });
    expect(verdict).toEqual({ outcome: "passed", detail: "2 routes each read within their rows a request" });
  });

  it("fails a route that reads past its ceiling, as one reading a whole table would", () => {
    const verdict = judgeRouteReads({
      "/api/dispatch": { requests: 60, rowsRead: 60 * 480 },
      "/api/me": { requests: 200, rowsRead: 200 * 5_000 },
    });
    expect(verdict.outcome).toBe("failed");
    expect(verdict.detail).toBe(`/api/me read 5000 rows a request, past its ${String(OTHER_ROUTE_ROWS_READ)}`);
  });

  it("holds the dispatch board to its own ceiling, not the one for every other route", () => {
    const board = ROUTE_ROWS_READ["/api/dispatch"] ?? 0;
    expect(board).toBeGreaterThan(OTHER_ROUTE_ROWS_READ);
    expect(judgeRouteReads({ "/api/dispatch": { requests: 60, rowsRead: 60 * board } }).outcome).toBe("passed");
    expect(judgeRouteReads({ "/api/dispatch": { requests: 60, rowsRead: 60 * (board + 1) } }).outcome).toBe("failed");
  });

  it("does not judge a route on too few requests", () => {
    expect(judgeRouteReads({ "/api/waitlist": { requests: 3, rowsRead: 3 * 9_000 } }).outcome).toBe("not judged");
  });

  const readRoutes = (doFetch: typeof fetch) =>
    readRouteReads({
      token: "t",
      accountId: "acct",
      script: "mm-api-production",
      version: NEW,
      since: new Date("2026-09-25T10:00:00Z"),
      until: new Date("2026-09-25T10:05:00Z"),
      fetch: doFetch,
    });

  const byRoute = (route: string, value: number) => ({
    value,
    count: 1,
    interval: 1,
    sampleInterval: 1,
    groups: [{ key: "route", value: route }],
  });

  it("asks Workers Logs for the new version's request lines, counted and summed by route", async () => {
    const seen: unknown[] = [];
    const calculations = [
      { alias: "requests", calculation: "count", aggregates: [byRoute("/api/dispatch", 60), byRoute("/api/me", 200)] },
      {
        alias: "rows_read",
        calculation: "sum",
        aggregates: [byRoute("/api/dispatch", 28_800), byRoute("/api/me", 7_000)],
      },
    ];
    const body = { success: true, errors: [], result: { calculations } };

    const reading = await readRoutes(analytics({ status: 200, body }, seen));

    expect(reading).toEqual({
      byRoute: {
        "/api/dispatch": { requests: 60, rowsRead: 28_800 },
        "/api/me": { requests: 200, rowsRead: 7_000 },
      },
    });
    const asked = JSON.stringify(seen[0]);
    expect(asked).toContain('"value":"mm-api-production"');
    expect(asked).toContain(`"key":"$workers.scriptVersion.id","operation":"eq","type":"string","value":"${NEW}"`);
    expect(asked).toContain('"key":"d1_rows_read"');
  });

  it("says why when the token may not query Workers Logs, rather than failing the release", async () => {
    const body = { success: false, errors: [{ code: 10000, message: "Authentication error" }], result: null };
    expect(await readRoutes(analytics({ status: 403, body }))).toEqual({
      unreadable: 'Workers Logs: HTTP 403, "Authentication error"',
    });
  });
});
