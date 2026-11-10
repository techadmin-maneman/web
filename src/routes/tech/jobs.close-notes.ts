// What a visit's close leaves on the client's record (./jobs.steps.ts; docs/decisions/0242-client-record.md): the
// note for the next technician and an alert, kept in their own tables and never in the close's event.

import { z } from "@hono/zod-openapi";
import { alertAtClose } from "../../domain/clients/client-alerts.ts";
import { noteAtClose } from "../../domain/clients/handoff-notes.ts";
import { closedAt, eventByClientId } from "../../domain/field/job-events.ts";
import { type WorkableJob } from "../../domain/field/workable-job.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { closeNotesLand } from "../../policy/in-job-steps.ts";
import { type Ctx } from "./jobs.record.ts";
import { type AcceptedSchema } from "./jobs.schemas.ts";

/**
 * Keeps the note and the alert once however often the phone sends the close. An event ID that had landed before leaves
 * them only where it is this job's close, sent again within the hour after it.
 */
export async function keepCloseNotes(
  c: Ctx,
  job: WorkableJob,
  notes: { readonly handoff_note?: string | undefined; readonly client_alert?: string | undefined },
  accepted: z.infer<typeof AcceptedSchema>,
): Promise<void> {
  const now = c.var.deps.now();
  if (accepted.replayed) {
    const close = await eventByClientId(c.env.DB, job.id, accepted.event_id);
    if (close?.kind !== "outcome" || close.superseded) return;
    // From when the close reached us, as a correction's hour runs: a close held offline is sent again at once.
    const closed = await closedAt(c.env.DB, job.id);
    if (closed === null || !closeNotesLand(closed, now)) return;
  }
  const { technicianId } = technicianOf(c);
  const kept = { personId: job.personId, appointmentId: job.id, technicianId, now };
  const writes = [
    notes.handoff_note === undefined ? null : noteAtClose(c.env.DB, { ...kept, body: notes.handoff_note }),
    notes.client_alert === undefined ? null : alertAtClose(c.env.DB, { ...kept, body: notes.client_alert }),
  ].filter((write) => write !== null);
  if (writes.length > 0) await c.env.DB.batch(writes);
}
