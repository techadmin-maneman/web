// How work is put on a queue once what it acts on is saved in D1. The change has happened by then, so a queue that
// refuses the message must not turn it into an error: the caller would answer 500 for a change that was made, and
// whoever made it would make it again. A lost message is logged, and either a sweeper pass finds its row in D1 and
// queues it again, or ops are told what to do by hand.

import type { AlertOnce, RaisedAlert } from "../domain/alerts.ts";
import type { Logger } from "../log.ts";

/** The most messages Cloudflare takes in one sendBatch. */
export const SEND_BATCH_LIMIT = 100;

/** What brings back a message the queue would not take. */
export type IfLost =
  /** A sweeper pass finds what the message names still waiting in D1, and queues it again (src/scheduled/). */
  | "sweeper"
  /** Nothing would: ops are told, once, what to do by hand. */
  | { readonly alertOnce: AlertOnce; readonly alert: RaisedAlert };

export interface EnqueueOptions {
  readonly log: Logger;
  readonly ifLost: IfLost;
}

/** Puts one message on the queue. Never throws; answers whether the queue took it. */
export async function enqueue(queue: Queue, body: unknown, options: EnqueueOptions): Promise<boolean> {
  try {
    await queue.send(body);
    return true;
  } catch (error) {
    await whenLost(options, { body, lost: 1, error });
    return false;
  }
}

/**
 * Puts the messages on the queue, at most SEND_BATCH_LIMIT a call; a batch the queue refuses does not stop the
 * next. Never throws; answers whether the queue took every one.
 */
export async function enqueueBatch(
  queue: Queue,
  messages: readonly MessageSendRequest[],
  options: EnqueueOptions,
): Promise<boolean> {
  let tookEvery = true;
  for (let start = 0; start < messages.length; start += SEND_BATCH_LIMIT) {
    const batch = messages.slice(start, start + SEND_BATCH_LIMIT);
    try {
      await queue.sendBatch(batch);
    } catch (error) {
      tookEvery = false;
      await whenLost(options, { body: batch[0]?.body, lost: batch.length, error });
    }
  }
  return tookEvery;
}

async function whenLost(
  options: EnqueueOptions,
  lost: { readonly body: unknown; readonly lost: number; readonly error: unknown },
): Promise<void> {
  const { log, ifLost } = options;
  if (ifLost === "sweeper") {
    log.warn("enqueue_failed", { ...lost, replayed_by: "sweeper" });
    return;
  }
  log.warn("enqueue_failed", { ...lost, alert: ifLost.alert.key });
  await ifLost.alertOnce(ifLost.alert);
}
