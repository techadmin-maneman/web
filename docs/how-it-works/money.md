# Money, as it works now

What a client pays, what goes back, and how it reaches the books. Amounts are kept in paise everywhere; the client pays through Razorpay, and nothing here charges anyone by itself.

## Prices

The price book is the only source of prices (`src/domain/money/price-book.ts`): each service by its kind and tier, from a day, so a visit keeps the price it was sold at. A city may set its own price for a service or a late fee, which comes before the national one there (`city_prices`, `src/domain/money/price-lookup.ts`). A hold copies its service's price, late fee and length as it is made. Ops set prices on the Prices page and a city's own on Cities.

A first fit is the hair system and its fitting together; late fees are set in Prices, not as rules.

## Taking a payment

Razorpay is the record of what was paid. Its signed webhook events are queued and applied once each (`src/domain/money/razorpay-events.ts`): the payment kept in our mirror (`src/domain/money/payments.ts`), the hold it paid for booked, the payment link it paid for settled. The cron asks Razorpay about any payment the webhook never told us of, so money never sits there with nothing booked or refunded (`src/domain/money/razorpay-catch-up.ts`).

A visit ops book is paid by a Razorpay payment link (`src/domain/money/payment-links.ts`); so is a consultation and fit in one visit, once the client is fitted, and a custom order before its purchase order goes out (`src/domain/money/custom-order-links.ts`).

Discount codes are made in Settings · Discount codes and entered while a price is still open: by the client on their hold, by the site's form, or by the technician or ops on a visit (`src/domain/money/discount-codes.ts`, `src/policy/discount-codes.ts`).

## Giving money back

A refund is made once however often it is asked for: each carries a receipt no other refund of its payment carries, and Razorpay refuses a second under it (`src/domain/money/refunds.ts`). A cancel's refund is asked for by the request that cancels, and again by the cron if that request could not settle it (`src/domain/money/cancel-refunds.ts`). A hold that could not be kept refunds itself (`src/domain/money/auto-refunds.ts`); ops refund a payment made twice with why (`src/domain/money/payment-refunds.ts`); a custom order is refunded whole when its supplier is late or its piece fails its check (`src/domain/money/custom-order-refunds.ts`).

## Free service visits

Credits are an append-only ledger; a balance is always summed from it (`src/domain/money/credits.ts`). Referrals grant them, Care's remedies grant them, and a visit redeems one. The client is reminded before they run out (`src/domain/money/credit-reminders.ts`).

## Zoho Books

Books is written by the cron's hourly pass, never on a client's path (`src/domain/books/books-sync.ts`): each client's customer, each finished visit's invoice from our own figures, each payment and refund, then bills and vendor credits for stock (`src/domain/books/books-bills.ts`, `src/domain/books/books-credits.ts`). An invoice is sent only once Books' total equals what the client was sold the visit for (`src/domain/books/books-invoices.ts`). A Books refusal reaches ops at once in its own words; any other failure on its third time (`src/domain/books/vendor-pass.ts`).

A client's issued invoice or receipt is kept after its first view and served from storage after, so a Books outage leaves their documents opening (`src/domain/clients/client-documents.ts`). Every Zoho call is counted by India's day, and ops are told at 70% of Books' 5,000 a day (`src/domain/books/books-calls.ts`). Staging writes to the same organisation until it has one of its own ([ADR 0200](../decisions/0200-staging-tenants-of-its-own.md)).

## What ops see

The Payments page reads a day's money: collected, given back, and each charge kept or ruled on (`src/domain/money/day-money.ts`). A client's page lists their payments, refunds, credits, links and invoices (`src/domain/money/client-payments.ts`, `src/domain/money/client-billing.ts`).

## Decisions still worth reading

- [0033, the credit ledger](../decisions/0033-credit-ledger.md) and [0044, the payments mirror](../decisions/0044-payments-mirror.md).
- [0100, a refund is made once](../decisions/0100-a-refund-is-made-once.md).
- [0108, discount codes](../decisions/0108-discount-codes.md) and [0198, cities as data](../decisions/0198-cities-as-data.md).
- [0110, field work without FSM](../decisions/0110-field-work-without-fsm.md), for how invoices are made from our own figures.
