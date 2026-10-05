// The photograph sets the phone holds (board A2): one per job and phase, each
// counted by what the API has confirmed. A frame is dropped from the phone the
// moment its upload is confirmed (apps/tech/src/store/outbox.ts), so a set
// whose write is queued has sent every frame it no longer holds; a set still
// being taken has sent nothing.

import type { Angle, Phase } from "../api.ts";
import type { Frame, Queued } from "../store/outbox.ts";

/** The five angles of a visit's set, in the order the design guides them (board B1). */
export const ANGLES: readonly Angle[] = ["front", "top", "left", "right", "hair"];

export const IN_A_SET = ANGLES.length;

export interface PhotoSet {
  readonly job: string;
  readonly phase: Phase;
  /** Frames still on the phone. */
  readonly held: number;
  /** Of those, the ones whose photograph is up: only the thumbnail is still to go. */
  readonly up: number;
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
  const setOf = (job: string, phase: Phase) =>
    sets.get(`${job}:${phase}`) ?? { job, phase, held: 0, up: 0, queued: false };

  for (const frame of [...frames].sort((a, b) => a.kept_at - b.kept_at)) {
    const set = setOf(frame.job_id, frame.phase);
    const up = frame.take === undefined ? set.up : set.up + 1;
    sets.set(`${frame.job_id}:${frame.phase}`, { ...set, held: set.held + 1, up });
  }
  for (const event of events) {
    const phase = PHASE_OF[event.kind];
    if (phase === undefined) continue;
    sets.set(`${event.job_id}:${phase}`, { ...setOf(event.job_id, phase), queued: true });
  }
  return [...sets.values()];
}

/** How many of a set's photographs the API has confirmed. */
export const sentOf = (set: PhotoSet): number => (set.queued ? Math.max(0, IN_A_SET - set.held + set.up) : 0);

export interface TakenAngle {
  readonly angle: Angle;
  /** The frame on the phone; null for an angle whose photograph has already reached us. */
  readonly frameId: string | null;
}

/**
 * The angles of a job's set already taken, for the capture screen: those whose photograph reached us first, then each
 * frame on the phone in the order taken. Once a set is finished, an angle the phone no longer holds has reached us. A
 * frame the API refused is not taken: its angle is taken again.
 */
export function anglesTaken(
  frames: readonly Frame[],
  events: readonly Queued[],
  jobId: string,
  phase: Phase,
): TakenAngle[] {
  const held = frames.filter((frame) => frame.job_id === jobId && frame.phase === phase);
  const finished = events.some((event) => event.job_id === jobId && PHASE_OF[event.kind] === phase);
  const reached = finished ? ANGLES.filter((angle) => !held.some((frame) => frame.angle === angle)) : [];
  const good = held.filter((frame) => frame.refused !== true).sort((a, b) => a.kept_at - b.kept_at);
  return [
    ...reached.map((angle) => ({ angle, frameId: null })),
    ...good.map((frame) => ({ angle: frame.angle, frameId: frame.id })),
  ];
}

/** The angles of a job's set whose photographs the API refused, in the order the design guides them. */
export function anglesRefused(frames: readonly Frame[], jobId: string, phase: Phase): Angle[] {
  return ANGLES.filter((angle) =>
    frames.some(
      (frame) => frame.job_id === jobId && frame.phase === phase && frame.angle === angle && frame.refused === true,
    ),
  );
}
