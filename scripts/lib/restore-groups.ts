// What a restore of D1 to an earlier minute undoes, group of tables by group (docs/runbook.md, "Restoring D1"), as
// docs/schema.md lists it (./schema-doc.ts). Every table is in one group, and may be in more; the schema's test fails on
// a table in none.

export interface RestoreGroup {
  readonly what: string;
  readonly tables: readonly string[];
  /** What it means when the tables are left as they were at <T>. */
  readonly leftAtT: string;
  readonly putBackBy: string;
}

/** What a restore to an earlier minute undoes, group by group. Every table is in one, and may be in more. */
export const RESTORE_GROUPS: readonly RestoreGroup[] = [
  {
    what: "Consents given and withdrawn",
    tables: ["consents"],
    leftAtT: "Someone who said stop is messaged again",
    putBackBy: "Adding the rows since `<T>`: they are only ever added",
  },
  {
    what: "Terms agreed to",
    tables: ["terms_acceptances"],
    leftAtT: "A booking made since `<T>` has no record of the terms its client agreed to",
    putBackBy: "Adding the rows since `<T>`: they are only ever added",
  },
  {
    what: "Revoked sessions and phones",
    tables: ["sessions", "technician_devices"],
    leftAtT: "A lost phone, or a session that was ended, works again",
    putBackBy: "Revoking again: a phone in the console, a client's session with `sessions.revoked_at`",
  },
  {
    what: "Erasures",
    tables: [
      "people",
      "addresses",
      "waitlist_entries",
      "number_change_requests",
      "photos",
      "photo_sets",
      "hair_profiles",
      "grievances",
      "no_show_disputes",
      "task_closures",
      "staff_notes",
    ],
    leftAtT: "Erased people come back in D1, with their own words. Their files stay gone, since R2 is not restored",
    putBackBy:
      "Erasing again (runbook, \"Erasure within the day\"). List them before restoring: `SELECT id FROM people WHERE erased_at >= '<T>';`",
  },
  {
    what: "Number changes, deletion requests, grievances",
    tables: ["number_change_requests", "people", "deletion_requests", "grievances"],
    leftAtT: "A client's new number stops working; a request, or its answer, is lost",
    putBackBy: "Deciding each again in the console",
  },
  {
    what: "Payments and refunds",
    tables: ["payments", "refunds", "razorpay_events", "payment_links"],
    leftAtT:
      "Money Razorpay took or gave back is unrecorded, and Razorpay does not send it again. A payment link sent since has no row, though a payment on it still finds its visit",
    putBackBy: "Adding the rows since `<T>`, checked against Razorpay's dashboard",
  },
  {
    what: "Discount codes",
    tables: ["discount_codes", "discount_code_uses"],
    leftAtT:
      "A code made or switched off since goes back, and a use since is forgotten, so a single-use code works again",
    putBackBy: "Making or switching off the code again in the console. `discount_code_uses` is only ever added to",
  },
  {
    what: "Bookings and moves",
    tables: [
      "appointments",
      "slot_holds",
      "slot_claims",
      "dispatch_moves",
      "move_proposals",
      "visit_changes",
      "consultation_requests",
      "first_fit_requests",
    ],
    leftAtT: "A visit booked, moved or cancelled since is lost, and its time can be booked again",
    putBackBy: "The rows since `<T>`, before the switch is turned off",
  },
  {
    what: "Messages",
    tables: ["outbound_messages"],
    leftAtT: "The sweeper sends again what was sent since",
    putBackBy: "The rows since `<T>`, before the switch is turned off",
  },
  {
    what: "The Care inbox",
    tables: [
      "conversations",
      "chat_messages",
      "care_owners",
      "care_weekly_off",
      "care_leave",
      "care_names",
      "city_matters",
      "quick_replies",
      "remedies",
      "technician_updates",
    ],
    leftAtT: "A message written since, the client's or ours, is gone from its thread",
    putBackBy: "The rows since `<T>`; WhatsApp's own copy shows what was said",
  },
  {
    what: "Technicians' steps, pieces and photographs",
    tables: [
      "job_events",
      "checkins",
      "visit_outcomes",
      "consumables_used",
      "no_show_cases",
      "no_show_disputes",
      "no_show_refunds",
      "pieces",
      "photos",
      "photo_sets",
    ],
    leftAtT:
      "Steps, check-ins, outcomes, pieces fitted, no-shows, disputes and the refunds they owe since are lost; a photograph's file is kept with no row",
    putBackBy: "The rows since `<T>`",
  },
  {
    what: "Hair profiles",
    tables: ["hair_profiles"],
    leftAtT: "A profile recorded since is lost, and one an erasure blanked since is whole again",
    putBackBy: "Adding the rows since `<T>`: they are only ever added. Erasing again blanks the rest",
  },
  {
    what: "Purchase orders",
    tables: ["purchase_orders", "po_lines", "receipts", "receipt_lines", "supplier_claims", "custom_orders"],
    leftAtT:
      "An order drafted since is gone, one approved, sent, received or cancelled since goes back to where it stood, a receipt since is lost with the stock it brought, and a claim or custom order since is gone or back at its earlier step",
    putBackBy:
      "Adding the rows since `<T>`, and each order's, claim's and custom order's state from the audit log and Razorpay",
  },
  {
    what: "Stock",
    tables: [
      "stock_movements",
      "stock_places",
      "stock_lots",
      "stock_lot_moves",
      "stock_transfers",
      "stock_units",
      "stock_unit_events",
      "piece_returns",
    ],
    leftAtT:
      "A delivery, transfer, count or loss recorded since, or a job's use, is lost, so what each place holds is wrong; a hub or stockroom added or changed since goes back, and each piece is where it was",
    putBackBy: "Adding the rows since `<T>`, and setting each unit where its latest line of history puts it",
  },
  {
    what: "Referrals and credits",
    tables: [
      "referral_codes",
      "referral_attributions",
      "credit_ledger",
      "waitlist_entries",
      "referral_channels",
      "channel_attributions",
      "partner_payouts",
      "spend_entries",
    ],
    leftAtT:
      "A credit, a grant, a partner, a partner's payment, an entry of offline spend or a place on a waitlist disappears",
    putBackBy: "The rows since `<T>`. `credit_ledger` is only ever added to",
  },
  {
    what: "Ops' settings and what we sell",
    tables: [
      "ops_settings",
      "price_book",
      "po_letterhead",
      "standard_costs",
      "targets",
      "services",
      "packages",
      "slot_times",
      "serviceable_pincodes",
      "technician_leave",
      "leave_requests",
      "technician_hours",
      "visit_blackouts",
      "city_blackouts",
      "cities",
      "city_prices",
      "city_settings",
      "gst_registrations",
      "zones",
      "consumables",
      "hair_systems",
      "consumable_usage",
      "suppliers",
      "supplier_items",
      "checklist_items",
      "partial_reasons",
      "lost_reasons",
      "pay_grades",
      "visit_pay_rates",
      "word_versions",
      "site_word_publishes",
    ],
    leftAtT:
      "A price, package, service, rule, area, day's times, day off, consumable, supplier, job-sheet list, pay rate or wording set since goes back",
    putBackBy: "Setting it again in the console, which audits it",
  },
  {
    what: "Staff and access",
    tables: ["staff", "staff_grants", "staff_service_tokens", "staff_access_mode"],
    leftAtT: "Someone taken off the Staff list since, or a grant taken back, is let in again",
    putBackBy: "Setting it again on the Staff page, before anything else",
  },
  {
    what: "Tasks",
    tables: ["task_owners", "task_closures", "task_spans", "stock_risks"],
    leftAtT:
      "A task closed since opens again, one given to someone since is nobody's, a task's span closed since closes again the next night, dated then, and a fit's stock risk is found or cleared again within the hour",
    putBackBy: "Closing or giving it again on the Tasks board",
  },
  {
    what: "The audit log",
    tables: ["audit_log"],
    leftAtT: "Who did what since `<T>`",
    putBackBy: "Adding the rows since `<T>`: they are only ever added",
  },
  {
    what: "New people, leads, addresses and try-ons",
    tables: ["people", "leads", "addresses", "tryon_jobs", "crm_contact_updates"],
    leftAtT: "Bookings and leads made since are lost here; the CRM has the leads",
    putBackBy: "The rows since `<T>`",
  },
  {
    what: "Technicians, and the old catalogue table",
    tables: ["technicians", "fsm_items"],
    leftAtT: "A technician added or changed since goes back",
    putBackBy: "The rows since `<T>`; ops can add one again on the Technicians page",
  },
  {
    what: "Recalls",
    tables: ["recalls", "recall_pieces"],
    leftAtT:
      "A recall raised since is gone though its lot stays blocked and its pieces stay due; one closed since is open again",
    putBackBy:
      "Raising the recall again on the Quality page names the same lot, already blocked, so it is refused: ask the engineer",
  },
  {
    what: "Cycle counts",
    tables: ["count_tasks", "count_lines"],
    leftAtT:
      "A count since is open again, though the ledger keeps what it took; a task raised since is raised again the next morning",
    putBackBy: "Counting the task again on the Counts page: the ledger takes a count that agrees with it as nought",
  },
  {
    what: "The demand forecast",
    tables: ["forecast_runs", "forecast_lines", "demand_events", "plan_lines", "forecast_accuracy"],
    leftAtT:
      "A forecast run since is gone and the last before stands until the next is due, an event ops added or took off since is gone or back, a plan line decided since is proposed again, though its transfer or order stands, and a period measured since is measured again from the movements",
    putBackBy: "Adding the events again on the Supply plan page; the next run is due within the planning period",
  },
  {
    what: "Worked out from other tables",
    tables: ["last_visits", "ops_settings_snapshot", "stock_balances", "stock_lot_balances"],
    leftAtT: "Nothing of their own: triggers keep each from the table it is worked out from",
    putBackBy: "Putting back that table",
  },
  {
    what: "India Post's pincodes",
    tables: ["pincode_directory"],
    leftAtT: "A quarter's refresh since is undone, so the console offers India Post's pincodes as they were",
    putBackBy: "Loading the file again: `node scripts/ops/load-pincode-directory.ts <environment>`",
  },
  {
    what: "The storage meter",
    tables: ["stored_objects", "storage_meter"],
    leftAtT: "Objects stored or deleted since are counted wrongly, as R2 is not restored",
    putBackBy: "The rows since `<T>`",
  },
  {
    what: "Housekeeping",
    tables: [
      "alerts",
      "vendor_breakers",
      "board_version",
      "cron_jobs",
      "cron_runs",
      "credit_expiry_cursor",
      "counters",
      "idempotency",
      "number_codes",
      "otp_challenges",
      "tryon_sessions",
      "events",
      "zoho_access_tokens",
    ],
    leftAtT: "Nothing that lasts",
    putBackBy: "Nothing",
  },
  {
    what: "The database's identity, and the restore's own switch",
    tables: ["deployment_identity", "maintenance"],
    leftAtT: "The identity is the same at every minute. Going back undoes the switch, so the steps turn it on again",
    putBackBy: "Nothing",
  },
];
