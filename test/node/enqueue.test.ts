// Putting work on a queue once its change is saved never throws (PLAT-24, CQ-25): a message the queue refuses is
// logged, and left to a sweeper or told to ops once; a long run goes in batches the queue takes.

import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/log.ts";
import { enqueue, enqueueBatch, SEND_BATCH_LIMIT } from "../../src/queues/enqueue.ts";

type Line = { readonly event: string; readonly fields: Readonly<Record<string, unknown>> };

function recordingLog(): { log: Logger; warnings: Line[] } {
  const warnings: Line[] = [];
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event, fields = {}) => {
      warnings.push({ event, fields });
    },
    error: () => undefined,
    child: () => log,
  };
  return { log, warnings };
}

/** A queue that, as Cloudflare's does, refuses a batch over a hundred; and refuses every call numbered in `refused`. */
function fakeQueue(refused: readonly number[] = []) {
  const sent: unknown[] = [];
  const batchSizes: number[] = [];
  let calls = 0;
  const refuses = () => {
    calls += 1;
    return refused.includes(calls);
  };
  const queue = {
    send: (body: unknown) => {
      if (refuses()) return Promise.reject(new Error("queue unavailable"));
      sent.push(body);
      return Promise.resolve();
    },
    sendBatch: (messages: Iterable<MessageSendRequest>) => {
      const batch = [...messages];
      batchSizes.push(batch.length);
      if (refuses() || batch.length > 100) return Promise.reject(new Error("queue refused the batch"));
      sent.push(...batch.map((message) => message.body));
      return Promise.resolve();
    },
  } as unknown as Queue;
  return { queue, sent, batchSizes };
}

const bodies = (count: number) => Array.from({ length: count }, (_, n) => ({ body: { message_id: `m${String(n)}` } }));

describe("enqueue", () => {
  it("puts the message on the queue and answers that it was taken", async () => {
    const { log, warnings } = recordingLog();
    const { queue, sent } = fakeQueue();

    expect(await enqueue(queue, { lead_id: "lead-1" }, { log, ifLost: "sweeper" })).toBe(true);
    expect(sent).toEqual([{ lead_id: "lead-1" }]);
    expect(warnings).toEqual([]);
  });

  it("answers false without throwing when the queue refuses, and leaves the message to the sweeper", async () => {
    const { log, warnings } = recordingLog();
    const { queue } = fakeQueue([1]);

    expect(await enqueue(queue, { lead_id: "lead-1" }, { log, ifLost: "sweeper" })).toBe(false);
    expect(warnings).toEqual([
      {
        event: "enqueue_failed",
        fields: expect.objectContaining({ body: { lead_id: "lead-1" }, lost: 1, replayed_by: "sweeper" }) as object,
      },
    ]);
  });

  it("tells ops once what to do by hand where no sweeper would send it", async () => {
    const { log, warnings } = recordingLog();
    const { queue } = fakeQueue([1]);
    const alertOnce = vi.fn(() => Promise.resolve());
    const alert = { key: "contact_sync:p1", message: "Update their CRM lead by hand.", link: "/clients/p1" };

    expect(await enqueue(queue, { update_person_id: "p1" }, { log, ifLost: { alertOnce, alert } })).toBe(false);
    expect(alertOnce).toHaveBeenCalledExactlyOnceWith(alert);
    expect(warnings[0]?.fields).toMatchObject({ alert: "contact_sync:p1" });
  });
});

describe("enqueueBatch", () => {
  it("sends a long run in batches of a hundred at most", async () => {
    const { log } = recordingLog();
    const { queue, sent, batchSizes } = fakeQueue();

    expect(await enqueueBatch(queue, bodies(201), { log, ifLost: "sweeper" })).toBe(true);
    expect(SEND_BATCH_LIMIT).toBe(100);
    expect(batchSizes).toEqual([100, 100, 1]);
    expect(sent).toHaveLength(201);
  });

  it("goes on past a batch the queue refuses, and answers that not every message was taken", async () => {
    const { log, warnings } = recordingLog();
    const { queue, sent } = fakeQueue([2]);

    expect(await enqueueBatch(queue, bodies(250), { log, ifLost: "sweeper" })).toBe(false);
    expect(sent).toHaveLength(150);
    expect(warnings).toEqual([
      {
        event: "enqueue_failed",
        fields: expect.objectContaining({ body: { message_id: "m100" }, lost: 100 }) as object,
      },
    ]);
  });

  it("sends nothing for no messages", async () => {
    const { log } = recordingLog();
    const { queue, batchSizes } = fakeQueue();

    expect(await enqueueBatch(queue, [], { log, ifLost: "sweeper" })).toBe(true);
    expect(batchSizes).toEqual([]);
  });
});
