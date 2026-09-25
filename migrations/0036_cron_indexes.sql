-- Migration number: 0036
-- Indexes for what the five-minute cron and the busiest requests look up, so
-- that each reads about the rows it wants rather than the whole table
-- (ADR 0009: past 5 million rows read a day, D1 refuses every query until
-- midnight UTC). Most are partial: they hold only the rows still waiting for
-- something, so they stay small however much history the table gathers.
-- test/node/query-plans.test.ts holds each statement to its index. Only new
-- indexes, so the code already deployed is unaffected.

-- The sweeper: erased people still to be blanked in the CRM and in FSM.
CREATE INDEX people_crm_erasure_due ON people (erased_at) WHERE erased_at IS NOT NULL AND crm_erased_at IS NULL;
CREATE INDEX people_fsm_erasure_due ON people (erased_at)
  WHERE erased_at IS NOT NULL AND fsm_contact_id IS NOT NULL AND fsm_erased_at IS NULL;

-- The sweeper: try-on photographs not yet deleted, by photograph. Every job ever
-- made stays in tryon_jobs, and this is what stops the sweep reading them all.
CREATE INDEX tryon_jobs_photos_held ON tryon_jobs (upload_key, created_at, state)
  WHERE upload_deleted_at IS NULL AND uploaded_at IS NOT NULL;

-- The sweeper's housekeeping: what it deletes once it is old enough.
CREATE INDEX idempotency_by_created ON idempotency (created_at);
CREATE INDEX counters_by_window ON counters (window_start);
CREATE INDEX tryon_sessions_by_expiry ON tryon_sessions (expires_at);
CREATE INDEX sessions_by_revoked ON sessions (revoked_at) WHERE revoked_at IS NOT NULL;

-- The asked-window pass: live visits not yet looked at; and a lead by the FSM Request it became.
CREATE INDEX appointments_asked_unchecked ON appointments (window_start)
  WHERE asked_checked_at IS NULL AND fsm_work_order_id IS NOT NULL AND deleted_at IS NULL
    AND status IN ('scheduled', 'dispatched', 'in_progress');
CREATE INDEX leads_by_fsm_request ON leads (fsm_request_id) WHERE fsm_request_id IS NOT NULL;

-- The invoice pass: finished visits whose invoice is not yet issued.
CREATE INDEX appointments_to_invoice ON appointments (window_start)
  WHERE status = 'completed' AND invoice_issued_at IS NULL AND fsm_work_order_id IS NOT NULL AND deleted_at IS NULL;

-- Tomorrow's reminders, and the reconciliation's visits closed in the last three days.
CREATE INDEX appointments_by_window_start ON appointments (window_start);
CREATE INDEX appointments_by_window_end ON appointments (window_end);

-- The Books pass: payments not yet recorded there, recorded but not set against an
-- invoice, and processed refunds not yet recorded.
CREATE INDEX payments_books_unrecorded ON payments (captured_at)
  WHERE books_payment_id IS NULL AND captured_at IS NOT NULL;
CREATE INDEX payments_books_unapplied ON payments (captured_at)
  WHERE books_payment_id IS NOT NULL AND books_applied_at IS NULL;
CREATE INDEX refunds_books_unrecorded ON refunds (created_at) WHERE status = 'processed' AND books_refund_id IS NULL;

-- The referral pass: referrals still pending, refunded first fits and the referral
-- each belongs to, and credit grants by expiry.
CREATE INDEX referral_attributions_pending ON referral_attributions (referred_person_id) WHERE grant_state = 'pending';
CREATE INDEX payments_refunded_visits ON payments (appointment_id) WHERE status = 'refunded' AND kind = 'visit';
CREATE INDEX referral_attributions_by_first_fit ON referral_attributions (first_fit_appointment_id)
  WHERE first_fit_appointment_id IS NOT NULL;
CREATE INDEX credit_ledger_grants_by_expiry ON credit_ledger (expires_at) WHERE kind = 'grant';

-- The dispatch board's daily utilisation: whether yesterday's is written yet.
CREATE INDEX events_utilisation_by_day ON events (subject_id) WHERE name = 'dispatch_utilisation';

-- Requests: a payment by its Razorpay order (the hold page polls it), a visit's
-- payments, a payment's refunds and changes, a credit entry by what it paid for,
-- and the slot holds still held.
CREATE INDEX payments_by_order ON payments (razorpay_order_id);
CREATE INDEX payments_by_appointment ON payments (appointment_id);
CREATE INDEX refunds_by_payment ON refunds (payment_id);
CREATE INDEX visit_changes_by_payment ON visit_changes (payment_id);
CREATE INDEX credit_ledger_by_source ON credit_ledger (source_id, kind);
CREATE INDEX slot_holds_held ON slot_holds (expires_at) WHERE state = 'held';

-- An erasure: the rows that point at what it deletes, and what it reads by person.
CREATE INDEX checkins_by_address ON checkins (address_id) WHERE address_id IS NOT NULL;
CREATE INDEX otp_challenges_by_number_change ON otp_challenges (number_change_id) WHERE number_change_id IS NOT NULL;
CREATE INDEX tryon_jobs_by_person ON tryon_jobs (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX tryon_sessions_by_person ON tryon_sessions (person_id);
CREATE INDEX waitlist_entries_by_person ON waitlist_entries (person_id);
CREATE INDEX grievances_by_person ON grievances (person_id);
