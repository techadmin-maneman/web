// Every table that holds rows about a client: the person themselves, and each table with a person_id, subject_id or
// referred_person_id column. For each, what their data export leaves out and why (every other column is in it), and
// what erasing them does to it. test/node/database/personal-data.test.ts runs the export and the erasure against the migrated
// schema and fails on a table or a column added without an answer here, or an answer the code does not keep.

interface PersonalTable {
  /** The columns the client's data export leaves out. Every other column of the table is in it. */
  readonly leftOut: readonly string[];
  /** Why they are left out; empty when nothing is. */
  readonly whyLeftOut: string;
  readonly erasure: Erasure;
}

interface Erasure {
  /** The erasure deletes the person's rows, or some of them. */
  readonly deletes?: true;
  /** The columns it blanks in the rows it keeps. */
  readonly blanks?: readonly string[];
  /** What it does, and why anything stays. */
  readonly why: string;
}

/** Where an erasure goes after our own database, each with when it was done there and the tries it took. */
const ERASURE_REACHES = ["crm", "fsm", "books", "crm_contact"];

const OUR_KEYS = "Our own keys to the record, which say nothing about the client.";

const HAIR_PROFILE_FIELDS = [
  "norwood_stage",
  "head_circumference_cm",
  "front_to_nape_cm",
  "ear_to_ear_cm",
  "temple_to_temple_cm",
  "base_width_in",
  "base_length_in",
  "colour",
  "grey_percent",
  "density_percent",
  "wave",
  "hairline",
  "product",
  "attachment",
  "remedies",
  "transplant_year",
  "skin_and_allergies",
];

export const PERSONAL_COLUMNS: Readonly<Record<string, PersonalTable>> = {
  people: {
    leftOut: [
      "id",
      "zoho_lead_id",
      "fsm_contact_id",
      "books_customer_id",
      "erased_at",
      ...ERASURE_REACHES.flatMap((place) => [`${place}_erased_at`, `${place}_erasure_attempts`]),
      "crm_erasure_error",
      "files_erased_at",
      "books_checked_at",
      "books_details_changed_at",
      "crm_contact_id",
      "client_since",
      "test_record",
    ],
    whyLeftOut:
      "Our keys to the client's record here and in the CRM and Books, how an erasure of it is going, and when they first had a visit or a payment, which decides how long the record is kept, and whether staging made it for a test.",
    erasure: {
      blanks: ["name", "email", "mobile_e164", "contactable"],
      why: "The name, e-mail and number go. The row stays, marked erased, for the records that point at it.",
    },
  },
  addresses: {
    leftOut: ["id", "person_id", "geocoded_at", "place_id", "geocode_source", "given_to_staff"],
    whyLeftOut:
      "Our keys, how and when we found the pin on the map, and which member of staff took it down on the phone. The export says whether it was given on the phone.",
    erasure: {
      deletes: true,
      blanks: [
        "line1",
        "line2",
        "locality",
        "access_notes",
        "lat",
        "lng",
        "geocoded_at",
        "building",
        "flat",
        "floor",
        "tower",
        "landmark",
        "place_id",
        "geocode_source",
        "given_to_staff",
      ],
      why: "Deleted, unless a technician's check-in was measured against it: that one keeps its city and pincode, the evidence a no-show is ruled on.",
    },
  },
  appointments: {
    leftOut: [
      "id",
      "fsm_id",
      "fsm_work_order_id",
      "person_id",
      "technician_id",
      "fsm_invoice_id",
      "synced_at",
      "deleted_at",
      "reconciled_at",
      "invoice_checked_at",
      "invoice_issued_at",
      "asked_checked_at",
      "asked_failed_at",
      "first_seen_at",
      "start_before_move",
      "nothing_owed_at",
      "fsm_note_written_at",
      "fsm_status",
      "fsm_modified_at",
      "checkin_waived_at",
      "checkin_waived_by",
      "checkin_waived_reason",
    ],
    whyLeftOut:
      "Our and FSM's keys, when each visit was last checked against FSM and Books, and ops letting the technician " +
      "check in past the geofence, which is about his arrival. The technician is given by name.",
    erasure: {
      blanks: ["client_note", "client_note_at"],
      why: "The visits stay, as the record of the service and its invoice; the client's notes to the technician go.",
    },
  },
  audit_log: {
    leftOut: ["id", "surface", "actor_kind", "action", "subject_kind", "subject_id", "request_id", "detail"],
    whyLeftOut:
      "The log of everything else ops did on the record, kept for security. Who opened the photographs, and when, is given.",
    erasure: { why: "Kept two years and never changed, as the record of who did what." },
  },
  consents: {
    leftOut: ["id", "person_id", "ip_hash"],
    whyLeftOut: "Our key, and a one-way hash of the network address it was given from, which reads as nothing.",
    erasure: { why: "Kept, as the record of what was agreed; the erasure adds a withdrawal of each." },
  },
  consultation_requests: {
    leftOut: ["id", "person_id"],
    whyLeftOut: OUR_KEYS,
    erasure: {
      why: "Kept, as the record of a booking asked for: a pincode, a day and a window, nothing that names them.",
    },
  },
  credit_ledger: {
    leftOut: ["id", "person_id", "grant_id", "source_kind", "source_id"],
    whyLeftOut: "Which grant each entry draws on, and the record it came from, by our own keys.",
    erasure: { why: "Kept, as the record of credits given and spent." },
  },
  deletion_requests: {
    leftOut: ["id", "person_id", "decided_by", "alerted_at"],
    whyLeftOut: "Our key, which member of staff decided, and when ops were reminded.",
    erasure: { why: "Kept, as the record that the erasure was asked for and what was decided." },
  },
  discount_code_uses: {
    leftOut: ["id", "code_id", "person_id", "hold_id", "appointment_id", "given_by_id", "removed_by_id"],
    whyLeftOut: "Our keys, and which member of staff entered or took off a code. The code is given by its name.",
    erasure: { why: "Kept with the payments, as the record of what each booking cost." },
  },
  events: {
    leftOut: ["id", "created_at", "name", "subject_id", "payload_json"],
    whyLeftOut: "Counts and keys for our own analysis, with nothing that names anyone.",
    erasure: { why: "Kept: counts and keys, with nothing that names them." },
  },
  first_fit_requests: {
    leftOut: ["id", "person_id", "fitted_since"],
    whyLeftOut: "Our keys, and whether a fit has happened since, which the visits show.",
    erasure: { why: "Kept, as the record of a booking asked for: a window, nothing that names them." },
  },
  grievances: {
    leftOut: ["id", "person_id", "resolved_by"],
    whyLeftOut: "Our keys, and which member of staff answered.",
    erasure: { blanks: ["text", "response"], why: "The words go; that a concern was raised and answered stays." },
  },
  hair_profiles: {
    leftOut: ["id", "person_id", "appointment_id", "event_id", "technician_id", "staff"],
    whyLeftOut: "Our keys, and who recorded each version; the export says whether a technician or ops did.",
    erasure: {
      blanks: HAIR_PROFILE_FIELDS,
      why: "Every version's fit spec and history go; who recorded each, and when, stay.",
    },
  },
  last_visits: {
    leftOut: ["person_id", "visit_id", "visit_start", "consulted_start"],
    whyLeftOut: "Worked out from the visits, which are given.",
    erasure: { why: "Worked out from the visits, which stay." },
  },
  leads: {
    leftOut: [
      "id",
      "person_id",
      "sync_state",
      "sync_attempts",
      "last_sync_error",
      "synced_at",
      "request_id",
      "fsm_request_id",
      "fsm_queued_at",
      "fsm_request_tried_at",
    ],
    whyLeftOut: "Our keys, and how each lead reached the CRM.",
    erasure: {
      blanks: [
        "loss_extent",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
        "gclid",
        "fbclid",
        "referrer",
        "landing_path",
      ],
      why: "How they reached us and how much hair they had lost go. The lead stays, as the record of a booking; the CRM's copy is erased.",
    },
  },
  no_show_disputes: {
    leftOut: ["id", "case_id", "person_id", "ruled_by", "ruling_id", "ruling_reason"],
    whyLeftOut: "Our keys, and which member of staff ruled and their own note on it.",
    erasure: { blanks: ["reason", "ruling_reason"], why: "Both reasons go; the ruling stays." },
  },
  number_change_requests: {
    leftOut: ["id", "person_id", "decided_by", "session_id"],
    whyLeftOut: "Our keys, which member of staff decided, and the sign-in that asked, whose key lets a phone in.",
    erasure: { deletes: true, why: "Deleted, with their codes." },
  },
  otp_challenges: {
    leftOut: [
      "id",
      "created_at",
      "person_id",
      "purpose",
      "channel",
      "code_hash",
      "last_sent_at",
      "sends",
      "attempts",
      "expires_at",
      "verified_at",
      "voided_at",
      "number_change_id",
      "technician_login",
      "technician_id",
      "mobile_hash",
    ],
    whyLeftOut:
      "The one-time codes we sent, kept only as one-way hashes for a day; the sign-ins say when they were used.",
    erasure: {
      deletes: true,
      blanks: ["code_hash"],
      why: "A number change's codes are deleted; every other code stops working at once.",
    },
  },
  outbound_messages: {
    leftOut: [
      "id",
      "person_id",
      "subject_kind",
      "subject_id",
      "queued_at",
      "due_at",
      "sending_at",
      "provider_message_id",
      "attempts",
      "last_error",
    ],
    whyLeftOut: "Our and WhatsApp's keys, and how each message was sent.",
    erasure: {
      why: "Kept, as the record of what was sent: its kind and dates, never its words. Any not yet sent is cancelled.",
    },
  },
  payments: {
    leftOut: [
      "id",
      "reference_year",
      "reference_number",
      "person_id",
      "appointment_id",
      "razorpay_order_id",
      "razorpay_payment_id",
      "currency",
      "vpa_hash",
      "updated_at",
      "books_payment_id",
      "books_checked_at",
      "books_applied_at",
    ],
    whyLeftOut:
      "Our, Razorpay's and Books' keys, the currency (always rupees), and a one-way hash of the UPI ID, which reads as nothing.",
    erasure: { why: "Kept for eight years, as the law asks of payments and invoices." },
  },
  pieces: {
    leftOut: [
      "id",
      "fsm_id",
      "person_id",
      "supplier_lot",
      "appointment_id",
      "synced_at",
      "deleted_at",
      "replacement_booked",
    ],
    whyLeftOut: "Our and FSM's keys, our supplier's batch, and whether a replacement is booked, which the visits show.",
    erasure: { why: "Kept, as the record of what was fitted." },
  },
  referral_attributions: {
    leftOut: [
      "id",
      "referred_person_id",
      "consultation_appointment_id",
      "first_fit_appointment_id",
      "fraud_signals",
      "review_reason",
      "reviewed_by",
      "reviewed_at",
      "attached_by",
      "attach_reason",
      "referrer_visits",
      "updated_at",
    ],
    whyLeftOut:
      "Our keys; our checks against misuse of invites; which member of staff reviewed or attached the invite, and their notes; and what the friend who invited them was given.",
    erasure: {
      blanks: ["friend_first_name", "review_reason", "attach_reason"],
      why: "Their first name, as their friend saw it, and ops' notes go; the invite's grant stays.",
    },
  },
  referral_codes: {
    leftOut: ["person_id", "card_version", "card_key", "updated_at"],
    whyLeftOut: "Our key, and where the card's picture is kept.",
    erasure: {
      why: "The code stays, for the invites already sent; its card goes back to our house card, and the personal card's file is deleted.",
    },
  },
  sessions: {
    leftOut: ["id", "subject_kind", "subject_id"],
    whyLeftOut: "Each sign-in's own key, which lets a phone in, and whose it is.",
    erasure: { why: "Every sign-in ends at once, and is deleted with the other ended ones." },
  },
  slot_holds: {
    leftOut: [
      "id",
      "person_id",
      "technician_id",
      "start_unit",
      "amount_ex_gst",
      "gst_percent",
      "razorpay_order_id",
      "appointment_id",
      "expires_at",
      "updated_at",
      "refunded_at",
      "moves_appointment_id",
      "queued_at",
      "booking_until",
      "fsm_tried_at",
      "fsm_work_order_id",
      "fsm_appointment_id",
      "late_fee_ex_gst",
      "late_fee_gst_percent",
      "grace_seconds",
      "fsm_held_at",
      "fsm_refusal",
      "payment_link_id",
      "payment_link_url",
      "consents_ip_hash",
      "reference_year",
      "reference_number",
      "payment_checked_at",
    ],
    whyLeftOut:
      "How each slot was held and placed, by our, Razorpay's and FSM's keys; its price before GST; when we last asked Razorpay about its payment; and a one-way hash of the network address, which reads as nothing.",
    erasure: {
      blanks: ["consents_shown", "consents_ip_hash"],
      why: "What the pay step showed, and the hashed network address, go; the booking stays.",
    },
  },
  task_closures: {
    leftOut: ["id", "task_group", "subject_id", "reason", "closed_by", "closed_at"],
    whyLeftOut: "Ops' own to-do list.",
    erasure: { blanks: ["reason"], why: "Ops' reason for closing a task about their visit goes." },
  },
  task_owners: {
    leftOut: ["task_group", "subject_id", "episode", "owner", "assigned_by", "assigned_at"],
    whyLeftOut: "Ops' own to-do list.",
    erasure: { why: "Kept: which member of staff looks after a task, nothing about them." },
  },
  tryon_jobs: {
    leftOut: [
      "id",
      "upload_key",
      "uploaded_at",
      "parent_job_id",
      "endpoint",
      "provider_color",
      "color_route",
      "submit_started_at",
      "submit_attempts",
      "submitted_at",
      "provider_task_id",
      "provider_result_url",
      "provider_result_expires_at",
      "download_attempts",
      "download_attempted_at",
      "result_key",
      "failure_code",
      "provider_error_detail",
      "latency_ms",
      "person_id",
      "lead_id",
      "session_id",
      "claimed_at",
      "expires_at",
      "ip_hash",
      "request_id",
      "copy_key",
      "kept_look_key",
      "number_proved_at",
    ],
    whyLeftOut:
      "How each look was made, by our and AILabTools' keys; where the files are kept; and a one-way hash of the network address, which reads as nothing.",
    erasure: {
      blanks: ["result_key", "copy_key", "kept_look_key"],
      why: "The photograph and every look made from it are deleted; the job stays, as a count, with its one-way hash of the network address.",
    },
  },
  tryon_sessions: {
    leftOut: ["id", "person_id", "created_at", "expires_at"],
    whyLeftOut: "The try-on page's sign-in, which lasted minutes and is no longer made.",
    erasure: { deletes: true, why: "Deleted." },
  },
  visit_changes: {
    leftOut: [
      "id",
      "appointment_id",
      "person_id",
      "payment_id",
      "razorpay_refund_id",
      "hold_id",
      "cancelled_by",
      "cancel_reason",
      "refund_settled_at",
    ],
    whyLeftOut:
      "Our and Razorpay's keys, which member of staff cancelled and their own note on it, and when our refund job was done with it.",
    erasure: { blanks: ["cancel_reason"], why: "Ops' reason for a cancel goes; the change stays, with what it cost." },
  },
  waitlist_entries: {
    leftOut: ["id", "person_id"],
    whyLeftOut: OUR_KEYS,
    erasure: { deletes: true, why: "Deleted: waiting needs the number." },
  },
};
