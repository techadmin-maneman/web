# 0125. A partner's discount code

- Status: accepted
- Date: 2026-10-11
- Topic: Referrals

## Context

The owner's scope for partner channels (ADR 0123) gave each partner its own reward for the friend: free service visits, or a discount code. Phase 1 built the visits. An invite's page takes no typed code, the invite being its offer (ADR 0108).

## Decision

1. **One of Finance's codes.** Growth may give a partner one discount code, made on Discount codes, switched on and covering a first fit. It sits beside the partner's free visits, or stands alone with none. A code a partner names cannot be deleted; switching it off ends the offer.
2. **The invite's offer, never typed.** The partner's page says what the code takes off the first fit ("Rs. 2,000 off your first fit."), while the code applies that day. The friend never types it.
3. **Off the first fit by itself.** A consultation and fit in one visit booked from the partner's page takes the code as /book takes a typed one, off the product's price at the payment link. A friend who books the consultation first finds the code on their first fit's hold in the app, entered as the pay step enters one. Where the code no longer applies (ended, used up, switched off), the booking goes ahead at its price: an offer the partner made is never a refusal.
4. **The code's own rules hold**: what it covers, its end, its uses and once a client. Its use is recorded as any other.

## Consequences

- A partner's friend may get both the visits and the code; Growth chooses per partner.
- Tests: `test/worker/referrals/partner-discount.test.ts`, `e2e/refer-landing.e2e.ts`, `e2e/ops/partners.e2e.ts`.
