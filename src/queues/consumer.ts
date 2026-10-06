// How every queue consumer reads its batch (src/index.ts): each message read against its contract
// (src/config/pipeline.ts), one it cannot read let go of, and each worked on alone, so a message whose work throws is
// tried again by itself and holds back none of the others. A handler says what becomes of its message by what it
// answers, and never acks or retries the message itself.

import type { z } from "zod";
import type { Logger } from "../log.ts";

/** What becomes of a message: done with none, or tried again after so many seconds. */
export type Settle = { readonly retryAfterSeconds?: number };

export const DONE: Settle = {};

/** The first wait after a message's work throws, doubled for each try it has had: 30 s, 60 s, 120 s and so on. */
const ERROR_RETRY_SECONDS = 30;

/** A wait doubled for each try a message has had already: the first delay, 2×, 4× and so on. */
export const backoffSeconds = (attempts: number, firstDelaySeconds: number): number =>
  firstDelaySeconds * 2 ** Math.max(0, attempts - 1);

export interface Consumer<T> {
  /** Names its log events: "<name>_bad_message" for one it cannot read, "<name>_step_error" for work that threw. */
  readonly name: string;
  readonly schema: z.ZodType<T>;
  readonly log: Logger;
  /** The log a message's work writes to: the consumer's, with the message's own IDs. */
  readonly logFor: (data: T) => Logger;
  readonly handle: (data: T, attempts: number, log: Logger) => Promise<Settle>;
  /** What becomes of a message whose work threw; by default it is tried again, later each time. */
  readonly onError?: (data: T, attempts: number, error: unknown, log: Logger) => Promise<Settle>;
}

const afterError = (attempts: number): Settle => ({ retryAfterSeconds: backoffSeconds(attempts, ERROR_RETRY_SECONDS) });

export async function runConsumer<T>(batch: MessageBatch, consumer: Consumer<T>): Promise<void> {
  for (const message of batch.messages) {
    const parsed = consumer.schema.safeParse(message.body);
    if (!parsed.success) {
      consumer.log.error(`${consumer.name}_bad_message`, { message_id: message.id });
      message.ack();
      continue;
    }
    const log = consumer.logFor(parsed.data);
    let settle: Settle;
    try {
      settle = await consumer.handle(parsed.data, message.attempts, log);
    } catch (error) {
      log.error(`${consumer.name}_step_error`, { error });
      settle = await settleAfterError({ consumer, data: parsed.data, attempts: message.attempts, error, log });
    }
    if (settle.retryAfterSeconds === undefined) message.ack();
    else message.retry({ delaySeconds: settle.retryAfterSeconds });
  }
}

/** The consumer's own answer to a throw; if that throws too, the message is tried again all the same. */
async function settleAfterError<T>({
  consumer,
  data,
  attempts,
  error,
  log,
}: {
  consumer: Consumer<T>;
  data: T;
  attempts: number;
  error: unknown;
  log: Logger;
}): Promise<Settle> {
  if (consumer.onError === undefined) return afterError(attempts);
  try {
    return await consumer.onError(data, attempts, error, log);
  } catch (again) {
    log.error(`${consumer.name}_error_handling_failed`, { error: again });
    return afterError(attempts);
  }
}
