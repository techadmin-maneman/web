// What a job is called: its kind, as the boards name it, or a consultation and fit in one visit, which no board
// draws (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). A job further out than the API shows names
// no kind.

import type { JobSummary } from "../api.ts";
import { job as copy, oneVisit, types, typesLower } from "../content.ts";

type Named = Pick<JobSummary, "type" | "one_visit">;

/** "Consultation and fit", or the kind: "Service". */
export function kindName(job: Named): string {
  if (job.type === null) return copy.locked.title;
  return job.one_visit ? oneVisit.name : types[job.type];
}

/** The same in the card's line, in lower case: "consultation and fit", "service". */
export function kindNameLower(job: Named): string {
  if (job.type === null) return copy.locked.title;
  return job.one_visit ? oneVisit.nameLower : typesLower[job.type];
}
