// What has not yet reached us, kept current: App reads the outbox whenever it
// changes, once for every screen, so a send or a supersede shows without a reload.

import { createContext, useContext, useEffect, useState } from "react";
import { events, frames, onChange, type Frame, type Queued } from "../store/outbox.ts";

export interface Waiting {
  readonly events: readonly Queued[];
  /** Photograph frames still on the phone, one per angle, grouped by job on the waiting screen. */
  readonly frames: readonly Frame[];
  /** False until the outbox has been read, or would not be: until then, nothing in it is known. */
  readonly read: boolean;
}

const NOTHING: Waiting = { events: [], frames: [], read: false };

/**
 * What the outbox holds, as one value that changes only when it does. A screen
 * that must re-read a job when a write lands watches this rather than the array
 * itself, which is new on every read (apps/tech/src/lib/useDay.ts).
 */
export function signatureOf(waiting: Waiting): string {
  const events = waiting.events.map((event) => `${String(event.seq)}${event.state}`).join(",");
  return `${events}|${String(waiting.frames.length)}`;
}

/** What the outbox holds, as App last read it (useOutboxSubscription). */
export const OutboxContext = createContext<Waiting>(NOTHING);

export function useOutbox(): Waiting {
  return useContext(OutboxContext);
}

/** The one reader of the outbox, which App holds and passes to every screen through OutboxContext. */
export function useOutboxSubscription(): Waiting {
  const [waiting, setWaiting] = useState<Waiting>(NOTHING);

  useEffect(() => {
    let current = true;
    const read = () => {
      void Promise.all([events(), frames()]).then(
        ([queued, kept]) => {
          if (current) setWaiting({ events: queued, frames: kept, read: true });
        },
        () => {
          // A store that would not open this time keeps the last account, and no screen waits on it; the next change
          // reads again.
          if (current) setWaiting((last) => ({ ...last, read: true }));
        },
      );
    };
    read();
    const stop = onChange(read);
    return () => {
      current = false;
      stop();
    };
  }, []);

  return waiting;
}
