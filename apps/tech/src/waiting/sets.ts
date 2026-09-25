// The photograph sets the phone holds (board A2): one per job and phase, each
// counted by what the API has confirmed. A frame is dropped from the phone the
// moment its upload is confirmed (apps/tech/src/store/outbox.ts), so a set
// whose write is queued has sent every frame it no longer holds; a set still
// being taken has sent nothing.

import type { Phase } from "../api.ts";
import type { Frame, Queued } from "../store/outbox.ts";

/** A visit's set is five angles (board B1). */
export const IN_A_SET = 5;

export interface PhotoSet {
  readonly job: string;
  readonly phase: Phase;
  /** Frames still on the phone. */
  readonly held: number;
  /** True once the technician finished the set and its write is waiting to go. */
  readonly queued: boolean;
}

const PHASE_OF: Readonly<Partial<Record<Queued["kind"], Phase>>> = {
  before_photos: "before",
  after_photos: "after",
};

/** Every set with a frame on the phone or its write still to send, in the order they were taken. */
export function photoSets(frames: readonly Frame[], events: readonly Queued[]): PhotoSet[] {
  const sets = new Map<string, PhotoSet>();
  const setOf = (job: string, phase: Phase) => sets.get(`${job}:${phase}`) ?? { job, phase, held: 0, queued: false };

  for (const frame of [...frames].sort((a, b) => a.kept_at - b.kept_at)) {
    const set = setOf(frame.job_id, frame.phase);
    sets.set(`${frame.job_id}:${frame.phase}`, { ...set, held: set.held + 1 });
  }
  for (const event of events) {
    const phase = PHASE_OF[event.kind];
    if (phase === undefined) continue;
    sets.set(`${event.job_id}:${phase}`, { ...setOf(event.job_id, phase), queued: true });
  }
  return [...sets.values()];
}

/** How many of a set's photographs the API has confirmed. */
export const sentOf = (set: PhotoSet): number => (set.queued ? Math.max(0, IN_A_SET - set.held) : 0);
