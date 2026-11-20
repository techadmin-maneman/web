// The conversions a write to a visit or a payment brings about (docs/decisions/0288-attribution-and-conversions.md),
// recorded in the write's own batch, worked out again from the visits and payments as they now stand: a client's first
// consultation booked and first done (a consultation and fit in one visit counts as both), and each payment captured,
// a first fit's as first_fit_paid, any other as service_paid. Each is recorded once, by what it is, with the client's
// channels as they stand, to wait for the cron to send it (./conversion-sends.ts). A test record's is never sent, nor
// one of a client who asked that nothing of theirs go to Google or Meta. A
// payment for a hold waits until its visit is booked, so it is known to be a first fit's or not.

import { PAYMENT_HELD, statusIn } from "../../config/statuses.ts";

/** A fresh UUID (v4), as SQLite can make one. */
const UUID = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
  || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

/**
 * Each platform's starting state: waiting, or not for it where the client is a test record or asked that nothing of
 * theirs go to Google or Meta.
 */
const STATE = "CASE WHEN p.test_record = 1 OR pa.sharing_stopped_at IS NOT NULL THEN 'skipped' ELSE 'pending' END";
const WHY = `CASE WHEN p.test_record = 1 THEN 'test_record' WHEN pa.sharing_stopped_at IS NOT NULL THEN 'sharing_stopped'
  END`;

const INSERT = `INSERT INTO conversions (event_id, event, subject_id, person_id, occurred_at, value_paise,
    attributed_channel, last_touch_channel, meta_state, meta_error, meta_next_at, google_state, google_error,
    google_next_at, created_at)`;

/** The columns after the subject, value and time: the client's channels, and both platforms' states. */
const REST = `COALESCE(pa.attributed_channel, 'direct'), COALESCE(pa.last_touch_channel, 'direct'),
    ${STATE}, ${WHY}, ?2, ${STATE}, ${WHY}, ?2, ?2`;

const FROM_CLIENT = "JOIN people p ON p.id = a.person_id LEFT JOIN person_attribution pa ON pa.person_id = a.person_id";

/** A client's first visit of these kinds, by `order`, of those `where` holds of. */
const FIRST_OF = (types: string, where: string, order: string) =>
  `a.id = (SELECT x.id FROM appointments x WHERE x.person_id = a.person_id AND x.type IN (${types})
     AND x.deleted_at IS NULL ${where} ORDER BY ${order}, x.id LIMIT 1)`;

const CONSULTATIONS = "'consultation', 'first_fit'";
const BOOKED_AT = (alias: string) => `COALESCE(${alias}.first_seen_at, ${alias}.synced_at)`;

/**
 * The statements that record the conversions of the people `whose` names (SQL reading the JSON list bound as ?1), to
 * follow a write to their visits or payments in its batch. `at` is the write's own time.
 */
export function conversionUpkeep(db: D1Database, whose: string, list: string, at: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `${INSERT}
         SELECT ${UUID}, 'consult_booked', a.id, a.person_id, ${BOOKED_AT("a")}, NULL, ${REST}
         FROM appointments a ${FROM_CLIENT}
         WHERE a.person_id IN (${whose}) AND ${FIRST_OF(CONSULTATIONS, "", BOOKED_AT("x"))}
         ON CONFLICT DO NOTHING`,
      )
      .bind(list, at),
    // The client's channel is settled from their first consultation's booking on.
    db
      .prepare(
        `UPDATE person_attribution SET settled_at = (SELECT c.occurred_at FROM conversions c
           WHERE c.event = 'consult_booked' AND c.person_id = person_attribution.person_id)
         WHERE person_id IN (${whose}) AND settled_at IS NULL`,
      )
      .bind(list),
    db
      .prepare(
        `${INSERT}
         SELECT ${UUID}, 'consult_done', a.id, a.person_id, a.window_start, NULL, ${REST}
         FROM appointments a ${FROM_CLIENT}
         WHERE a.person_id IN (${whose}) AND ${FIRST_OF(CONSULTATIONS, "AND x.status = 'completed'", "x.window_start")}
         ON CONFLICT DO NOTHING`,
      )
      .bind(list, at),
    db
      .prepare(
        `${INSERT}
         SELECT ${UUID},
           CASE WHEN a.type = 'first_fit' AND ${FIRST_OF("'first_fit'", "", "x.window_start")} THEN 'first_fit_paid'
             ELSE 'service_paid' END,
           y.id, y.person_id, y.captured_at, COALESCE(y.amount_ex_gst, y.amount),
           COALESCE(pa.attributed_channel, 'direct'), COALESCE(pa.last_touch_channel, 'direct'),
           ${STATE}, ${WHY}, ?2, ${STATE}, ${WHY}, ?2, ?2
         FROM payments y JOIN people p ON p.id = y.person_id
           LEFT JOIN appointments a ON a.id = y.appointment_id
           LEFT JOIN person_attribution pa ON pa.person_id = y.person_id
         WHERE y.person_id IN (${whose}) AND y.captured_at IS NOT NULL
           AND ${statusIn("y.status", PAYMENT_HELD)} AND y.amount > 0
           AND (y.appointment_id IS NOT NULL
             OR NOT EXISTS (SELECT 1 FROM slot_holds h WHERE h.razorpay_order_id = y.razorpay_order_id))
         ON CONFLICT DO NOTHING`,
      )
      .bind(list, at),
  ];
}
