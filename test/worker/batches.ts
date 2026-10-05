// A queue's batch as Cloudflare hands one to a consumer, each message's ack and retry recorded.

import { vi, type Mock } from "vitest";

export interface FakeMessage<Body> extends Message<Body> {
  readonly ack: Mock<() => void>;
  readonly retry: Mock<(options?: QueueRetryOptions) => void>;
}

export interface FakeBatch<Body> extends MessageBatch<Body> {
  readonly messages: readonly FakeMessage<Body>[];
  readonly ackAll: Mock<() => void>;
  readonly retryAll: Mock<(options?: QueueRetryOptions) => void>;
}

/** One message for each body, delivered for the `attempts`th time at `timestamp`. */
export function fakeBatch<Body>(
  queue: string,
  bodies: readonly Body[],
  { attempts = 1, timestamp = new Date() }: { attempts?: number; timestamp?: Date } = {},
): FakeBatch<Body> {
  const messages = bodies.map((body, index) => ({
    id: `m-${String(index)}`,
    body,
    attempts,
    timestamp,
    ack: vi.fn<() => void>(),
    retry: vi.fn<(options?: QueueRetryOptions) => void>(),
  }));
  return {
    queue,
    messages,
    // Nothing waiting behind this batch.
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    ackAll: vi.fn<() => void>(),
    retryAll: vi.fn<(options?: QueueRetryOptions) => void>(),
  };
}
