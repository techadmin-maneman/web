// Where the technician is, from a visit's check-in to its close (docs/decisions/0248-safety.md): while the app is open
// the phone sends it every POSITION_EVERY_MINUTES for today's visit that is checked in and not closed, straight to the
// API and never queued, as an old position is no use. Nothing is drawn; a reading the phone will not give is skipped.

import { POSITION_EVERY_MINUTES } from "@rules/policy/safety.ts";
import { useEffect, useRef } from "react";
import { api } from "../api.ts";
import { rowState } from "../lib/progress.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { todayInIndia } from "../lib/when.ts";
import { readPosition } from "../lib/where.ts";
import { keptDay, keptStates } from "../store/jobs.ts";
import type { Queued } from "../store/outbox.ts";

/** Today's visit under way: checked in, by what landed or what is still on the phone, and not closed. */
async function visitUnderWay(queued: readonly Queued[]): Promise<string | null> {
  const day = (await keptDay(todayInIndia())) ?? [];
  const heard = await keptStates();
  const underWay = day.find((job) => {
    const state = rowState(job, queued, heard.get(job.id));
    return state === "at_the_door" || state === "in_progress";
  });
  return underWay?.id ?? null;
}

export function SharePosition() {
  const { events } = useOutbox();
  const queued = useRef(events);
  useEffect(() => {
    queued.current = events;
  }, [events]);

  useEffect(() => {
    const share = async () => {
      const jobId = await visitUnderWay(queued.current);
      if (jobId === null) return;
      const position = await readPosition();
      if (position !== null) await api.position(jobId, position);
    };
    const tell = () => {
      share().catch(() => undefined);
    };
    tell();
    const timer = setInterval(tell, POSITION_EVERY_MINUTES * 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return null;
}
