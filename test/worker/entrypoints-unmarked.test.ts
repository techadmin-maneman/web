// Its own file: src/index.ts remembers a successful identity check for the life
// of the isolate, and each test file gets a fresh copy of the module.

import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import worker from "../../src/index.ts";
import { captureLogs } from "./helpers.ts";

it("refuses to consume queue messages while the database is not this environment's, so they are retried", async () => {
  captureLogs();
  const batch = {
    queue: "mm-crm-sync-local",
    messages: [{ id: "m", body: {}, attempts: 1, timestamp: new Date(), ack: vi.fn(), retry: vi.fn() }],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
  await expect(worker.queue(batch as unknown as MessageBatch, env)).rejects.toThrow(
    "database identity check failed: unmarked",
  );
  expect(batch.messages[0]?.ack).not.toHaveBeenCalled();
});
