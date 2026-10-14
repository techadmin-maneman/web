// What follows a visit on WhatsApp: the way to the technician's recommendation after a consultation, the care guide after a fit
// or a replacement, and two check-ins after it, on the days ops set (`check_in_days`, src/policy/follow-ups.ts). Each
// is queued once a visit by the hourly job, from the reminder hour in India, and goes only with the client's consent
// to WhatsApp about visits. A reply to a check-in reaches Customer Care's inbox as any reply does.

import { indiaDate, indiaInstant, addDays } from "../../lib/india-time.ts";
import { firstNameOf } from "../../lib/names.ts";
import type { MessageKind } from "../../config/message-kinds.ts";
import { FOLLOW_UP_AFTER_HOURS, type CheckInDays } from "../../policy/follow-ups.ts";
import { queueMessage } from "../messages/queued-messages.ts";
import { underVisitsConsent, type Composed } from "../messages/visit-message-text.ts";
import { reminderHourCame, type ReminderHours } from "../cities/city-rules.ts";

/** The kinds this sends, each once a visit. */
const FOLLOW_UP_KINDS = [
  "consultation_follow_up",
  "fit_aftercare",
  "first_check_in",
  "second_check_in",
] as const satisfies readonly MessageKind[];
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

const PER_PASS = 20;

/** The guide a client is sent after a fit, on our site. */
const CARE_GUIDE = "/guides/looking-after-a-hair-system";

const DONE = (types: string) =>
  `a.status = 'completed' AND a.type IN (${types}) AND a.deleted_at IS NULL AND p.erased_at IS NULL
   AND COALESCE((SELECT v.outcome FROM visits v WHERE v.appointment_id = a.id), 'done') = 'done'`;

const NOT_SENT = (kind: FollowUpKind) =>
  `NOT EXISTS (SELECT 1 FROM outbound_messages m WHERE m.subject_id = a.id AND m.kind = '${kind}')`;

/**
 * Each kind's visits due a message: a consultation the client is going ahead from, with no fit booked since, and a
 * fit or a replacement, each from a few hours after it; and the check-ins on their days. `?1` and `?2` bound when the
 * visit started; `?3` is how many a pass takes.
 */
const DUE: Readonly<Record<FollowUpKind, string>> = {
  consultation_follow_up: `${DONE("'consultation'")}
    AND (SELECT v.lost_reason FROM visits v WHERE v.appointment_id = a.id) IS NULL
    AND NOT EXISTS (SELECT 1 FROM appointments f WHERE f.person_id = a.person_id AND f.type = 'first_fit'
                     AND f.deleted_at IS NULL AND f.window_start > a.window_start)`,
  fit_aftercare: DONE("'first_fit', 'replacement'"),
  first_check_in: DONE("'first_fit', 'replacement'"),
  second_check_in: DONE("'first_fit', 'replacement'"),
};

/** When a kind's visits started, for a pass at `now`: a few hours ago at most for the first two, a day for a check-in. */
function startedBetween(kind: FollowUpKind, now: Date, days: CheckInDays): { from: string; to: string } {
  if (kind === "consultation_follow_up" || kind === "fit_aftercare") {
    return {
      from: new Date(now.getTime() - 2 * 24 * 60 * 60_000).toISOString(),
      to: new Date(now.getTime() - FOLLOW_UP_AFTER_HOURS * 60 * 60_000).toISOString(),
    };
  }
  const day = addDays(indiaDate(now), -(kind === "first_check_in" ? days.first : days.second));
  return { from: indiaInstant(day, "00:00").toISOString(), to: indiaInstant(addDays(day, 1), "00:00").toISOString() };
}

/**
 * Writes each follow-up due, once a visit, from the reminder hour in India. Returns the messages' IDs, for the queue;
 * the consumer decides at sending whether each goes.
 */
export async function queueFollowUps(
  db: D1Database,
  now: Date,
  days: CheckInDays,
  hour: ReminderHours,
): Promise<string[]> {
  const came = reminderHourCame("a.service_city", 4, hour, now);
  if (came === null) return [];
  const at = now.toISOString();
  const messages: { id: string; personId: string; visitId: string; kind: FollowUpKind }[] = [];
  for (const kind of FOLLOW_UP_KINDS) {
    const { from, to } = startedBetween(kind, now, days);
    const { results } = await db
      .prepare(
        `SELECT a.id, a.person_id FROM appointments a JOIN people p ON p.id = a.person_id
         WHERE ${DUE[kind]} AND ${NOT_SENT(kind)} AND a.window_start >= ?1 AND a.window_start < ?2
           AND ${came.sql}
         ORDER BY a.window_start LIMIT ?3`,
      )
      .bind(from, to, PER_PASS, ...came.values)
      .all<{ id: string; person_id: string }>();
    for (const row of results)
      messages.push({ id: crypto.randomUUID(), personId: row.person_id, visitId: row.id, kind });
  }
  if (messages.length === 0) return [];
  await db.batch(
    messages.map((message) =>
      queueMessage(db, {
        id: message.id,
        personId: message.personId,
        kind: message.kind,
        subject: { kind: "appointment", id: message.visitId },
        at,
      }),
    ),
  );
  return messages.map((message) => message.id);
}

/** What a queued follow-up says, as things stand when it goes, and only with the client's consent to visit messages. */
export async function composeFollowUp(
  db: D1Database,
  message: {
    readonly kind: FollowUpKind;
    readonly visitId: string;
    readonly personId: string;
    readonly origin: string;
  },
): Promise<Composed> {
  const person = await db
    .prepare("SELECT name FROM people WHERE id = ?1 AND erased_at IS NULL")
    .bind(message.personId)
    .first<{ name: string }>();
  if (person === null) return { skip: "the client is erased" };
  const name = firstNameOf(person.name);
  const composed = composedOf(message, name);
  return "skip" in composed ? composed : underVisitsConsent(db, message.personId, composed);
}

function composedOf(message: { readonly kind: FollowUpKind; readonly origin: string }, name: string): Composed {
  switch (message.kind) {
    // The recommendation itself is in the app, on Home: no queue reads the hair profile.
    case "consultation_follow_up":
      return { template: "consultation_follow_up_v1", params: [name] };
    case "fit_aftercare":
      return { template: "fit_aftercare_v1", params: [name, `${message.origin}${CARE_GUIDE}`] };
    case "first_check_in":
      return { template: "first_check_in_v1", params: [name] };
    case "second_check_in":
      return { template: "second_check_in_v1", params: [name] };
  }
}
