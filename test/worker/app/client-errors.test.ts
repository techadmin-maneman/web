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

  it("is not a route of the public site", async () => {
    expect((await report("public", CRASH)).status).toBe(404);
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
