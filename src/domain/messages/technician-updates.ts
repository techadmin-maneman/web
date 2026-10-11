// A technician's word to the client from the job card (docs/decisions/0145-technician-presets.md): on the way, at the
// gate, or running late, sent from our number. Recorded once by the phone's event ID, and sent as a message about the
// visit, under the client's consent to WhatsApp about visits. Word that reaches us too late to help is kept, unsent.

import { MINUTE_MS } from "../../lib/durations.ts";
import { firstNameOf } from "../../lib/names.ts";
import type { TemplateName } from "../../config/message-templates.ts";

export const PRESETS = ["on_the_way", "at_gate", "running_late"] as const;
export type Preset = (typeof PRESETS)[number];

const TEMPLATES: Readonly<Record<Preset, TemplateName>> = {
  on_the_way: "technician_on_the_way_v1",
  at_gate: "technician_at_gate_v1",
  running_late: "technician_running_late_v1",
};

/** How long after the phone queued it a word still helps: at the gate for ten minutes, the others for thirty. */
const STILL_HELPS_MINUTES: Readonly<Record<Preset, number>> = { on_the_way: 30, at_gate: 10, running_late: 30 };

const tooLate = (preset: Preset, writtenAt: Date, now: Date): boolean =>
  now.getTime() - writtenAt.getTime() > STILL_HELPS_MINUTES[preset] * MINUTE_MS;

/**
 * Records the word and its message, once however often the phone sends it. The message's ID to queue; null when it was
 * recorded before, or reached us too late to tell the client.
 */
export async function recordTechnicianUpdate(
  db: D1Database,
  update: {
    readonly eventId: string;
    readonly appointmentId: string;
    readonly personId: string;
    readonly technicianId: string;
    readonly preset: Preset;
    readonly minutes: number | null;
    readonly writtenAt: Date;
    readonly now: Date;
  },
): Promise<string | null> {
  const late = tooLate(update.preset, update.writtenAt, update.now);
  const messageId = crypto.randomUUID();
  const at = update.now.toISOString();
  const [recorded] = await db.batch([
    db
      .prepare(
        `INSERT INTO technician_updates (id, appointment_id, technician_id, preset, minutes, written_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT DO NOTHING`,
      )
      .bind(
        update.eventId,
        update.appointmentId,
        update.technicianId,
        update.preset,
        update.minutes,
        update.writtenAt.toISOString(),
        at,
      ),
    db
      .prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at,
           last_error)
         SELECT ?1, ?2, ?3, 'technician_update', 'technician_update', ?4, ?5, ?6, ?7
         WHERE NOT EXISTS (SELECT 1 FROM outbound_messages m WHERE m.subject_kind = 'technician_update'
           AND m.subject_id = ?4)`,
      )
      .bind(
        messageId,
        at,
        update.personId,
        update.eventId,
        late ? "skipped" : "queued",
        late ? null : at,
        late ? "the word reached us too late to tell the client" : null,
      ),
  ]);
  return (recorded?.meta.changes ?? 0) === 1 && !late ? messageId : null;
}

/** The message a word sends, as the visit stands now; why not, once it no longer helps or the visit has closed. */
export async function composeTechnicianUpdate(
  db: D1Database,
  updateId: string,
  personId: string,
  now: Date,
): Promise<{ readonly template: TemplateName; readonly params: string[] } | { readonly skip: string }> {
  const update = await db
    .prepare(
      `SELECT u.preset, u.minutes, u.written_at, a.status, p.name, t.name AS technician
       FROM technician_updates u JOIN appointments a ON a.id = u.appointment_id
       JOIN people p ON p.id = a.person_id LEFT JOIN technicians t ON t.id = u.technician_id
       WHERE u.id = ?1 AND a.person_id = ?2`,
    )
    .bind(updateId, personId)
    .first<{
      preset: Preset;
      minutes: number | null;
      written_at: string;
      status: string;
      name: string;
      technician: string | null;
    }>();
  if (update === null) return { skip: "no such word, or not this client's visit" };
  if (["completed", "cancelled", "terminated"].includes(update.status)) return { skip: "the visit has closed" };
  if (tooLate(update.preset, new Date(update.written_at), now)) return { skip: "too late to help the client" };
  const technician = update.technician === null ? "our technician" : firstNameOf(update.technician);
  return {
    template: TEMPLATES[update.preset],
    // A visit's params, as the visit messages number them: {{1}} the first name, {{5}} the technician, {{9}} minutes.
    params: [firstNameOf(update.name), "", "", "", technician, "", "", "", String(update.minutes ?? "")],
  };
}
