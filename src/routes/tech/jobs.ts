// The technician's day and the job he is on (src/policy/job-visibility.ts,
// in-job-steps.ts, check-in.ts, no-show.ts):
//
//   GET  /api/tech/jobs?date=                    the day's jobs; today and tomorrow in full
//   GET  /api/tech/jobs/:id                      one job, under the day-before unlock
//   GET  /api/tech/jobs/:id/last-visit-photo     the client's last visit, after (board A3)
//   POST /api/tech/jobs/:id/checkin              I have arrived, with the geofence
//   POST /api/tech/jobs/:id/start                start the job
//   POST /api/tech/jobs/:id/photos/upload-url    a link to PUT one photograph to
//   PUT  /api/tech/photos/:token                 the photograph itself
//   PUT  /api/tech/photos/:token/small           its small copy, for the client app's rows
//   POST /api/tech/jobs/:id/photos               the set is complete
//   POST /api/tech/jobs/:id/checklist            the service checklist
//   POST /api/tech/jobs/:id/consumables          what was used, with quantities
//   POST /api/tech/jobs/:id/piece                the piece fitted, or the one that failed; on a one visit, the
//                                                product chosen with it, or that the client decided against it
//   POST /api/tech/jobs/:id/profile              the client's hair profile: the fit spec and their history
//   POST /api/tech/jobs/:id/outcome              done, or partial with a reason; a one visit closed as done
//                                                sends the client its payment link
//   POST /api/tech/jobs/:id/no-show              refused before the wait ends
//
// "Every write accepts the client-generated X-Client-Event-Id, which is
// idempotent": a phone replaying its outbox lands each event once and gets the
// first answer back (docs/decisions/0038-offline-writes.md).
//
// When a write happened is the phone's to say, within bounds, since a phone in
// a basement sends an hour's work at once (src/policy/phone-clock.ts): the
// check-in's own `at`, else the millisecond its event ID, a UUIDv7, begins with.
//
// No response here carries an amount.
//
// A consultation and fit in one visit runs the first fit's steps, the piece
// first: the client chooses the product with the technician there, or decides
// against it, before the checklist, which is the consultation's and the fit's,
// or the consultation's alone once they decline. Closing it as done makes it
// the product's visit, whose payment link Razorpay then texts to the client, or
// a consultation (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
//
// A consultation and a one visit also take the client's hair profile, just
// before the after photographs. It is not a job event: it lands in its own
// table, and the job's order leaves it out, so it needs only
// the start (docs/decisions/0106-a-clients-hair-profile.md).

// The schemas are ./jobs.schemas.ts, the reads ./jobs.read.ts, and the steps ./jobs.steps.ts.

import type { App } from "../../http/context.ts";
import { registerTechJobReads } from "./jobs.read.ts";
import { registerTechJobSteps } from "./jobs.steps.ts";

export function registerTechJobs(app: App): void {
  registerTechJobReads(app);
  registerTechJobSteps(app);
}
