// The next visit the app offers a client, the WhatsApp reminder of it, and a first fit asked for on the site's form
// (src/policy/next-visit.ts; docs/decisions/0086-the-next-visit-is-offered.md).
//
// What the app offers, in the booking sheet it opens pre-filled: once the consultation is done, the first fit, from
// the lead time ops set and in the window the site's request asked for; once a first fit, a service or a replacement
// is done, the next service on its due day and in the last visit's window, or the replacement on the piece's own due
// day where the piece in wear falls due first. A visit whose due day has passed is offered for tomorrow, and the app
// says the day it was due. Nothing is offered while a visit is booked, or paid for and on its way to FSM.
//
// The reminder: one WhatsApp a last visit, from `reminder_before_due` days before its next service falls due until
// the day it does, while nothing is booked. The cron's pass writes it from the evening's reminder hour; the
// messaging consumer sends it only with the client's consent to WhatsApp about their visits, and only while nothing
// is booked still, checking both as it sends (src/queues/messaging.ts), as the visit messages do.

import { shortDate } from "@maneman/web-kit/dates";
import { windowsFor, type BookingWindow, type FirstFitWindow } from "../config/scheduling.ts";
import { VISIT_TYPE_NAMES, type VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import { firstNameOf } from "../lib/names.ts";
import {
  firstFitDue,
  firstFitOpens,
  lastBookableDay,
  nextVisitAfter,
  nextVisitType,
  offeredDay,
  remindedIfDoneBetween,
  serviceDue,
  type NextVisitDays,
  type NextVisitType,
} from "../policy/next-visit.ts";
import { DAY_BEFORE_REMINDER_HOUR } from "../policy/job-visibility.ts";
import { loadSlotSchedule } from "./slot-times.ts";
import { consentGiven } from "./messages.ts";
import { serviceToOffer } from "./services.ts";
import { NO_VISITS_CONSENT, remindersFrom, type Composed } from "./visit-messages.ts";

/** A visit a next service follows: a first fit, a service or a replacement, done. Migration 0048 indexes these. */
const DONE = "a.status = 'completed' AND a.type IN ('first_fit', 'service', 'replacement') AND a.deleted_at IS NULL";

/** A visit of the client's still to happen, or one paid for and on its way to FSM (ADR 0068). */
const BOOKED = `(EXISTS (SELECT 1 FROM appointments b WHERE b.person_id = ?1 AND b.deleted_at IS NULL
      AND b.status IN ('scheduled', 'dispatched', 'in_progress'))
    OR EXISTS (SELECT 1 FROM slot_holds h WHERE h.person_id = ?1 AND h.state = 'held' AND h.confirmed_at IS NOT NULL))`;

/** How many reminders a cron pass writes, well inside its 50 outside calls. */
const REMINDERS_PER_PASS = 20;

/** What the app offers the client next, pre-filled in the booking sheet. */
export interface NextOffer {
  readonly type: NextVisitType;
  /**
   * The service of its kind it is offered as: the one the client's last visit of the kind was, while that is offered,
   * else the kind's first in the console's order (serviceToOffer, docs/decisions/0085-services-ops-can-edit.md). Null
   * while the kind offers none, as a first fit does before ops offer a hair system.
   */
  readonly tier: string | null;
  /**
   * India's day it fell or falls due: a service's from the last visit and the cadence, a replacement's the piece's own,
   * a first fit's from the consultation and the lead time.
   */
  readonly due_on: string;
  /** India's day it is offered on: the day it falls due, or tomorrow once that has passed. */
  readonly date: string;
  /** The window it is offered in, where a visit of its kind can start in it; null for none. */
  readonly window: BookingWindow | null;
}

/** What a client's next visit turns on, read in one statement. */
export interface NextVisitFacts {
  /** A visit is booked, or paid for and on its way to FSM. */
  readonly booked: boolean;
  readonly offer: NextOffer | null;
}

const FACTS = `SELECT
  (SELECT a.window_start FROM appointments a WHERE a.person_id = ?1 AND ${DONE}
    ORDER BY a.window_start DESC LIMIT 1) AS last_start,
  (SELECT a.window_start FROM appointments a WHERE a.person_id = ?1 AND a.status = 'completed'
     AND a.type = 'consultation' AND a.deleted_at IS NULL ORDER BY a.window_start DESC LIMIT 1) AS consulted_start,
  ${BOOKED} AS booked,
  (SELECT MIN(replacement_due_at) FROM pieces WHERE person_id = ?1 AND deleted_at IS NULL AND failed_at IS NULL
     AND replacement_due_at IS NOT NULL) AS piece_due,
  (SELECT preferred_window FROM first_fit_requests WHERE person_id = ?1) AS asked_window`;

interface FactsRow {
  last_start: string | null;
  consulted_start: string | null;
  booked: number;
  piece_due: string | null;
  asked_window: FirstFitWindow | null;
}

/** The window, where a visit of this kind can start in it. */
const windowFor = (type: NextVisitType, window: BookingWindow | null): BookingWindow | null =>
  window !== null && windowsFor(type).includes(window) ? window : null;

/**
 * Whether the client has a visit booked, and what the app offers them next: the next service (or the replacement
 * where the piece falls due first) once they are fitted, the first fit once their consultation is done, or nothing
 * while a visit is booked.
 */
export async function nextVisitFacts(
  db: D1Database,
  personId: string,
  now: Date,
  days: NextVisitDays,
): Promise<NextVisitFacts> {
  const row = await db.prepare(FACTS).bind(personId).first<FactsRow>();
  if (row === null) return { booked: false, offer: null };
  const booked = row.booked === 1;
  if (booked) return { booked, offer: null };
  const tomorrow = addDays(indiaDate(now), 1);
  if (row.last_start !== null) {
    const last = new Date(row.last_start);
    const next = nextVisitAfter(indiaDate(last), row.piece_due, tomorrow, days);
    return {
      booked,
      offer: {
        type: next.type,
        tier: await serviceToOffer(db, personId, next.type, next.offeredOn),
        due_on: next.dueOn,
        date: next.offeredOn,
        window: windowFor(next.type, (await loadSlotSchedule(db)).at(last).window),
      },
    };
  }
  if (row.consulted_start === null) return { booked, offer: null };
  const due = firstFitDue(indiaDate(new Date(row.consulted_start)), days);
  const date = offeredDay(due, tomorrow);
  return {
    booked,
    offer: {
      type: "first_fit",
      tier: await serviceToOffer(db, personId, "first_fit", date),
      due_on: due,
      date,
      window: windowFor("first_fit", row.asked_window),
    },
  };
}

/**
 * The first day the client may book a first fit on: their consultation's day and the lead time ops set, and never
 * before tomorrow (open point 70). Tomorrow for a client with no consultation done, who is offered no first fit.
 */
async function firstFitOpensFor(
  db: D1Database,
  personId: string,
  tomorrow: string,
  days: NextVisitDays,
): Promise<string> {
  const row = await db
    .prepare(
      `SELECT window_start FROM appointments WHERE person_id = ?1 AND status = 'completed' AND type = 'consultation'
         AND deleted_at IS NULL ORDER BY window_start DESC LIMIT 1`,
    )
    .bind(personId)
    .first<{ window_start: string }>();
  return row === null ? tomorrow : firstFitOpens(indiaDate(new Date(row.window_start)), tomorrow, days);
}

/**
 * The days a visit of this type may be booked on in the app, for this client: from tomorrow, or for a first fit from
 * the lead time ops set after the consultation, to the horizon ops set.
 */
export async function bookableDays(
  db: D1Database,
  personId: string,
  type: VisitType,
  now: Date,
  days: NextVisitDays,
): Promise<{ readonly opens: string; readonly last: string }> {
  const tomorrow = addDays(indiaDate(now), 1);
  const opens = type === "first_fit" ? await firstFitOpensFor(db, personId, tomorrow, days) : tomorrow;
  return { opens, last: lastBookableDay(tomorrow, days) };
}

/**
 * Something booked since the done visit `a`: a later visit that is not cancelled, any visit still to happen, or one
 * paid for and on its way to FSM.
 */
const BOOKED_SINCE = `(EXISTS (SELECT 1 FROM appointments later WHERE later.person_id = a.person_id
      AND later.deleted_at IS NULL AND (later.status IN ('scheduled', 'dispatched', 'in_progress')
        OR (later.window_start > a.window_start AND later.status NOT IN ('cancelled', 'terminated'))))
    OR EXISTS (SELECT 1 FROM slot_holds h WHERE h.person_id = a.person_id AND h.state = 'held'
      AND h.confirmed_at IS NOT NULL))`;

/**
 * The visits whose next service is due within `reminder_before_due` days with nothing booked, and not yet reminded
 * of: the last visit of each client, done between ?1 and ?2.
 */
const TO_REMIND = `SELECT a.id, a.person_id FROM appointments a JOIN people p ON p.id = a.person_id
  WHERE ${DONE} AND a.window_start >= ?1 AND a.window_start < ?2 AND p.erased_at IS NULL AND NOT ${BOOKED_SINCE}
    AND NOT EXISTS (SELECT 1 FROM outbound_messages m WHERE m.subject_id = a.id AND m.kind = 'next_service_reminder')
  ORDER BY a.window_start LIMIT ?3`;

/**
 * Writes the next service's reminder for each client it is due to, once a last visit, from the reminder hour in
 * India that the day-before reminders go from. Returns the messages' IDs, for the queue; the consumer decides at
 * sending whether each goes.
 */
export async function queueNextServiceReminders(
  db: D1Database,
  now: Date,
  days: NextVisitDays,
  hour: number = DAY_BEFORE_REMINDER_HOUR,
): Promise<string[]> {
  if (indiaTime(now) < remindersFrom(hour)) return [];
  const { from, to } = remindedIfDoneBetween(indiaDate(now), days);
  if (to < from) return [];
  const { results } = await db
    .prepare(TO_REMIND)
    .bind(
      indiaInstant(from, "00:00").toISOString(),
      indiaInstant(addDays(to, 1), "00:00").toISOString(),
      REMINDERS_PER_PASS,
    )
    .all<{ id: string; person_id: string }>();
  const at = now.toISOString();
  const messages = results.map((visit) => ({
    id: crypto.randomUUID(),
    personId: visit.person_id,
    visitId: visit.id,
  }));
  if (messages.length > 0) {
    await db.batch(
      messages.map((message) =>
        db
          .prepare(
            `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
             VALUES (?1, ?2, ?3, 'next_service_reminder', 'appointment', ?4, 'queued', ?2)`,
          )
          .bind(message.id, at, message.personId, message.visitId),
      ),
    );
  }
  return messages.map((message) => message.id);
}

/**
 * What the reminder says, as things stand when it is sent: the next visit and the day it falls due. Not sent without
 * the client's consent to WhatsApp about their visits, or once a visit is booked.
 */
export async function composeNextServiceReminder(
  db: D1Database,
  visitId: string,
  personId: string,
  days: NextVisitDays,
): Promise<Composed> {
  if (!(await consentGiven(db, personId, "whatsapp_visits"))) return { skip: NO_VISITS_CONSENT };
  const row = await db
    .prepare(
      `SELECT a.window_start, p.name,
         (SELECT MIN(replacement_due_at) FROM pieces WHERE person_id = ?1 AND deleted_at IS NULL AND failed_at IS NULL
            AND replacement_due_at IS NOT NULL) AS piece_due,
         ${BOOKED_SINCE} AS booked
       FROM appointments a JOIN people p ON p.id = a.person_id
       WHERE a.id = ?2 AND a.person_id = ?1 AND ${DONE}`,
    )
    .bind(personId, visitId)
    .first<{ window_start: string; name: string; piece_due: string | null; booked: number }>();
  if (row === null) return { skip: "no such visit" };
  if (row.booked === 1) return { skip: "a visit is booked" };
  const due = serviceDue(indiaDate(new Date(row.window_start)), days);
  const type = nextVisitType(due, row.piece_due);
  return {
    template: "next_visit_due_v1",
    params: [firstNameOf(row.name), VISIT_TYPE_NAMES[type].toLowerCase(), shortDate(due)],
  };
}
