// What goes wrong in the apps' own pages (src/routes/client-errors.ts): each report is one redacted client_error log
// line, on the client, ops and technician hosts alone, and an address sends only so many an hour.

import { beforeEach, describe, expect, it } from "vitest";
import { appFor, captureLogs, fakeDependencies, markDatabase, request } from "../helpers.ts";

const ORIGIN = "https://maneman.test";

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  await markDatabase();
  logs = captureLogs();
});

const CRASH = {
  kind: "error",
  message: "TypeError: Cannot read properties of undefined (reading 'name')",
  path: "/visits/0192a8e4-0000-7000-8000-000000000001",
  stack: "TypeError: Cannot read properties of undefined\n    at Card (https://app.maneman.in/assets/index.js:1:2048)",
  source: "https://app.maneman.in/assets/index.js",
  line: 1,
  column: 2048,
  version: "7a782035b563255f34799b70ff97b9041afdb358",
};

function report(surface: "public" | "client" | "ops" | "tech", body: unknown, address = "203.0.113.20") {
  return request(appFor("local", fakeDependencies(), {}, surface), "/api/client-errors", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": address },
    body: JSON.stringify(body),
  });
}

const reported = () => logs.lines().filter((line) => line.event === "client_error");

describe("POST /api/client-errors", () => {
  // Code a browser extension or the browser itself put into the page throws there too; its stack names no script of
  // ours, and Sentry's client errors are kept for our own (docs/decisions/0277-alerts-that-come-sooner.md).
  it("logs an error thrown only in code the browser put into the page as foreign, not as ours", async () => {
    const injected = {
      ...CRASH,
      message: "TypeError: This document requires 'TrustedScript' assignment.",
      stack: [
        "TypeError: This document requires 'TrustedScript' assignment.",
        "    at <anonymous>:12:30",
        "    at <anonymous>:4:7",
      ].join("\n"),
      source: undefined,
    };
    const extension = {
      ...CRASH,
      stack: ["Error: x", "    at run (chrome-extension://abcdef/content.js:3:9)"].join("\n"),
      source: undefined,
    };
    expect((await report("client", injected)).status).toBe(204);
    expect((await report("client", extension)).status).toBe(204);
    expect(reported()).toEqual([]);
    const foreign = logs.lines().filter((line) => line.event === "client_error_foreign");
    expect(foreign.map((line) => line.level)).toEqual(["info", "info"]);

    // The site's own Worker names its frames by its bundle alone; Checkout not loading names Razorpay's script: ours.
    const worker = {
      ...CRASH,
      stack: ["Error: D1 down", "    at handle (worker.js:12:5)"].join("\n"),
      source: "mm-site Worker",
    };
    expect((await report("public", worker)).status).toBe(204);
    expect((await report("client", { ...CRASH, kind: "checkout_unavailable", stack: undefined })).status).toBe(204);
    expect(reported().map((line) => [line.kind, line.level])).toEqual([
      ["error", "error"],
      ["checkout_unavailable", "error"],
    ]);

    // One frame of ours among the others makes it ours.
    const mixed = {
      ...CRASH,
      stack: [injected.stack, "    at Card (https://app.maneman.in/assets/index.js:1:2048)"].join("\n"),
    };
    expect((await report("client", mixed)).status).toBe(204);
    expect(reported()).toHaveLength(3);
  });

  it.each(["client", "ops", "tech"] as const)(
    "logs a crash in the %s app as one client_error line",
    async (surface) => {
      const answer = await report(surface, CRASH);

      expect(answer.status).toBe(204);
      const lines = reported();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: "error", app: surface, ...CRASH });
      expect(typeof lines[0]?.request_id).toBe("string");
    },
  );

  it("logs a crash on the public site, its booking form or its try-on", async () => {
    expect((await report("public", { ...CRASH, path: "/book" })).status).toBe(204);
    expect(reported()[0]).toMatchObject({ app: "public", path: "/book" });
  });

  it("logs a write the technician app gave up on, under the refusal's own request ID", async () => {
    const refusal = "0192a8e4-0000-7000-8000-0000000000aa";
    const gaveUp = {
      kind: "outbox_gave_up",
      message: "piece refused: piece_code",
      path: "/waiting",
      step: "piece",
      code: "piece_code",
      status: 422,
      request_id: refusal,
    };

    expect((await report("tech", gaveUp)).status).toBe(204);
    const [line] = reported();
    expect(line).toMatchObject({ app: "tech", step: "piece", code: "piece_code", refused_request_id: refusal });
    expect(line?.request_id).not.toBe(refusal);
  });

  it("masks a number or an address a page put in its message, as every log line is", async () => {
    await report("client", { ...CRASH, message: "No visit for +91 98765 43210 (client@example.com)" });

    const [line] = reported();
    expect(line?.message).toBe("No visit for [redacted] ([redacted])");
  });

  it("names an invite's landing without its code, which is a person's own, wherever the report names the page", async () => {
    const landing = "https://maneman.in/r/RM4417";
    const sent = {
      ...CRASH,
      path: "/r/RM4417",
      message: `SecurityError: A history state object with URL '${landing}' cannot be created, on ${landing}.`,
      stack: `SyntaxError: Unexpected token\n    at hydrate (${landing}:1:2048)\n    at ${landing}?from=wa:2:10`,
      source: landing,
    };
    expect((await report("public", sent)).status).toBe(204);
    const [line] = reported();
    expect(line).toMatchObject({
      path: "/r/",
      source: "https://maneman.in/r/",
      stack: expect.stringContaining("https://maneman.in/r/:1:2048") as unknown,
    });
    expect(JSON.stringify(line)).not.toContain("RM4417");
  });

  it("refuses a field it does not know, and logs nothing", async () => {
    const answer = await report("client", { ...CRASH, mobile: "+919876543210" });

    expect(answer.status).toBe(400);
    expect(reported()).toEqual([]);
  });

  it("refuses a report from another site's page", async () => {
    const answer = await request(appFor("local", fakeDependencies(), {}, "client"), "/api/client-errors", {
      method: "POST",
      headers: { Origin: "https://elsewhere.example", "Content-Type": "application/json" },
      body: JSON.stringify(CRASH),
    });

    expect(answer.status).toBe(403);
    expect(reported()).toEqual([]);
  });

  it("takes 20 reports an hour from one address, and the next is refused unlogged", async () => {
    for (let sent = 0; sent < 20; sent += 1) expect((await report("client", CRASH)).status).toBe(204);

    const answer = await report("client", CRASH);
    expect(answer.status).toBe(429);
    expect(await answer.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(reported()).toHaveLength(20);
    expect((await report("client", CRASH, "203.0.113.21")).status).toBe(204);
  });
});
