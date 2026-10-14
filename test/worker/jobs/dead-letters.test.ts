// What a queue gave up on (src/queues/dead-letters.ts): each message told to ops once, by what it was and what settles
// it by hand, and let go of. Every ID is made up.

import { describe, expect, it } from "vitest";
import { handleDeadLetters } from "../../../src/queues/dead-letters.ts";
import { createLogger } from "../../../src/log.ts";
import { fakeBatch } from "../batches.ts";
import { captureLogs, fakeDependencies, markDatabase } from "../helpers.ts";

const MESSAGE = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";

describe("the dead letters", () => {
  it("tell ops of each message given up on, by what it was, and let each go", async () => {
    await markDatabase();
    captureLogs();
    const deps = fakeDependencies();
    const batch = fakeBatch("mm-dead-letters-local", [
      { event_id: "evt_1", request_id: "r-1", body: "{}" },
      { message_id: MESSAGE, request_id: "r-2" },
      { lead_id: LEAD, request_id: "r-3" },
      { job_id: JOB, request_id: "r-4" },
      { something: "else" },
    ]);
    await handleDeadLetters(batch, deps, createLogger());

    expect(deps.alerts).toEqual([
      expect.stringContaining("Settle its payment or refund by hand from Razorpay's dashboard"),
      expect.stringContaining(`Send it again from Tasks (runbook, "A queue gave up"): message ${MESSAGE} was given up`),
      expect.stringContaining(`lead ${LEAD} was given up on after every try`),
      expect.stringContaining(`try-on ${JOB}`),
      expect.stringContaining("Read the logs for queue_gave_up"),
    ]);
    expect(batch.messages.every((message) => message.ack.mock.calls.length === 1)).toBe(true);
  });

  it("tell ops once of a message given up on twice", async () => {
    await markDatabase();
    captureLogs();
    const deps = fakeDependencies();
    for (let delivery = 0; delivery < 2; delivery += 1) {
      await handleDeadLetters(
        fakeBatch("mm-dead-letters-local", [{ lead_id: LEAD, request_id: "r-3" }]),
        deps,
        createLogger(),
      );
    }
    expect(deps.alerts).toHaveLength(1);
  });
});
