// What the site's pages' content security policy refused, as browsers report it (src/routes/public/csp-reports.ts):
// each refusal one csp_refused log line, its page's query left out, on the public host alone, and an address sends
// only so many an hour.

import { beforeEach, describe, expect, it } from "vitest";
import { appFor, captureLogs, fakeDependencies, markDatabase, request } from "../helpers.ts";

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  await markDatabase();
  logs = captureLogs();
});

/** A batch as the Reporting API sends it from report-to. */
const BATCH = [
  {
    type: "csp-violation",
    url: "https://maneman.in/r/RM4K7P?utm_source=wa",
    body: {
      documentURL: "https://maneman.in/r/RM4K7P?utm_source=wa",
      blockedURL: "https://static.cloudflareinsights.com/beacon.min.js?token=abc",
      effectiveDirective: "script-src-elem",
      disposition: "enforce",
    },
  },
  { type: "deprecation", body: { id: "something" } },
];

/** One report as report-uri sends it. */
const ONE = {
  "csp-report": {
    "document-uri": "https://maneman.in/try#token",
    "blocked-uri": "inline",
    "violated-directive": "script-src",
    disposition: "report",
  },
};

function send(body: string, type: string, surface: "public" | "client" | "ops" = "public", address = "203.0.113.30") {
  return request(appFor("local", fakeDependencies(), {}, surface), "/api/csp-reports", {
    method: "POST",
    // The app hosts' own origin, which their same-origin rule lets through to the routes.
    headers: { Origin: "https://maneman.test", "Content-Type": type, "CF-Connecting-IP": address },
    body,
  });
}

const refused = () => logs.lines().filter((line) => line.event === "csp_refused");

describe("POST /api/csp-reports", () => {
  it("logs each refusal of a Reporting API batch, without the page's query, and nothing else of the batch", async () => {
    const answer = await send(JSON.stringify(BATCH), "application/reports+json");
    expect(answer.status).toBe(204);
    expect(refused()).toEqual([
      expect.objectContaining({
        level: "warn",
        directive: "script-src-elem",
        blocked: "static.cloudflareinsights.com/beacon.min.js",
        page: "maneman.in/r/RM4K7P",
        disposition: "enforce",
      }),
    ]);
  });

  it("logs a report-uri report, its fragment left out too", async () => {
    expect((await send(JSON.stringify(ONE), "application/csp-report")).status).toBe(204);
    expect(refused()).toEqual([
      expect.objectContaining({ directive: "script-src", blocked: "inline", page: "maneman.in/try" }),
    ]);
  });

  it("lets go what is not a report, or bigger than any browser sends", async () => {
    expect((await send("not json", "application/csp-report")).status).toBe(204);
    expect((await send(JSON.stringify({ hello: "there" }), "application/json")).status).toBe(204);
    expect(
      (await send(JSON.stringify([{ ...BATCH[0], pad: "x".repeat(20_000) }]), "application/reports+json")).status,
    ).toBe(204);
    expect(refused()).toEqual([]);
  });

  // The client app's policy reports too, so a Checkout frame or script it refuses is heard of
  // (docs/decisions/0277-alerts-that-come-sooner.md); the console and the technician app do not.
  it("answers on the public and client hosts alone", async () => {
    expect((await send(JSON.stringify(ONE), "application/csp-report", "client")).status).toBe(204);
    expect((await send(JSON.stringify(ONE), "application/csp-report", "ops")).status).toBe(404);
  });

  // The browser posts a report itself, perhaps with no Origin; the client host's same-origin rule lets it through.
  it("takes a report on the client host with no Origin", async () => {
    const answer = await request(appFor("local", fakeDependencies(), {}, "client"), "/api/csp-reports", {
      method: "POST",
      headers: { "Content-Type": "application/csp-report", "CF-Connecting-IP": "203.0.113.31" },
      body: JSON.stringify(ONE),
    });
    expect(answer.status).toBe(204);
  });

  it("takes only so many reports an hour from one address", async () => {
    const answers = [];
    for (let sent = 0; sent < 21; sent += 1)
      answers.push((await send(JSON.stringify(ONE), "application/csp-report")).status);
    expect(answers.slice(0, 20).every((status) => status === 204)).toBe(true);
    expect(answers[20]).toBe(429);
  });
});
