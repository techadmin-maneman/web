// The writes to a core table outside its owner today, as ./table-writers.test.ts finds them. A line comes off when
// the write moves into its owner; none is added.

import type { CoreTable } from "./table-writers.test.ts";

export const WRITTEN_ELSEWHERE: Readonly<Partial<Record<CoreTable, readonly string[]>>> = {
  appointments: [
    "src/domain/booking/bookings.ts",
    "src/domain/booking/move-in-place.ts",
    "src/domain/books/books-invoices.ts",
    "src/domain/clients/client-notes.ts",
    "src/domain/dispatch/dispatch.ts",
    "src/domain/dispatch/technician-roster.ts",
    "src/domain/money/payment-links.ts",
    "src/domain/privacy/erasure-statements.ts",
  ],
  visits: ["src/domain/privacy/erasure-statements.ts"],
  slot_holds: [
    "src/domain/money/discount-code-holds.ts",
    "src/domain/money/payments.ts",
    "src/domain/money/razorpay-catch-up.ts",
    "src/domain/privacy/booking-consents.ts",
    "src/domain/privacy/erasure-statements.ts",
    "src/domain/privacy/erasure.ts",
  ],
  slot_claims: ["src/domain/dispatch/dispatch.ts", "src/domain/privacy/erasure.ts"],
  payments: [
    "src/domain/booking/bookings.ts",
    "src/domain/booking/move-in-place.ts",
    "src/domain/books/books-kept.ts",
    "src/domain/books/books-pass.ts",
    "src/domain/books/books-sync-payments.ts",
  ],
  outbound_messages: [
    "src/domain/booking/waitlist.ts",
    "src/domain/money/payment-links-paid.ts",
    "src/domain/no-shows/ruling-claims.ts",
    "src/domain/ops/needs-a-hand.ts",
    "src/domain/privacy/erasure.ts",
    "src/domain/referrals/channel-grants.ts",
    "src/domain/referrals/referral-grants.ts",
    "src/domain/try-on/tryon-claims.ts",
    "src/domain/try-on/tryon.ts",
    "src/queues/messaging.ts",
    "src/queues/render.ts",
    "src/scheduled/sweeper.ts",
    "src/scheduled/unsent-messages.ts",
  ],
  people: [
    "src/domain/booking/form-person.ts",
    "src/domain/books/books-customers.ts",
    "src/domain/books/books-erasure.ts",
    "src/domain/books/books-sync-customers.ts",
    "src/domain/ops/needs-a-hand.ts",
    "src/domain/privacy/erasure-files.ts",
    "src/domain/privacy/erasure-statements.ts",
    "src/queues/crm-sync.ts",
  ],
  technicians: ["src/domain/field/technician-pay.ts"],
};
