// The WhatsApp reminder that free service visits are running out (src/policy/credit-reminders.ts): one to a client
// for the visits that end on one day, however many grants they came from. The cron's pass writes it from the
// evening's reminder hour; the messaging consumer sends it only with the client's consent to WhatsApp about their
// visits, and only while some of those visits are still to book.

import { fullDate } from "@maneman/web-kit/dates";
import { serviceVisits } from "../config/message-templates.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import { firstNameOf } from "../lib/names.ts";
import { CREDIT_REMINDER_DAYS, creditReminderOwed } from "../policy/credit-reminders.ts";
import { DAY_BEFORE_REMINDER_HOUR } from "../policy/job-visibility.ts";
import { GRANT_REMAINING } from "./credits.ts";
import { consentGiven } from "./consents.ts";
import { NO_VISITS_CONSENT, remindersFrom, type Composed } from "./visit-messages.ts";

/** How many reminders a cron pass queues. */
const REMINDERS_PER_PASS = 20;

/**
 * Each client's visits still to book that end between ?1 and ?2, grouped by the instant they expire: when they were
 * given, and when the client was last reminded of them. A group is named by its first grant.
 */
const ENDING = `SELECT MIN(g.id) AS grant_id, g.person_id, g.expires_at, MIN(g.created_at) AS given_at,
    (SELECT MAX(m.created_at) FROM credit_ledger sibling JOIN outbound_messages m ON m.subject_id = sibling.id
      WHERE sibling.person_id = g.person_id AND sibling.kind = 'grant' AND sibling.expires_at = g.expires_at
        AND m.kind = 'credits_expiring') AS reminded_at
  FROM credit_ledger g JOIN people p ON p.id = g.person_id
  WHERE g.kind = 'grant' AND g.expires_at > ?1 AND g.expires_at < ?2 AND p.erased_at IS NULL AND ${GRANT_REMAINING} > 0
  GROUP BY g.person_id, g.expires_at`;

interface EndingVisits {
  grant_id: string;
  person_id: string;
  expires_at: string;
  given_at: string;
  reminded_at: string | null;
}

/** The India days the policy decides on. */
function daysOf(visits: EndingVisits) {
  return {
    lastDay: indiaDate(new Date(visits.expires_at)),
    givenOn: indiaDate(new Date(visits.given_at)),
    remindedOn: visits.reminded_at === null ? null : indiaDate(new Date(visits.reminded_at)),
  };
}

/**
 * Writes the reminder owed for each client's visits running out, from the reminder hour in India. Returns the
 * messages' IDs, for the queue.
 */
export async function queueCreditReminders(
  db: D1Database,
  now: Date,
  hour: number = DAY_BEFORE_REMINDER_HOUR,
): Promise<string[]> {
  if (indiaTime(now) < remindersFrom(hour)) return [];
  const today = indiaDate(now);
  // Visits whose last day is further off than the first reminder's lead have no reminder due yet.
  const tooFarOff = indiaInstant(addDays(today, CREDIT_REMINDER_DAYS[0] + 1), "00:00");
  const { results } = await db.prepare(ENDING).bind(now.toISOString(), tooFarOff.toISOString()).all<EndingVisits>();
  const owed = results.filter((visits) => creditReminderOwed(daysOf(visits), today)).slice(0, REMINDERS_PER_PASS);
  if (owed.length === 0) return [];
  const at = now.toISOString();
  const messages = owed.map((visits) => ({
    id: crypto.randomUUID(),
    personId: visits.person_id,
    grantId: visits.grant_id,
  }));
  await db.batch(
    messages.map((message) =>
      db
        .prepare(
          `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
           VALUES (?1, ?2, ?3, 'credits_expiring', 'credit_ledger', ?4, 'queued', ?2)`,
        )
        .bind(message.id, at, message.personId, message.grantId),
    ),
  );
  return messages.map((message) => message.id);
}

/**
 * What the reminder says as it is sent: how many of the visits ending with the grant's are still to book, and their
 * last day. Not sent without the client's consent to WhatsApp about their visits, nor once none are left.
 */
export async function composeCreditsExpiring(
  db: D1Database,
  grantId: string,
  personId: string,
  now: Date,
): Promise<Composed> {
  if (!(await consentGiven(db, personId, "whatsapp_visits"))) return { skip: NO_VISITS_CONSENT };
  const row = await db
    .prepare(
      `SELECT p.name, named.expires_at,
         (SELECT SUM(${GRANT_REMAINING}) FROM credit_ledger g
           WHERE g.person_id = named.person_id AND g.kind = 'grant' AND g.expires_at = named.expires_at) AS visits
       FROM credit_ledger named JOIN people p ON p.id = named.person_id
       WHERE named.id = ?1 AND named.person_id = ?2 AND named.kind = 'grant' AND named.expires_at IS NOT NULL`,
    )
    .bind(grantId, personId)
    .first<{ name: string; expires_at: string; visits: number }>();
  if (row === null) return { skip: "no such grant" };
  if (row.expires_at <= now.toISOString()) return { skip: "the visits have expired" };
  if (row.visits <= 0) return { skip: "no free service visits left to book" };
  return {
    template: "credits_expiring_v1",
    params: [firstNameOf(row.name), serviceVisits(row.visits), fullDate(indiaDate(new Date(row.expires_at)))],
  };
}
