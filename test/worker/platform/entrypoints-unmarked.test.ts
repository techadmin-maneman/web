// Its own file: src/index.ts remembers a successful identity check for the life
// of the isolate, and each test file gets a fresh copy of the module.

import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import worker from "../../../src/index.ts";
import { fakeBatch } from "../batches.ts";
import { captureLogs } from "../helpers.ts";

it("refuses to consume queue messages while the database is not this environment's, so they are retried", async () => {
  captureLogs();
  const batch = fakeBatch("mm-crm-sync-local", [{}]);
  await expect(worker.queue(batch, env)).rejects.toThrow("database identity check failed: unmarked");
  expect(batch.messages[0]?.ack).not.toHaveBeenCalled();
});
