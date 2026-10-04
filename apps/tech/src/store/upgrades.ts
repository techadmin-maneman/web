// How the phone's database reaches each version, one step at a time (./db.ts). A phone opens it at whatever version
// it last had and runs every step it missed, in order, and none twice. A new step goes at the end, and an old one is
// never edited: some phone somewhere has not run it yet. A record an earlier build kept is put into today's shape
// here, once, and never as it is read.

import type { Job, JobState, JobSummary } from "../api.ts";
import type { KeptArrival, KeptClosure, KeptDay, KeptStart } from "./records.ts";

/** The outbox's index by job, kind and state. */
export const STEP_INDEX = "step";

/**
 * The shape of every record written now, stamped on it as `v`, so a step that changes a record's shape can tell the
 * records it must move from the ones already moved. A record from before the stamp has none, and is version 1.
 */
export const RECORD_VERSION = 2;

/** What the jobs store held before version 3, told apart by its kind. */
type JobsRecord =
  | { readonly id: string; readonly kind: "day"; readonly date: string; readonly jobs: readonly OldRow[] }
  | { readonly id: string; readonly kind: "job"; readonly job: OldCard }
  | { readonly id: string; readonly kind: "arrival"; readonly job_id: string; readonly arrival: KeptArrival["arrival"] }
  | { readonly id: string; readonly kind: "closed"; readonly job_id: string; readonly at: number }
  | { readonly id: string; readonly kind: "start_at_check_in"; readonly job_id: string; readonly starts_at: string };

/** A row of a day's list as an earlier build may have kept it: before the list said where each job stood, or for how long. */
type OldRow = Omit<JobSummary, "progress" | "minutes"> & {
  readonly progress?: JobState;
  readonly minutes?: JobSummary["minutes"];
};

const NOTHING_LANDED: JobState = { started_at: null, outcome: null };

const rowNow = (row: OldRow): JobSummary => ({
  ...row,
  progress: row.progress ?? NOTHING_LANDED,
  minutes: row.minutes ?? null,
});

/**
 * A card as an earlier build may have kept it: before the job sheet and the consumables were set in the console
 * (docs/decisions/0087-consumables-and-stock.md) its partial reasons were ids alone and it carried no consumables;
 * before the hair profile, a one visit's discount code, a one visit's choice, the visit's length and the check-in
 * radius were on the card, it carried none of them (docs/decisions/0106-a-clients-hair-profile.md).
 */
type OldCard = Omit<
  Job,
  | "partial_reasons"
  | "consumables"
  | "profile"
  | "discount_code"
  | "checklist_if_declined"
  | "client_choice"
  | "minutes"
  | "checkin_radius_m"
> & {
  readonly partial_reasons: readonly (Job["partial_reasons"][number] | string)[];
  readonly consumables?: Job["consumables"];
  readonly profile?: Job["profile"];
  readonly discount_code?: Job["discount_code"];
  readonly checklist_if_declined?: Job["checklist_if_declined"];
  readonly client_choice?: Job["client_choice"];
  readonly minutes?: Job["minutes"];
  readonly checkin_radius_m?: Job["checkin_radius_m"];
};

/** "piece_not_ready" as "Piece not ready". */
const worded = (id: string): string => {
  const words = id.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * A card in today's shape, so a job opened with no signal after an update still closes: each reason worded from its
 * id, the consumables step with nothing to start from, the whole checklist run, and no profile, code, choice, length
 * or radius said.
 */
const cardNow = (card: OldCard): Job => ({
  ...card,
  partial_reasons: card.partial_reasons.map((reason) =>
    typeof reason === "string" ? { id: reason, label: worded(reason) } : reason,
  ),
  consumables: card.consumables ?? [],
  profile: card.profile ?? null,
  discount_code: card.discount_code ?? null,
  checklist_if_declined: card.checklist_if_declined ?? card.checklist,
  client_choice: card.client_choice ?? null,
  minutes: card.minutes ?? null,
  checkin_radius_m: card.checkin_radius_m ?? null,
});

/** Where one of the jobs store's records goes from version 3, in today's shape. */
function moved(record: JobsRecord): [string, KeptDay | Job | KeptArrival | KeptClosure | KeptStart] {
  switch (record.kind) {
    case "day":
      return ["days", { date: record.date, jobs: record.jobs.map(rowNow) }];
    case "job":
      return ["cards", cardNow(record.job)];
    case "arrival":
      return ["arrivals", { job_id: record.job_id, arrival: record.arrival }];
    case "closed":
      return ["closures", { job_id: record.job_id, at: record.at }];
    case "start_at_check_in":
      return ["starts", { job_id: record.job_id, starts_at: record.starts_at }];
  }
}

export const UPGRADES: readonly ((db: IDBDatabase, upgrade: IDBTransaction) => void)[] = [
  // Version 1: the four stores. The outbox's key counts up, so reading it in key order is the order the phone queued them in.
  (db) => {
    db.createObjectStore("device", { keyPath: "key" });
    db.createObjectStore("jobs", { keyPath: "id" });
    db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true }).createIndex("job", "job_id");
    db.createObjectStore("frames", { keyPath: "id" });
  },
  // Version 2: the outbox's events by job, kind and state, so a step is found, and queued once, without reading them all.
  (_db, upgrade) => {
    upgrade.objectStore("outbox").createIndex(STEP_INDEX, ["job_id", "kind", "state"]);
  },
  // Version 3: the jobs store held days, cards, arrivals, close-outs and starts side by side, told apart by their keys.
  // Each has a store of its own now, and what the jobs store held moves there, in today's shape, before it goes.
  (db, upgrade) => {
    db.createObjectStore("days", { keyPath: "date" });
    db.createObjectStore("cards", { keyPath: "id" });
    for (const name of ["arrivals", "closures", "starts"]) db.createObjectStore(name, { keyPath: "job_id" });
    const cursor = upgrade.objectStore("jobs").openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (at === null) {
        db.deleteObjectStore("jobs");
        return;
      }
      // What an earlier build wrote: its own shape, which this step is here to read.
      const [store, record] = moved(at.value as JobsRecord);
      upgrade.objectStore(store).put({ ...record, v: RECORD_VERSION });
      at.continue();
    };
  },
];
