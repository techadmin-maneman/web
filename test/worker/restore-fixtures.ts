// A row in every table, as the database held them at <T>, and what was written since: for test/worker/restore-carry.test.ts.
// The rows at <T> fire every trigger, so the carry-back meets each table that refuses a delete and each one a trigger
// writes to. A new table needs a row here; the test names any table left empty.

const AT = "2026-09-21T06:30:00.000Z";
const SINCE = "2026-10-02T06:30:00.000Z";
const LATER = "2026-12-31T06:30:00.000Z";

/** Every table's rows at <T>, beside what the migrations themselves put in. */
export const ROWS_AT_T: readonly string[] = [
  // A fitted client, whose name has an apostrophe, and a friend he invited, who has a consultation booked.
  `INSERT INTO people (id, created_at, mobile_e164, name, contactable)
     VALUES ('p1', '${AT}', '+919810000001', 'Arjun D''Souza', 1)`,
  `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p2', '${AT}', '+919810000002', 'Rohit Malhotra')`,
  `INSERT INTO leads (id, person_id, created_at, source, city, request_id) VALUES ('l1', 'p2', '${AT}', 'form', 'Gurgaon', 'r1')`,
  `INSERT INTO visit_blackouts (date, reason) VALUES ('2026-10-02', 'Gandhi Jayanti')`,
  `INSERT INTO counters (scope, key, window_start, count) VALUES ('otp_send', 'a-hash', '${AT}', 1)`,
  `INSERT INTO idempotency (key, route, request_hash, created_at) VALUES ('k1', 'POST /api/holds', 'h-hash', '${AT}')`,
  `INSERT INTO zoho_token (id, access_token, expires_at) VALUES (1, 'old-token', '${AT}')`,
  `INSERT INTO zoho_tokens (client, access_token, expires_at) VALUES ('fsm', 'old-token', '${AT}')`,
  `INSERT INTO zoho_access_tokens (client, access_token, expires_at) VALUES ('crm', 'a-token', '${LATER}')`,
  `INSERT INTO events (id, created_at, name) VALUES ('e1', '${AT}', 'lead_created')`,
  `INSERT INTO tryon_jobs (id, created_at, upload_key, state, person_id, lead_id, photo_consent_version, photo_consent_at,
     ip_hash, request_id)
     VALUES ('j1', '${AT}', 'uploads/j1', 'ready', 'p2', 'l1', 'photo-v1', '${AT}', 'a-hash', 'r1')`,
  `INSERT INTO tryon_sessions (id, person_id, created_at, expires_at) VALUES ('ts1', 'p2', '${AT}', '${LATER}')`,
  `INSERT INTO audit_log (id, at, surface, actor_kind, actor, action, subject_kind, subject_id)
     VALUES (1, '${AT}', 'ops', 'staff', 'ops@example.com', 'ops.call', 'person', 'p1')`,
  `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state)
     VALUES ('m1', '${AT}', 'p1', 'visit_reminder', 'appointment', 'ap1', 'queued')`,
  `INSERT INTO otp_challenges (id, created_at, person_id, purpose, channel, last_sent_at, expires_at)
     VALUES ('o1', '${AT}', 'p1', 'login', 'whatsapp', '${AT}', '${LATER}')`,
  `INSERT INTO number_codes (id, created_at, mobile_hash, code_hash, expires_at)
     VALUES ('nc-code1', '${AT}', 'a-hash', 'c-hash', '${LATER}')`,
  `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at)
     VALUES ('s1', 'technician', 't1', '${AT}', '${AT}', '${LATER}')`,
  `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at)
     VALUES ('s2', 'client', 'p1', '${AT}', '${AT}', '${LATER}')`,
  `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
     VALUES ('a1', 'p1', '${AT}', '1 A Road', 'DLF Phase 1', 'Gurgaon', '122002')`,
  `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state)
     VALUES ('nc1', 'p1', '${AT}', '+919810000009', 'verifying')`,
  `INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES ('dr1', 'p2', '${AT}', 'requested')`,
  `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES ('c1', 'p1', 'contact', 'contact-v1', 1, '${AT}')`,
  `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at)
     VALUES ('t1', 't1', 'A Technician', 'AT', 1, '${AT}')`,
  `INSERT INTO fsm_items (fsm_id, name, type, updated_at) VALUES ('i1', 'Bond strip', 'Part', '${AT}')`,
  // His first fit, done: last_visits follows it.
  `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status, synced_at)
     VALUES ('ap1', 'ap1', 'p1', 'first_fit', '2026-09-22T03:30:00.000Z', '2026-09-22T06:30:00.000Z', 't1',
             'completed', '${AT}')`,
  // The friend's consultation: their request reads as booked.
  `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status, synced_at)
     VALUES ('ap2', 'ap2', 'p2', 'consultation', '2026-10-05T03:30:00.000Z', '2026-10-05T04:30:00.000Z', 't1',
             'scheduled', '${AT}')`,
  // His replacement, booked after his piece falls due: the piece reads as booked, and his partial fit as followed up.
  `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status, synced_at)
     VALUES ('ap3', 'ap3', 'p1', 'replacement', '2026-12-01T03:30:00.000Z', '2026-12-01T06:30:00.000Z', 't1',
             'scheduled', '${AT}')`,
  `INSERT INTO webhook_inbox (id, source, dedupe_key, module, record_id, received_at)
     VALUES ('w1', 'fsm', 'w1-key', 'Appointments', 'ap1', '${AT}')`,
  `INSERT INTO sync_cursors (name, updated_at) VALUES ('fsm_appointments', '${AT}')`,
  `INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES ('ps1', 'ap1', 'after', '${AT}')`,
  `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, taken_at, created_at)
     VALUES ('ph1', 'ps1', 'front', 'visits/ap1/after-front.jpg', 'image/jpeg', 1000, '${AT}', '${AT}')`,
  `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status, captured_at,
     created_at, updated_at)
     VALUES ('pay1', 'p1', 'ap1', 'pay_1', 2500000, 'INR', 'captured', '${AT}', '${AT}', '${AT}')`,
  `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, created_at, updated_at)
     VALUES ('rf1', 'pay1', 'rfnd_1', 100000, 'processed', '${AT}', '${AT}')`,
  `INSERT INTO razorpay_events (event_id, event, received_at) VALUES ('evt_1', 'payment.captured', '${AT}')`,
  `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
     gst_percent, state, appointment_id, expires_at, created_at, updated_at)
     VALUES ('h1', 'p1', 'first_fit', '2026-09-22', 'morning', 't1', 0, 2500000, 2118644, 18, 'booked', 'ap1',
             '${AT}', '${AT}', '${AT}')`,
  `INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES ('t1', '2026-09-22', 'unit-0', 'h1')`,
  `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, created_at)
     VALUES ('vc1', 'ap2', 'p2', 'moved', 'free', '2026-10-04T03:30:00.000Z', '${AT}')`,
  `INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122002', 'DLF Phase 1', 'Gurgaon', 1)`,
  `INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('ARJUN1', 'p1', '${AT}', '${AT}')`,
  `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, created_at, updated_at)
     VALUES ('ra1', 'ARJUN1', 'p2', '${AT}', 'consultation', '${AT}', '${AT}')`,
  `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, created_at)
     VALUES ('cl1', 'p1', 'grant', 3, 'referral', 'ra1', '${AT}')`,
  `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, created_at)
     VALUES ('wl1', '110001', 'p2', '${AT}', '${AT}')`,
  `INSERT INTO grievances (id, person_id, text, state, created_at)
     VALUES ('g1', 'p1', 'The technician came late.', 'open', '${AT}')`,
  `INSERT INTO technician_devices (id, technician_id, device_id, session_id, created_at, last_seen_at)
     VALUES ('d1', 't1', 'phone-1', 's1', '${AT}', '${AT}')`,
  `INSERT INTO checkins (id, appointment_id, technician_id, address_id, at, radius_m, passed, created_at)
     VALUES ('ci1', 'ap1', 't1', 'a1', '${AT}', 150, 1, '${AT}')`,
  `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, created_at)
     VALUES ('ns1', 'ci1', 'ap1', '${AT}', '${AT}', '${AT}')`,
  `INSERT INTO no_show_disputes (id, case_id, person_id, reason, created_at) VALUES ('nd1', 'ns1', 'p1', 'I was home.', '${AT}')`,
  `INSERT INTO job_events (id, appointment_id, event_id, technician_id, device_id, kind, body, occurred_at, received_at,
     updated_at)
     VALUES ('je1', 'ap1', 'e1', 't1', 'd1', 'outcome', '{"outcome":"partial"}', '${AT}', '${AT}', '${AT}')`,
  `INSERT INTO consumables (code, name, unit, unit_cost, created_at, updated_at)
     VALUES ('strip', 'Bond strip', 'strip', 4000, '${AT}', '${AT}')`,
  `INSERT INTO consumables_used (id, appointment_id, job_event_id, name, quantity, created_at, consumable_code)
     VALUES ('cu1', 'ap1', 'je1', 'Bond strip', 2, '${AT}', 'strip')`,
  `INSERT INTO consumable_usage (visit_type, consumable_code, quantity, set_by, set_at)
     VALUES ('first_fit', 'strip', 2, 'ops@example.com', '${AT}')`,
  // A delivery to the central store: stock_balances follows it.
  `INSERT INTO stock_movements (id, consumable_code, location, quantity, reason, actor_kind, actor, created_at)
     VALUES ('sm1', 'strip', 'central', 100, 'received', 'staff', 'ops@example.com', '${AT}')`,
  `INSERT INTO dispatch_moves (id, appointment_id, was_technician_id, now_technician_id, reason, actor, created_at, updated_at)
     VALUES ('dm1', 'ap2', 't1', 't1', 'client_asked', 'ops@example.com', '${AT}', '${AT}')`,
  `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, replacement_due_at, appointment_id, synced_at)
     VALUES ('pc1', 'pc1', 'p1', 'MM-STD-4417-B', '2026-09-22', '2026-11-20', 'ap1', '${AT}')`,
  `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
     VALUES ('cr1', 'p2', '122002', '2026-10-05', 'morning', '${AT}')`,
  `INSERT INTO first_fit_requests (id, person_id, preferred_window, created_at) VALUES ('ff1', 'p2', 'morning', '${AT}')`,
  `INSERT INTO visits (id, appointment_id, outcome, partial_reason, updated_at)
     VALUES ('v1', 'ap1', 'partial', 'client_left', '${AT}')`,
  // A setting changed in the console: ops_settings_snapshot follows it.
  `INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('grace_minutes', '15', 'ops@example.com', '${AT}')`,
  `INSERT INTO technician_leave (id, technician_id, from_date, to_date, actor, created_at)
     VALUES ('tl1', 't1', '2026-10-10', '2026-10-11', 'ops@example.com', '${AT}')`,
  `INSERT INTO alerts (id, key, message, count, first_seen_at, last_seen_at)
     VALUES ('al1', 'books_refund_refused:rf1', 'Books refused the refund.', 1, '${AT}', '${AT}')`,
  `INSERT INTO cron_jobs (job, failed_runs) VALUES ('sweeper', 1)`,
  `INSERT INTO cron_runs (id, started_at, completed_at, failed_jobs) VALUES (1, '${AT}', '${AT}', 0)`,
  `INSERT INTO checklist_items (visit_type, code, label, position, set_by, set_at)
     VALUES ('first_fit', 'shave', 'Shave the area', 1, 'ops@example.com', '${AT}')`,
  `INSERT INTO partial_reasons (code, label, position, set_by, set_at)
     VALUES ('client_left', 'The client had to leave', 1, 'ops@example.com', '${AT}')`,
  `INSERT INTO stored_objects (key, bytes) VALUES ('visits/ap1/after-front.jpg', 1000)`,
  `UPDATE storage_meter SET bytes = 1000 WHERE id = 1`,
  `INSERT INTO task_owners (task_group, subject_id, episode, owner, assigned_by, assigned_at)
     VALUES ('at_risk', 'p1', '', 'ops@example.com', 'ops@example.com', '${AT}')`,
  `INSERT INTO task_closures (id, task_group, subject_id, reason, closed_by, closed_at)
     VALUES ('tc1', 'first_fit_to_book', 'p2', 'Not ready yet', 'ops@example.com', '${AT}')`,
  `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, created_at, updated_at)
     VALUES ('pl1', 'ap2', 'standard', 2500000, 2118644, 18, '${AT}', '${AT}')`,
  `INSERT INTO discount_codes (id, code, kind, value, covers_first_fit, covers_service, covers_replacement,
     once_per_client, created_by, created_at)
     VALUES ('dc1', 'WELCOME10', 'percent', 10, 1, 0, 0, 1, 'ops@example.com', '${AT}')`,
  `INSERT INTO discount_code_uses (id, code_id, person_id, hold_id, given_by, given_by_id, created_at)
     VALUES ('du1', 'dc1', 'p1', 'h1', 'client', 'p1', '${AT}')`,
  `INSERT INTO hair_profiles (id, person_id, appointment_id, technician_id, created_at, norwood_stage,
     head_circumference_cm, colour, skin_and_allergies)
     VALUES ('hp1', 'p1', 'ap1', 't1', '${AT}', '4', 57.5, 'black', 'None known')`,
  `INSERT INTO slot_times (id, applies_from, unit_starts, day_end, set_by, set_at)
     VALUES ('st1', '2026-10-01', '["09:00","10:00","11:00","12:00","14:00","15:00","16:00","17:00"]', '19:00',
             'ops@example.com', '${AT}')`,
  `INSERT INTO staff (email, active, added_by, added_at) VALUES ('ops@example.com', 1, 'owner@example.com', '${AT}')`,
  `INSERT INTO staff_grants (id, email, department, level, geography, granted_by, granted_at)
     VALUES (1, 'ops@example.com', 'operations', 'act', 'national', 'owner@example.com', '${AT}')`,
  `INSERT INTO staff_service_tokens (client_id, label, added_by, added_at)
     VALUES ('ci.access', 'CI', 'owner@example.com', '${AT}')`,
];

/** What was written between <T> and the export: rows added, changed and deleted, in tables of every kind. */
export const WRITTEN_SINCE_T: readonly string[] = [
  // A new client, and what she agreed to, wrote and asked for.
  `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p3', '${SINCE}', '+919810000003', 'Meera O''Brien')`,
  `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES ('c2', 'p3', 'contact', 'contact-v1', 1, '${SINCE}')`,
  `INSERT INTO grievances (id, person_id, text, state, created_at)
     VALUES ('g2', 'p3', 'The first line.' || char(10) || 'The second line.', 'open', '${SINCE}')`,
  `INSERT INTO first_fit_requests (id, person_id, preferred_window, created_at) VALUES ('ff2', 'p3', 'afternoon', '${SINCE}')`,
  `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status, synced_at)
     VALUES ('ap4', 'ap4', 'p3', 'consultation', '2026-10-09T03:30:00.000Z', '2026-10-09T04:30:00.000Z', 't1',
             'scheduled', '${SINCE}')`,
  `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status, captured_at,
     created_at, updated_at)
     VALUES ('pay2', 'p3', 'ap4', 'pay_2', 50000, 'INR', 'captured', '${SINCE}', '${SINCE}', '${SINCE}')`,
  `INSERT INTO hair_profiles (id, person_id, staff, created_at, norwood_stage) VALUES ('hp2', 'p3', 'ops@example.com', '${SINCE}', '3')`,
  `INSERT INTO discount_code_uses (id, code_id, person_id, appointment_id, given_by, given_by_id, created_at)
     VALUES ('du2', 'dc1', 'p3', 'ap4', 'ops', 'ops@example.com', '${SINCE}')`,
  // The friend's consultation done, with its outcome: last_visits follows.
  `UPDATE appointments SET status = 'completed' WHERE id = 'ap2'`,
  `INSERT INTO visits (id, appointment_id, outcome, updated_at) VALUES ('v2', 'ap2', 'done', '${SINCE}')`,
  // His erasure's blanking of his hair profile, and his discount priced and then taken off.
  `UPDATE hair_profiles SET norwood_stage = NULL, head_circumference_cm = NULL, colour = NULL, skin_and_allergies = NULL
     WHERE id = 'hp1'`,
  `UPDATE discount_code_uses SET amount_off = 211864, removed_at = '${SINCE}', removed_by = 'ops',
     removed_by_id = 'ops@example.com' WHERE id = 'du1'`,
  `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
     VALUES ('cl2', 'p1', 'redeem', -1, 'cl1', 'appointment', 'ap3', '${SINCE}')`,
  `INSERT INTO audit_log (id, at, surface, actor_kind, actor, action, subject_kind, subject_id)
     VALUES (2, '${SINCE}', 'ops', 'staff', 'ops@example.com', 'ops.erase', 'person', 'p1')`,
  `INSERT INTO slot_times (id, applies_from, unit_starts, day_end, set_by, set_at)
     VALUES ('st2', '2026-10-15', '["08:30","09:30","10:30","11:30","13:30","14:30","15:30","16:30"]', '18:30',
             'ops@example.com', '${SINCE}')`,
  // Stock in, and a kit counted: stock_balances follows both.
  `INSERT INTO stock_movements (id, consumable_code, location, quantity, reason, actor_kind, actor, created_at)
     VALUES ('sm2', 'strip', 'central', 50, 'received', 'staff', 'ops@example.com', '${SINCE}')`,
  `INSERT INTO stock_movements (id, consumable_code, location, technician_id, quantity, reason, actor_kind, actor, created_at)
     VALUES ('sm3', 'strip', 'kit', 't1', 0, 'counted', 'technician', 't1', '${SINCE}')`,
  // Settings changed and added: ops_settings_snapshot follows.
  `UPDATE ops_settings SET value = '20', set_at = '${SINCE}' WHERE name = 'grace_minutes'`,
  `INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('change_notice_hours', '24', 'ops@example.com', '${SINCE}')`,
  // A photograph added to his set.
  `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, taken_at, created_at)
     VALUES ('ph2', 'ps1', 'top', 'visits/ap1/after-top.jpg', 'image/jpeg', 2000, '${SINCE}', '${SINCE}')`,
  // Rows changed and deleted where that is allowed.
  `UPDATE addresses SET line2 = 'Tower B' WHERE id = 'a1'`,
  `UPDATE outbound_messages SET state = 'sent', sent_at = '${SINCE}' WHERE id = 'm1'`,
  `UPDATE cron_runs SET started_at = '${SINCE}', completed_at = '${SINCE}' WHERE id = 1`,
  `DELETE FROM sessions WHERE id = 's2'`,
  `DELETE FROM counters`,
  `INSERT INTO staff (email, active, added_by, added_at) VALUES ('care@example.com', 1, 'owner@example.com', '${SINCE}')`,
];
