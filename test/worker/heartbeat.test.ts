// PLAT-42: every alert was sent from inside mm-api, so a cron that stopped running altogether told nobody.

import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/log.ts";
import { pingHeartbeat } from "../../src/providers/heartbeat.ts";
import { captureLogs, fakeFetch } from "./helpers.ts";

const CHECK = "https://hc-ping.com/0b9f1a52-7c0b-4f5b-9a0e-2f4f6f2b1a01";

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => {
  logs = captureLogs();
});

describe("the cron's heartbeat", () => {
  it("pings the check when every job worked", async () => {
    const outside = fakeFetch({ [CHECK]: () => new Response("OK") });

    await pingHeartbeat({ url: CHECK, fetch: outside.fetch, log: createLogger() }, []);

    expect(outside.calls.map((call) => [call.method, call.url, call.body])).toEqual([["POST", CHECK, ""]]);
  });

  it("pings the check's /fail, naming the jobs that failed", async () => {
    const outside = fakeFetch({ [CHECK]: () => new Response("OK") });

    await pingHeartbeat({ url: CHECK, fetch: outside.fetch, log: createLogger() }, ["invoices", "books_sync"]);

    expect(outside.calls.map((call) => [call.url, call.body])).toEqual([[`${CHECK}/fail`, "invoices, books_sync"]]);
  });

  it("sends nothing where no check is set", async () => {
    const outside = fakeFetch({});
    await pingHeartbeat({ url: null, fetch: outside.fetch, log: createLogger() }, []);
    expect(outside.calls).toEqual([]);
  });

  it("logs a ping the monitor did not take, and never throws", async () => {
    const refusing = fakeFetch({ [CHECK]: () => new Response("not found", { status: 404 }) });
    const unreachable = fakeFetch({ [CHECK]: () => Promise.reject(new Error("connection lost")) });

    await pingHeartbeat({ url: CHECK, fetch: refusing.fetch, log: createLogger() }, []);
    await pingHeartbeat({ url: CHECK, fetch: unreachable.fetch, log: createLogger() }, []);

    expect(logs.lines().filter((line) => line.event === "heartbeat_not_delivered")).toEqual([
      expect.objectContaining({ level: "error", status: 404 }),
      expect.objectContaining({ level: "error" }),
    ]);
  });
});
