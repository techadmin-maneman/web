// The technician's day and the job they are on (src/policy/job-visibility.ts,
// in-job-steps.ts, check-in.ts, no-show.ts).
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

// The schemas are ./jobs.schemas.ts, the reads ./jobs.read.ts, the steps ./jobs.steps.ts, and a word to the client
// from the card ./jobs.updates.ts.

import type { App } from "../../http/context.ts";
import { registerTechJobReads } from "./jobs.read.ts";
import { registerTechJobSteps } from "./jobs.steps.ts";
import { registerTechUpdates } from "./jobs.updates.ts";

export function registerTechJobs(app: App): void {
  registerTechJobReads(app);
  registerTechJobSteps(app);
  registerTechUpdates(app);
}
