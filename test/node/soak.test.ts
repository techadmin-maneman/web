// The canary's soak judged on real visitors' requests, not only the smoke's
// (scripts/soak.ts): Workers analytics counts each version's invocations and
// the ones that errored.

import { describe, expect, it } from "vitest";
import { judgeSoak, readInvocations } from "../../scripts/lib/soak.ts";

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
