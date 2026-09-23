// The technician app's outbox, where its rules can be read: the event ID every
// write carries, and the order a reconnected phone replays its queue in
// (docs/decisions/0038-the-technician-app-offline.md).

import { describe, expect, it } from "vitest";
import { account, nextToSend, sendable, stoppedJobs, type Queued } from "../../apps/tech/src/store/replay.ts";
import { queuedAt, uuidv7 } from "../../apps/tech/src/store/uuidv7.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const event = (seq: number, job: string, over: Partial<Queued> = {}): Queued => ({
  seq,
  id: uuidv7(),
  job_id: job,
  kind: "checklist",
  path: `/tech/jobs/${job}/checklist`,
  body: {},
  queued_at: seq,
  state: "waiting",
  note: null,
  ...over,
});

describe("the event ID a write carries", () => {
  it("is a UUIDv7, with its version and variant in place", () => {
    for (let n = 0; n < 50; n += 1) expect(uuidv7()).toMatch(UUID_V7);
  });

  it("carries the millisecond it was made, so two events sort in the order they happened", () => {
    const at = Date.UTC(2027, 0, 14, 9, 41, 0);
    expect(queuedAt(uuidv7(at))).toBe(at);
    expect(uuidv7(at) < uuidv7(at + 1)).toBe(true);
  });

  it("is different every time, in the same millisecond", () => {
    const at = Date.now();
    const made = new Set(Array.from({ length: 200 }, () => uuidv7(at)));
    expect(made.size).toBe(200);
  });
});

describe("what the outbox sends, and in what order", () => {
  it("sends in the order the phone queued them, whatever order the store answers in", () => {
    const queue = [event(3, "a"), event(1, "a"), event(2, "b")];
    expect(sendable(queue).map((held) => held.seq)).toEqual([1, 2, 3]);
    expect(nextToSend(queue)?.seq).toBe(1);
  });

  it("stops a job whose write was superseded, and lets the other jobs go on", () => {
    const queue = [
      event(1, "a", { state: "superseded", note: "Ops moved this job to Sandeep at 10:40" }),
      event(2, "a"),
      event(3, "b"),
    ];
    expect(stoppedJobs(queue)).toEqual(new Set(["a"]));
    expect(sendable(queue).map((held) => held.seq)).toEqual([3]);
  });

  it("stops a job the API refused, for the same reason", () => {
    const queue = [event(1, "a", { state: "refused", note: "This job is already closed." }), event(2, "a")];
    expect(sendable(queue)).toEqual([]);
    expect(nextToSend(queue)).toBeNull();
  });

  it("has nothing to send when the queue is empty", () => {
    expect(nextToSend([])).toBeNull();
  });
});

describe("the account of what has not reached us", () => {
  it("counts each job's waiting writes, oldest job first", () => {
    const queue = [event(1, "a"), event(2, "b"), event(3, "a")];
    expect(account(queue)).toEqual([
      { job_id: "a", waiting: 2, stopped: null },
      { job_id: "b", waiting: 1, stopped: null },
    ]);
  });

  it("keeps what changed, in the API's own words, so no screen says a generic error", () => {
    const changed = "Ops moved this job to Sandeep at 10:40";
    const queue = [event(1, "a", { state: "superseded", note: changed }), event(2, "a")];
    expect(account(queue)).toEqual([{ job_id: "a", waiting: 1, stopped: { state: "superseded", note: changed } }]);
  });
});
