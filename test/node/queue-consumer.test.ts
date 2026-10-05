// How every queue consumer reads its batch (src/queues/consumer.ts): one it cannot read is let go of, and a message
// whose work throws is tried again by itself, later each time, holding back none of the others.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { backoffSeconds, DONE, runConsumer, type Consumer } from "../../src/queues/consumer.ts";
import { createLogger } from "../../src/log.ts";

const log = createLogger();

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

function batchOf(bodies: readonly unknown[], attempts = 1) {
  const messages = bodies.map((body, index) => ({
    id: `m${String(index)}`,
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  }));
  return { queue: "mm-test-local", messages, ackAll: vi.fn(), retryAll: vi.fn() };
}

const run = (batch: ReturnType<typeof batchOf>, consumer: Partial<Consumer<{ id: string }>>) =>
  runConsumer(batch as unknown as MessageBatch, {
    name: "test",
    schema: z.object({ id: z.string() }),
    log,
    logFor: () => log,
    handle: () => Promise.resolve(DONE),
    ...consumer,
  });

describe("a queue consumer", () => {
  it("lets go of a message it cannot read, and works the rest", async () => {
    const batch = batchOf([{ nope: true }, { id: "a" }]);
    await run(batch, {});
    expect(batch.messages[0]?.ack).toHaveBeenCalledOnce();
    expect(batch.messages[1]?.ack).toHaveBeenCalledOnce();
  });

  it("acks a message its work settles, and retries one it asks to, after the delay it names", async () => {
    const batch = batchOf([{ id: "done" }, { id: "later" }]);
    await run(batch, { handle: (data) => Promise.resolve(data.id === "later" ? { retryAfterSeconds: 90 } : DONE) });
    expect(batch.messages[0]?.ack).toHaveBeenCalledOnce();
    expect(batch.messages[1]?.retry).toHaveBeenCalledWith({ delaySeconds: 90 });
  });

  // A D1 throw on the first message rejected the whole batch, and every message came back at once.
  it("tries again only the message whose work threw, later each time, and works the rest", async () => {
    const batch = batchOf([{ id: "throws" }, { id: "fine" }], 3);
    await run(batch, {
      handle: (data) => (data.id === "throws" ? Promise.reject(new Error("D1_ERROR")) : Promise.resolve(DONE)),
    });
    expect(batch.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: backoffSeconds(3, 30) });
    expect(backoffSeconds(3, 30)).toBe(120);
    expect(batch.messages[1]?.ack).toHaveBeenCalledOnce();
  });

  it("settles a throw as the consumer says, and tries again if that throws too", async () => {
    const said = batchOf([{ id: "a" }]);
    await run(said, { handle: () => Promise.reject(new Error("x")), onError: () => Promise.resolve(DONE) });
    expect(said.messages[0]?.ack).toHaveBeenCalledOnce();

    const again = batchOf([{ id: "a" }]);
    await run(again, { handle: () => Promise.reject(new Error("x")), onError: () => Promise.reject(new Error("y")) });
    expect(again.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
  });
});
