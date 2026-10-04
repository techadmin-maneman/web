// What each of the phone's stores holds (./db.ts): one record type per store, so a read says what it gets.

import type { Angle, CheckIn, Job, JobSummary, Me, Phase } from "../api.ts";
import type { Queued } from "./replay.ts";

/** A day's list of jobs, by its date. */
export interface KeptDay {
  readonly date: string;
  readonly jobs: readonly JobSummary[];
}

/** What a check-in measured: the distance, the radius, and when the no-show wait ends. No later call gives it back. */
export interface KeptArrival {
  readonly job_id: string;
  readonly arrival: CheckIn;
}

/** When the technician took the outcome, which the close-out's duration runs to. */
export interface KeptClosure {
  readonly job_id: string;
  readonly at: number;
}

/** The job's start as the card showed it at check-in, which every later step is sent with. */
export interface KeptStart {
  readonly job_id: string;
  readonly starts_at: string;
}

/** One photograph waiting on the phone, held until the API confirms its upload. */
export interface Frame {
  readonly id: string;
  readonly job_id: string;
  readonly angle: Angle;
  readonly phase: Phase;
  readonly frame: Blob;
  /** Its thumbnail, for the client app's rows; missing from a frame kept before the phone made them. */
  readonly small?: Blob;
  /** The take the API answered once the photograph was up; only its thumbnail is still to go. */
  readonly take?: string;
  /** True once the API refused the file itself. The angle is taken again, which replaces this frame. */
  readonly refused?: true;
  readonly kept_at: number;
}

/** The device store's records, each under its own key. */
export type DeviceRecord =
  | { readonly key: "device"; readonly id: string; readonly enrolled_at: number | null }
  /** Who is signed in: a technician's own name and initials, and nothing of a client's. */
  | { readonly key: "me"; readonly me: Me }
  /** Only ever "granted": a refusal is asked again on the next start (./persist.ts). */
  | { readonly key: "keeping"; readonly keeping: "granted" }
  /** A switched-off technician's unsent work, kept for him; the seven days run from `at` (./set-aside.ts). */
  | { readonly key: "set_aside"; readonly technician_id: string; readonly at: number };

export interface Records {
  readonly device: DeviceRecord;
  readonly days: KeptDay;
  readonly cards: Job;
  readonly arrivals: KeptArrival;
  readonly closures: KeptClosure;
  readonly starts: KeptStart;
  readonly outbox: Queued;
  readonly frames: Frame;
}
