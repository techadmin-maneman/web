# 0192. Free remakes

- Status: accepted
- Date: 2026-10-13
- Topic: Money and Books

## Context

A first fit or replacement left partly done (the wrong piece in the kit, a skin reaction) offered ops only "Close without follow-up", and the console priced the refit again. The client's Home said "Book your first fit", and one client paid a second time. A recalled hair system's replacement was charged in full, and ops' only way out was a 100%-off code. The console had no way to refund a payment made twice. The owner ruled on 13 October 2026 that a refit or replacement that is not the client's fault is free, with no late fee, and the payment already made carries over.

## Decision

1. **What is owed.** A client is owed a remake for each first fit or replacement left partly done whose Tasks row ops have not closed, each piece they wear from an open recall, and each piece that failed with none fitted since and no replacement on its way (`src/domain/booking/remakes.ts`).
2. **Ops book it.** Book a visit lists what a visit of the kind may make good. Booked so, it costs nothing, carries no late fee and no no-show charge, takes no code, and is audited with what it made good. The Tasks row of a visit left partly done books it ("Book again, free"), as does the recall's list of who wears it.
3. **Ops judge fault.** A visit left partly done through the client's own doing is closed from its Tasks row, and is owed nothing. A failed piece is offered, never booked, free: ops choose.
4. **One remake each.** Booking it closes the visit's Tasks row in the same batch; a booked or paid replacement ends a piece's.
5. **Home says so.** While a first fit or replacement left partly done is owed, or a recalled piece is, the client's Home says we will call to set a day and offers nothing to book or pay. A recall says it is at no cost.
6. **A refund for a payment made twice.** Finance MANAGE may refund what is left of a captured payment, with why, once under the payment's own receipt (ADR 0100), audited.

## Consequences

- The payment for the visit left partly done stays with that visit, so its invoice stands; the remake's is nothing.
- Tests: `test/worker/ops/ops-visits-remakes.test.ts`, `test/worker/app/client-visits-me.test.ts`, `test/worker/money/payment-refunds.test.ts`.
