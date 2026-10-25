// What outbound_messages may hold (migrations/0006_outbound_messages_v2.sql).
// The database leaves kind and subject_kind unchecked, so that a new one needs
// no table rebuild. The list below is every kind the code writes, and its type
// is the check; subject_kind names the table a message's subject_id is in.

/** Each kind of WhatsApp message we send a person. */
export const MESSAGE_KINDS = [
  // The try-on result, with its image.
  "tryon_result",
  // The client's:
  "consultation_confirmation",
  "visit_reminder", // the day before
  "waitlist_confirmation",
  "payment_receipt",
  "nothing_to_pay", // a one visit a discount code left nothing to pay for, once the client is fitted (ADR 0108)
  "link_paid", // the receipt for a one visit paid by its payment link, once the client is fitted
  "upi_received", // the receipt for a visit paid by UPI at the visit, once ops record it; its subject is the payment
  "reschedule_confirmation",
  "cancel_confirmation",
  "visit_cancelled", // ops cancelled the visit from the console
  "visit_moved", // ops moved the visit: the new window
  "move_proposed", // ops ask the client to confirm a move to another day; its subject is the proposal (ADR 0115)
  "arrival_notice", // the technician has arrived
  "technician_update", // on the way, at the gate, or running late, from the job card
  "no_show_decided", // ops ruled on a visit the client was not home for
  "no_show_dispute_ruled", // ops refunded or upheld a no-show's charge the client disputed
  "booking_refunded", // a booking given back by itself; its subject is the hold
  "next_service_reminder", // the next visit falls due soon, and nothing is booked (ADR 0086)
  "friend_fitted", // to the referrer
  "friend_credited", // to the friend: the invite's credits are theirs
  "referral_rejected", // to either side: ops refused a held grant
  "credits_expiring", // free service visits run out: a month before their last day, and a week before
  "launch_alert", // the person's pincode went live
  // The site's booking form, for a number we know (src/domain/booking/site-notices.ts): what the page tells no one.
  "consultation_exists",
  "book_in_app",
  "address_on_account",
  "address_not_served",
  // Ops kept the account the client asked us to delete, with their reason (src/domain/privacy/deletion.ts).
  "deletion_rejected",
  "concern_received", // the client raised a concern about their data, which we have (src/routes/client/data.ts)
  "concern_answered", // ops answered a concern the client raised about their data (src/routes/ops/grievances.ts)
  "recall_notice", // a lot the client wears was recalled: replaced free (src/domain/inventory/recalls.ts)
  // What follows a visit (src/domain/visits/follow-ups.ts): the technician's recommendation after a consultation,
  // the care guide after a fit or a replacement, and the two check-ins after it.
  "consultation_follow_up",
  "fit_aftercare",
  "first_check_in",
  "second_check_in",
  "messages_stopped", // the answer to a STOP reply (src/domain/messages/stop-messages.ts)
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
