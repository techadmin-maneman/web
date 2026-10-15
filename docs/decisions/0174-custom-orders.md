# 0174. Custom orders

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

A client whose profile no stock code matches exactly is made a hair system to order (ADR 0173). The owner ruled on 11 October 2026 that a custom piece is paid in full at order, and that nothing goes to the supplier before then.

## Decision

1. **Ops raise a custom order from the client's Pieces tab,** with Customer care ACT within their places: made to the client's latest profile (wave and a note added), from an active supplier at its price, with what the client pays and the day the supplier promised. A profile missing part of the spec is refused.
2. **Raising it asks Razorpay for a payment link** of the whole price, under the order's ID as its reference, texted to the client. One whose answer never came is found by that reference; one that could not be made tells ops, who send it again.
3. **Razorpay's word that it is paid** records the payment as the client's, marks the order paid, and drafts a purchase order of its own to the supplier: one piece, at the supplier's price, on the stock code made to its spec, found or added as ops add one. The line names the custom order. It is approved and sent as any order is. Each step is written once, however often Razorpay says so.
4. **Where an order stands** is read from it and its purchase order: awaiting payment, paid, ordered once its order is sent, arrived once received, or cancelled. One not yet paid may be cancelled, its link with it.

## Consequences

- Until the fit, the payment sits in Books with nothing to set against, and ops are told (`books_unapplied`). How an advance is invoiced and taxed waits on the CA (INV-4).
- The piece reserved to the client on arrival, the client's view of their order, and refunds for a late or failed piece come next.
- Tests: `test/worker/purchasing/custom-orders.test.ts`, `e2e/ops/clients-visits.e2e.ts`.
