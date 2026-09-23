// What has not yet reached us, kept current: the screens re-read whenever the
// outbox changes, so a send or a supersede shows without a reload.

import { useEffect, useState } from "react";
import { events, frames, onChange, type Queued } from "../store/outbox.ts";

export interface Waiting {
  readonly events: readonly Queued[];
  /** Photograph frames still on the phone, one per angle, grouped by job on the waiting screen. */
  readonly frames: readonly { id: string; job_id: string; angle: string; phase: string; frame: Blob }[];
}

const NOTHING: Waiting = { events: [], frames: [] };

export function useOutbox(): Waiting {
  const [waiting, setWaiting] = useState<Waiting>(NOTHING);

  useEffect(() => {
    let current = true;
    const read = () => {
      void Promise.all([events(), frames()]).then(([queued, kept]) => {
        if (current) setWaiting({ events: queued, frames: kept });
      });
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
