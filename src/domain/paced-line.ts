// The line of paced messages waiting to leave (src/policy/message-pacing.ts). Each is held back on the queue until its
// turn, saved as its `due_at`. Messages joining later queue behind the last one still waiting, so two launches, or a
// launch and the sweeper, never leave faster together than the pace allows.

import { SECOND_MS } from "../lib/durations.ts";
import { PACED_GAP_SECONDS, pacedDelaySeconds } from "../policy/message-pacing.ts";

/** A place in the line: the seconds the queue holds the message back, and the instant it leaves. */
export interface PacedSlot {
  readonly delaySeconds: number;
  readonly dueAt: string;
}

/**
 * Gives each message its place at the back of the line. `behind` is how many join just ahead of these in the same
 * write, which the line in D1 does not hold yet.
 */
export async function joinPacedLine<Message>(
  db: D1Database,
  now: Date,
  messages: readonly Message[],
  behind = 0,
): Promise<(Message & PacedSlot)[]> {
  if (messages.length === 0) return [];
  const startSeconds = await secondsUntilLineIsFree(db, now);
  return messages.map((message, index) => {
    const delaySeconds = pacedDelaySeconds(startSeconds, behind + index);
    return { ...message, delaySeconds, dueAt: new Date(now.getTime() + delaySeconds * SECOND_MS).toISOString() };
  });
}

/** The seconds from now until the next message may leave: at once when nothing waits in the line. */
async function secondsUntilLineIsFree(db: D1Database, now: Date): Promise<number> {
  const line = await db
    .prepare("SELECT MAX(due_at) AS last FROM outbound_messages WHERE state = 'queued' AND due_at > ?1")
    .bind(now.toISOString())
    .first<{ last: string | null }>();
  if (line === null || line.last === null) return 0;
  const untilLast = Math.ceil((Date.parse(line.last) - now.getTime()) / SECOND_MS);
  return untilLast + PACED_GAP_SECONDS;
}
