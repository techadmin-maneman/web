import { describe, expect, it } from "vitest";
import { validateStaticConfig } from "../../../src/guard.ts";
import { parseDsn } from "../../../src/lib/sentry-dsn.ts";
import { createLogger } from "../../../src/log.ts";
import { createErrorTracker, eventOf, framesOf } from "../../../src/providers/error-tracking.ts";
import { captureLogs, fakeFetch, NOW } from "../helpers.ts";
import { production, problemsOf } from "./guard-fixtures.ts";

const DSN = "https://0123abcd@o1.ingest.sentry.io/4507";
const ENVELOPE_URL = "https://o1.ingest.sentry.io/api/4507/envelope/";

/** A tracker sending through `http`, every send collected so the test can wait for them. */
function trackerFor(http: ReturnType<typeof fakeFetch>, now = () => NOW) {
  const dsn = parseDsn(DSN);
  if (dsn === null) throw new Error("the test's DSN is a DSN");
  const sends: Promise<unknown>[] = [];
  const tracker = createErrorTracker({ dsn, environment: "staging", release: "abc1234", fetch: http.fetch, now });
  const log = createLogger(
    { worker: "mm-api" },
    tracker.sink({ waitUntil: (sending) => sends.push(sending), log: () => log }),
  );
  return { log, settle: () => Promise.all(sends) };
}

/** The event in a send's envelope: its third line. */
const eventIn = (body: string) => JSON.parse(body.split("\n")[2] ?? "{}") as Record<string, unknown>;

describe("error tracking", () => {
  it("reads a DSN into where its events go, and refuses anything else", () => {
    expect(parseDsn(DSN)?.envelopeUrl).toBe(`${ENVELOPE_URL}?sentry_key=0123abcd&sentry_version=7`);
    expect(parseDsn("http://0123abcd@o1.ingest.sentry.io/4507")).toBeNull();
    expect(parseDsn("https://o1.ingest.sentry.io/4507")).toBeNull();
  });

  it("sends each error line once, as Sentry's event, with no number or name a vendor echoed", async () => {
    captureLogs();
    const http = fakeFetch({ [ENVELOPE_URL]: () => new Response(null, { status: 200 }) });
    const { log, settle } = trackerFor(http);

    log.info("request", { route: "/api/visits" });
    log.error("unhandled_error", {
      error: new Error("Zoho refused +919810000001"),
      route: "/api/visits/:id",
      name: "Rohit Malhotra",
    });
    await settle();

    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]?.headers.get("Content-Type")).toBe("application/x-sentry-envelope");
    const event = eventIn(http.calls[0]?.body ?? "");
    expect(event).toMatchObject({
      level: "error",
      environment: "staging",
      release: "abc1234",
      exception: { values: [{ type: "Error" }] },
      tags: { event: "unhandled_error", route: "/api/visits/:id" },
    });
    const sent = http.calls[0]?.body ?? "";
    expect(sent).not.toContain("9810000001");
    expect(sent).not.toContain("Rohit");
  });

  it("names a line without an error by its event and message, as an app's own report is", () => {
    const event = eventOf(
      {
        event: "client_error",
        fields: { app: "client", kind: "render", message: "Cannot read map", path: "/payments" },
      },
      { environment: "production", release: null },
      NOW,
    );
    expect(event).toMatchObject({
      message: { formatted: "client_error: Cannot read map" },
      tags: { event: "client_error", app: "client", kind: "render", path: "/payments" },
    });
    expect(event).not.toHaveProperty("release");
  });

  it("sends an error's stack as Sentry's frames, the outermost call first, so the issue says where it was thrown", () => {
    const error = new Error("D1 refused");
    error.stack = [
      "Error: D1 refused",
      "    at visitOf (src/domain/visits/read.ts:41:11)",
      "    at async handle (src/routes/client/visits.ts:88:5)",
      "    at node:internal/process/task_queues:95:5",
      "    at <anonymous>",
    ].join("\n");
    const event = eventOf(
      { event: "unhandled_error", fields: { error } },
      { environment: "staging", release: "abc1234" },
      NOW,
    );
    expect(event).toMatchObject({
      exception: {
        values: [
          {
            type: "Error",
            value: "D1 refused",
            stacktrace: {
              frames: [
                { filename: "node:internal/process/task_queues", lineno: 95, colno: 5, in_app: false },
                { function: "async handle", filename: "src/routes/client/visits.ts", lineno: 88, in_app: true },
                { function: "visitOf", filename: "src/domain/visits/read.ts", lineno: 41, colno: 11, in_app: true },
              ],
            },
          },
        ],
      },
    });
  });

  it("reads a page's reported stack as Firefox and Safari write it, into an exception of the report's event", () => {
    const event = eventOf(
      {
        event: "client_error",
        fields: {
          app: "client",
          kind: "error",
          message: "x is undefined",
          stack:
            "render@https://app.maneman.in/assets/Home-1a2b.js:3:1406\n@https://app.maneman.in/assets/index-9f8e.js:1:22",
        },
      },
      { environment: "production", release: null },
      NOW,
    );
    expect(event).toMatchObject({
      exception: {
        values: [
          {
            type: "client_error",
            value: "x is undefined",
            stacktrace: {
              frames: [
                { function: "?", filename: "https://app.maneman.in/assets/index-9f8e.js", lineno: 1, colno: 22 },
                { function: "render", filename: "https://app.maneman.in/assets/Home-1a2b.js", lineno: 3, colno: 1406 },
              ],
            },
          },
        ],
      },
    });
    expect(event).not.toHaveProperty("message");
  });

  it("sends at most fifty frames, the innermost, and none for a line it cannot or will not read", () => {
    const deep = Array.from(
      { length: 80 },
      (_, index) => `    at step${String(index)} (src/x.ts:${String(index + 1)}:1)`,
    );
    const frames = framesOf(["Error: deep", ...deep].join("\n"));
    expect(frames).toHaveLength(50);
    expect(frames.at(-1)).toMatchObject({ function: "step0", lineno: 1 });
    expect(framesOf("no frames here")).toEqual([]);
    // A page's report is the public's to write: a line past any frame's length is not read at all.
    expect(framesOf(`    at ${"a:1:".repeat(400)}1:1`)).toEqual([]);
    expect(framesOf(undefined)).toEqual([]);
  });

  it("sends the same error once a minute, and at most twenty a minute, inside the free plan", async () => {
    captureLogs();
    const http = fakeFetch({ [ENVELOPE_URL]: () => new Response(null, { status: 200 }) });
    let now = NOW;
    const { log, settle } = trackerFor(http, () => now);

    log.error("unhandled_error", { route: "/api/me", message: "boom" });
    log.error("unhandled_error", { route: "/api/me", message: "boom" });
    for (let each = 0; each < 30; each += 1) log.error("unhandled_error", { route: `/api/r${String(each)}` });
    await settle();
    expect(http.calls).toHaveLength(20);

    now = new Date(NOW.getTime() + 61_000);
    log.error("unhandled_error", { route: "/api/me", message: "boom" });
    await settle();
    expect(http.calls).toHaveLength(21);
  });

  it("only warns when Sentry cannot be reached, so a failure to report reports nothing", async () => {
    const logs = captureLogs();
    const http = fakeFetch({
      [ENVELOPE_URL]: () => {
        throw new TypeError("fetch failed");
      },
    });
    const { log, settle } = trackerFor(http);
    log.error("unhandled_error", { route: "/api/me" });
    await settle();
    expect(logs.lines().some((line) => line.event === "error_tracking_failed" && line.level === "warn")).toBe(true);
    expect(http.calls).toHaveLength(1);
  });

  it("is read from SENTRY_DSN, which is optional, and refused when it is not a DSN", () => {
    expect(validateStaticConfig(production).settings.sentryDsn).toBeNull();
    expect(validateStaticConfig({ ...production, SENTRY_DSN: DSN }).settings.sentryDsn?.raw).toBe(DSN);
    expect(problemsOf({ ...production, SENTRY_DSN: "https://example.com" })).toEqual([
      "SENTRY_DSN must be a Sentry DSN: https://<key>@<host>/<project>",
    ]);
  });
});
